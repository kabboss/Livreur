const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = "FarmsConnect";

// Headers CORS
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
};

// Instance MongoDB réutilisable
let mongoClient = null;

// Cache en mémoire
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Rate limiting
const rateLimiter = new Map();
const RATE_LIMIT = 100; // requêtes par minute
const RATE_WINDOW = 60 * 1000; // 1 minute

// Métriques de performance
const metrics = {
    requests: 0,
    errors: 0,
    responseTime: [],
    startTime: Date.now()
};

// Configuration des collections
const COLLECTIONS_CONFIG = {
    'Colis': { 
        name: 'Colis', 
        searchFields: ['colisID', 'sender', 'recipient', 'status'],
        sortFields: ['createdAt', 'status', 'sender'],
        requiredFields: ['sender', 'recipient']
    },
    'Commandes': { 
        name: 'Commandes', 
        searchFields: ['orderID', 'customerName', 'status'],
        sortFields: ['date_creation', 'status', 'customerName'],
        requiredFields: ['customerName']
    },
    'Livraison': { 
        name: 'En Livraison', 
        searchFields: ['colisID', 'livreur', 'status'],
        sortFields: ['dateCreation', 'status', 'livreur'],
        requiredFields: ['colisID', 'livreur']
    },
    'LivraisonsEffectuees': { 
        name: 'Livrées', 
        searchFields: ['colisID', 'livreur', 'recipient'],
        sortFields: ['dateCreation', 'livreur', 'recipient'],
        requiredFields: ['colisID', 'livreur']
    },
    'Res_livreur': { 
        name: 'Livreurs', 
        searchFields: ['id_livreur', 'nom', 'prenom', 'whatsapp', 'quartier'],
        sortFields: ['date_inscription', 'nom', 'prenom'],
        requiredFields: ['id_livreur', 'nom', 'prenom', 'whatsapp']
    },
    'Restau': { 
        name: 'Restaurants', 
        searchFields: ['nom', 'adresse', 'telephone', 'cuisine'],
        sortFields: ['date_creation', 'nom', 'cuisine'],
        requiredFields: ['nom', 'adresse', 'telephone']
    }
};

async function connectToMongoDB() {
    try {
        if (!mongoClient) {
            mongoClient = new MongoClient(MONGODB_URI, {
                connectTimeoutMS: 30000,
                serverSelectionTimeoutMS: 30000,
                maxPoolSize: 10,
                retryWrites: true,
                w: 'majority',
                maxIdleTimeMS: 30000,
                socketTimeoutMS: 30000
            });
            await mongoClient.connect();
            console.log('✅ Connexion MongoDB établie');
        }
        return mongoClient.db(DB_NAME);
    } catch (error) {
        console.error('❌ Erreur de connexion MongoDB:', error);
        throw error;
    }
}

// Middleware de rate limiting
function checkRateLimit(ip) {
    const now = Date.now();
    const windowStart = now - RATE_WINDOW;
    
    if (!rateLimiter.has(ip)) {
        rateLimiter.set(ip, []);
    }
    
    const requests = rateLimiter.get(ip);
    
    // Nettoyer les anciennes requêtes
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    rateLimiter.set(ip, validRequests);
    
    if (validRequests.length >= RATE_LIMIT) {
        return false;
    }
    
    validRequests.push(now);
    rateLimiter.set(ip, validRequests);
    return true;
}

// Gestion du cache
function getCachedData(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    cache.delete(key);
    return null;
}

function setCachedData(key, data) {
    cache.set(key, {
        data: data,
        timestamp: Date.now()
    });
}

function clearCache() {
    cache.clear();
}

// Validation des données
function validateData(data, requiredFields) {
    const missing = requiredFields.filter(field => !data[field] || data[field].toString().trim() === '');
    return {
        isValid: missing.length === 0,
        missingFields: missing
    };
}

// Sanitisation des données
function sanitizeData(data) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
            sanitized[key] = value.trim().replace(/[<>]/g, '');
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

// Logging de sécurité avancé
async function logSecurityAction(db, action, details, ip = 'unknown') {
    try {
        const securityLog = db.collection('_security_logs');
        await securityLog.insertOne({
            action,
            details,
            timestamp: new Date(),
            ip,
            userAgent: 'admin-ultra-pro',
            severity: getSeverityLevel(action),
            sessionId: generateSessionId()
        });
    } catch (error) {
        console.warn('⚠️ Erreur lors du logging de sécurité:', error);
    }
}

function getSeverityLevel(action) {
    const highRiskActions = ['DELETE_ITEM', 'DELETE_ITEMS', 'DELETE_BACKUP'];
    const mediumRiskActions = ['UPDATE_ITEM', 'CREATE_ITEM', 'BACKUP_COLLECTION'];
    
    if (highRiskActions.includes(action)) return 'HIGH';
    if (mediumRiskActions.includes(action)) return 'MEDIUM';
    return 'LOW';
}

function generateSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Métriques de performance
function recordMetrics(startTime, success = true) {
    metrics.requests++;
    if (!success) metrics.errors++;
    
    const responseTime = Date.now() - startTime;
    metrics.responseTime.push(responseTime);
    
    // Garder seulement les 1000 dernières mesures
    if (metrics.responseTime.length > 1000) {
        metrics.responseTime = metrics.responseTime.slice(-1000);
    }
}

function getPerformanceMetrics() {
    const avgResponseTime = metrics.responseTime.length > 0 
        ? metrics.responseTime.reduce((a, b) => a + b, 0) / metrics.responseTime.length 
        : 0;
    
    const uptime = Date.now() - metrics.startTime;
    const errorRate = metrics.requests > 0 ? (metrics.errors / metrics.requests) * 100 : 0;
    
    return {
        totalRequests: metrics.requests,
        totalErrors: metrics.errors,
        errorRate: errorRate.toFixed(2),
        averageResponseTime: Math.round(avgResponseTime),
        uptime: Math.round(uptime / 1000), // en secondes
        cacheSize: cache.size,
        rateLimiterSize: rateLimiter.size
    };
}

exports.handler = async (event, context) => {
    const startTime = Date.now();
    context.callbackWaitsForEmptyEventLoop = false;

    // Gérer les requêtes OPTIONS (CORS preflight)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({})
        };
    }

    try {
        // Rate limiting
        const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
        if (!checkRateLimit(clientIP)) {
            recordMetrics(startTime, false);
            return errorResponse('Trop de requêtes. Veuillez patienter.', 429);
        }

        const queryParams = event.queryStringParameters || {};
        const action = queryParams.action;

        console.log(`🚀 Action reçue: ${action} - IP: ${clientIP}`);

        const db = await connectToMongoDB();

        // Gestion des actions GET
        if (event.httpMethod === 'GET') {
            const result = await handleGetRequest(db, action, queryParams, clientIP);
            recordMetrics(startTime, result.statusCode < 400);
            return result;
        }

        // Gestion des actions POST
        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            console.log(`📝 Action POST: ${body.action}`);
            
            const result = await handlePostRequest(db, body, clientIP);
            recordMetrics(startTime, result.statusCode < 400);
            return result;
        }

        recordMetrics(startTime, false);
        return errorResponse('Méthode HTTP non supportée', 405);

    } catch (error) {
        console.error('💥 Erreur serveur:', error);
        recordMetrics(startTime, false);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: 'Erreur interne du serveur',
                error: error.message,
                timestamp: new Date().toISOString(),
                requestId: generateSessionId()
            })
        };
    }
};

async function handleGetRequest(db, action, queryParams, clientIP) {
    switch (action) {
        case 'getStats':
            return await getStats(db, clientIP);
        
        case 'getData':
            const collection = queryParams.collection;
            const limit = parseInt(queryParams.limit || '100');
            const offset = parseInt(queryParams.offset || '0');
            const search = queryParams.search || '';
            const sort = queryParams.sort || '';
            const direction = queryParams.direction || 'desc';
            
            if (!collection) {
                return errorResponse('Collection manquante', 400);
            }
            return await getData(db, collection, limit, offset, search, sort, direction, clientIP);
        
        case 'getPreview':
            const previewCollection = queryParams.collection;
            const previewLimit = parseInt(queryParams.limit || '5');
            if (!previewCollection) {
                return errorResponse('Collection manquante', 400);
            }
            return await getPreview(db, previewCollection, previewLimit, clientIP);
        
        case 'getCollectionStats':
            const statsCollection = queryParams.collection;
            if (!statsCollection) {
                return errorResponse('Collection manquante', 400);
            }
            return await getCollectionStats(db, statsCollection, clientIP);
        
        case 'getBackups':
            const backupCollection = queryParams.collection || null;
            return await getBackups(db, backupCollection, clientIP);
        
        case 'getSystemInfo':
            return await getSystemInfo(db, clientIP);
        
        case 'getPerformanceMetrics':
            return await getPerformanceMetricsResponse(clientIP);
        
        case 'healthCheck':
            return await healthCheck(db, clientIP);
        
        default:
            return errorResponse('Action GET non supportée', 400);
    }
}

async function handlePostRequest(db, body, clientIP) {
    switch (body.action) {
        case 'addDriver':
            return await addDriver(db, body, clientIP);
        
        case 'addRestaurant':
            return await addRestaurant(db, body, clientIP);
        
        case 'generateDriverId':
            return await generateUniqueDriverId(db, clientIP);
        
        case 'deleteItem':
            return await deleteItem(db, body.collection, body.itemId, clientIP);
        
        case 'deleteItems':
            return await deleteItems(db, body.collection, body.itemIds, clientIP);
        
        case 'updateItem':
            return await updateItem(db, body.collection, body.itemId, body.updates, clientIP);
        
        case 'createItem':
            return await createItem(db, body.collection, body.data, clientIP);
        
        case 'exportCollection':
            return await exportCollection(db, body.collection, body.format || 'json', clientIP);
        
        case 'getAnalytics':
            return await getAnalytics(db, body.collection, body.timeRange || '7d', clientIP);
        
        case 'searchItems':
            return await searchItems(db, body.collection, body.query, body.filters || {}, clientIP);
        
        case 'backupCollection':
            return await backupCollection(db, body.collection, clientIP);
        
        case 'restoreCollection':
            return await restoreCollection(db, body.collection, body.backupName, clientIP);
        
        case 'deleteBackup':
            return await deleteBackup(db, body.backupName, clientIP);
        
        case 'globalSearch':
            return await globalSearch(db, body.query, body.collections || [], clientIP);
        
        case 'bulkUpdate':
            return await bulkUpdate(db, body.collection, body.updates, body.filter, clientIP);
        
        case 'validateData':
            return await validateCollectionData(db, body.collection, body.data, clientIP);
        
        case 'optimizeCollection':
            return await optimizeCollection(db, body.collection, clientIP);
        
        case 'clearCache':
            return await clearCacheAction(clientIP);
        
        default:
            return errorResponse('Action POST non supportée', 400);
    }
}

// Fonction pour obtenir les statistiques globales
async function getStats(db, clientIP) {
    try {
        console.log('📊 Chargement des statistiques...');
        
        const cacheKey = 'dashboard_stats';
        const cached = getCachedData(cacheKey);
        
        if (cached) {
            console.log('📋 Statistiques chargées depuis le cache');
            return successResponse(cached);
        }
        
        const collections = Object.keys(COLLECTIONS_CONFIG);
        const stats = {};
        const collectionsData = {};
        const recentActivity = [];

        // Obtenir le nombre de documents dans chaque collection en parallèle
        const collectionPromises = collections.map(async (collection) => {
            try {
                const count = await db.collection(collection).countDocuments();
                collectionsData[collection] = count;

                // Statistiques spéciales pour le dashboard
                switch (collection) {
                    case 'Colis':
                        stats.colis = count;
                        // Activité récente
                        try {
                            const recentColis = await db.collection(collection)
                                .find({})
                                .sort({ createdAt: -1 })
                                .limit(3)
                                .toArray();
                            recentActivity.push(...recentColis.map(item => ({
                                ...item,
                                collection: 'Colis',
                                type: 'colis',
                                title: `Nouveau colis: ${item.colisID || item._id}`,
                                description: `De ${item.sender || 'Expéditeur'} vers ${item.recipient || 'Destinataire'}`
                            })));
                        } catch (err) {
                            console.warn('⚠️ Erreur activité récente Colis:', err);
                        }
                        break;
                    case 'Livraison':
                        stats.livraison = count;
                        break;
                    case 'LivraisonsEffectuees':
                        stats.livrees = count;
                        break;
                    case 'Res_livreur':
                        try {
                            const activeDrivers = await db.collection(collection)
                                .countDocuments({ status: 'actif' });
                            stats.livreurs = activeDrivers || count;
                            stats.totalLivreurs = count;
                        } catch (err) {
                            stats.livreurs = count;
                            stats.totalLivreurs = count;
                        }
                        break;
                    case 'Restau':
                        try {
                            const activeRestaurants = await db.collection(collection)
                                .countDocuments({ statut: 'actif' });
                            stats.restaurants = activeRestaurants || count;
                            stats.totalRestaurants = count;
                        } catch (err) {
                            stats.restaurants = count;
                            stats.totalRestaurants = count;
                        }
                        break;
                    case 'Commandes':
                        stats.commandes = count;
                        break;
                }
            } catch (error) {
                console.warn(`⚠️ Erreur pour la collection ${collection}:`, error);
                collectionsData[collection] = 0;
            }
        });

        await Promise.all(collectionPromises);

        // Commandes du jour
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        try {
            const [commandesCommandes, commandesColis] = await Promise.all([
                db.collection('Commandes').countDocuments({
                    $or: [
                        { date_creation: { $gte: today, $lt: tomorrow } },
                        { createdAt: { $gte: today, $lt: tomorrow } }
                    ]
                }),
                db.collection('Colis').countDocuments({
                    $or: [
                        { createdAt: { $gte: today, $lt: tomorrow } },
                        { dateCreation: { $gte: today, $lt: tomorrow } }
                    ]
                })
            ]);

            stats.commandesJour = commandesCommandes + commandesColis;
        } catch (error) {
            console.warn('⚠️ Erreur calcul commandes du jour:', error);
            stats.commandesJour = 0;
        }

        // Statistiques de performance
        try {
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            
            const [weeklyDeliveries, weeklyOrders] = await Promise.all([
                db.collection('LivraisonsEffectuees').countDocuments({
                    $or: [
                        { dateCreation: { $gte: weekAgo } },
                        { createdAt: { $gte: weekAgo } }
                    ]
                }),
                db.collection('Commandes').countDocuments({
                    $or: [
                        { date_creation: { $gte: weekAgo } },
                        { createdAt: { $gte: weekAgo } }
                    ]
                })
            ]);

            stats.performance = {
                weeklyDeliveries,
                weeklyOrders,
                averageDeliveryTime: '2.5h',
                successRate: '94%',
                ...getPerformanceMetrics()
            };
        } catch (error) {
            console.warn('⚠️ Erreur calcul performance:', error);
            stats.performance = {
                weeklyDeliveries: 0,
                weeklyOrders: 0,
                averageDeliveryTime: 'N/A',
                successRate: 'N/A',
                ...getPerformanceMetrics()
            };
        }

        // Trier l'activité récente par date
        recentActivity.sort((a, b) => {
            const dateA = new Date(a.createdAt || a.dateCreation || 0);
            const dateB = new Date(b.createdAt || b.dateCreation || 0);
            return dateB.getTime() - dateA.getTime();
        });

        const result = {
            stats,
            collectionsData,
            recentActivity: recentActivity.slice(0, 10),
            systemHealth: await getSystemHealth(db),
            timestamp: new Date().toISOString()
        };

        setCachedData(cacheKey, result);
        
        await logSecurityAction(db, 'GET_STATS', {
            collectionsCount: collections.length,
            totalItems: Object.values(collectionsData).reduce((a, b) => a + b, 0)
        }, clientIP);

        console.log('✅ Statistiques chargées avec succès');
        return successResponse(result);

    } catch (error) {
        console.error('❌ Erreur getStats:', error);
        return errorResponse('Erreur lors du chargement des statistiques');
    }
}

// Fonction pour obtenir les données d'une collection avec pagination et recherche
async function getData(db, collectionName, limit = 100, offset = 0, search = '', sort = '', direction = 'desc', clientIP) {
    try {
        console.log(`📋 Chargement de la collection ${collectionName}`);
        
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const collection = db.collection(collectionName);
        const config = COLLECTIONS_CONFIG[collectionName];
        
        // Construction de la requête de recherche
        let query = {};
        if (search && search.trim()) {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = config.searchFields.map(field => ({
                [field]: searchRegex
            }));
        }

        // Construction du tri
        let sortQuery = { $natural: -1 };
        if (sort && config.sortFields.includes(sort)) {
            sortQuery = { [sort]: direction === 'asc' ? 1 : -1 };
        }

        // Obtenir le nombre total de documents
        const totalCount = await collection.countDocuments(query);
        
        // Obtenir les documents avec pagination et tri
        const documents = await collection
            .find(query)
            .sort(sortQuery)
            .skip(offset)
            .limit(Math.min(limit, 1000))
            .toArray();

        // Statistiques de la collection
        const stats = await getCollectionBasicStats(db, collectionName);

        await logSecurityAction(db, 'GET_DATA', {
            collection: collectionName,
            count: documents.length,
            totalCount,
            hasSearch: !!search,
            hasSort: !!sort
        }, clientIP);

        console.log(`✅ Collection ${collectionName} chargée: ${documents.length} documents`);

        return successResponse({
            data: documents,
            count: documents.length,
            totalCount,
            offset,
            limit,
            hasMore: offset + documents.length < totalCount,
            collection: collectionName,
            stats,
            searchQuery: search,
            sortField: sort,
            sortDirection: direction
        });

    } catch (error) {
        console.error('❌ Erreur getData:', error);
        return errorResponse(`Erreur lors du chargement de la collection ${collectionName}: ${error.message}`);
    }
}

// Fonction pour obtenir un aperçu d'une collection
async function getPreview(db, collectionName, limit = 5, clientIP) {
    try {
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const collection = db.collection(collectionName);
        
        const documents = await collection
            .find({})
            .sort({ $natural: -1 })
            .limit(limit)
            .toArray();

        const totalCount = await collection.countDocuments();

        await logSecurityAction(db, 'GET_PREVIEW', {
            collection: collectionName,
            previewCount: documents.length
        }, clientIP);

        return successResponse({
            data: documents,
            collection: collectionName,
            totalCount
        });

    } catch (error) {
        console.error('❌ Erreur getPreview:', error);
        return errorResponse(`Erreur lors du chargement de l'aperçu de ${collectionName}: ${error.message}`);
    }
}

// Fonction pour obtenir les statistiques d'une collection
async function getCollectionStats(db, collectionName, clientIP) {
    try {
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const collection = db.collection(collectionName);
        
        const totalCount = await collection.countDocuments();
        const stats = await getCollectionBasicStats(db, collectionName);
        
        // Statistiques par période
        const now = new Date();
        const periods = {
            today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            week: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
            month: new Date(now.getFullYear(), now.getMonth(), 1)
        };

        const periodStats = {};
        
        const periodPromises = Object.entries(periods).map(async ([period, date]) => {
            try {
                const count = await collection.countDocuments({
                    $or: [
                        { createdAt: { $gte: date } },
                        { dateCreation: { $gte: date } },
                        { date_creation: { $gte: date } },
                        { orderDate: { $gte: date } }
                    ]
                });
                periodStats[period] = count;
            } catch (error) {
                periodStats[period] = 0;
            }
        });

        await Promise.all(periodPromises);

        await logSecurityAction(db, 'GET_COLLECTION_STATS', {
            collection: collectionName,
            totalCount
        }, clientIP);

        return successResponse({
            collection: collectionName,
            totalCount,
            stats,
            periodStats
        });

    } catch (error) {
        console.error('❌ Erreur getCollectionStats:', error);
        return errorResponse(`Erreur lors du calcul des statistiques de ${collectionName}: ${error.message}`);
    }
}

// Fonction pour obtenir les statistiques de base d'une collection
async function getCollectionBasicStats(db, collectionName) {
    try {
        const collection = db.collection(collectionName);
        
        // Statistiques par statut si applicable
        const statusStats = {};
        const statusFields = ['status', 'statut'];
        
        for (const field of statusFields) {
            try {
                const pipeline = [
                    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
                    { $sort: { count: -1 } }
                ];
                
                const results = await collection.aggregate(pipeline).toArray();
                if (results.length > 0 && results[0]._id !== null) {
                    statusStats[field] = results.reduce((acc, item) => {
                        if (item._id) acc[item._id] = item.count;
                        return acc;
                    }, {});
                    break;
                }
            } catch (error) {
                // Ignorer les erreurs pour les champs qui n'existent pas
            }
        }

        return {
            statusDistribution: statusStats,
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.warn('⚠️ Erreur getCollectionBasicStats:', error);
        return {};
    }
}

// Fonction pour générer un ID unique de livreur
async function generateUniqueDriverId(db, clientIP) {
    try {
        console.log('🆔 Génération d\'un nouvel ID livreur...');
        
        const collection = db.collection('Res_livreur');
        let isUnique = false;
        let newId = '';
        let attempts = 0;
        const maxAttempts = 100;
        
        while (!isUnique && attempts < maxAttempts) {
            const random = Math.floor(Math.random() * 9000) + 1000;
            newId = `LIV${random}`;
            
            const existing = await collection.findOne({ id_livreur: newId });
            if (!existing) {
                isUnique = true;
            }
            attempts++;
        }
        
        if (!isUnique) {
            // Fallback avec timestamp si trop de tentatives
            newId = `LIV-${Date.now().toString().slice(-6)}`;
        }
        
        await logSecurityAction(db, 'GENERATE_DRIVER_ID', {
            generatedId: newId,
            attempts
        }, clientIP);
        
        console.log(`✅ ID généré: ${newId}`);
        
        return successResponse({
            id_livreur: newId,
            attempts
        });
        
    } catch (error) {
        console.error('❌ Erreur generateUniqueDriverId:', error);
        return errorResponse('Erreur lors de la génération de l\'ID');
    }
}

async function addDriver(db, data, clientIP) {
    try {
        console.log('👤 Ajout d\'un nouveau livreur...');

        const config = COLLECTIONS_CONFIG['Res_livreur'];
        const validation = validateData(data, config.requiredFields);

        if (!validation.isValid) {
            return errorResponse(`Champs obligatoires manquants: ${validation.missingFields.join(', ')}`, 400);
        }

        const sanitizedData = sanitizeData(data);
        const collection = db.collection('Res_livreur');

        const existingDriver = await collection.findOne({
            $or: [
                { whatsapp: sanitizedData.whatsapp },
                { id_livreur: sanitizedData.id_livreur }
            ]
        });

        if (existingDriver) {
            return errorResponse('Un livreur avec ce numéro WhatsApp ou cet ID existe déjà', 409);
        }

        const driverDocument = {
            id_livreur: sanitizedData.id_livreur,
            nom: sanitizedData.nom,
            prenom: sanitizedData.prenom,
            whatsapp: sanitizedData.whatsapp,
            telephone: sanitizedData.telephone || '',
            quartier: sanitizedData.quartier,
            piece: sanitizedData.piece || '',
            piece_number: sanitizedData.piece_number || '',
            vehicule: sanitizedData.vehicule || '',
            immatriculation: sanitizedData.immatriculation || '',
            experience: sanitizedData.experience || '',
            contact_urgence: sanitizedData.contact_urgence || {},
            garant: sanitizedData.garant || {},
            date_inscription: sanitizedData.date_inscription || new Date().toISOString(),
            createdAt: new Date(),
            updatedAt: new Date(),
            status: 'actif',
            metadata: {
                createdBy: 'admin',
                version: 1,
                source: 'admin-panel'
            }
        };

        if (sanitizedData.photo_data) {
            driverDocument.photo = {
                data: sanitizedData.photo_data,
                content_type: sanitizedData.photo_type || 'image/webp',
                size: sanitizedData.photo_size || 0,
                width: sanitizedData.photo_width || 0,
                height: sanitizedData.photo_height || 0,
                uploaded_at: new Date()
            };
        }

        if (sanitizedData.permis_file) {
            driverDocument.permis_file = sanitizedData.permis_file;
        }

        if (sanitizedData.casier_file) {
            driverDocument.casier_file = sanitizedData.casier_file;
        }

        const result = await collection.insertOne(driverDocument);

        clearCache();

        await logSecurityAction(db, 'ADD_DRIVER', {
            id_livreur: sanitizedData.id_livreur,
            nom: sanitizedData.nom,
            prenom: sanitizedData.prenom,
            hasPhoto: !!sanitizedData.photo_data,
            insertedId: result.insertedId
        }, clientIP);

        console.log(`✅ Livreur ajouté avec succès: ${sanitizedData.id_livreur}`);

        return {
            statusCode: 201,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                insertedId: result.insertedId,
                message: 'Livreur ajouté avec succès',
                driver: {
                    id_livreur: sanitizedData.id_livreur,
                    nom: sanitizedData.nom,
                    prenom: sanitizedData.prenom
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('❌ Erreur addDriver:', error);
        return errorResponse(`Erreur lors de l'ajout du livreur: ${error.message}`);
    }
}

// Fonction pour ajouter un restaurant
async function addRestaurant(db, data, clientIP) {
    try {
        console.log('🏪 Ajout d\'un nouveau restaurant...');
        
        const config = COLLECTIONS_CONFIG['Restau'];
        const validation = validateData(data, config.requiredFields);
        
        if (!validation.isValid) {
            return errorResponse(`Champs obligatoires manquants: ${validation.missingFields.join(', ')}`, 400);
        }

        const sanitizedData = sanitizeData(data);
        const collection = db.collection('Restau');

        // Vérification des doublons par nom et téléphone
        const existingRestaurant = await collection.findOne({
            $or: [
                { nom: sanitizedData.nom },
                { telephone: sanitizedData.telephone }
            ]
        });

        if (existingRestaurant) {
            return errorResponse('Un restaurant avec ce nom ou ce numéro de téléphone existe déjà', 409);
        }

        // Préparation du document restaurant
        const restaurantDocument = {
            nom: sanitizedData.nom,
            adresse: sanitizedData.adresse,
            quartier: sanitizedData.quartier || '',
            telephone: sanitizedData.telephone,
            email: sanitizedData.email || '',
            cuisine: sanitizedData.cuisine || '',
            horaires: sanitizedData.horaires || '',
            description: sanitizedData.description || '',
            date_creation: new Date(),
            statut: 'actif',
            createdAt: new Date(),
            updatedAt: new Date(),
            metadata: {
                createdBy: 'admin',
                version: 1,
                source: 'admin-panel'
            }
        };

        // Ajouter les coordonnées GPS si fournies
        if (sanitizedData.latitude && sanitizedData.longitude) {
            restaurantDocument.latitude = parseFloat(sanitizedData.latitude);
            restaurantDocument.longitude = parseFloat(sanitizedData.longitude);
            restaurantDocument.location = {
                type: "Point",
                coordinates: [parseFloat(sanitizedData.longitude), parseFloat(sanitizedData.latitude)]
            };
        }

        // Ajout du logo si fourni
        if (sanitizedData.logo_data) {
            restaurantDocument.logo = {
                logo_nom: sanitizedData.logo_nom || 'logo.webp',
                logo_type: sanitizedData.logo_type || 'image/webp',
                logo_taille: sanitizedData.logo_taille || 0,
                logo_data: sanitizedData.logo_data
            };
        }

        // Ajout des photos si fournies
        if (sanitizedData.photos && Array.isArray(sanitizedData.photos) && sanitizedData.photos.length > 0) {
            restaurantDocument.photos = sanitizedData.photos;
        }

        // Menu par défaut ou fourni
        restaurantDocument.menu = sanitizedData.menu || [];
        restaurantDocument.rating = 0;
        restaurantDocument.reviews_count = 0;

        // Insertion
        const result = await collection.insertOne(restaurantDocument);

        // Nettoyer le cache
        clearCache();

        // Log de sécurité
        await logSecurityAction(db, 'ADD_RESTAURANT', {
            nom: sanitizedData.nom,
            adresse: sanitizedData.adresse,
            telephone: sanitizedData.telephone,
            hasLogo: !!sanitizedData.logo_data,
            hasPhotos: !!(sanitizedData.photos && sanitizedData.photos.length > 0),
            menuItems: sanitizedData.menu ? sanitizedData.menu.length : 0,
            insertedId: result.insertedId
        }, clientIP);

        console.log(`✅ Restaurant ajouté avec succès: ${sanitizedData.nom}`);

        return {
            statusCode: 201,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                insertedId: result.insertedId,
                message: 'Restaurant ajouté avec succès',
                hasLogo: !!sanitizedData.logo_data,
                hasPhotos: !!(sanitizedData.photos && sanitizedData.photos.length > 0),
                menuItems: sanitizedData.menu ? sanitizedData.menu.length : 0,
                restaurant: {
                    nom: sanitizedData.nom,
                    adresse: sanitizedData.adresse,
                    telephone: sanitizedData.telephone,
                    cuisine: sanitizedData.cuisine
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('❌ Erreur addRestaurant:', error);
        return errorResponse(`Erreur lors de l'ajout du restaurant: ${error.message}`);
    }
}

// Fonction pour supprimer un élément (modifiée)
async function deleteItem(db, collectionName, itemId, clientIP) {
    try {
        console.log(`🗑️ Suppression de l'élément ${itemId} dans ${collectionName}`);
        
        if (!itemId) {
            return errorResponse('ID de l\'élément manquant', 400);
        }

        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        // Requête flexible pour les ID
        let query = {};
        
        // Essayer de convertir en ObjectId si possible
        try {
            const objectId = new ObjectId(itemId);
            query._id = objectId;
        } catch (error) {
            // Si échoue, utiliser l'ID comme chaîne
            query._id = itemId;
        }

        const collection = db.collection(collectionName);
        
        // Vérifier que l'élément existe
        const existingItem = await collection.findOne(query);
        if (!existingItem) {
            return errorResponse('Élément non trouvé', 404);
        }
        
        // Supprimer
        const result = await collection.deleteOne(query);

        if (result.deletedCount === 1) {
            // Nettoyer le cache
            clearCache();

            // Log de sécurité
            await logSecurityAction(db, 'DELETE_ITEM', {
                collection: collectionName,
                itemId: itemId,
                deletedItem: {
                    id: existingItem._id,
                    type: collectionName,
                    summary: generateItemSummary(existingItem, collectionName)
                }
            }, clientIP);

            console.log('✅ Élément supprimé avec succès');

            return successResponse({
                message: 'Élément supprimé avec succès',
                deletedCount: 1,
                itemId,
                collection: collectionName
            });
        } else {
            return errorResponse('Échec de la suppression - Aucun document supprimé', 500);
        }

    } catch (error) {
        console.error('❌ Erreur deleteItem:', error);
        return errorResponse(`Erreur lors de la suppression: ${error.message}`);
    }
}

// Fonction pour supprimer plusieurs éléments (cohérence)
async function deleteItems(db, collectionName, itemIds, clientIP) {
    try {
        console.log(`🗑️ Suppression de ${itemIds.length} éléments dans ${collectionName}`);
        
        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
            return errorResponse('IDs des éléments manquants', 400);
        }

        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        // Requête flexible pour les IDs
        const query = {
            _id: { $in: itemIds }
        };

        const collection = db.collection(collectionName);
        
        // Récupérer les éléments avant suppression pour le log
        const itemsToDelete = await collection.find(query).toArray();
        
        // Supprimer les éléments
        const result = await collection.deleteMany(query);

        // Nettoyer le cache
        clearCache();

        // Log de sécurité
        await logSecurityAction(db, 'DELETE_ITEMS', {
            collection: collectionName,
            requestedIds: itemIds.length,
            validIds: itemsToDelete.length,
            deletedCount: result.deletedCount,
            deletedItems: itemsToDelete.map(item => ({
                id: item._id,
                summary: generateItemSummary(item, collectionName)
            }))
        }, clientIP);

        console.log(`✅ ${result.deletedCount} élément(s) supprimé(s) avec succès`);

        return successResponse({
            message: `${result.deletedCount} élément(s) supprimé(s)`,
            deletedCount: result.deletedCount,
            requestedCount: itemIds.length,
            collection: collectionName
        });

    } catch (error) {
        console.error('❌ Erreur deleteItems:', error);
        return errorResponse(`Erreur lors de la suppression multiple: ${error.message}`);
    }
}


// Fonction pour mettre à jour un élément
async function updateItem(db, collectionName, itemId, updates, clientIP) {
    try {
        console.log(`✏️ Mise à jour de l'élément ${itemId} dans ${collectionName}`);
        
        if (!itemId) {
            return errorResponse('ID de l\'élément manquant', 400);
        }

        if (!updates || typeof updates !== 'object') {
            return errorResponse('Données de mise à jour manquantes', 400);
        }

        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const sanitizedUpdates = sanitizeData(updates);
        const collection = db.collection(collectionName);
        
        // Ajouter la date de modification
        sanitizedUpdates.updatedAt = new Date();
        sanitizedUpdates['metadata.lastModified'] = new Date();
        sanitizedUpdates['metadata.modifiedBy'] = 'admin';
        
        // Vérifier que l'élément existe
        const existingItem = await collection.findOne({ _id: new ObjectId(itemId) });
        if (!existingItem) {
            return errorResponse('Élément non trouvé', 404);
        }
        
        const result = await collection.updateOne(
            { _id: new ObjectId(itemId) },
            { $set: sanitizedUpdates }
        );

        if (result.matchedCount === 1) {
            // Récupérer l'élément mis à jour
            const updatedItem = await collection.findOne({ _id: new ObjectId(itemId) });
            
            // Nettoyer le cache
            clearCache();
            
            // Log de sécurité
            await logSecurityAction(db, 'UPDATE_ITEM', {
                collection: collectionName,
                itemId: itemId,
                updatedFields: Object.keys(sanitizedUpdates),
                modifiedCount: result.modifiedCount
            }, clientIP);
            
            console.log('✅ Élément mis à jour avec succès');
            
            return successResponse({
                message: 'Élément mis à jour avec succès',
                modifiedCount: result.modifiedCount,
                itemId,
                updatedItem,
                collection: collectionName
            });
        } else {
            return errorResponse('Échec de la mise à jour', 500);
        }

    } catch (error) {
        console.error('❌ Erreur updateItem:', error);
        return errorResponse(`Erreur lors de la mise à jour: ${error.message}`);
    }
}

// Fonction pour créer un élément
async function createItem(db, collectionName, data, clientIP) {
    try {
        console.log(`➕ Création d'un élément dans ${collectionName}`);
        
        if (!data || typeof data !== 'object') {
            return errorResponse('Données manquantes', 400);
        }

        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const config = COLLECTIONS_CONFIG[collectionName];
        const validation = validateData(data, config.requiredFields);
        
        if (!validation.isValid) {
            return errorResponse(`Champs obligatoires manquants: ${validation.missingFields.join(', ')}`, 400);
        }

        const sanitizedData = sanitizeData(data);
        const collection = db.collection(collectionName);
        
        // Ajouter les dates de création et modification
        sanitizedData.createdAt = new Date();
        sanitizedData.updatedAt = new Date();
        sanitizedData.metadata = {
            createdBy: 'admin',
            version: 1,
            source: 'admin-panel'
        };
        
        const result = await collection.insertOne(sanitizedData);

        // Nettoyer le cache
        clearCache();

        // Log de sécurité
        await logSecurityAction(db, 'CREATE_ITEM', {
            collection: collectionName,
            itemId: result.insertedId,
            itemSummary: generateItemSummary(sanitizedData, collectionName)
        }, clientIP);

        console.log('✅ Élément créé avec succès');

        return {
            statusCode: 201,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: 'Élément créé avec succès',
                insertedId: result.insertedId,
                collection: collectionName,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('❌ Erreur createItem:', error);
        return errorResponse(`Erreur lors de la création: ${error.message}`);
    }
}

// Fonction pour exporter une collection
async function exportCollection(db, collectionName, format = 'json', clientIP) {
    try {
        console.log(`📤 Export de la collection ${collectionName} en format ${format}`);
        
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const collection = db.collection(collectionName);
        
        const documents = await collection.find({}).toArray();

        let exportData;
        let contentType;
        let fileExtension;

        switch (format.toLowerCase()) {
            case 'csv':
                exportData = convertToCSV(documents);
                contentType = 'text/csv';
                fileExtension = 'csv';
                break;
            case 'json':
            default:
                exportData = JSON.stringify({
                    collection: collectionName,
                    exportDate: new Date().toISOString(),
                    count: documents.length,
                    data: documents,
                    metadata: {
                        exportedBy: 'admin',
                        version: '1.0',
                        format: format
                    }
                }, null, 2);
                contentType = 'application/json';
                fileExtension = 'json';
                break;
        }

        // Log de sécurité
        await logSecurityAction(db, 'EXPORT_COLLECTION', {
            collection: collectionName,
            format: format,
            count: documents.length,
            sizeBytes: exportData.length
        }, clientIP);

        console.log(`✅ Export réussi: ${documents.length} éléments`);

        return {
            statusCode: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${collectionName}_export_${new Date().toISOString().split('T')[0]}.${fileExtension}"`
            },
            body: exportData
        };

    } catch (error) {
        console.error('❌ Erreur exportCollection:', error);
        return errorResponse(`Erreur lors de l'export: ${error.message}`);
    }
}

// Fonction pour les analyses temporelles
async function getAnalytics(db, collectionName, timeRange, clientIP) {
    try {
        console.log(`📊 Analyse de ${collectionName} pour la période ${timeRange}`);
        
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const collection = db.collection(collectionName);
        
        // Définir la plage de temps
        const now = new Date();
        let startDate;
        let groupFormat;

        switch (timeRange) {
            case '24h':
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%m-%d %H:00";
                break;
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%m-%d";
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%m-%d";
                break;
            case '90d':
                startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%m-%d";
                break;
            default:
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%m-%d";
                break;
        }

        // Agrégation pour les statistiques temporelles
        const pipeline = [
            {
                $match: {
                    $or: [
                        { createdAt: { $gte: startDate } },
                        { dateCreation: { $gte: startDate } },
                        { date_creation: { $gte: startDate } },
                        { orderDate: { $gte: startDate } }
                    ]
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: groupFormat,
                            date: {
                                $ifNull: [
                                    "$createdAt",
                                    { $ifNull: ["$dateCreation", { $ifNull: ["$date_creation", "$orderDate"] }] }
                                ]
                            }
                        }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id": 1 } }
        ];

        const analyticsData = await collection.aggregate(pipeline).toArray();

        // Statistiques par statut si applicable
        const statusPipeline = [
            {
                $match: {
                    $or: [
                        { createdAt: { $gte: startDate } },
                        { dateCreation: { $gte: startDate } },
                        { date_creation: { $gte: startDate } },
                        { orderDate: { $gte: startDate } }
                    ]
                }
            },
            {
                $group: {
                    _id: { $ifNull: ["$status", "$statut"] },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ];

        const statusData = await collection.aggregate(statusPipeline).toArray();

        await logSecurityAction(db, 'GET_ANALYTICS', {
            collection: collectionName,
            timeRange: timeRange,
            dataPoints: analyticsData.length,
            statusCategories: statusData.length
        }, clientIP);

        console.log(`✅ Analyse terminée: ${analyticsData.length} points de données`);

        return successResponse({
            analytics: analyticsData,
            statusDistribution: statusData,
            timeRange,
            startDate: startDate.toISOString(),
            endDate: now.toISOString(),
            collection: collectionName
        });

    } catch (error) {
        console.error('❌ Erreur getAnalytics:', error);
        return errorResponse(`Erreur lors de l'analyse: ${error.message}`);
    }
}

// Fonction de recherche avancée
async function searchItems(db, collectionName, query, filters = {}, clientIP) {
    try {
        console.log(`🔍 Recherche dans ${collectionName}: "${query}"`);
        
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const collection = db.collection(collectionName);
        const config = COLLECTIONS_CONFIG[collectionName];
        
        // Construction de la requête de recherche
        const searchQuery = {};

        // Recherche textuelle si une requête est fournie
        if (query && query.trim()) {
            const searchTerms = query.trim().split(/\s+/);
            const regexQueries = searchTerms.map(term => new RegExp(term, 'i'));
            
            searchQuery.$or = config.searchFields.map(field => ({
                [field]: { $in: regexQueries }
            }));
        }

        // Appliquer les filtres
        if (filters.status) {
            searchQuery.status = filters.status;
        }
        if (filters.statut) {
            searchQuery.statut = filters.statut;
        }
        if (filters.dateStart && filters.dateEnd) {
            const startDate = new Date(filters.dateStart);
            const endDate = new Date(filters.dateEnd);
            endDate.setHours(23, 59, 59, 999);
            
            searchQuery.$and = searchQuery.$and || [];
            searchQuery.$and.push({
                $or: [
                    { createdAt: { $gte: startDate, $lte: endDate } },
                    { dateCreation: { $gte: startDate, $lte: endDate } },
                    { date_creation: { $gte: startDate, $lte: endDate } },
                    { orderDate: { $gte: startDate, $lte: endDate } }
                ]
            });
        }

        const results = await collection
            .find(searchQuery)
            .sort({ $natural: -1 })
            .limit(500)
            .toArray();

        await logSecurityAction(db, 'SEARCH_ITEMS', {
            collection: collectionName,
            query: query,
            filters: filters,
            resultsCount: results.length
        }, clientIP);

        console.log(`✅ Recherche terminée: ${results.length} résultats`);

        return successResponse({
            data: results,
            count: results.length,
            query,
            filters,
            collection: collectionName
        });

    } catch (error) {
        console.error('❌ Erreur searchItems:', error);
        return errorResponse(`Erreur lors de la recherche: ${error.message}`);
    }
}

// Fonction de sauvegarde
async function backupCollection(db, collectionName, clientIP) {
    try {
        console.log(`💾 Création de sauvegarde pour ${collectionName}`);
        
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }
        
        const collection = db.collection(collectionName);
        const timestamp = Date.now();
        const backupName = `${collectionName}_backup_${timestamp}`;
        const backupCollection = db.collection(backupName);
        
        const documents = await collection.find({}).toArray();
        
        if (documents.length > 0) {
            // Ajouter des métadonnées de sauvegarde
            const backupData = documents.map(doc => ({
                ...doc,
                _backup_metadata: {
                    originalCollection: collectionName,
                    backupDate: new Date(),
                    backupName,
                    version: '1.0'
                }
            }));
            
            await backupCollection.insertMany(backupData);
        }

        // Créer un document de métadonnées pour la sauvegarde
        const metadataCollection = db.collection('_backup_metadata');
        await metadataCollection.insertOne({
            backupName,
            originalCollection: collectionName,
            documentsCount: documents.length,
            backupDate: new Date(),
            timestamp,
            status: 'completed',
            createdBy: 'admin',
            sizeBytes: JSON.stringify(documents).length
        });

        // Log de sécurité
        await logSecurityAction(db, 'BACKUP_COLLECTION', {
            collection: collectionName,
            backupName: backupName,
            documentsCount: documents.length
        }, clientIP);

        console.log(`✅ Sauvegarde créée: ${backupName}`);

        return successResponse({
            message: `Sauvegarde créée pour ${collectionName}`,
            backupName,
            documentsCount: documents.length
        });

    } catch (error) {
        console.error('❌ Erreur backupCollection:', error);
        return errorResponse(`Erreur lors de la sauvegarde: ${error.message}`);
    }
}

// Fonction de restauration
async function restoreCollection(db, collectionName, backupName, clientIP) {
    try {
        console.log(`🔄 Restauration de ${collectionName} depuis ${backupName}`);
        
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const backupCollection = db.collection(backupName);
        const targetCollection = db.collection(collectionName);
        
        // Vérifier que la sauvegarde existe
        const backupCount = await backupCollection.countDocuments();
        if (backupCount === 0) {
            return errorResponse('Sauvegarde non trouvée ou vide', 404);
        }
        
        // Récupérer les documents de sauvegarde
        const backupDocuments = await backupCollection.find({}).toArray();
        
        // Nettoyer les métadonnées de sauvegarde et restaurer
        const cleanDocuments = backupDocuments.map(doc => {
            const { _backup_metadata, ...cleanDoc } = doc;
            return {
                ...cleanDoc,
                restoredAt: new Date(),
                restoredFrom: backupName,
                'metadata.restored': true,
                'metadata.restoredBy': 'admin'
            };
        });
        
        // Vider la collection cible et insérer les données restaurées
        await targetCollection.deleteMany({});
        if (cleanDocuments.length > 0) {
            await targetCollection.insertMany(cleanDocuments);
        }

        // Nettoyer le cache
        clearCache();

        // Log de sécurité
        await logSecurityAction(db, 'RESTORE_COLLECTION', {
            collection: collectionName,
            backupName: backupName,
            restoredCount: cleanDocuments.length
        }, clientIP);

        console.log(`✅ Restauration terminée: ${cleanDocuments.length} documents`);

        return successResponse({
            message: `Collection ${collectionName} restaurée depuis ${backupName}`,
            restoredCount: cleanDocuments.length
        });

    } catch (error) {
        console.error('❌ Erreur restoreCollection:', error);
        return errorResponse(`Erreur lors de la restauration: ${error.message}`);
    }
}

// Fonction pour lister les sauvegardes
async function getBackups(db, collectionName, clientIP) {
    try {
        console.log(`📋 Récupération des sauvegardes${collectionName ? ` pour ${collectionName}` : ''}`);
        
        const metadataCollection = db.collection('_backup_metadata');
        
        const query = collectionName ? { originalCollection: collectionName } : {};
        const backups = await metadataCollection
            .find(query)
            .sort({ backupDate: -1 })
            .toArray();

        await logSecurityAction(db, 'GET_BACKUPS', {
            collection: collectionName,
            backupsCount: backups.length
        }, clientIP);

        console.log(`✅ ${backups.length} sauvegarde(s) trouvée(s)`);

        return successResponse({
            backups,
            count: backups.length,
            collection: collectionName
        });

    } catch (error) {
        console.error('❌ Erreur getBackups:', error);
        return errorResponse(`Erreur lors de la récupération des sauvegardes: ${error.message}`);
    }
}

// Fonction pour supprimer une sauvegarde
async function deleteBackup(db, backupName, clientIP) {
    try {
        console.log(`🗑️ Suppression de la sauvegarde ${backupName}`);
        
        // Supprimer la collection de sauvegarde
        await db.collection(backupName).drop();
        
        // Supprimer les métadonnées
        const metadataCollection = db.collection('_backup_metadata');
        await metadataCollection.deleteOne({ backupName });

        // Log de sécurité
        await logSecurityAction(db, 'DELETE_BACKUP', {
            backupName: backupName
        }, clientIP);

        console.log(`✅ Sauvegarde ${backupName} supprimée`);

        return successResponse({
            message: `Sauvegarde ${backupName} supprimée`
        });

    } catch (error) {
        console.error('❌ Erreur deleteBackup:', error);
        return errorResponse(`Erreur lors de la suppression de la sauvegarde: ${error.message}`);
    }
}

// Fonction de recherche globale
async function globalSearch(db, query, collections = [], clientIP) {
    try {
        console.log(`🌐 Recherche globale: "${query}"`);
        
        if (!query || query.trim().length < 2) {
            return errorResponse('Requête de recherche trop courte (minimum 2 caractères)', 400);
        }

        const defaultCollections = Object.keys(COLLECTIONS_CONFIG);
        const searchCollections = collections.length > 0 ? collections : defaultCollections;
        const results = {};
        let totalResults = 0;

        const searchPromises = searchCollections.map(async (collectionName) => {
            try {
                if (!COLLECTIONS_CONFIG[collectionName]) {
                    return;
                }

                const searchResponse = await searchItems(db, collectionName, query, {}, clientIP);
                const searchData = JSON.parse(searchResponse.body);
                
                if (searchData.success) {
                    results[collectionName] = {
                        data: searchData.data.slice(0, 10),
                        count: searchData.count,
                        hasMore: searchData.count > 10
                    };
                    totalResults += searchData.count;
                }
            } catch (error) {
                console.warn(`⚠️ Erreur recherche dans ${collectionName}:`, error);
                results[collectionName] = { data: [], count: 0, hasMore: false };
            }
        });

        await Promise.all(searchPromises);

        await logSecurityAction(db, 'GLOBAL_SEARCH', {
            query: query,
            searchedCollections: searchCollections,
            totalResults: totalResults
        }, clientIP);

        console.log(`✅ Recherche globale terminée: ${totalResults} résultats`);

        return successResponse({
            query,
            results,
            totalResults,
            searchedCollections
        });

    } catch (error) {
        console.error('❌ Erreur globalSearch:', error);
        return errorResponse(`Erreur lors de la recherche globale: ${error.message}`);
    }
}

// Fonction pour obtenir les informations système
async function getSystemInfo(db, clientIP) {
    try {
        console.log('🖥️ Récupération des informations système');
        
        // Liste des collections
        const collections = await db.listCollections().toArray();
        
        const systemInfo = {
            database: DB_NAME,
            collections: collections.length,
            performance: getPerformanceMetrics(),
            cache: {
                size: cache.size,
                keys: Array.from(cache.keys())
            },
            rateLimiter: {
                activeIPs: rateLimiter.size
            }
        };

        const collectionsInfo = collections.map(col => ({
            name: col.name,
            type: col.type,
            options: col.options
        }));

        await logSecurityAction(db, 'GET_SYSTEM_INFO', {
            collectionsCount: collections.length
        }, clientIP);

        console.log('✅ Informations système récupérées');

        return successResponse({
            systemInfo,
            collectionsInfo
        });

    } catch (error) {
        console.error('❌ Erreur getSystemInfo:', error);
        return errorResponse(`Erreur lors de la récupération des informations système: ${error.message}`);
    }
}

// Fonctions utilitaires avancées

async function bulkUpdate(db, collectionName, updates, filter, clientIP) {
    try {
        console.log(`🔄 Mise à jour en masse dans ${collectionName}`);
        
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const collection = db.collection(collectionName);
        const sanitizedUpdates = sanitizeData(updates);
        
        sanitizedUpdates.updatedAt = new Date();
        sanitizedUpdates['metadata.bulkUpdated'] = new Date();
        sanitizedUpdates['metadata.bulkUpdatedBy'] = 'admin';
        
        const result = await collection.updateMany(filter, { $set: sanitizedUpdates });

        clearCache();

        await logSecurityAction(db, 'BULK_UPDATE', {
            collection: collectionName,
            filter: filter,
            updatedFields: Object.keys(sanitizedUpdates),
            modifiedCount: result.modifiedCount
        }, clientIP);

        console.log(`✅ Mise à jour en masse terminée: ${result.modifiedCount} documents`);

        return successResponse({
            message: `${result.modifiedCount} élément(s) mis à jour`,
            modifiedCount: result.modifiedCount,
            matchedCount: result.matchedCount
        });

    } catch (error) {
        console.error('❌ Erreur bulkUpdate:', error);
        return errorResponse(`Erreur lors de la mise à jour en masse: ${error.message}`);
    }
}

async function validateCollectionData(db, collectionName, data, clientIP) {
    try {
        console.log(`✅ Validation des données pour ${collectionName}`);
        
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const config = COLLECTIONS_CONFIG[collectionName];
        const validation = validateData(data, config.requiredFields);
        
        const issues = [];
        
        // Vérifications supplémentaires
        if (collectionName === 'Res_livreur' && data.whatsapp) {
            const collection = db.collection(collectionName);
            const existing = await collection.findOne({ whatsapp: data.whatsapp });
            if (existing) {
                issues.push('Numéro WhatsApp déjà utilisé');
            }
        }

        await logSecurityAction(db, 'VALIDATE_DATA', {
            collection: collectionName,
            isValid: validation.isValid,
            issues: issues.length
        }, clientIP);

        return successResponse({
            isValid: validation.isValid && issues.length === 0,
            missingFields: validation.missingFields,
            issues: issues
        });

    } catch (error) {
        console.error('❌ Erreur validateCollectionData:', error);
        return errorResponse(`Erreur lors de la validation: ${error.message}`);
    }
}

async function optimizeCollection(db, collectionName, clientIP) {
    try {
        console.log(`⚡ Optimisation de la collection ${collectionName}`);
        
        if (!COLLECTIONS_CONFIG[collectionName]) {
            return errorResponse('Collection non autorisée', 403);
        }

        const collection = db.collection(collectionName);
        
        // Créer des index pour améliorer les performances
        const config = COLLECTIONS_CONFIG[collectionName];
        const indexPromises = config.searchFields.map(field => 
            collection.createIndex({ [field]: 1 })
        );
        
        await Promise.all(indexPromises);

        await logSecurityAction(db, 'OPTIMIZE_COLLECTION', {
            collection: collectionName,
            indexesCreated: config.searchFields.length
        }, clientIP);

        console.log(`✅ Collection ${collectionName} optimisée`);

        return successResponse({
            message: `Collection ${collectionName} optimisée`,
            indexesCreated: config.searchFields.length
        });

    } catch (error) {
        console.error('❌ Erreur optimizeCollection:', error);
        return errorResponse(`Erreur lors de l'optimisation: ${error.message}`);
    }
}

async function clearCacheAction(clientIP) {
    try {
        console.log('🧹 Nettoyage du cache');
        
        const cacheSize = cache.size;
        clearCache();

        await logSecurityAction(null, 'CLEAR_CACHE', {
            previousCacheSize: cacheSize
        }, clientIP);

        console.log(`✅ Cache nettoyé: ${cacheSize} entrées supprimées`);

        return successResponse({
            message: 'Cache nettoyé avec succès',
            clearedEntries: cacheSize
        });

    } catch (error) {
        console.error('❌ Erreur clearCacheAction:', error);
        return errorResponse(`Erreur lors du nettoyage du cache: ${error.message}`);
    }
}

async function getPerformanceMetricsResponse(clientIP) {
    try {
        const performanceData = getPerformanceMetrics();
        
        await logSecurityAction(null, 'GET_PERFORMANCE_METRICS', {
            metricsRequested: Object.keys(performanceData).length
        }, clientIP);

        return successResponse({
            performance: performanceData,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erreur getPerformanceMetricsResponse:', error);
        return errorResponse(`Erreur lors de la récupération des métriques: ${error.message}`);
    }
}

async function healthCheck(db, clientIP) {
    try {
        console.log('🏥 Vérification de l\'état du système');
        
        // Test de connexion à la base de données
        await db.admin().ping();
        
        const health = {
            status: 'healthy',
            database: 'connected',
            cache: `${cache.size} entries`,
            uptime: Math.round((Date.now() - metrics.startTime) / 1000),
            performance: getPerformanceMetrics(),
            timestamp: new Date().toISOString()
        };

        await logSecurityAction(db, 'HEALTH_CHECK', {
            status: health.status
        }, clientIP);

        console.log('✅ Système en bonne santé');

        return successResponse(health);

    } catch (error) {
        console.error('❌ Erreur healthCheck:', error);
        return errorResponse(`Erreur lors de la vérification de santé: ${error.message}`);
    }
}

async function getSystemHealth(db) {
    try {
        await db.admin().ping();
        return {
            database: 'connected',
            status: 'healthy',
            uptime: Math.round((Date.now() - metrics.startTime) / 1000)
        };
    } catch (error) {
        return {
            database: 'disconnected',
            status: 'unhealthy',
            error: error.message
        };
    }
}

// Fonctions utilitaires

function generateItemSummary(item, collectionName) {
    switch (collectionName) {
        case 'Res_livreur':
            return `${item.nom} ${item.prenom} (${item.id_livreur})`;
        case 'Restau':
            return `${item.nom} - ${item.adresse}`;
        case 'Colis':
            return `${item.colisID || item._id} - ${item.sender} → ${item.recipient}`;
        default:
            return `${item._id}`;
    }
}

function convertToCSV(data) {
    if (!data.length) return '';
    
    // Obtenir tous les champs possibles
    const allFields = new Set();
    data.forEach(item => {
        Object.keys(item).forEach(key => {
            if (!key.startsWith('_') && key !== 'photo' && key !== 'photos' && key !== 'logo') {
                allFields.add(key);
            }
        });
    });
    
    const headers = Array.from(allFields);
    
    const csvContent = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => {
                let value = row[header];
                if (typeof value === 'object' && value !== null) {
                    value = JSON.stringify(value);
                }
                return `"${String(value || '').replace(/"/g, '""')}"`;
            }).join(',')
        )
    ].join('\n');
    
    return csvContent;
}

function successResponse(data) {
    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            ...data,
            timestamp: new Date().toISOString()
        })
    };
}

function errorResponse(message, status = 400) {
    return {
        statusCode: status,
        headers: corsHeaders,
        body: JSON.stringify({
            success: false,
            message,
            timestamp: new Date().toISOString()
        })
    };
}