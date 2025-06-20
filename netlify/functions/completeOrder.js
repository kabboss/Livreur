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
        const { orderId, serviceType, driverName, driverId, notes, completionLocation } = data;

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

        // Vérifier l'assignation dans cour_expedition
        const expedition = await db.collection('cour_expedition').findOne({ 
            $or: [
                { orderId: orderId },
                { colisID: orderId },
                { identifiant: orderId },
                { id: orderId },
                { _id: orderId }
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

        // Vérifier que c'est bien le bon livreur
        if (expedition.driverId !== driverId) {
            return {
                statusCode: 403,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Vous n\'êtes pas autorisé à finaliser cette livraison'
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
        let query;
        let originalOrder = null;

        if (serviceType === 'packages') {
            query = { colisID: orderId };
            originalOrder = await db.collection(collectionName).findOne(query);
        } else if (serviceType === 'food') {
            // Essayer d'abord avec identifiant
            query = { identifiant: orderId };
            originalOrder = await db.collection(collectionName).findOne(query);
            
            // Si pas trouvé, essayer avec _id
            if (!originalOrder) {
                try {
                    query = { _id: new ObjectId(orderId) };
                    originalOrder = await db.collection(collectionName).findOne(query);
                } catch (e) {
                    query = { _id: orderId };
                    originalOrder = await db.collection(collectionName).findOne(query);
                }
            }
        } else {
            // Pour shopping et pharmacy
            try {
                query = { _id: new ObjectId(orderId) };
                originalOrder = await db.collection(collectionName).findOne(query);
            } catch (e) {
                query = { _id: orderId };
                originalOrder = await db.collection(collectionName).findOne(query);
            }
            
            // Si pas trouvé, essayer avec id
            if (!originalOrder) {
                query = { id: orderId };
                originalOrder = await db.collection(collectionName).findOne(query);
            }
        }

        if (!originalOrder) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Commande originale non trouvée',
                    collection: collectionName,
                    query: query
                })
            };
        }

        // Données de finalisation
        const completionData = {
            status: 'livré',
            statut: 'livré',
            driverName: driverName,
            driverId: driverId,
            deliveredAt: new Date(),
            deliveryNotes: notes || null,
            lastUpdated: new Date(),
            completionLocation: completionLocation,
            completedBy: {
                driverId: driverId,
                driverName: driverName,
                completedAt: new Date()
            }
        };

        // Archiver dans LivraisonsEffectuees
        const archiveData = {
            ...originalOrder,
            ...completionData,
            serviceType: serviceType,
            originalCollection: collectionName,
            expeditionData: expedition,
            archivedAt: new Date(),
            deliveryProcess: {
                assignedAt: expedition.assignedAt,
                deliveredAt: new Date(),
                driverInfo: {
                    id: driverId,
                    name: driverName,
                    phone1: expedition.driverPhone1,
                    phone2: expedition.driverPhone2
                },
                positionHistory: expedition.positionHistory || []
            }
        };

        await db.collection('LivraisonsEffectuees').insertOne(archiveData);

        // Supprimer de cour_expedition
        await db.collection('cour_expedition').deleteOne({ 
            _id: expedition._id 
        });

        // Supprimer de la collection originale
        await db.collection(collectionName).deleteOne(query);

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                message: 'Livraison terminée et archivée avec succès !',
                orderId: orderId,
                serviceType: serviceType,
                deliveredAt: new Date().toISOString(),
                archived: true,
                driverName: driverName
            })
        };

    } catch (error) {
        console.error('Erreur finalisation livraison:', error);
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