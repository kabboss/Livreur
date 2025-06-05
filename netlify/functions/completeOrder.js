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

        // Pour les colis, vérifier d'abord dans cour_expedition
        if (serviceType === 'packages') {
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

        // Mise à jour de la commande originale
        const updateResult = await db.collection(collectionName).updateOne(
            { $or: [{ _id: new ObjectId(orderId) }, { codeID: orderId }] },
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

        if (updateResult.modifiedCount === 0) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande non trouvée ou déjà livrée' })
            };
        }

        // Pour les colis, supprimer de cour_expedition et archiver
        if (serviceType === 'packages') {
            await db.collection('cour_expedition').deleteOne({ 
                orderId: orderId,
                serviceType: 'packages'
            });

            await db.collection('LivraisonsEffectuees').insertOne({
                ...(await db.collection(collectionName).findOne({ 
                    $or: [{ _id: new ObjectId(orderId) }, { codeID: orderId }] 
                }) || {},
                serviceType: serviceType,
                deliveryDate: new Date(),
                status: 'livrée'
            });
        }

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                message: 'Livraison enregistrée avec succès',
                orderId: orderId
            })
        };

    } catch (error) {
        console.error('Erreur :', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message })
        };
    } finally {
        if (client) await client.close();
    }
};