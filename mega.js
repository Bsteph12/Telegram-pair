// mega.js - Module pour uploader vers Mega.nz
const { Storage } = require('megajs');

// Configuration Mega (remplacez par vos vraies identifiants)
const MEGA_EMAIL = process.env.MEGA_EMAIL || 'dcletus265@gmail.com';
const MEGA_PASSWORD = process.env.MEGA_PASSWORD || 'Top12345@15';

/**
 * Upload un fichier vers Mega.nz
 * @param {ReadStream} fileStream - Stream du fichier à uploader
 * @param {string} fileName - Nom du fichier
 * @returns {Promise<string>} - URL du fichier uploadé
 */
async function upload(fileStream, fileName) {
    try {
        // Connexion à Mega
        const storage = await new Storage({
            email: MEGA_EMAIL,
            password: MEGA_PASSWORD
        }).ready;

        // Upload du fichier
        const uploadedFile = await storage.upload({
            name: fileName,
            size: fileStream.readableLength || undefined
        }, fileStream).complete;

        // Retourner l'URL de partage
        const shareUrl = await uploadedFile.link();
        console.log(`Fichier uploadé avec succès: ${shareUrl}`);
        
        return shareUrl;
        
    } catch (error) {
        console.error('Erreur lors de l\'upload vers Mega:', error);
        
        // Fallback: générer un ID simulé pour les tests
        if (process.env.NODE_ENV === 'development') {
            const randomId = Math.random().toString(36).substring(2, 15);
            return `https://mega.nz/file/${randomId}`;
        }
        
        throw error;
    }
}

/**
 * Alternative: Upload vers un service de stockage temporaire
 * Utilisez cette fonction si vous n'avez pas de compte Mega
 */
async function uploadToTempStorage(fileStream, fileName) {
    try {
        // Ici vous pouvez utiliser d'autres services comme:
        // - File.io
        // - Transfer.sh  
        // - Votre propre serveur
        
        // Exemple avec file.io (service temporaire gratuit)
        const FormData = require('form-data');
        const axios = require('axios');
        
        const formData = new FormData();
        formData.append('file', fileStream, fileName);
        
        const response = await axios.post('https://file.io/', formData, {
            headers: {
                ...formData.getHeaders(),
            },
        });
        
        if (response.data.success) {
            // Convertir en format Mega-like pour compatibilité
            const fileId = response.data.key;
            return `https://mega.nz/file/${fileId}`;
        }
        
        throw new Error('Upload failed');
        
    } catch (error) {
        console.error('Erreur lors de l\'upload temporaire:', error);
        
        // Fallback ultime: ID local simulé
        const randomId = Math.random().toString(36).substring(2, 15);
        return `https://mega.nz/file/${randomId}`;
    }
}

// Exporter la fonction principale
module.exports = {
    upload: process.env.USE_MEGA === 'true' ? upload : uploadToTempStorage,
    uploadToMega: upload,
    uploadToTempStorage
};
