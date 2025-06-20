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
        const { orderId, driverId, location } = data;

        if (!orderId || !driverId || !location || !location.latitude || !location.longitude) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Données requises manquantes',
                    required: ['orderId', 'driverId', 'location.latitude', 'location.longitude']
                })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Vérifier l'assignation dans cour_expedition
        const expedition = await db.collection('cour_expedition').findOne({ 
            $or: [
                { orderId: orderId },
                { colisID: orderId },
                { identifiant: orderId },
                { id: orderId },
                { _id: orderId }
            ],
            driverId: driverId
        });

        if (!expedition) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Commande non trouvée ou non assignée à ce livreur',
                    orderId: orderId,
                    driverId: driverId
                })
            };
        }

        // Mettre à jour la position dans cour_expedition
        const updateResult = await db.collection('cour_expedition').updateOne(
            { _id: expedition._id },
            { 
                $set: { 
                    driverLocation: location,
                    lastPositionUpdate: new Date()
                },
                $push: {
                    positionHistory: {
                        location: location,
                        timestamp: new Date()
                    }
                }
            }
        );

        // Mettre à jour également dans la collection originale si elle existe encore
        const collectionMap = {
            packages: 'Livraison',
            food: 'Commandes',
            shopping: 'shopping_orders',
            pharmacy: 'pharmacyOrders'
        };

        const collectionName = collectionMap[expedition.serviceType];
        if (collectionName) {
            let query;
            if (expedition.serviceType === 'packages') {
                query = { colisID: orderId };
            } else if (expedition.serviceType === 'food') {
                query = { identifiant: orderId };
            } else {
                query = { _id: orderId };
            }

            await db.collection(collectionName).updateOne(
                query,
                { 
                    $set: { 
                        driverLocation: location,
                        lastPositionUpdate: new Date()
                    } 
                }
            );
        }

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                message: 'Position mise à jour avec succès',
                orderId: orderId,
                driverId: driverId,
                location: location,
                updatedAt: new Date().toISOString(),
                modifiedCount: updateResult.modifiedCount
            })
        };

    } catch (error) {
        console.error('Erreur mise à jour position:', error);
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