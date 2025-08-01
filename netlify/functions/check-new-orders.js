const { MongoClient } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

// Collections à surveiller
const COLLECTIONS = {
    deliveries: 'Livraison',
    foodOrders: 'Commandes', 
    pharmacyOrders: 'pharmacyOrders',
    shoppingOrders: 'shopping_orders'
};

// Cache de connexion
let cachedClient = null;

/**
 * Connexion MongoDB optimisée
 */
async function connectToDatabase() {
    if (cachedClient && cachedClient.topology && cachedClient.topology.isConnected()) {
        return cachedClient.db(DB_NAME);
    }

    try {
        cachedClient = new MongoClient(MONGODB_URI, {
            connectTimeoutMS: 5000,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 30000,
            maxPoolSize: 10,
            minPoolSize: 2,
            retryWrites: true
        });

        await cachedClient.connect();
        console.log('✅ Connexion MongoDB établie');
        return cachedClient.db(DB_NAME);
    } catch (error) {
        console.error('❌ Erreur connexion MongoDB:', error);
        throw new Error(`Connexion échouée: ${error.message}`);
    }
}

/**
 * Vérification des nouvelles commandes dans toutes les collections
 */
async function checkNewOrdersInCollections(db, lastCheckTime) {
    const results = {
        hasNewOrders: false,
        newOrdersCount: 0,
        orderTypes: [],
        collections: {},
        totalOrders: 0,
        deliveryModeRequired: true // Indique que ces notifications sont destinées aux livreurs
    };

    try {
        // Convertir lastCheckTime en Date
        const checkDate = new Date(lastCheckTime);
        
        // Vérifier chaque collection
        for (const [type, collectionName] of Object.entries(COLLECTIONS)) {
            try {
                const collection = db.collection(collectionName);
                
                // Requête pour trouver les nouvelles commandes
                let query = {};
                
                // Adapter la requête selon la collection
                switch (type) {
                    case 'deliveries':
                        query = {
                            $or: [
                                { dateAcceptation: { $gte: checkDate } },
                                { dateCreation: { $gte: checkDate } }
                            ],
                            statut: { $in: ['en_cours_de_livraison', 'pending', 'waiting_for_delivery'] }
                        };
                        break;
                        
                    case 'foodOrders':
                        query = {
                            $or: [
                                { dateCreation: { $gte: checkDate } },
                                { orderDate: { $gte: checkDate } }
                            ],
                            status: { $in: ['pending', 'confirmed', 'preparing'] }
                        };
                        break;
                        
                    case 'pharmacyOrders':
                        query = {
                            createdAt: { $gte: checkDate },
                            status: { $in: ['pending', 'confirmed'] }
                        };
                        break;
                        
                    case 'shoppingOrders':
                        query = {
                            $or: [
                                { createdAt: { $gte: checkDate } },
                                { dateCreation: { $gte: checkDate } },
                                { timestamp: { $gte: checkDate } }
                            ],
                            $or: [
                                { status: { $in: ['pending', 'confirmed'] } },
                                { status: { $exists: false } } // Pour les commandes sans statut explicite
                            ]
                        };
                        break;
                }

                // Compter les nouvelles commandes
                const newCount = await collection.countDocuments(query);
                
                // Compter le total des commandes actives
                const totalQuery = { 
                    status: { $nin: ['completed', 'cancelled', 'delivered', 'refused'] } 
                };
                const totalCount = await collection.countDocuments(totalQuery);

                results.collections[type] = {
                    newOrders: newCount,
                    totalOrders: totalCount,
                    collectionName
                };

                if (newCount > 0) {
                    results.hasNewOrders = true;
                    results.newOrdersCount += newCount;
                    
                    // Ajouter le type de commande
                    const typeNames = {
                        deliveries: 'Livraisons',
                        foodOrders: 'Restauration',
                        pharmacyOrders: 'Pharmacie', 
                        shoppingOrders: 'Courses'
                    };
                    
                    results.orderTypes.push(`${typeNames[type]} (${newCount})`);
                }

                results.totalOrders += totalCount;

                console.log(`📊 ${collectionName}: ${newCount} nouvelles, ${totalCount} total`);

            } catch (collectionError) {
                console.error(`❌ Erreur collection ${collectionName}:`, collectionError);
                // Continue avec les autres collections même si une échoue
            }
        }

        // Enrichir les informations si des commandes sont trouvées
        if (results.hasNewOrders) {
            // Obtenir des détails supplémentaires sur les commandes récentes
            results.details = await getOrderDetails(db, checkDate);
            
            // Ajouter des métadonnées pour les livreurs
            results.deliveryInfo = {
                urgentOrders: results.details.urgentOrders || 0,
                zones: results.details.locationCoverage?.length || 0,
                recommendedAction: results.newOrdersCount > 5 ? 'high_priority' : 'normal',
                estimatedEarnings: calculateEstimatedEarnings(results.newOrdersCount, results.orderTypes)
            };
        }

        console.log(`🔍 Résultat vérification: ${results.newOrdersCount} nouvelles commandes pour livreurs`);
        return results;

    } catch (error) {
        console.error('❌ Erreur lors de la vérification:', error);
        throw error;
    }
}

/**
 * Calculer les gains estimés pour les livreurs
 */
function calculateEstimatedEarnings(orderCount, orderTypes) {
    const baseRates = {
        'Livraisons': 1500, // CFA
        'Restauration': 1200,
        'Pharmacie': 2000, // Plus urgent
        'Courses': 1800
    };
    
    let totalEstimated = 0;
    
    orderTypes.forEach(typeStr => {
        const match = typeStr.match(/^(.+) \((\d+)\)$/);
        if (match) {
            const [, type, count] = match;
            const rate = baseRates[type] || 1500;
            totalEstimated += rate * parseInt(count);
        }
    });
    
    return {
        min: Math.round(totalEstimated * 0.8),
        max: Math.round(totalEstimated * 1.2),
        currency: 'CFA'
    };
}

/**
 * Obtenir les détails des commandes récentes
 */
async function getOrderDetails(db, checkDate) {
    const details = {
        recentOrders: [],
        locationCoverage: [],
        urgentOrders: 0,
        peakHours: isCurrentTimePeakHours(),
        weatherAlert: false // Pourrait être intégré avec une API météo
    };

    try {
        // Obtenir quelques commandes récentes de chaque type
        for (const [type, collectionName] of Object.entries(COLLECTIONS)) {
            const collection = db.collection(collectionName);
            
            let pipeline = [];
            
            switch (type) {
                case 'deliveries':
                    pipeline = [
                        {
                            $match: {
                                dateCreation: { $gte: checkDate },
                                statut: { $in: ['en_cours_de_livraison', 'pending'] }
                            }
                        },
                        {
                            $project: {
                                type: { $literal: 'delivery' },
                                location: '$localisation',
                                urgency: { $literal: 'normal' },
                                createdAt: '$dateCreation',
                                distance: '$distance'
                            }
                        },
                        { $limit: 3 }
                    ];
                    break;
                    
                case 'foodOrders':
                    pipeline = [
                        {
                            $match: {
                                dateCreation: { $gte: checkDate },
                                status: { $in: ['pending', 'confirmed'] }
                            }
                        },
                        {
                            $project: {
                                type: { $literal: 'food' },
                                location: '$client.position',
                                restaurant: '$restaurant.name',
                                urgency: { $literal: 'normal' },
                                createdAt: '$dateCreation'
                            }
                        },
                        { $limit: 3 }
                    ];
                    break;
                    
                case 'pharmacyOrders':
                    pipeline = [
                        {
                            $match: {
                                createdAt: { $gte: checkDate },
                                status: { $in: ['pending', 'confirmed'] }
                            }
                        },
                        {
                            $project: {
                                type: { $literal: 'pharmacy' },
                                location: '$clientPosition',
                                urgency: { $literal: 'high' },
                                createdAt: '$createdAt'
                            }
                        },
                        { $limit: 3 }
                    ];
                    break;
                    
                case 'shoppingOrders':
                    pipeline = [
                        {
                            $match: {
                                createdAt: { $gte: checkDate }
                            }
                        },
                        {
                            $project: {
                                type: { $literal: 'shopping' },
                                location: '$clientPosition',
                                urgency: { $literal: 'normal' },
                                createdAt: '$createdAt'
                            }
                        },
                        { $limit: 3 }
                    ];
                    break;
            }

            if (pipeline.length > 0) {
                const orders = await collection.aggregate(pipeline).toArray();
                details.recentOrders.push(...orders);
                
                // Compter les commandes urgentes
                details.urgentOrders += orders.filter(order => order.urgency === 'high').length;
            }
        }

        // Extraire les zones géographiques couvertes
        details.locationCoverage = details.recentOrders
            .filter(order => order.location && (order.location.latitude || order.location.lat))
            .map(order => ({
                lat: order.location.latitude || order.location.lat,
                lng: order.location.longitude || order.location.lng || order.location.lon,
                type: order.type
            }));

    } catch (error) {
        console.warn('⚠️ Erreur lors de la récupération des détails:', error);
    }

    return details;
}

/**
 * Vérifier si on est en heure de pointe
 */
function isCurrentTimePeakHours() {
    const now = new Date();
    const hour = now.getHours();
    
    // Heures de pointe: 7h-9h, 12h-14h, 18h-21h
    return (hour >= 7 && hour <= 9) || 
           (hour >= 12 && hour <= 14) || 
           (hour >= 18 && hour <= 21);
}

/**
 * Headers CORS
 */
const getCorsHeaders = () => ({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
});

/**
 * Handler principal de la fonction
 */
exports.handler = async (event, context) => {
    // Optimiser les performances Lambda
    context.callbackWaitsForEmptyEventLoop = false;
    
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(2, 15);
    
    console.log(`📥 [${requestId}] Requête ${event.httpMethod} - Vérification commandes livreurs`);

    // Gestion CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: getCorsHeaders(),
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: getCorsHeaders(),
            body: JSON.stringify({
                error: 'Méthode non autorisée',
                requestId,
                note: 'Utilisez POST pour vérifier les nouvelles commandes'
            })
        };
    }

    try {
        // Parse du body
        let requestData = {};
        try {
            requestData = JSON.parse(event.body || '{}');
        } catch (parseError) {
            throw new Error('Format JSON invalide');
        }

        // Validation des paramètres
        const lastCheckTime = requestData.lastCheckTime || new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h par défaut
        const clientType = event.headers['x-client-type'] || 'web'; // web, mobile, sw
        
        if (typeof lastCheckTime === 'string') {
            const parsedDate = new Date(lastCheckTime);
            if (isNaN(parsedDate.getTime())) {
                throw new Error('Format de date invalide pour lastCheckTime');
            }
        }

        console.log(`🕐 [${requestId}] Vérification depuis: ${new Date(lastCheckTime).toISOString()}, Client: ${clientType}`);

        // Connexion à la base de données
        const db = await connectToDatabase();

        // Vérification des nouvelles commandes
        const result = await checkNewOrdersInCollections(db, lastCheckTime);

        const processingTime = Date.now() - startTime;
        
        // Log des résultats
        if (result.hasNewOrders) {
            console.log(`🔔 [${requestId}] ${result.newOrdersCount} nouvelles commandes pour livreurs (${processingTime}ms)`);
            console.log(`💰 [${requestId}] Gains estimés: ${result.deliveryInfo?.estimatedEarnings?.min}-${result.deliveryInfo?.estimatedEarnings?.max} CFA`);
        } else {
            console.log(`✅ [${requestId}] Aucune nouvelle commande (${processingTime}ms)`);
        }

        // Enrichir la réponse avec des informations spécifiques aux livreurs
        const response = {
            success: true,
            ...result,
            metadata: {
                timestamp: new Date().toISOString(),
                requestId,
                processingTime,
                clientType,
                serverTime: new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Ouagadougou' }),
                peakHours: isCurrentTimePeakHours(),
                note: 'Notifications destinées aux livreurs uniquement'
            }
        };

        // Réponse
        return {
            statusCode: 200,
            headers: getCorsHeaders(),
            body: JSON.stringify(response)
        };

    } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error(`❌ [${requestId}] Erreur (${processingTime}ms):`, error);

        const statusCode = 
            error.message.includes('invalide') ? 400 :
            error.message.includes('Connexion') ? 503 :
            500;

        return {
            statusCode,
            headers: getCorsHeaders(),
            body: JSON.stringify({
                success: false,
                error: error.message,
                hasNewOrders: false,
                newOrdersCount: 0,
                orderTypes: [],
                deliveryModeRequired: true,
                metadata: {
                    requestId,
                    processingTime,
                    timestamp: new Date().toISOString(),
                    note: 'Erreur lors de la vérification des commandes'
                }
            })
        };
    }
};