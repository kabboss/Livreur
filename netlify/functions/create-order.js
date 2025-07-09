const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Commandes';

const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
});

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

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
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const orderData = JSON.parse(event.body);
        
        // Validation des données
        if (!orderData.restaurant || !orderData.items || !orderData.client) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Données de commande incomplètes' })
            };
        }

        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        
        // Construction du document de commande
        const orderDocument = {
            ...orderData,
            restaurantId: orderData.restaurant.id,
            restaurantName: orderData.restaurant.name,
            clientPhone: orderData.client.phone,
            status: 'en attente',
            dateCreation: new Date(),
            lastUpdate: new Date(),
            codeCommande: generateOrderCode(),
            items: orderData.items.map(item => ({
                ...item,
                status: 'à préparer'
            })),
            metadata: {
                appVersion: '1.0',
                source: 'web'
            }
        };

        // Insertion avec vérification
        const result = await collection.insertOne(orderDocument);
        
        if (!result.insertedId) {
            throw new Error('Échec de la création de la commande');
        }

        return {
            statusCode: 201,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                orderId: result.insertedId,
                codeCommande: orderDocument.codeCommande,
                timestamp: orderDocument.dateCreation
            })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: false,
                error: 'Internal Server Error',
                message: error.message
            })
        };
    } finally {
        await client.close();
    }
};

function generateOrderCode() {
    const date = new Date();
    const prefix = 'CMD';
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${date.getFullYear().toString().slice(-2)}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}${random}`;
}