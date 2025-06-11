const { MongoClient } = require('mongodb');

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
            body: JSON.stringify({ error: 'Méthode non autorisée' })
        };
    }

    let client;

    try {
        const data = JSON.parse(event.body);
        const { orderId, serviceType, driverName, driverId, notes } = data;

        if (!orderId || !serviceType || !driverName || !driverId) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Données requises manquantes' })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Vérifier l'assignation avec driverId court
        const expedition = await db.collection('cour_expedition').findOne({ 
            $or: [
                { orderId: orderId },
                { codeID: orderId }
            ],
            serviceType: serviceType,
            driverId: driverId
        });

        if (!expedition && serviceType === 'packages') {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Expédition non trouvée ou non assignée à ce livreur' })
            };
        }

        // Déterminer la collection source
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

        // Trouver la commande originale
        const originalOrder = await db.collection(collectionName).findOne({
            $or: [
                { _id: expedition?._id },
                { codeID: orderId }
            ]
        });

        if (!originalOrder) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande originale non trouvée' })
            };
        }

        // Archiver la commande
        await db.collection('LivraisonsEffectuees').insertOne({
            ...originalOrder,
            serviceType: serviceType,
            driverName: driverName,
            driverId: driverId,
            deliveryNotes: notes || null,
            deliveryDate: new Date(),
            status: 'livrée'
        });

        // Supprimer de la collection cour_expedition
        if (expedition) {
            await db.collection('cour_expedition').deleteOne({ 
                _id: expedition._id 
            });
        }

        // Supprimer de la collection originale
        await db.collection(collectionName).deleteOne({
            $or: [
                { _id: originalOrder._id },
                { codeID: orderId }
            ]
        });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                message: 'Livraison terminée et colis archivé',
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