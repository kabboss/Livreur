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

        // Finalisation avec transaction
        const session = client.startSession();
        
        try {
            await session.withTransaction(async () => {
                // Mise à jour de la commande avec statut completed
                const updateResult = await updateOrderAsCompleted(
                    collection,
                    order,
                    {
                        driverName,
                        driverId,
                        notes,
                        completionLocation
                    },
                    serviceType,
                    session
                );

                if (updateResult.matchedCount === 0) {
                    throw new Error('CONCURRENT_MODIFICATION');
                }

                // Mise à jour de l'enregistrement d'assignation
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

                // Création d'un historique de livraison
                await createDeliveryHistory(
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
                    session
                );
            });

        } catch (transactionError) {
            if (transactionError.message === 'CONCURRENT_MODIFICATION') {
                return {
                    statusCode: 409,
                    headers: COMMON_HEADERS,
                    body: JSON.stringify({
                        error: 'Cette commande a été modifiée par un autre processus',
                        message: 'Veuillez recharger et réessayer'
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
                message: 'Livraison finalisée avec succès !',
                orderId,
                serviceType,
                driverName,
                driverId,
                completedAt: new Date().toISOString(),
                status: 'completed'
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

async function updateOrderAsCompleted(collection, originalOrder, completionInfo, serviceType, session) {
    const now = new Date();
    
    const updateData = {
        // Statuts de completion
        status: 'completed',
        statut: 'livré',
        isCompleted: true,
        
        // Informations de finalisation
        completedAt: now,
        dateLivraison: now,
        completedBy: completionInfo.driverName,
        completedById: completionInfo.driverId,
        completionNotes: completionInfo.notes,
        completionLocation: completionInfo.completionLocation,
        
        // Timestamps
        lastUpdated: now,
        
        // Version pour gestion des conflits
        version: (originalOrder.version || 0) + 1
    };

    // Ajouts spécifiques par service
    if (serviceType === 'packages') {
        updateData.dateLivraisonEffective = now;
        updateData.livraisonConfirmee = true;
        updateData.processusTermine = true;
    } else if (serviceType === 'food') {
        updateData.deliveredAt = now;
        updateData.deliveryConfirmed = true;
    }

    const query = { 
        _id: originalOrder._id,
        // S'assurer que la commande est toujours assignée au bon livreur
        $or: [
            { driverId: completionInfo.driverId },
            { idLivreurEnCharge: completionInfo.driverId }
        ]
    };

    return await collection.updateOne(query, { $set: updateData }, { session });
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
                    lastUpdated: new Date()
                }
            },
            { session }
        );
    } catch (error) {
        console.warn('Erreur mise à jour assignment record:', error);
        // Non bloquant, on continue
    }
}

async function createDeliveryHistory(db, originalOrder, orderId, serviceType, completionInfo, session) {
    try {
        const historyRecord = {
            // Identification
            originalOrderId: originalOrder._id,
            orderId,
            serviceType,
            
            // Informations de livraison
            driverId: completionInfo.driverId,
            driverName: completionInfo.driverName,
            completedAt: new Date(),
            completionNotes: completionInfo.notes,
            completionLocation: completionInfo.completionLocation,
            
            // Données de la commande au moment de la completion
            orderSnapshot: { ...originalOrder },
            
            // Métadonnées
            createdAt: new Date(),
            deliveryDuration: originalOrder.assignedAt ? 
                new Date() - new Date(originalOrder.assignedAt) : null
        };

        await db.collection('delivery_history').insertOne(historyRecord, { session });
    } catch (error) {
        console.warn('Erreur création historique:', error);
        // Non bloquant, on continue
    }
}