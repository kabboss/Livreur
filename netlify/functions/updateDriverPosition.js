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
            body: JSON.stringify({ error: 'Méthode non autorisée' })
        };
    }

    let client;

    try {
        const data = JSON.parse(event.body);
        const { orderId, driverId, location } = data;

        if (!orderId || !driverId || !location) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Données requises manquantes' })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Vérifier d'abord dans cour_expedition pour les colis
        const expedition = await db.collection('cour_expedition').findOne({ 
            orderId: orderId,
            serviceType: 'packages'
        });

        if (!expedition) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Expédition non trouvée' })
            };
        }

        // Vérifier que le livreur correspond
        if (expedition.driverId !== driverId) {
            return {
                statusCode: 403,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Vous n\'êtes pas le livreur assigné à cette commande' })
            };
        }

        // Mettre à jour la position dans cour_expedition
        await db.collection('cour_expedition').updateOne(
            { _id: expedition._id },
            { 
                $set: { 
                    driverLocation: location,
                    lastPositionUpdate: new Date()
                } 
            }
        );

        // Mettre à jour également dans la collection originale
        await db.collection(expedition.originalCollection).updateOne(
            { $or: [{ _id: new ObjectId(orderId) }, { codeID: orderId }] },
            { 
                $set: { 
                    driverLocation: location,
                    lastPositionUpdate: new Date()
                } 
            }
        );

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                message: 'Position mise à jour avec succès',
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