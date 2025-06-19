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

        // Vérifier que le service est bien dans la liste des services simplifiés
        if (!['food', 'shopping', 'pharmacy'].includes(serviceType)) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Service non supporté par ce système' })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Vérifier l'assignation dans other_service_cour
        const assignment = await db.collection('other_service_cour').findOne({ 
            $or: [
                { orderId: orderId },
                { identifiant: orderId },
                { id: orderId },
                { _id: orderId }
            ],
            serviceType: serviceType,
            driverId: driverId
        });

        if (!assignment) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Assignation non trouvée ou non assignée à ce livreur',
                    details: `Order: ${orderId}, Driver: ${driverId}`
                })
            };
        }

        // Vérifier que c'est bien le bon livreur
        if (assignment.driverId !== driverId) {
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
            food: 'Commandes',
            shopping: 'shopping_orders',
            pharmacy: 'pharmacyOrders'
        };

        const collectionName = collectionMap[serviceType];

        // Trouver la commande originale
        let query;
        if (serviceType === 'food') {
            query = { identifiant: orderId };
        } else {
            try {
                query = { _id: new ObjectId(orderId) };
            } catch (e) {
                query = { _id: orderId };
            }
        }

        const originalOrder = await db.collection(collectionName).findOne(query);
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
            assignmentData: assignment,
            archivedAt: new Date(),
            deliveryProcess: {
                assignedAt: assignment.assignedAt,
                deliveredAt: new Date(),
                driverInfo: {
                    id: driverId,
                    name: driverName,
                    phone1: assignment.driverPhone1,
                    phone2: assignment.driverPhone2
                }
            }
        };

        await db.collection('LivraisonsEffectuees').insertOne(archiveData);

        // Supprimer de other_service_cour
        await db.collection('other_service_cour').deleteOne({ 
            _id: assignment._id 
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
        console.error('Erreur finalisation livraison autres services:', error);
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