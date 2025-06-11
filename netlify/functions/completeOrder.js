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
                body: JSON.stringify({ 
                    error: 'Données requises manquantes',
                    requiredFields: ['orderId', 'serviceType', 'driverName', 'driverId']
                })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Vérifier l'assignation
        const expedition = await db.collection('cour_expedition').findOne({ 
            $or: [
                { orderId: orderId },
                { codeID: orderId }
            ],
            serviceType: serviceType,
            driverId: driverId
        });

        if (!expedition) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Expédition non trouvée ou non assignée à ce livreur',
                    details: `Order: ${orderId}, Driver: ${driverId}`
                })
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
                body: JSON.stringify({ 
                    error: 'Type de service invalide',
                    validTypes: Object.keys(collectionMap)
                })
            };
        }

        // Trouver la commande originale
        let originalOrder;
        try {
            originalOrder = await db.collection(collectionName).findOne({
                $or: [
                    { _id: expedition._id || new ObjectId(orderId) },
                    { codeID: orderId }
                ]
            });
        } catch (e) {
            console.error('Erreur recherche commande:', e);
            originalOrder = null;
        }

        if (!originalOrder) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Commande originale non trouvée',
                    collection: collectionName,
                    searchQuery: {
                        $or: [
                            { _id: expedition?._id },
                            { codeID: orderId }
                        ]
                    }
                })
            };
        }

        // Mettre à jour la commande
        const updateData = {
            status: 'livrée',
            driverName: driverName,
            driverId: driverId,
            deliveredAt: new Date(),
            deliveryNotes: notes || null,
            lastUpdated: new Date()
        };

        const updateResult = await db.collection(collectionName).updateOne(
            { _id: originalOrder._id },
            { $set: updateData }
        );

        // Pour les colis, archiver
        if (serviceType === 'packages') {
            await db.collection('LivraisonsEffectuees').insertOne({
                ...originalOrder,
                ...updateData,
                serviceType: serviceType,
                originalCollection: collectionName
            });

            await db.collection('cour_expedition').deleteOne({ 
                _id: expedition._id 
            });
        }

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                message: 'Livraison enregistrée avec succès',
                orderId: orderId,
                deliveredAt: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur complète:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
                eventBody: event.body
            })
        };
    } finally {
        if (client) await client.close();
    }
};