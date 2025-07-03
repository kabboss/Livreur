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
        const { orderId, driverId } = data;

        if (!orderId || !driverId) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Données requises manquantes',
                    required: ['orderId', 'driverId']
                })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Vérifier dans cour_expedition si ce livreur est bien assigné à cette commande
        const expedition = await db.collection('cour_expedition').findOne({ 
            $or: [
                { orderId: orderId },
                { colisID: orderId },
                { _id: orderId }
            ],
            $and: [
                {
                    $or: [
                        { driverId: driverId },
                        { idLivreur: driverId }
                    ]
                }
            ]
        });

        if (expedition) {
            return {
                statusCode: 200,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    isAuthorized: true,
                    driverName: expedition.driverName || expedition.nomLivreur,
                    assignedAt: expedition.assignedAt || expedition.dateAssignation
                })
            };
        } else {
            return {
                statusCode: 200,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    isAuthorized: false,
                    message: 'Livreur non autorisé pour cette commande'
                })
            };
        }

    } catch (error) {
        console.error('Erreur lors de la vérification de l\'identité du livreur:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: 'Erreur serveur lors de la vérification',
                details: error.message
            })
        };
    } finally {
        if (client) await client.close();
    }
};