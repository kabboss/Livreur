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

        // Validation des données
        if (!orderId || !driverId || !location || 
            typeof location.latitude === 'undefined' || 
            typeof location.longitude === 'undefined') {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Données requises manquantes ou invalides',
                    required: {
                        orderId: 'string',
                        driverId: 'string',
                        location: {
                            latitude: 'number',
                            longitude: 'number',
                            accuracy: 'number (optional)'
                        }
                    },
                    received: data
                })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Ajout du timestamp et normalisation des coordonnées
        const positionData = {
            latitude: parseFloat(location.latitude),
            longitude: parseFloat(location.longitude),
            accuracy: location.accuracy ? parseFloat(location.accuracy) : null,
            timestamp: new Date()
        };

        // 1. Mise à jour dans cour_expedition
        const expeditionUpdate = await db.collection('cour_expedition').updateOne(
            { 
                $or: [
                    { orderId: orderId },
                    { colisID: orderId },
                    { identifiant: orderId },
                    { id: orderId },
                    { _id: orderId }
                ],
                driverId: driverId 
            },
            { 
                $set: { 
                    'driverLocation': positionData,
                    'lastPositionUpdate': new Date()
                },
                $push: {
                    'positionHistory': {
                        $each: [positionData],
                        $slice: -100 // Garde seulement les 100 dernières positions
                    }
                }
            }
        );

        if (expeditionUpdate.matchedCount === 0) {
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

        // 2. Mise à jour dans la collection d'origine si différente
        const collectionMap = {
            packages: 'Livraison',
            food: 'Commandes',
            shopping: 'shopping_orders',
            pharmacy: 'pharmacyOrders'
        };

        // Récupérer le type de service depuis cour_expedition
        const expeditionRecord = await db.collection('cour_expedition').findOne(
            { _id: expeditionUpdate.upsertedId || expeditionUpdate.matchedRecords?.[0]?._id }
        );

        if (expeditionRecord?.serviceType && collectionMap[expeditionRecord.serviceType]) {
            const originalCollection = collectionMap[expeditionRecord.serviceType];
            
            let query;
            switch(expeditionRecord.serviceType) {
                case 'packages':
                    query = { colisID: orderId };
                    break;
                case 'food':
                    query = { identifiant: orderId };
                    break;
                default:
                    query = { _id: orderId };
            }

            await db.collection(originalCollection).updateOne(
                query,
                { 
                    $set: { 
                        'driverLocation': positionData,
                        'lastPositionUpdate': new Date()
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
                location: positionData,
                updatedAt: new Date().toISOString(),
                expeditionUpdated: expeditionUpdate.modifiedCount > 0
            })
        };

    } catch (error) {
        console.error('Erreur mise à jour position:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: 'Erreur serveur lors de la mise à jour',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    } finally {
        if (client) await client.close();
    }
};