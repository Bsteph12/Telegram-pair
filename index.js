const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require("child_process");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const express = require('express');

// Configuration pour Render
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN manquant dans les variables d\'environnement');
    process.exit(1);
}

// Créer un serveur Express pour maintenir le service actif sur Render
const app = express();

app.get('/', (req, res) => {
    res.json({
        status: 'active',
        bot: 'TERRA-MD Pair Bot',
        version: '2.0',
        uptime: process.uptime(),
        sessions: sessions.size
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Démarrer le serveur Express
app.listen(PORT, () => {
    console.log(`🌐 Serveur démarré sur le port ${PORT}`);
});

// Import des modules WhatsApp
let upload;
try {
    upload = require('./mega').upload;
} catch (e) {
    console.log('⚠️ Module mega non trouvé, utilisation du fallback');
    upload = async (stream, filename) => {
        // Fallback simple qui génère un ID aléatoire
        const randomId = Math.random().toString(36).substring(2, 15);
        return `https://mega.nz/file/${randomId}`;
    };
}

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
} = require("@whiskeysockets/baileys");

// Configuration du bot
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

const MESSAGE = process.env.MESSAGE || `
*SESSION GENERATED SUCCESSFULLY* ✅

*Gɪᴠᴇ ᴀ ꜱᴛᴀʀ ᴛᴏ ʀᴇᴘᴏ ꜰᴏʀ ᴄᴏᴜʀᴀɢᴇ* 🌟
repo

*TERRA-MD--WHATSAPP-BOT* ☃️
`;

// Base de données en mémoire
const sessions = new Map();
const userSessions = new Map();
const pairingProcesses = new Map();

// Fonction pour générer un ID aléatoire
function randomMegaId(length = 6, numberLength = 4) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const number = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${result}${number}`;
}

// Créer les répertoires nécessaires
async function createDirectories() {
    try {
        await fs.ensureDir('./sessions');
        await fs.ensureDir('./temp');
    } catch (error) {
        console.error('Erreur lors de la création des répertoires:', error);
    }
}

// Fonction principale de pairage (optimisée pour Render)
async function startPairingProcess(chatId, phoneNumber) {
    const processId = `${chatId}_${Date.now()}`;
    const authPath = path.join('./temp', `auth_${processId}`);
    
    try {
        // S'assurer que le répertoire existe
        await fs.ensureDir(authPath);
        
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        let Smd = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.macOS("Safari"),
        });

        // Stocker le processus avec timeout
        const timeoutId = setTimeout(async () => {
            console.log(`⏰ Timeout pour le processus ${processId}`);
            await cleanupProcess(processId);
            try {
                await bot.sendMessage(chatId, "⏰ Processus de pairage expiré. Veuillez réessayer avec /pair.");
            } catch (e) {}
        }, 10 * 60 * 1000); // 10 minutes

        pairingProcesses.set(processId, { 
            socket: Smd, 
            chatId, 
            authPath, 
            timeoutId,
            startTime: Date.now()
        });

        if (!Smd.authState.creds.registered) {
            await delay(1500);
            phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
            const code = await Smd.requestPairingCode(phoneNumber);
            
            await bot.sendMessage(chatId, `
🔐 **CODE DE PAIRAGE GÉNÉRÉ**

📱 **Numéro:** +${phoneNumber}
🔑 **Code:** \`${code}\`

**Instructions:**
1. Ouvrez WhatsApp sur votre téléphone
2. Allez dans Paramètres > Appareils liés
3. Appuyez sur "Lier un appareil"
4. Entrez le code: **${code}**

⏰ Le code expire dans 10 minutes.
            `, { parse_mode: 'Markdown' });
        }

        Smd.ev.on('creds.update', saveCreds);
        
        Smd.ev.on("connection.update", async (s) => {
            const { connection, lastDisconnect } = s;

            if (connection === "open") {
                try {
                    await delay(5000); // Réduire le délai pour Render
                    
                    const credsFile = path.join(authPath, 'creds.json');
                    if (await fs.pathExists(credsFile)) {
                        // Upload vers Mega ou service de stockage
                        let sessionId;
                        try {
                            const mega_url = await upload(
                                fs.createReadStream(credsFile), 
                                `${randomMegaId()}.json`
                            );
                            sessionId = mega_url.replace('https://mega.nz/file/', '');
                        } catch (uploadError) {
                            console.log('Erreur upload, génération ID local:', uploadError);
                            sessionId = randomMegaId(12, 6);
                        }
                        
                        // Sauvegarder la session
                        const sessionData = {
                            id: sessionId,
                            chatId: chatId,
                            phoneNumber: phoneNumber,
                            status: 'VERIFIED',
                            createdAt: new Date(),
                            isActive: true
                        };
                        
                        sessions.set(sessionId, sessionData);
                        userSessions.set(chatId, sessionId);
                        
                        // Message de succès
                        await bot.sendMessage(chatId, `
✅ **SESSION CRÉÉE AVEC SUCCÈS**

🆔 **Session ID:** \`${sessionId}\`
📱 **Numéro:** +${phoneNumber}
📅 **Créé le:** ${sessionData.createdAt.toLocaleString()}
🔒 **Status:** ${sessionData.status}

**Instructions:**
1. Copiez le Session ID ci-dessus
2. Ouvrez votre fichier \`config.js\`
3. Collez le Session ID dans la configuration
4. Lancez votre bot

⚠️ **Important:** Gardez ce Session ID confidentiel!

${MESSAGE}
                        `, { parse_mode: 'Markdown' });
                        
                        // Nettoyer
                        await cleanupProcess(processId);
                        saveSessions();
                    }
                } catch (e) {
                    console.log("Erreur lors du traitement:", e);
                    await bot.sendMessage(chatId, "❌ Erreur lors de la création de la session. Veuillez réessayer.");
                    await cleanupProcess(processId);
                }
            }

            if (connection === "close") {
                let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                console.log(`Connexion fermée pour ${processId}:`, reason);
                
                await cleanupProcess(processId);
                
                if (reason !== DisconnectReason.loggedOut) {
                    try {
                        await bot.sendMessage(chatId, "❌ Connexion interrompue. Veuillez réessayer avec /pair.");
                    } catch (e) {}
                }
            }
        });

    } catch (err) {
        console.log("Erreur dans le processus de pairage:", err);
        await cleanupProcess(processId);
        try {
            await bot.sendMessage(chatId, "❌ Erreur lors de l'initialisation. Veuillez réessayer dans quelques minutes.");
        } catch (e) {}
    }
}

// Fonction de nettoyage optimisée
async function cleanupProcess(processId) {
    const process = pairingProcesses.get(processId);
    if (!process) return;

    // Nettoyer le timeout
    if (process.timeoutId) {
        clearTimeout(process.timeoutId);
    }

    // Fermer la connexion socket
    if (process.socket) {
        try {
            process.socket.end();
        } catch (e) {}
    }

    // Supprimer les fichiers temporaires
    if (process.authPath && await fs.pathExists(process.authPath)) {
        try {
            await fs.remove(process.authPath);
        } catch (e) {
            console.log(`Erreur lors du nettoyage de ${process.authPath}:`, e);
        }
    }

    pairingProcesses.delete(processId);
}

// Commandes du bot (identiques à la version précédente)
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;
    
    const welcomeMessage = `
🤖 **TERRA-MD PAIR BOT** ~ 2.0
STATUS: VERIFIED
USER: ${username.toUpperCase()}

Bienvenue dans le système de pairage TERRA-MD!

**Commandes disponibles:**
>> /pair [numéro] - Créer une nouvelle session
>> /delpair - Supprimer votre session
>> /listpair - Lister vos sessions actives

**Exemple:**
\`/pair 237123456789\`

Utilisez /pair suivi de votre numéro WhatsApp pour commencer.
    `;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/pair (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const phoneNumber = match[1].trim();
    
    // Vérifier si l'utilisateur a déjà un processus en cours
    const activeProcess = Array.from(pairingProcesses.values()).find(p => p.chatId === chatId);
    if (activeProcess) {
        bot.sendMessage(chatId, "⚠️ Un processus de pairage est déjà en cours. Veuillez patienter ou utilisez /cancel pour annuler.");
        return;
    }
    
    // Valider le numéro
    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
        bot.sendMessage(chatId, "❌ Numéro de téléphone invalide. Utilisez le format: /pair 237123456789");
        return;
    }
    
    await bot.sendMessage(chatId, `
🔄 **DÉMARRAGE DU PAIRAGE**

📱 Numéro: +${cleanNumber}
⏳ Génération du code de pairage...

Veuillez patienter quelques instants...
    `);
    
    await startPairingProcess(chatId, cleanNumber);
});

bot.onText(/^\/pair$/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
❌ **Numéro de téléphone requis**

**Utilisation:** \`/pair [numéro]\`

**Exemples:**
• \`/pair 237123456789\`
• \`/pair +237 123 456 789\`

Le numéro doit être celui associé à votre compte WhatsApp.
    `, { parse_mode: 'Markdown' });
});

bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    
    const activeProcess = Array.from(pairingProcesses.entries()).find(([_, p]) => p.chatId === chatId);
    if (activeProcess) {
        const [processId] = activeProcess;
        await cleanupProcess(processId);
        bot.sendMessage(chatId, "✅ Processus de pairage annulé.");
    } else {
        bot.sendMessage(chatId, "❌ Aucun processus de pairage en cours.");
    }
});

// Fonction pour sauvegarder les sessions
function saveSessions() {
    const data = {
        sessions: Array.from(sessions.entries()),
        userSessions: Array.from(userSessions.entries()),
        timestamp: new Date().toISOString()
    };
    
    fs.writeFile('./sessions/sessions.json', JSON.stringify(data, null, 2))
        .then(() => console.log('✅ Sessions sauvegardées'))
        .catch(err => console.error('❌ Erreur sauvegarde:', err));
}

// Fonction pour charger les sessions
async function loadSessions() {
    try {
        const sessionFile = './sessions/sessions.json';
        if (await fs.pathExists(sessionFile)) {
            const data = await fs.readJSON(sessionFile);
            
            if (data.sessions) {
                data.sessions.forEach(([key, value]) => {
                    sessions.set(key, value);
                });
            }
            
            if (data.userSessions) {
                data.userSessions.forEach(([key, value]) => {
                    userSessions.set(key, value);
                });
            }
            
            console.log('✅ Sessions chargées');
        }
    } catch (error) {
        console.error('❌ Erreur lors du chargement des sessions:', error);
    }
}

// Nettoyage périodique des processus expirés
setInterval(async () => {
    const now = Date.now();
    for (const [processId, process] of pairingProcesses.entries()) {
        // Nettoyer les processus de plus de 15 minutes
        if (now - process.startTime > 15 * 60 * 1000) {
            console.log(`🧹 Nettoyage du processus expiré: ${processId}`);
            await cleanupProcess(processId);
        }
    }
}, 5 * 60 * 1000); // Vérifier toutes les 5 minutes

// Sauvegarde périodique
setInterval(() => {
    if (sessions.size > 0) {
        saveSessions();
    }
}, 10 * 60 * 1000); // Sauvegarder toutes les 10 minutes

// Gestion des erreurs
bot.on('error', (error) => {
    console.error('❌ Erreur du bot:', error);
});

bot.on('polling_error', (error) => {
    console.error('❌ Erreur de polling:', error);
});

// Nettoyage à l'arrêt
process.on('SIGTERM', async () => {
    console.log('🛑 Arrêt du service...');
    
    // Sauvegarder les sessions
    saveSessions();
    
    // Nettoyer tous les processus
    for (const processId of pairingProcesses.keys()) {
        await cleanupProcess(processId);
    }
    
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Interruption du service...');
    
    // Sauvegarder les sessions
    saveSessions();
    
    // Nettoyer tous les processus
    for (const processId of pairingProcesses.keys()) {
        await cleanupProcess(processId);
    }
    
    process.exit(0);
});

// Initialisation
(async () => {
    await createDirectories();
    await loadSessions();
    
    console.log('🤖 TERRA-MD Pair Bot démarré sur Render...');
    console.log(`🌐 Port: ${PORT}`);
    console.log('📊 Sessions chargées:', sessions.size);
})();

module.exports = { bot, app };
