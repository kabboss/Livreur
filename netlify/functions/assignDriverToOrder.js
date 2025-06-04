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
        const data = JSON.parse(event.body);
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverPhone2, driverLocation } = data;

        // Validation des données
        if (!orderId || !serviceType || !driverId || !driverName || !driverPhone1) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Données requises manquantes' })
            };
        }

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

        // Convertir orderId en ObjectId seulement si c'est un format valide
        let query;
        try {
            query = { _id: new ObjectId(orderId) };
        } catch (e) {
            // Si orderId n'est pas un ObjectId valide, chercher par un autre champ (comme codeID)
            query = { codeID: orderId };
        }

        // Mettre à jour la commande
        const result = await db.collection(collectionName).updateOne(
            query,
            { 
                $set: { 
                    status: 'en cours',
                    driverId: driverId,
                    driverName: driverName,
                    driverPhone: driverPhone1,
                    driverPhone2: driverPhone2 || null,
                    driverLocation: driverLocation,
                    assignedAt: new Date()
                } 
            }
        );

        if (result.modifiedCount === 0) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande non trouvée ou déjà assignée' })
            };
        }

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                message: 'Livreur assigné avec succès',
                orderId: orderId
            })
        };

    } catch (error) {
        console.error('Erreur:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    } finally {
        if (client) await client.close();
    }
};