const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

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
            body: 'Method Not Allowed'
        };
    }

    let client;

    try {
        // Parser les données
        const data = JSON.parse(event.body);
        const { orderId, serviceType, driverName, driverId, notes } = data;

        // Validation des données
        if (!orderId || !serviceType || !driverName || !driverId) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Données requises manquantes' })
            };
        }

        // Connexion à MongoDB
        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Déterminer la collection
        const collectionMap = {
            packages: 'Livraison',
            food: 'Commandes',
            shopping: 'shopping_orders',
            pharmacy: 'pharmacyOrders'
        };

        const collectionName = collectionMap[serviceType];
        if (!collectionName) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Type de service invalide' })
            };
        }

        // Mettre à jour la commande
        const result = await db.collection(collectionName).updateOne(
            { _id: new ObjectId(orderId) },
            { 
                $set: { 
                    status: 'livrée',
                    driverName: driverName,
                    driverId: driverId,
                    deliveryNotes: notes || null,
                    deliveredAt: new Date()
                } 
            }
        );

        if (result.modifiedCount === 0) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande non trouvée' })
            };
        }

        // Enregistrer dans la collection des livraisons
        await db.collection('LivraisonsEffectuees').insertOne({
            orderId: orderId,
            serviceType: serviceType,
            driverName: driverName,
            driverId: driverId,
            deliveryNotes: notes || null,
            deliveryDate: new Date(),
            status: 'livrée'
        });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                message: 'Livraison enregistrée avec succès',
                deliveryId: result.insertedId
            })
        };

    } catch (error) {
        console.error('Erreur:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message })
        };
    } finally {
        if (client) await client.close();
    }
};