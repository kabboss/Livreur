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
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverPhone2, driverLocation } = data;

        // Validation des données requises
        if (!orderId || !serviceType || !driverId || !driverName || !driverPhone1) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    error: 'Données requises manquantes',
                    required: ['orderId', 'serviceType', 'driverId', 'driverName', 'driverPhone1']
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
        
        // Recherche de la commande
        let originalOrder = await findOrder(collection, orderId, serviceType);

        if (!originalOrder) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Commande non trouvée',
                    details: { collection: collectionName, orderId, serviceType }
                })
            };
        }

        // Vérification si déjà assignée avec vérouillage optimiste
        const currentAssignmentCheck = await collection.findOne({ _id: originalOrder._id });
        if (isOrderAlreadyAssigned(currentAssignmentCheck)) {
            const existingDriverName = currentAssignmentCheck.driverName || 
                                     currentAssignmentCheck.nomLivreur || 
                                     'Livreur inconnu';
            return {
                statusCode: 409,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    error: `Cette commande est déjà prise en charge par: ${existingDriverName}`,
                    isAlreadyAssigned: true,
                    currentDriver: existingDriverName,
                    currentDriverId: currentAssignmentCheck.driverId || currentAssignmentCheck.idLivreurEnCharge
                })
            };
        }

        // Assignation atomique avec transaction
        const session = client.startSession();
        
        try {
            await session.withTransaction(async () => {
                // Double vérification dans la transaction
                const finalCheck = await collection.findOne({ _id: originalOrder._id }, { session });
                if (isOrderAlreadyAssigned(finalCheck)) {
                    throw new Error('ALREADY_ASSIGNED');
                }

                // Mise à jour de la commande avec statut assigned permanent
                const updateResult = await updateOrderWithAssignment(
                    collection,
                    originalOrder,
                    {
                        driverId,
                        driverName,
                        driverPhone1,
                        driverPhone2: driverPhone2 || null,
                        driverLocation
                    },
                    serviceType,
                    session
                );

                if (updateResult.matchedCount === 0) {
                    throw new Error('CONCURRENT_MODIFICATION');
                }

                // Création d'un enregistrement de suivi dans une collection dédiée
                await createAssignmentRecord(
                    db,
                    originalOrder,
                    orderId,
                    serviceType,
                    {
                        driverId,
                        driverName,
                        driverPhone1,
                        driverPhone2,
                        driverLocation
                    },
                    collectionName,
                    session
                );
            });

        } catch (transactionError) {
            if (transactionError.message === 'ALREADY_ASSIGNED') {
                return {
                    statusCode: 409,
                    headers: COMMON_HEADERS,
                    body: JSON.stringify({
                        error: 'Cette commande vient d\'être assignée à un autre livreur',
                        isAlreadyAssigned: true
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
                message: 'Commande assignée avec succès !',
                orderId,
                serviceType,
                driverName,
                driverId,
                assignedAt: new Date().toISOString(),
                status: 'assigned',
                requiresSMS: true // Indique que l'envoi de SMS est requis
            })
        };

    } catch (error) {
        console.error('Erreur assignDriverToOrder:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: 'Erreur serveur lors de l\'assignation',
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

    // Stratégie de recherche selon le serviceType
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

function isOrderAlreadyAssigned(order) {
    if (!order) return false;
    
    return !!(
        order.driverId || 
        order.idLivreurEnCharge || 
        order.driverName ||
        order.nomLivreur ||
        (order.status && ['assigned', 'assigné', 'en_cours'].includes(order.status.toLowerCase())) ||
        (order.statut && ['assigned', 'assigné', 'en_cours_de_livraison'].includes(order.statut.toLowerCase()))
    );
}

async function updateOrderWithAssignment(collection, originalOrder, driverInfo, serviceType, session) {
    const now = new Date();
    
    const updateData = {
        // Informations du livreur
        driverId: driverInfo.driverId,
        driverName: driverInfo.driverName,
        nomLivreur: driverInfo.driverName, // Alias pour compatibilité
        idLivreurEnCharge: driverInfo.driverId, // Alias pour compatibilité
        driverPhone: driverInfo.driverPhone1,
        driverPhone1: driverInfo.driverPhone1,
        driverPhone2: driverInfo.driverPhone2,
        driverLocation: driverInfo.driverLocation,
        
        // Statuts uniformisés - TOUJOURS "assigned"
        status: 'assigned',
        statut: 'assigned',
        
        // Timestamps
        assignedAt: now,
        lastUpdated: now,
        
        // Flags de suivi
        isAssigned: true,
        assignmentConfirmed: true,
        
        // Version pour gestion des conflits
        version: (originalOrder.version || 0) + 1
    };

    // Ajouts spécifiques par service
    if (serviceType === 'packages') {
        updateData.dateAcceptation = now;
        updateData.processusDéclenche = true;
        updateData.estExpedie = true;
    } else if (serviceType === 'food') {
        updateData.assignedToDriver = true;
        updateData.preparationStatus = 'assigned_to_driver';
    }

    const query = { 
        _id: originalOrder._id,
        // Protection contre les modifications concurrentes
        $or: [
            { driverId: { $exists: false } },
            { driverId: null },
            { idLivreurEnCharge: { $exists: false } },
            { idLivreurEnCharge: null }
        ]
    };

    return await collection.updateOne(query, { $set: updateData }, { session });
}

async function createAssignmentRecord(db, originalOrder, orderId, serviceType, driverInfo, collectionName, session) {
    const assignmentRecord = {
        // Identification
        originalOrderId: originalOrder._id,
        orderId,
        serviceType,
        originalCollection: collectionName,
        
        // Copie des données de commande
        orderData: { ...originalOrder },
        
        // Informations d'assignation
        driverId: driverInfo.driverId,
        driverName: driverInfo.driverName,
        driverPhone1: driverInfo.driverPhone1,
        driverPhone2: driverInfo.driverPhone2,
        driverLocation: driverInfo.driverLocation,
        
        // Statut et timestamps
        status: 'assigned',
        assignedAt: new Date(),
        createdAt: new Date(),
        
        // Historique des positions (pour suivi futur)
        positionHistory: [{
            location: driverInfo.driverLocation,
            timestamp: new Date(),
            type: 'assignment'
        }],
        
        // Flags
        isActive: true,
        isCompleted: false
    };

    await db.collection('delivery_assignments').insertOne(assignmentRecord, { session });
}