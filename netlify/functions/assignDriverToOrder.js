const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB
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

exports.handler = async (event) => {
    // Gérer la requête de pré-vérification OPTIONS pour CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({})
        };
    }

    // Autoriser uniquement les requêtes POST pour la logique principale
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: 'Method Not Allowed'
        };
    }

    let client; // Déclarer le client ici pour qu'il soit accessible dans le bloc finally

    try {
        client = await mongoClient.connect();
        const db = client.db(DB_NAME);

        const data = JSON.parse(event.body);
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverPhone2, driverLocation } = data;

        // 1. Vérifier si la commande existe et n'est pas déjà assignée
        const collectionName = serviceType === 'food' ? 'Comandes' : 'Livraisons';
        const order = await db.collection(collectionName).findOne({ _id: new ObjectId(orderId) });

        if (!order) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande introuvable' })
            };
        }

        if (order.status === 'en cours') {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande déjà assignée' })
            };
        }

        // 2. Mettre à jour la commande
        const updateData = {
            status: 'en cours',
            driverId,
            driverName,
            driverPhone: driverPhone1,
            driverPhone2: driverPhone2 || null,
            driverLocation,
            assignedAt: new Date()
        };

        await db.collection(collectionName).updateOne({ _id: new ObjectId(orderId) }, { $set: updateData });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ message: 'Livreur assigné avec succès' })
        };

    } catch (error) {
        console.error('Erreur :', error); // Journaliser l'erreur pour le débogage
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message || 'Erreur interne du serveur' })
        };
    } finally {
        if (client) {
            await client.close(); // S'assurer que le client MongoDB est fermé
        }
    }
};