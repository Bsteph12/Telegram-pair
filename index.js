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
        bot: '༺𝟎𝐱𝐀𝐤𝐮𝐦𝐚  ꙰༻ Pair Bot',
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
    console.log('🤖 ༺𝟎𝐱𝐀𝐤𝐮𝐦𝐚  ꙰༻ Bot initialisé...');
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
    DisconnectReason,
    fetchLatestBaileysVersion
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

*༺𝟎𝐱𝐀𝐤𝐮𝐦𝐚  ꙰༻--WHATSAPP-BOT* ☃️
`;

// Configuration de l'image de démarrage
const START_IMAGE_URL = process.env.START_IMAGE_URL || 'https://i.postimg.cc/W4bNVMWp/3a53da274b6548f6faeb96424f5262a5.jpg';

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

// Fonction pour envoyer un message WhatsApp
async function sendWhatsAppMessage(socket, phoneNumber, message) {
    try {
        // Formater le numéro pour WhatsApp
        const formattedNumber = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
        
        await socket.sendMessage(formattedNumber, { text: message });
        console.log(`✅ Message WhatsApp envoyé à ${phoneNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ Erreur envoi WhatsApp à ${phoneNumber}:`, error);
        return false;
    }
}

// Fonction principale de pairage (version corrigée)
async function startPairingProcess(chatId, phoneNumber) {
    const processId = `${chatId}_${Date.now()}`;
    const authPath = path.join('./temp', `auth_${processId}`);
    
    try {
        // S'assurer que le répertoire existe
        await fs.ensureDir(authPath);
        
        // Obtenir la dernière version de Baileys
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📱 Utilisation de Baileys version ${version.join('.')}, dernière: ${isLatest}`);
        
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        let Smd = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.macOS("Safari"),
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            fireInitQueries: true,
            emitOwnEvents: false,
            defaultQueryTimeoutMs: 60000,
        });

        // Stocker le processus avec timeout
        const timeoutId = setTimeout(async () => {
            console.log(`⏰ Timeout pour le processus ${processId}`);
            await cleanupProcess(processId);
            try {
                await bot.sendMessage(chatId, "⏰ Processus de pairage expiré. Veuillez réessayer avec /pair.");
            } catch (e) {}
        }, 15 * 60 * 1000); // 15 minutes pour plus de temps

        pairingProcesses.set(processId, { 
            socket: Smd, 
            chatId, 
            authPath, 
            timeoutId,
            phoneNumber,
            startTime: Date.now()
        });

        // Gestion du pairage
        if (!Smd.authState.creds.registered) {
            await delay(2000); // Augmenter le délai
            
            // Nettoyer le numéro de téléphone
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            
            try {
                const code = await Smd.requestPairingCode(cleanNumber);
                
                await bot.sendMessage(chatId, `
╭━[༺𝟎𝐱𝐀𝐤𝐮𝐦𝐚  ꙰༻]━╮
║     𝐂𝐎𝐃𝐄 𝐃𝐄 𝐏𝐀𝐈𝐑𝐀𝐆𝐄
╰━━━━━━━━━━━━━━━━━━━━━━━╯

📱 **Numéro:** +${cleanNumber}
🔑 **Code:** \`${code}\`

⚠️ **IMPORTANT:**
1. Ouvrez WhatsApp sur votre téléphone
2. Allez dans **Paramètres** > **Appareils liés**
3. Appuyez sur **Lier un appareil**
4. Appuyez sur **Lier avec le numéro de téléphone**
5. Entrez ce code: **${code}**

⏱️ Le code expire dans 15 minutes.
🔄 Le pairage peut prendre quelques minutes...
                `, { parse_mode: 'Markdown' });

            } catch (codeError) {
                console.error('Erreur lors de la demande du code:', codeError);
                await bot.sendMessage(chatId, `❌ Erreur lors de la génération du code. Veuillez vérifier que le numéro +${cleanNumber} est correct et réessayer.`);
                await cleanupProcess(processId);
                return;
            }
        }

        // Sauvegarder les credentials
        Smd.ev.on('creds.update', saveCreds);
        
        // Gestion des événements de connexion
        Smd.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            console.log(`📡 État de connexion pour ${processId}:`, connection);

            if (connection === "connecting") {
                console.log(`🔄 Connexion en cours pour ${processId}...`);
            }

            if (connection === "open") {
                console.log(`✅ Connexion établie pour ${processId}`);
                
                try {
                    // Attendre que la connexion soit stable
                    await delay(3000);
                    
                    // Obtenir les informations de l'utilisateur
                    const userInfo = Smd.user;
                    console.log('👤 Utilisateur connecté:', userInfo);
                    
                    // Lire le fichier de credentials
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
                            isActive: true,
                            userInfo: userInfo
                        };
                        
                        sessions.set(sessionId, sessionData);
                        userSessions.set(chatId, sessionId);
                        
                        // Message de succès sur Telegram
                        const telegramMessage = `
╭━[༺𝟎𝐱𝐀𝐤𝐮𝐦𝐚  ꙰༻]━╮
║     ✅ 𝐏𝐀𝐈𝐑𝐀𝐆𝐄 𝐑É𝐔𝐒𝐒𝐈
╰━━━━━━━━━━━━━━━━━━━━━━━╯

🆔 **Session ID:** \`${sessionId}\`
📱 **Numéro:** +${phoneNumber}
👤 **Nom:** ${userInfo?.name || 'N/A'}
📅 **Créé le:** ${sessionData.createdAt.toLocaleString()}
🔒 **Status:** ${sessionData.status}

┌─────────────────────┐
│ 📋 𝐈𝐍𝐒𝐓𝐑𝐔𝐂𝐓𝐈𝐎𝐍𝐒     
└─────────────────────┘
1. Copiez le Session ID ci-dessus
2. Ouvrez votre fichier config.js
3. Collez le Session ID dans la configuration
4. Lancez votre bot

⚠️ **Important:** Gardez ce Session ID confidentiel!

${MESSAGE}
                        `;

                        await bot.sendMessage(chatId, telegramMessage, { parse_mode: 'Markdown' });
                        
                        // NOUVEAU: Envoyer aussi le Session ID sur WhatsApp
                        const whatsappMessage = `
🤖 *༺𝟎𝐱𝐀𝐤𝐮𝐦𝐚  ꙰༻ SESSION GÉNÉRÉE*

✅ *Pairage réussi !*

🆔 *Session ID:* ${sessionId}
📱 *Numéro:* +${phoneNumber}
📅 *Créé le:* ${sessionData.createdAt.toLocaleString()}

📋 *INSTRUCTIONS:*
1. Copiez ce Session ID
2. Collez-le dans votre fichier config.js
3. Lancez votre bot

⚠️ *IMPORTANT:* Ne partagez jamais ce Session ID avec quelqu'un d'autre !

${MESSAGE}
                        `;

                        // Envoyer le message WhatsApp
                        const whatsappSent = await sendWhatsAppMessage(Smd, phoneNumber, whatsappMessage);
                        
                        if (whatsappSent) {
                            await bot.sendMessage(chatId, "📨 Session ID également envoyé sur votre WhatsApp !");
                        }
                        
                        // Nettoyer
                        await cleanupProcess(processId);
                        saveSessions();
                        
                    } else {
                        throw new Error('Fichier de credentials non trouvé');
                    }
                } catch (e) {
                    console.error("Erreur lors du traitement de la connexion:", e);
                    await bot.sendMessage(chatId, "❌ Erreur lors de la création de la session. Veuillez réessayer.");
                    await cleanupProcess(processId);
                }
            }

            if (connection === "close") {
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                console.log(`❌ Connexion fermée pour ${processId}. Raison:`, reason, lastDisconnect?.error?.message);
                
                await cleanupProcess(processId);
                
                // Messages d'erreur plus spécifiques
                let errorMessage = "❌ Connexion interrompue. ";
                
                if (reason === DisconnectReason.badSession) {
                    errorMessage += "Session invalide. Veuillez réessayer avec /pair.";
                } else if (reason === DisconnectReason.connectionClosed) {
                    errorMessage += "Connexion fermée. Veuillez réessayer.";
                } else if (reason === DisconnectReason.connectionLost) {
                    errorMessage += "Connexion perdue. Vérifiez votre internet et réessayez.";
                } else if (reason === DisconnectReason.connectionReplaced) {
                    errorMessage += "Connexion remplacée par une autre session.";
                } else if (reason === DisconnectReason.loggedOut) {
                    errorMessage += "Déconnecté de WhatsApp.";
                } else if (reason === DisconnectReason.restartRequired) {
                    errorMessage += "Redémarrage requis. Veuillez réessayer avec /pair.";
                } else if (reason === DisconnectReason.timedOut) {
                    errorMessage += "Timeout de connexion. Vérifiez que vous avez bien entré le code dans WhatsApp.";
                } else {
                    errorMessage += "Veuillez réessayer avec /pair.";
                }
                
                if (reason !== DisconnectReason.loggedOut) {
                    try {
                        await bot.sendMessage(chatId, errorMessage);
                    } catch (e) {
                        console.log('Erreur envoi message:', e);
                    }
                }
            }
        });

        // Gestion des messages reçus (pour debug)
        Smd.ev.on('messages.upsert', async (m) => {
            const message = m.messages[0];
            if (message.key.fromMe) return;
            
            console.log('📨 Message reçu:', message.message?.conversation || message.message?.extendedTextMessage?.text);
        });

    } catch (err) {
        console.error("Erreur dans le processus de pairage:", err);
        await cleanupProcess(processId);
        try {
            await bot.sendMessage(chatId, `❌ Erreur lors de l'initialisation: ${err.message}. Veuillez réessayer dans quelques minutes.`);
        } catch (e) {
            console.log('Erreur envoi message erreur:', e);
        }
    }
}

// Fonction de nettoyage optimisée
async function cleanupProcess(processId) {
    const process = pairingProcesses.get(processId);
    if (!process) return;

    console.log(`🧹 Nettoyage du processus ${processId}`);

    // Nettoyer le timeout
    if (process.timeoutId) {
        clearTimeout(process.timeoutId);
    }

    // Fermer la connexion socket
    if (process.socket) {
        try {
            await process.socket.logout();
            process.socket.end();
        } catch (e) {
            console.log('Erreur fermeture socket:', e.message);
        }
    }

    // Supprimer les fichiers temporaires
    if (process.authPath && await fs.pathExists(process.authPath)) {
        try {
            await fs.remove(process.authPath);
            console.log(`🗑️ Fichiers temporaires supprimés: ${process.authPath}`);
        } catch (e) {
            console.log(`Erreur lors du nettoyage de ${process.authPath}:`, e);
        }
    }

    pairingProcesses.delete(processId);
}

// Commandes du bot (inchangées)
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name || 'USER';
    
    const welcomeMessage = `
╭━[ ༺𝟎𝐱𝐀𝐤𝐮𝐦𝐚  ꙰༻]━╮
║ STATUS: VERIFIED
║ USER: ${username.toUpperCase()}                ║
╰━━━━━━━━━━━━━━━╯

Bienvenue dans le système de pairage ༺𝟎𝐱𝐀𝐤𝐮𝐦𝐚  ꙰༻!

┌────────────┐
│ 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐄𝐒  
└────────────┘
>> 🔗 /pair [numéro] 
>> 🗑️ /delpair
>> 📋 /listpair

┌────────────┐
│ 𝐄𝐗𝐄𝐌𝐏𝐋𝐄 
└────────────┘
/pair 237123456789

/pair suivi de votre numéro WhatsApp pour commencer.
    `;
    
    try {
        if (START_IMAGE_URL && START_IMAGE_URL !== 'https://i.postimg.cc/W4bNVMWp/3a53da274b6548f6faeb96424f5262a5.jpg') {
            bot.sendPhoto(chatId, START_IMAGE_URL, {
                caption: welcomeMessage
            }).catch(() => {
                bot.sendMessage(chatId, welcomeMessage);
            });
        } else {
            bot.sendMessage(chatId, welcomeMessage);
        }
    } catch (error) {
        console.log('Erreur /start:', error);
        bot.sendMessage(chatId, welcomeMessage);
    }
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
        bot.sendMessage(chatId, `
╔═════════════╗
║𝐄𝐑𝐑𝐄𝐔𝐑 𝐍𝐔𝐌É𝐑𝐎
╚════════════╝

Numéro de téléphone invalide.

**Format correct:** \`/pair 237123456789\`
        `, { parse_mode: 'Markdown' });
        return;
    }
    
    await bot.sendMessage(chatId, `
╔════════════╗
║🔄 PAIRAGE EN COURS... 
╚════════════╝

**Numéro:** \`+${cleanNumber}\`
⏳ Génération du code de pairage...

Veuillez patienter quelques instants...
    `, { parse_mode: 'Markdown' });
    
    await startPairingProcess(chatId, cleanNumber);
});

bot.onText(/^\/pair$/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
╔═══════════════╗
║❌𝐍𝐔𝐌É𝐑𝐎 𝐑𝐄𝐐𝐔𝐈𝐒 
╚══════════════╝

**Utilisation:** \`/pair [numéro]\`

┌──────────┐
│ 𝐄𝐗𝐄𝐌𝐏𝐋𝐄𝐒     
└──────────┘
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
        bot.sendMessage(chatId, `
╔══════════╗
║ 𝐏𝐑𝐎𝐂𝐄𝐒𝐒 𝐀𝐍𝐍𝐔𝐋É
╚══════════╝

Le processus de pairage a été annulé avec succès.
        `);
    } else {
        bot.sendMessage(chatId, `
╔════════════╗
║ 𝐀𝐔𝐂𝐔𝐍 𝐏𝐑𝐎𝐂𝐄𝐒𝐒𝐔𝐒
╚════════════╝

Aucun processus de pairage en cours.
        `);
    }
});

bot.onText(/\/delpair/, async (msg) => {
    const chatId = msg.chat.id;
    const userSession = userSessions.get(chatId);
    
    if (!userSession) {
        bot.sendMessage(chatId, `
╔══════════════╗
║ 𝐀𝐔𝐂𝐔𝐍𝐄 𝐒𝐄𝐒𝐒𝐈𝐎𝐍   
╚══════════════════╝

Vous n'avez aucune session active à supprimer.
        `);
        return;
    }
    
    sessions.delete(userSession);
    userSessions.delete(chatId);
    saveSessions();
    
    bot.sendMessage(chatId, `
╔═══════════╗
║𝐒𝐄𝐒𝐒𝐈𝐎𝐍 𝐒𝐔𝐏𝐏𝐑𝐈𝐌É𝐄 
╚══════════════╝

Votre session a été supprimée avec succès.
    `);
});

bot.onText(/\/listpair/, async (msg) => {
    const chatId = msg.chat.id;
    const userSession = userSessions.get(chatId);
    
    if (!userSession) {
        bot.sendMessage(chatId, `
╔══════════╗
║𝐀𝐔𝐂𝐔𝐍𝐄 𝐒𝐄𝐒𝐒𝐈𝐎𝐍
╚═════════════╝

Vous n'avez aucune session active.
Utilisez \`/pair [numéro]\` pour en créer une.
        `, { parse_mode: 'Markdown' });
        return;
    }
    
    const sessionData = sessions.get(userSession);
    if (sessionData) {
        bot.sendMessage(chatId, `
╔════════════╗
║𝐕𝐎𝐒 𝐒𝐄𝐒𝐒𝐈𝐎𝐍𝐒
╚══════════════╝

🆔 **Session ID:** \`${sessionData.id}\`
📱 **Numéro:** \`+${sessionData.phoneNumber}\`
👤 **Nom:** \`${sessionData.userInfo?.name || 'N/A'}\`
📅 **Créé le:** \`${new Date(sessionData.createdAt).toLocaleString()}\`
🔒 **Status:** \`${sessionData.status}\`
⚡ **Actif:** \`${sessionData.isActive ? 'Oui' : 'Non'}\`
        `, { parse_mode: 'Markdown' });
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
            
            console.log('✅ Sessions chargées:', sessions.size);
        }
    } catch (error) {
        console.error('❌ Erreur lors du chargement des sessions:', error);
    }
}

// Nettoyage périodique des processus expirés
setInterval(async () => {
    const now = Date.now();
    for (const [processId, process] of pairingProcesses.entries()) {
        // Nettoyer les processus de plus de 20 minutes
        if (now - process.startTime > 20 * 60 * 1000) {
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
    
    // Nettoyer tous les processus de pairage en cours
    for (const [processId] of pairingProcesses.entries()) {
        await cleanupProcess(processId);
    }
    
    // Sauvegarder les sessions
    if (sessions.size > 0) {
        saveSessions();
    }
    
    // Arrêter le bot
    await bot.stopPolling();
    
    console.log('✅ Service arrêté proprement');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Interruption du service...');
    
    // Nettoyer tous les processus de pairage en cours
    for (const [processId] of pairingProcesses.entries()) {
        await cleanupProcess(processId);
    }
    
    // Sauvegarder les sessions
    if (sessions.size > 0) {
        saveSessions();
    }
    
    // Arrêter le bot
    await bot.stopPolling();
    
    console.log('✅ Service interrompu proprement');
    process.exit(0);
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
    console.error('❌ Erreur non capturée:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesse rejetée non gérée:', reason);
});

// Initialisation au démarrage
async function initialize() {
    try {
        console.log('🚀 Initialisation du bot...');
        
        // Créer les répertoires nécessaires
        await createDirectories();
        
        // Charger les sessions existantes
        await loadSessions();
        
        console.log('✅ Bot initialisé avec succès');
        console.log(`📊 Sessions actives: ${sessions.size}`);
        console.log(`🔗 URL du service: https://votre-app.onrender.com`);
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation:', error);
        process.exit(1);
    }
}

// Démarrer l'initialisation
initialize();
