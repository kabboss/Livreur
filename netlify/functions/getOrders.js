const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
};

// Mapping des collections et de leurs champs d'identifiants livreur
const COLLECTION_CONFIG = {
    packages: {
        collection: 'Livraison',
        driverIdFields: ['driverId', 'idLivreurEnCharge'],
        statusField: 'statut',
        driverNameFields: ['driverName', 'nomLivreur'],
        dateFields: ['dateCreation', 'dateAcceptation', 'createdAt'],
        locationField: 'expediteur.location'
    },
    food: {
        collection: 'Commandes',
        driverIdFields: ['driverId', 'idLivreurEnCharge'],
        statusField: 'status',
        driverNameFields: ['driverName', 'nomLivreur'],
        dateFields: ['orderDate', 'dateCreation', 'createdAt'],
        locationField: 'restaurant.position'
    },
    shopping: {
        collection: 'shopping_orders',
        driverIdFields: ['driverId'],
        statusField: 'status',
        driverNameFields: ['driverName'],
        dateFields: ['orderDate', 'createdAt'],
        locationField: 'clientPosition'
    },
    pharmacy: {
        collection: 'pharmacyOrders',
        driverIdFields: ['driverId'],
        statusField: 'status',
        driverNameFields: ['driverName'],
        dateFields: ['orderDate', 'createdAt'],
        locationField: 'clientPosition'
    }
};

// Statuts indiquant qu'une commande est terminée
const COMPLETED_STATUSES = ['completed', 'delivered', 'livré', 'terminé'];

exports.handler = async (event) => {
    // Gestion des pré-vols OPTIONS
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: COMMON_HEADERS, body: JSON.stringify({}) };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: 'Méthode non autorisée' })
        };
    }

    let client;
    try {
        const { serviceType, driverId } = event.queryStringParameters || {};
        
        client = await MongoClient.connect(MONGODB_URI, {
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000
        });
        const db = client.db(DB_NAME);

        // Si driverId est fourni, récupérer les commandes assignées à ce livreur UNIQUEMENT
        if (driverId) {
            return await getDriverAssignedOrders(db, driverId, serviceType);
        }

        // Sinon récupérer selon le serviceType (EXCLURE les commandes terminées/archivées)
        if (!serviceType || !COLLECTION_CONFIG[serviceType]) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Type de service invalide' })
            };
        }

        const config = COLLECTION_CONFIG[serviceType];
        const collection = db.collection(config.collection);
        
        // Construction de la requête pour EXCLURE les commandes terminées/archivées
        const query = {
            $and: [
                {
                    $or: [
                        { [config.statusField]: { $in: ['pending', 'assigned', 'assigné', 'en_attente_assignation', 'en_cours'] } },
                        { driverId: { $exists: true } },
                        { idLivreurEnCharge: { $exists: true } }
                    ]
                },
                // EXCLURE les statuts de completion
                {
                    [config.statusField]: { $nin: COMPLETED_STATUSES },
                    isCompleted: { $ne: true }
                }
            ]
        };

        // Récupérer uniquement les commandes NON terminées
        const orders = await collection.find(query)
            .sort({ createdAt: -1 })
            .limit(200)
            .toArray();
        
        console.log(`Service ${serviceType}: ${orders.length} commandes actives récupérées (archivées exclues)`);

        // Enrichir les données avec des informations d'assignation et normaliser
        const enrichedOrders = orders.map(order => {
            const driverId = config.driverIdFields.find(field => order[field]) ? 
                config.driverIdFields.map(field => order[field]).find(id => id) : null;
                
            const driverName = config.driverNameFields.find(field => order[field]) ? 
                config.driverNameFields.map(field => order[field]).find(name => name) : null;
                
            const isAssigned = !!driverId || 
                (order[config.statusField] && ['assigned', 'assigné', 'en_cours_de_livraison'].includes(order[config.statusField].toLowerCase()));

            // Normaliser la localisation pour l'interface
            let locationData = {};
            if (serviceType === 'packages' && order.expediteur?.location) {
                locationData = order.expediteur.location;
            } else if (serviceType === 'food' && order.restaurant?.position) {
                locationData = order.restaurant.position;
            } else if ((serviceType === 'shopping' || serviceType === 'pharmacy') && order.clientPosition) {
                locationData = order.clientPosition;
            }

            return {
                ...order,
                serviceType, // Important pour l'interface
                isAssigned,
                assignedDriver: driverName,
                assignedDriverId: driverId,
                // Champs normalisés pour l'interface
                position: locationData,
                location: locationData
            };
        });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                orders: enrichedOrders,
                serviceType,
                count: enrichedOrders.length,
                assignedCount: enrichedOrders.filter(o => o.isAssigned).length,
                availableCount: enrichedOrders.filter(o => !o.isAssigned).length,
                excludedCompleted: true
            })
        };

    } catch (error) {
        console.error('Erreur GET getOrders:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: 'Erreur serveur lors de la récupération des commandes',
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

async function getDriverAssignedOrders(db, driverId, serviceTypeFilter = null) {
    try {
        const collectionsToSearch = serviceTypeFilter ? 
            [{ name: COLLECTION_CONFIG[serviceTypeFilter].collection, serviceType: serviceTypeFilter }] :
            [
                { name: 'Livraison', serviceType: 'packages' },
                { name: 'Commandes', serviceType: 'food' },
                { name: 'shopping_orders', serviceType: 'shopping' },
                { name: 'pharmacyOrders', serviceType: 'pharmacy' }
            ];
        
        const assignedOrders = [];
        
        for (const { name, serviceType } of collectionsToSearch) {
            try {
                const config = COLLECTION_CONFIG[serviceType];
                const collection = db.collection(name);
                
                // Construire la condition pour trouver les commandes assignées à ce driver
                const driverCondition = {
                    $or: config.driverIdFields.map(field => ({ [field]: driverId }))
                };
                
                // Condition pour exclure les commandes terminées
                const notCompletedCondition = {
                    [config.statusField]: { $nin: COMPLETED_STATUSES },
                    isCompleted: { $ne: true }
                };
                
                // RECHERCHER uniquement les commandes assignées ET NON terminées
                const orders = await collection.find({
                    $and: [driverCondition, notCompletedCondition]
                }).toArray();
                
                assignedOrders.push(...orders.map(order => {
                    const driverName = config.driverNameFields.find(field => order[field]) ? 
                        config.driverNameFields.map(field => order[field]).find(name => name) : null;
                    
                    // Normaliser la localisation pour l'interface
                    let locationData = {};
                    if (serviceType === 'packages' && order.expediteur?.location) {
                        locationData = order.expediteur.location;
                    } else if (serviceType === 'food' && order.restaurant?.position) {
                        locationData = order.restaurant.position;
                    } else if ((serviceType === 'shopping' || serviceType === 'pharmacy') && order.clientPosition) {
                        locationData = order.clientPosition;
                    }

                    return {
                        ...order,
                        serviceType, // Important pour l'interface
                        originalCollection: name,
                        isAssigned: true,
                        assignedDriver: driverName,
                        assignedDriverId: driverId,
                        // Champs normalisés pour l'interface
                        position: locationData,
                        location: locationData
                    };
                }));
            } catch (collectionError) {
                console.error(`Erreur collection ${name}:`, collectionError);
            }
        }

        // Tri par date d'assignation
        assignedOrders.sort((a, b) => {
            const configA = COLLECTION_CONFIG[a.serviceType];
            const configB = COLLECTION_CONFIG[b.serviceType];
            
            const aDateField = configA.dateFields.find(field => a[field]) || 'createdAt';
            const bDateField = configB.dateFields.find(field => b[field]) || 'createdAt';
            
            const aDate = new Date(a[aDateField] || 0);
            const bDate = new Date(b[bDateField] || 0);
            return bDate - aDate;
        });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                orders: assignedOrders,
                driverId,
                count: assignedOrders.length,
                excludedCompleted: true,
                message: `${assignedOrders.length} commande(s) active(s) assignée(s) à ${driverId}`
            })
        };
    } catch (error) {
        throw error;
    }
}