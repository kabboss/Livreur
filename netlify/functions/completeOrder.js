const { MongoClient, ObjectId } = require('mongodb');

// --- Configuration MongoDB ---
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';


const mongoClient = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000
});

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};


// --- Gestionnaire de la fonction Netlify ---
exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({})
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: 'Method Not Allowed'
        };
    }

    let client; // Déclare la variable client pour s'assurer qu'elle est accessible dans le bloc finally

    try {
        // Parse le corps de la requête comme un JSON
        const data = JSON.parse(event.body);

        // Extrait les champs nécessaires du corps JSON.
        // Les champs 'proofBase64', 'proofMimeType', 'originalFilename' ne sont plus attendus.
        const { orderId, serviceType, driverId, driverName, notes } = data;

        // 1. Vérifie si la commande existe et si elle est bien assignée à ce livreur spécifique
        client = await mongoClient.connect();
        const db = client.db(DB_NAME);

        const collectionName = serviceType === 'food' ? 'Comandes' : 'Livraisons';
        const order = await db.collection(collectionName).findOne({
            _id: new ObjectId(orderId),
            driverId: driverId // Vérifie que la commande est bien assignée à ce livreur
        });

        if (!order) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande introuvable ou non assignée à ce livreur' })
            };
        }

        if (order.status === 'livrée') {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande déjà marquée comme livrée' })
            };
        }

        // 2. Met à jour le statut de la commande comme "livrée" dans la base de données
        const updateData = {
            status: 'livrée', // Nouveau statut de la commande
            deliveryNotes: notes || null, // Notes de livraison (maintenant facultatives)
            // REMARQUE : proofUrl est supprimée de la mise à jour
            deliveredAt: new Date() // Horodatage de la livraison
        };

        await db.collection(collectionName).updateOne({ _id: new ObjectId(orderId) }, { $set: updateData });

        // Retourne une réponse de succès
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ message: 'Livraison terminée avec succès' })
        };

    } catch (error) {
        console.error('Erreur :', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message || 'Erreur interne du serveur' })
        };
    } finally {
        if (client) {
            await client.close();
        }
    }
};