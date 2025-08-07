const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event) => {
    // Gestion des pré-vols OPTIONS
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: COMMON_HEADERS, body: JSON.stringify({}) };
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

        // Validation des données requises
        if (!orderId || !serviceType || !driverName || !driverId) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    error: 'Données requises manquantes',
                    required: ['orderId', 'serviceType', 'driverName', 'driverId']
                })
            };
        }

        client = await MongoClient.connect(MONGODB_URI, {
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000
        });
        const db = client.db(DB_NAME);

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

        const collection = db.collection(collectionName);
        
        // Recherche de la commande avec vérification d'assignation
        const order = await findOrder(collection, orderId, serviceType);

        if (!order) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Commande non trouvée',
                    details: { collection: collectionName, orderId, serviceType }
                })
            };
        }

        // Vérification que la commande est bien assignée au livreur
        if (!isOrderAssignedToDriver(order, driverId)) {
            return {
                statusCode: 403,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    error: 'Cette commande n\'est pas assignée à ce livreur',
                    currentDriver: order.driverName || order.nomLivreur || null,
                    currentDriverId: order.driverId || order.idLivreurEnCharge || null
                })
            };
        }

        // Vérification si déjà completée
        if (isOrderCompleted(order)) {
            return {
                statusCode: 409,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    error: 'Cette commande est déjà marquée comme terminée',
                    completedAt: order.completedAt || order.dateLivraison || null
                })
            };
        }

        // Finalisation avec transaction et archivage
        const session = client.startSession();
        
        try {
            await session.withTransaction(async () => {
                // 1. Archiver la commande dans la collection d'historique
                const archivedOrder = await archiveCompletedOrder(
                    db,
                    order,
                    orderId,
                    serviceType,
                    {
                        driverName,
                        driverId,
                        notes,
                        completionLocation
                    },
                    collectionName,
                    session
                );

                if (!archivedOrder) {
                    throw new Error('ARCHIVING_FAILED');
                }

                // 2. Supprimer complètement de la collection originale
                const deleteResult = await collection.deleteOne(
                    { _id: order._id },
                    { session }
                );

                if (deleteResult.deletedCount === 0) {
                    throw new Error('DELETION_FAILED');
                }

                // 3. Mise à jour de l'enregistrement d'assignation
                await updateAssignmentRecord(
                    db,
                    order._id,
                    orderId,
                    {
                        driverName,
                        driverId,
                        notes,
                        completionLocation
                    },
                    session
                );
            });

        } catch (transactionError) {
            if (transactionError.message === 'ARCHIVING_FAILED') {
                return {
                    statusCode: 500,
                    headers: COMMON_HEADERS,
                    body: JSON.stringify({
                        error: 'Erreur lors de l\'archivage de la commande',
                        message: 'Veuillez réessayer'
                    })
                };
            }
            if (transactionError.message === 'DELETION_FAILED') {
                return {
                    statusCode: 500,
                    headers: COMMON_HEADERS,
                    body: JSON.stringify({
                        error: 'Erreur lors de la suppression de la commande',
                        message: 'Veuillez contacter le support'
                    })
                };
            }
            throw transactionError;
        } finally {
            await session.endSession();
        }

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                message: 'Livraison finalisée et archivée avec succès !',
                orderId,
                serviceType,
                driverName,
                driverId,
                completedAt: new Date().toISOString(),
                status: 'completed_and_archived',
                archived: true
            })
        };

    } catch (error) {
        console.error('Erreur completeOrder:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: 'Erreur serveur lors de la finalisation',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    } finally {
        if (client) {
            try {
                await client.close();
            } catch (closeError) {
                console.error('Erreur fermeture connexion:', closeError);
            }
        }
    }
};

async function findOrder(collection, orderId, serviceType) {
    const tryObjectId = (id) => {
        try {
            return ObjectId.isValid(id) ? new ObjectId(id) : id;
        } catch {
            return id;
        }
    };

    const searchStrategies = {
        packages: [
            { colisID: orderId },
            { _id: tryObjectId(orderId) }
        ],
        food: [
            { identifiant: orderId },
            { _id: tryObjectId(orderId) }
        ],
        default: [
            { _id: tryObjectId(orderId) },
            { id: orderId }
        ]
    };

    const strategies = searchStrategies[serviceType] || searchStrategies.default;
    
    for (const query of strategies) {
        try {
            const order = await collection.findOne(query);
            if (order) return order;
        } catch (error) {
            console.error('Erreur recherche avec query:', query, error);
        }
    }

    return null;
}

function isOrderAssignedToDriver(order, driverId) {
    return (order.driverId === driverId || order.idLivreurEnCharge === driverId);
}

function isOrderCompleted(order) {
    const status = (order.status || '').toLowerCase();
    const statut = (order.statut || '').toLowerCase();
    
    return status === 'completed' || 
           status === 'delivered' || 
           statut === 'livré' ||
           statut === 'terminé' ||
           statut === 'completed' ||
           order.isCompleted === true ||
           order.completedAt ||
           order.dateLivraison;
}

async function archiveCompletedOrder(db, originalOrder, orderId, serviceType, completionInfo, originalCollection, session) {
    try {
        const now = new Date();
        
        // Créer l'enregistrement archivé complet
        const archivedOrder = {
            // Données originales de la commande
            ...originalOrder,
            
            // Métadonnées d'archivage
            archiveMetadata: {
                originalOrderId: originalOrder._id,
                originalCollection: originalCollection,
                serviceType: serviceType,
                archivedAt: now,
                archivedBy: 'delivery_completion_system'
            },
            
            // Informations de completion
            completionData: {
                completedBy: completionInfo.driverName,
                completedById: completionInfo.driverId,
                completedAt: now,
                completionNotes: completionInfo.notes,
                completionLocation: completionInfo.completionLocation,
                
                // Statuts finaux
                status: 'completed',
                statut: 'livré',
                isCompleted: true,
                isArchived: true
            },
            
            // Historique de la livraison
            deliveryHistory: {
                assignedAt: originalOrder.assignedAt,
                completedAt: now,
                driverName: completionInfo.driverName,
                driverId: completionInfo.driverId,
                totalDeliveryTime: originalOrder.assignedAt ? 
                    now.getTime() - new Date(originalOrder.assignedAt).getTime() : null
            },
            
            // Index pour les recherches
            searchableFields: {
                orderId: orderId,
                serviceType: serviceType,
                driverId: completionInfo.driverId,
                driverName: completionInfo.driverName,
                completedAt: now,
                year: now.getFullYear(),
                month: now.getMonth() + 1,
                day: now.getDate()
            }
        };

        // Insérer dans la collection d'archives
        const result = await db.collection('completed_orders_archive').insertOne(
            archivedOrder, 
            { session }
        );

        console.log(`Commande ${orderId} archivée avec l'ID: ${result.insertedId}`);
        return result.acknowledged;

    } catch (error) {
        console.error('Erreur lors de l\'archivage:', error);
        return false;
    }
}

async function updateAssignmentRecord(db, originalOrderId, orderId, completionInfo, session) {
    try {
        await db.collection('delivery_assignments').updateOne(
            { 
                originalOrderId,
                driverId: completionInfo.driverId,
                isActive: true 
            },
            {
                $set: {
                    status: 'completed',
                    isCompleted: true,
                    isActive: false,
                    completedAt: new Date(),
                    completionNotes: completionInfo.notes,
                    completionLocation: completionInfo.completionLocation,
                    lastUpdated: new Date(),
                    // Marquer comme archivé
                    isArchived: true,
                    archivedAt: new Date()
                }
            },
            { session }
        );
    } catch (error) {
        console.warn('Erreur mise à jour assignment record:', error);
        // Non bloquant, on continue
    }
}