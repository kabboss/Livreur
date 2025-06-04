const { MongoClient, ObjectId } = require('mongodb');
const busboy = require('busboy'); // Pour analyser les données multipart/form-data (utilisé pour les fichiers et champs de formulaire)
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'); // Pour les téléchargements de fichiers vers AWS S3

// --- Configuration MongoDB ---
// URI de connexion à votre cluster MongoDB Atlas
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
// Nom de la base de données à utiliser
const DB_NAME = 'FarmsConnect';

// --- Configuration AWS S3 ---
// Nom de votre bucket S3 où les preuves de livraison seront stockées
const S3_BUCKET_NAME = 'your-s3-bucket-name'; // TODO: Remplacez par le nom réel de votre bucket S3
// Région AWS de votre bucket S3 (ex: 'eu-west-3' pour Paris)
const S3_REGION = 'your-s3-region'; // TODO: Remplacez par votre région S3 réelle

// Création d'une instance du client S3 pour interagir avec AWS
const s3Client = new S3Client({ region: S3_REGION });

// Création d'une instance du client MongoDB avec des options de timeout
const mongoClient = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000, // Durée maximale pour établir une connexion initiale
    serverSelectionTimeoutMS: 5000 // Durée maximale pour trouver un serveur compatible
});

// En-têtes CORS (Cross-Origin Resource Sharing) courants pour autoriser les requêtes depuis n'importe quelle origine
const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*', // Autorise les requêtes de toutes les origines
    'Access-Control-Allow-Headers': 'Content-Type', // Autorise l'envoi de l'en-tête Content-Type
    'Access-Control-Allow-Methods': 'POST, OPTIONS', // Autorise les méthodes POST et OPTIONS
    'Content-Type': 'application/json' // Définit le type de contenu de la réponse comme JSON
};

/**
 * Analyse les données de formulaire au format multipart/form-data contenues dans l'événement Netlify.
 * Ceci est nécessaire pour gérer les téléchargements de fichiers (par ex. preuve de livraison)
 * et les champs de texte du même formulaire.
 * @param {object} event - L'objet événement Netlify contenant la requête HTTP.
 * @returns {Promise<object>} Une promesse qui résout en un objet contenant les champs du formulaire (fields) et les fichiers (files).
 */
function parseFormData(event) {
    return new Promise((resolve, reject) => {
        // Initialise busboy avec les en-têtes de la requête (nécessaire pour détecter le type de contenu)
        const bb = busboy({ headers: event.headers });
        const fields = {}; // Objet pour stocker les champs de texte du formulaire
        const files = {}; // Objet pour stocker les fichiers téléchargés

        // Écoute l'événement 'file' déclenché lorsqu'un fichier est trouvé dans le formulaire
        bb.on('file', (name, file, info) => {
            const { filename, encoding, mimeType } = info;
            let fileBuffer = Buffer.from(''); // Buffer pour accumuler les données du fichier

            // Écoute l'événement 'data' pour collecter les morceaux du fichier
            file.on('data', (data) => {
                fileBuffer = Buffer.concat([fileBuffer, data]);
            });

            // Écoute l'événement 'end' lorsque le fichier est entièrement reçu
            file.on('end', () => {
                files[name] = { // Stocke les informations du fichier par son nom de champ
                    filename,
                    encoding,
                    mimeType,
                    content: fileBuffer, // Le contenu binaire du fichier
                };
            });
        });

        // Écoute l'événement 'field' déclenché lorsqu'un champ de texte est trouvé dans le formulaire
        bb.on('field', (name, val, info) => {
            fields[name] = val; // Stocke la valeur du champ par son nom
        });

        // Écoute l'événement 'close' lorsque l'analyse du formulaire est terminée
        bb.on('close', () => {
            resolve({ fields, files }); // Résout la promesse avec les champs et les fichiers collectés
        });

        // Gère les erreurs qui pourraient survenir pendant l'analyse
        bb.on('error', (err) => {
            reject(err); // Rejette la promesse en cas d'erreur
        });

        // Alimente busboy avec le corps de l'événement Netlify.
        // Convertit le corps en Buffer, en tenant compte de l'encodage base64 si nécessaire.
        bb.end(Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8'));
    });
}

/**
 * Télécharge un buffer de fichier vers AWS S3.
 * @param {object} file - L'objet fichier provenant de `parseFormData` (par exemple, `formData.files.proof`).
 * @returns {Promise<string>} La promesse résout en l'URL publique du fichier téléchargé sur S3.
 */
async function uploadFileToStorage(file) {
    // Vérifie si le fichier ou son contenu est manquant
    if (!file || !file.content) {
        throw new Error('Aucun contenu de fichier fourni pour le téléchargement.');
    }

    // Génère un nom de fichier unique pour éviter les collisions (timestamp + nom original)
    const uniqueFileName = `${Date.now()}-${file.filename}`;
    // Paramètres pour la commande PutObject de S3
    const uploadParams = {
        Bucket: S3_BUCKET_NAME, // Nom du bucket S3 cible
        Key: `proofs/${uniqueFileName}`, // Chemin et nom du fichier dans le bucket (ex: 'proofs/1678912345-image.jpg')
        Body: file.content, // Le contenu binaire du fichier à télécharger
        ContentType: file.mimeType, // Le type MIME du fichier (ex: 'image/jpeg')
        ACL: 'public-read' // Définit les permissions pour que le fichier soit publiquement lisible
    };

    try {
        // Exécute la commande de téléchargement vers S3
        await s3Client.send(new PutObjectCommand(uploadParams));
        // Retourne l'URL publique du fichier téléchargé
        return `https://${S3_BUCKET_NAME}.s3.${S3_REGION}.amazonaws.com/proofs/${uniqueFileName}`;
    } catch (error) {
        // Journalise l'erreur en cas d'échec du téléchargement S3
        console.error('Erreur lors du téléchargement du fichier vers S3 :', error);
        throw new Error('Échec du téléchargement du fichier de preuve.');
    }
}

// --- Gestionnaire de la fonction Netlify ---
exports.handler = async (event) => {
    // Gère la requête de pré-vérification OPTIONS (requête CORS envoyée par les navigateurs)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200, // Répond OK pour autoriser la requête principale
            headers: COMMON_HEADERS, // Inclut les en-têtes CORS
            body: JSON.stringify({}) // Corps vide
        };
    }

    // N'autorise que les requêtes POST pour la logique de traitement principale
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405, // Code pour "Méthode non autorisée"
            headers: COMMON_HEADERS, // Inclut les en-têtes CORS
            body: 'Method Not Allowed' // Message d'erreur
        };
    }

    let client; // Déclare la variable client ici pour s'assurer qu'elle est accessible dans le bloc finally

    try {
        // Tente de se connecter à la base de données MongoDB
        client = await mongoClient.connect();
        const db = client.db(DB_NAME); // Sélectionne la base de données

        // Analyse les données du formulaire, y compris les fichiers téléchargés
        const formData = await parseFormData(event);
        // Extrait les champs nécessaires des données du formulaire
        const { orderId, serviceType, driverId, driverName, notes } = formData.fields;
        // Récupère le fichier de preuve de livraison (en supposant que l'input file a le nom 'proof')
        const proofFile = formData.files.proof;

        // 1. Vérifie si la commande existe et si elle est bien assignée à ce livreur spécifique
        const collectionName = serviceType === 'food' ? 'Comandes' : 'Livraisons';
        const order = await db.collection(collectionName).findOne({
            _id: new ObjectId(orderId), // Recherche par ID de commande (convertit l'ID string en ObjectId MongoDB)
            driverId: driverId // S'assure que la commande est assignée à ce livreur
        });

        // Si la commande n'est pas trouvée ou n'est pas assignée au livreur actuel
        if (!order) {
            return {
                statusCode: 404, // Code pour "Non trouvé"
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande introuvable ou non assignée à ce livreur' })
            };
        }

        // Si la commande est déjà marquée comme "livrée"
        if (order.status === 'livrée') {
             return {
                statusCode: 400, // Code pour "Mauvaise requête" (Bad Request)
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande déjà marquée comme livrée' })
            };
        }

        // 2. Télécharge la preuve de livraison vers S3 (si un fichier a été fourni)
        let proofUrl = null; // Initialise l'URL de la preuve à null
        if (proofFile) {
            proofUrl = await uploadFileToStorage(proofFile); // Appelle la fonction de téléchargement S3
        }

        // 3. Met à jour le statut de la commande comme "livrée" dans la base de données
        const updateData = {
            status: 'livrée', // Nouveau statut de la commande
            deliveryNotes: notes || null, // Notes de livraison, ou null si non fournies
            proofUrl, // URL de la preuve de livraison (peut être null)
            deliveredAt: new Date() // Horodatage de la livraison
        };

        // Exécute la mise à jour de la commande dans la collection appropriée
        await db.collection(collectionName).updateOne({ _id: new ObjectId(orderId) }, { $set: updateData });

        // Retourne une réponse de succès
        return {
            statusCode: 200, // Code "OK"
            headers: COMMON_HEADERS,
            body: JSON.stringify({ message: 'Livraison terminée avec succès' })
        };

    } catch (error) {
        // Gère les erreurs survenues pendant l'exécution de la fonction
        console.error('Erreur :', error); // Journalise l'erreur pour le débogage (visible dans les logs Netlify)
        return {
            statusCode: 500, // Code pour "Erreur interne du serveur"
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message || 'Erreur interne du serveur' }) // Message d'erreur détaillé ou générique
        };
    } finally {
        // Ce bloc s'exécute toujours, que la fonction réussisse ou échoue
        if (client) {
            await client.close(); // S'assure que la connexion au client MongoDB est correctement fermée
        }
    }
};