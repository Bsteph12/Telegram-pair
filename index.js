// index.js
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs-extra');
const { exec } = require("child_process");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const { upload } = require('./mega');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
} = require("@whiskeysockets/baileys");

// Configuration
const BOT_TOKEN = '8310552962:AAGgt5c0JnWshhO4mKNQboTIHe8e3yFV1qg';
const IMAGE_URL = 'https://i.postimg.cc/W4bNVMWp/3a53da274b6548f6faeb96424f5262a5.jpg';
const PORT = process.env.PORT || 3000;

// Messages
const WELCOME_MESSAGE = `
🤖 *REM PAIR BOT* 

Bienvenue ! Je peux vous aider à générer une session WhatsApp.

*Commandes disponibles :*
• /pair <numéro> - Générer un code de pairing
• /help - Afficher cette aide
• /status - Vérifier le statut du bot

*Exemple :* /pair +237123456789
`;

const SUCCESS_MESSAGE = `
*SESSION GÉNÉRÉE AVEC SUCCÈS* ✅

*Votre session WhatsApp est prête* 🎉

*REM-MD BOT* ☃️
`;

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

// Middleware
app.use(express.json());

// Store active sessions
const activeSessions = new Map();

// Ensure auth directory exists and is clean
function ensureAuthDir() {
    const authDir = './auth_info_baileys';
    if (fs.existsSync(authDir)) {
        fs.emptyDirSync(authDir);
    } else {
        fs.ensureDirSync(authDir);
    }
}

// Generate random Mega ID
function randomMegaId(length = 6, numberLength = 4) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const number = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${result}${number}`;
}

// WhatsApp pairing function
async function createWhatsAppSession(chatId, phoneNumber) {
    ensureAuthDir();
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
        
        const Smd = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.macOS("Safari"),
        });

        // Store session
        activeSessions.set(chatId, Smd);

        if (!Smd.authState.creds.registered) {
            await delay(1500);
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
            const code = await Smd.requestPairingCode(cleanNumber);
            
            await bot.sendMessage(chatId, `
🔐 *Code de Pairing Généré*

*Numéro :* ${phoneNumber}
*Code :* \`${code}\`

*Instructions :*
1. Ouvrez WhatsApp sur votre téléphone
2. Allez dans Paramètres > Appareils liés
3. Appuyez sur "Lier un appareil"
4. Entrez ce code : *${code}*

⏳ En attente de la connexion...
            `, { parse_mode: 'Markdown' });
        }

        Smd.ev.on('creds.update', saveCreds);
        
        Smd.ev.on("connection.update", async (s) => {
            const { connection, lastDisconnect } = s;

            if (connection === "open") {
                try {
                    await delay(10000);
                    
                    if (fs.existsSync('./auth_info_baileys/creds.json')) {
                        const auth_path = './auth_info_baileys/';
                        let user = Smd.user.id;

                        // Upload credentials to Mega
                        const mega_url = await upload(
                            fs.createReadStream(auth_path + 'creds.json'), 
                            `${randomMegaId()}.json`
                        );
                        const sessionId = mega_url.replace('https://mega.nz/file/', '');

                        // Send session info to Telegram
                        await bot.sendMessage(chatId, `
✅ *SESSION CRÉÉE AVEC SUCCÈS*

*ID de Session :* \`${sessionId}\`

*Informations :*
• Status: Vérifié ✅
• Utilisateur: ${user.split('@')[0]}
• Type: REM ~ 2.0

*Commandes disponibles :*
• /pair - Nouvelle session
• /delpair - Supprimer session
• /listpair - Liste des sessions

${SUCCESS_MESSAGE}
                        `, { parse_mode: 'Markdown' });

                        // Send session ID as a separate message for easy copying
                        await bot.sendMessage(chatId, sessionId);
                        
                        // Clean up
                        await delay(1000);
                        try { 
                            await fs.emptyDirSync('./auth_info_baileys'); 
                        } catch (e) {
                            console.log("Cleanup error:", e);
                        }
                    }
                } catch (e) {
                    console.log("Error during session creation:", e);
                    await bot.sendMessage(chatId, `
❌ *Erreur lors de la création de la session*

${e.message}

Veuillez réessayer avec /pair <numéro>
                    `, { parse_mode: 'Markdown' });
                }

                // Remove from active sessions
                activeSessions.delete(chatId);
            }

            if (connection === "close") {
                let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
                
                if (reason === DisconnectReason.connectionClosed) {
                    console.log("Connection closed!");
                    await bot.sendMessage(chatId, "⚠️ Connexion fermée. Veuillez réessayer.");
                } else if (reason === DisconnectReason.connectionLost) {
                    console.log("Connection Lost from Server!");
                    await bot.sendMessage(chatId, "⚠️ Connexion perdue. Veuillez réessayer.");
                } else if (reason === DisconnectReason.timedOut) {
                    console.log("Connection TimedOut!");
                    await bot.sendMessage(chatId, "⏰ Délai d'attente dépassé. Veuillez réessayer.");
                } else {
                    console.log('Connection closed with bot:', reason);
                    await bot.sendMessage(chatId, "❌ Erreur de connexion. Veuillez réessayer.");
                }
                
                activeSessions.delete(chatId);
            }
        });

    } catch (err) {
        console.log("Error in createWhatsAppSession:", err);
        activeSessions.delete(chatId);
        await bot.sendMessage(chatId, `
❌ *Erreur*

Une erreur est survenue lors de la création de la session.
Veuillez réessayer dans quelques minutes.

*Erreur :* ${err.message}
        `, { parse_mode: 'Markdown' });
    }
}

// Bot command handlers
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        // Send the image with welcome message
        await bot.sendPhoto(chatId, IMAGE_URL, {
            caption: WELCOME_MESSAGE,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.log("Error sending image:", error);
        // Fallback to text message if image fails
        await bot.sendMessage(chatId, WELCOME_MESSAGE, { parse_mode: 'Markdown' });
    }
});

bot.onText(/\/pair(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const phoneNumber = match[1] ? match[1].trim() : '';
    
    if (!phoneNumber) {
        await bot.sendMessage(chatId, `
❌ *Numéro manquant*

Veuillez fournir un numéro de téléphone.

*Exemple :* /pair +237123456789
        `, { parse_mode: 'Markdown' });
        return;
    }

    // Check if session is already active for this chat
    if (activeSessions.has(chatId)) {
        await bot.sendMessage(chatId, `
⚠️ *Session en cours*

Une session est déjà en cours de création.
Veuillez attendre qu'elle se termine.
        `, { parse_mode: 'Markdown' });
        return;
    }

    await bot.sendMessage(chatId, `
🔄 *Génération de la session en cours...*

*Numéro :* ${phoneNumber}

Veuillez patienter...
    `, { parse_mode: 'Markdown' });

    await createWhatsAppSession(chatId, phoneNumber);
});

bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, WELCOME_MESSAGE, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const activeCount = activeSessions.size;
    
    await bot.sendMessage(chatId, `
📊 *Statut du Bot*

*Status :* ✅ En ligne
*Sessions actives :* ${activeCount}
*Version :* REM ~ 2.0

*Bot créé pour générer des sessions WhatsApp*
    `, { parse_mode: 'Markdown' });
});

bot.onText(/\/delpair/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (activeSessions.has(chatId)) {
        activeSessions.delete(chatId);
        await bot.sendMessage(chatId, "✅ Session supprimée avec succès.");
    } else {
        await bot.sendMessage(chatId, "❌ Aucune session active à supprimer.");
    }
});

bot.onText(/\/listpair/, async (msg) => {
    const chatId = msg.chat.id;
    const activeCount = activeSessions.size;
    
    await bot.sendMessage(chatId, `
📋 *Liste des Sessions*

*Sessions actives :* ${activeCount}

${activeCount > 0 ? "🟢 Session en cours de création" : "🔴 Aucune session active"}
    `, { parse_mode: 'Markdown' });
});

// Health check endpoint for Render
app.get('/', (req, res) => {
    res.json({ 
        status: 'Bot is running', 
        uptime: process.uptime(),
        activeSessions: activeSessions.size 
    });
});

// Error handling
bot.on('error', (error) => {
    console.log('Bot error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Bot is active and listening for commands...');
});

console.log('Telegram WhatsApp Pairing Bot started...');
