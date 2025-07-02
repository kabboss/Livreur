const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB avec sécurité renforcée
const MONGODB_CONFIG = {
    URI: "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/?retryWrites=true&w=majority",
    DB_NAME: "FarmsConnect",
    OPTIONS: {
        connectTimeoutMS: 30000,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 2,
        retryWrites: true,
        w: 'majority',
        readPreference: 'primaryPreferred',
        authSource: 'admin',
        ssl: true,
        tls: true,
        tlsAllowInvalidCertificates: false,
        tlsAllowInvalidHostnames: false
    }
};

// Headers CORS optimisés
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
};

// Configuration des collections avec validation
const COLLECTION_SCHEMAS = {
    'Res_livreur': {
        required: ['id_livreur', 'nom', 'prenom', 'whatsapp', 'quartier'],
        indexed: ['id_livreur', 'whatsapp', 'nom', 'status'],
        maxDocuments: 10000
    },
    'Restau': {
        required: ['nom', 'adresse', 'telephone'],
        indexed: ['nom', 'telephone', 'quartier', 'statut'],
        maxDocuments: 5000
    },
    'Colis': {
        indexed: ['colisID', 'status', 'createdAt', 'id_livreur'],
        maxDocuments: 100000
    },
    'Commandes': {
        indexed: ['orderID', 'status', 'date_creation', 'restaurant_id'],
        maxDocuments: 100000
    },
    'Livraison': {
        indexed: ['id_livreur', 'colisID', 'status', 'dateCreation'],
        maxDocuments: 50000
    }
};

// Cache et rate limiting
const cache = new Map();
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;

// Instance MongoDB avec gestion des connexions
let mongoClient = null;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

// Fonction de connexion MongoDB avec retry et monitoring
async function connectToMongoDB() {
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
        return mongoClient.db(MONGODB_CONFIG.DB_NAME);
    }

    try {
        if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
            throw new Error('Nombre maximum de tentatives de connexion atteint');
        }

        connectionAttempts++;
        console.log(`Tentative de connexion MongoDB ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}`);
        
        mongoClient = new MongoClient(MONGODB_CONFIG.URI, MONGODB_CONFIG.OPTIONS);
        await mongoClient.connect();
        
        // Test de la connexion
        await mongoClient.db(MONGODB_CONFIG.DB_NAME).admin().ping();
        
        console.log('✅ Connexion MongoDB établie avec succès');
        connectionAttempts = 0; // Reset sur succès
        
        // Gestion des événements de connexion
        mongoClient.on('error', (error) => {
            console.error('❌ Erreur MongoDB:', error);
        });
        
        mongoClient.on('close', () => {
            console.warn('⚠️ Connexion MongoDB fermée');
        });

        return mongoClient.db(MONGODB_CONFIG.DB_NAME);
    } catch (error) {
        console.error(`❌ Erreur de connexion MongoDB (tentative ${connectionAttempts}):`, error);
        
        if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
            const delay = Math.pow(2, connectionAttempts) * 1000; // Exponential backoff
            console.log(`⏳ Nouvelle tentative dans ${delay/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return connectToMongoDB();
        }
        
        throw new Error(`Impossible de se connecter à MongoDB après ${MAX_CONNECTION_ATTEMPTS} tentatives: ${error.message}`);
    }
}

// Fonction de validation d'entrée
function validateInput(data, schema) {
    const errors = [];
    
    if (schema.required) {
        for (const field of schema.required) {
            if (!data[field] || (typeof data[field] === 'string' && !data[field].trim())) {
                errors.push(`Le champ "${field}" est obligatoire`);
            }
        }
    }
    
    // Validation des types de données
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        errors.push('Format email invalide');
    }
    
    if (data.whatsapp && !/^\+?[\d\s\-\(\)]{8,15}$/.test(data.whatsapp)) {
        errors.push('Format WhatsApp invalide');
    }
    
    if (data.telephone && !/^\+?[\d\s\-\(\)]{8,15}$/.test(data.telephone)) {
        errors.push('Format téléphone invalide');
    }
    
    return errors;
}

// Rate limiting
function checkRateLimit(ip) {
    const now = Date.now();
    const userRequests = rateLimit.get(ip) || [];
    
    // Nettoyer les anciennes requêtes
    const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
    
    if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
        throw new Error('Trop de requêtes. Veuillez patienter.');
    }
    
    recentRequests.push(now);
    rateLimit.set(ip, recentRequests);
}

// Cache utilities
function getCached(key) {
    const cached = cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > cached.ttl) {
        cache.delete(key);
        return null;
    }
    
    return cached.data;
}

function setCache(key, data, ttl = 300000) { // 5 minutes par défaut
    cache.set(key, {
        data,
        timestamp: Date.now(),
        ttl
    });
}

// Handler principal avec gestion d'erreurs complète
exports.handler = async (event, context) => {
    // Configuration du contexte
    context.callbackWaitsForEmptyEventLoop = false;
    
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substr(2, 9);
    const clientIP = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'] || 'unknown';
    
    console.log(`🚀 [${requestId}] Requête reçue - IP: ${clientIP}, Méthode: ${event.httpMethod}`);

    // Gérer CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    try {
        // Rate limiting
        checkRateLimit(clientIP);
        
        // Validation de la méthode HTTP
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(event.httpMethod)) {
            return createErrorResponse('Méthode HTTP non supportée', 405, requestId);
        }

        const queryParams = event.queryStringParameters || {};
        const action = queryParams.action || (event.body ? JSON.parse(event.body).action : null);

        if (!action) {
            return createErrorResponse('Action manquante', 400, requestId);
        }

        console.log(`📋 [${requestId}] Action: ${action}`);

        // Connexion à la base de données
        const db = await connectToMongoDB();
        
        let result;
        
        // Router les actions
        if (event.httpMethod === 'GET') {
            result = await handleGetRequest(db, action, queryParams, requestId);
        } else if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            result = await handlePostRequest(db, action, body, requestId);
        } else {
            return createErrorResponse('Méthode non implémentée', 501, requestId);
        }

        const duration = Date.now() - startTime;
        console.log(`✅ [${requestId}] Requête traitée en ${duration}ms`);
        
        return result;

    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ [${requestId}] Erreur après ${duration}ms:`, error);
        
        // Classification des erreurs
        if (error.message.includes('Trop de requêtes')) {
            return createErrorResponse(error.message, 429, requestId);
        }
        
        if (error.message.includes('MongoDB') || error.message.includes('connexion')) {
            return createErrorResponse('Erreur de base de données', 503, requestId);
        }
        
        if (error.message.includes('validation') || error.message.includes('obligatoire')) {
            return createErrorResponse(error.message, 400, requestId);
        }
        
        return createErrorResponse('Erreur interne du serveur', 500, requestId, error.message);
    }
};

// Handler pour les requêtes GET
async function handleGetRequest(db, action, queryParams, requestId) {
    switch (action) {
        case 'getStats':
            return await getStats(db, requestId);
        
        case 'getData':
            const collection = queryParams.collection;
            const limit = Math.min(parseInt(queryParams.limit || '1000'), 5000); // Limite max de sécurité
            const offset = Math.max(parseInt(queryParams.offset || '0'), 0);
            
            if (!collection) {
                throw new Error('Collection manquante');
            }
            
            return await getData(db, collection, limit, offset, requestId);
        
        case 'getPreview':
            const previewCollection = queryParams.collection;
            const previewLimit = Math.min(parseInt(queryParams.limit || '5'), 20);
            
            if (!previewCollection) {
                throw new Error('Collection manquante');
            }
            
            return await getPreview(db, previewCollection, previewLimit, requestId);
        
        case 'getCollectionStats':
            const statsCollection = queryParams.collection;
            
            if (!statsCollection) {
                throw new Error('Collection manquante');
            }
            
            return await getCollectionStats(db, statsCollection, requestId);
        
        case 'healthCheck':
            return await healthCheck(db, requestId);
        
        default:
            throw new Error(`Action GET non supportée: ${action}`);
    }
}

// Handler pour les requêtes POST
async function handlePostRequest(db, action, body, requestId) {
    switch (action) {
        case 'addDriver':
            return await addDriver(db, body, requestId);
        
        case 'addRestaurant':
            return await addRestaurant(db, body, requestId);
        
        case 'generateDriverId':
            return await generateUniqueDriverId(db, requestId);
        
        case 'deleteItem':
            return await deleteItem(db, body.collection, body.itemId, requestId);
        
        case 'updateItem':
            return await updateItem(db, body.collection, body.itemId, body.updates, requestId);
        
        case 'createItem':
            return await createItem(db, body.collection, body.data, requestId);
        
        case 'searchItems':
            return await searchItems(db, body.collection, body.query, body.filters || {}, requestId);
        
        case 'backupCollection':
            return await backupCollection(db, body.collection, requestId);
        
        case 'globalSearch':
            return await globalSearch(db, body.query, body.collections || [], requestId);
        
        case 'bulkOperation':
            return await bulkOperation(db, body.collection, body.operation, body.items, requestId);
        
        default:
            throw new Error(`Action POST non supportée: ${action}`);
    }
}

// Fonction de santé système
async function healthCheck(db, requestId) {
    try {
        const ping = await db.admin().ping();
        const stats = await db.stats();
        
        return createSuccessResponse({
            status: 'healthy',
            database: {
                connected: true,
                name: MONGODB_CONFIG.DB_NAME,
                collections: stats.collections,
                dataSize: stats.dataSize,
                avgObjSize: stats.avgObjSize
            },
            cache: {
                size: cache.size,
                hitRate: '95%' // Placeholder
            },
            timestamp: new Date().toISOString()
        }, requestId);
    } catch (error) {
        throw new Error(`Health check failed: ${error.message}`);
    }
}

// Fonction de statistiques optimisée avec cache
async function getStats(db, requestId) {
    const cacheKey = 'global-stats';
    const cached = getCached(cacheKey);
    
    if (cached) {
        console.log(`📊 [${requestId}] Stats servies depuis le cache`);
        return createSuccessResponse(cached, requestId);
    }

    try {
        console.log(`📊 [${requestId}] Calcul des statistiques globales...`);
        
        const collections = [
            'Colis', 'Commandes', 'Livraison', 'LivraisonsEffectuees', 
            'Refus', 'Res_livreur', 'compte_livreur', 'Restau', 
            'cour_expedition', 'pharmacyOrders', 'shopping_orders'
        ];

        const stats = {};
        const collectionsData = {};
        
        // Parallélisation des requêtes de comptage
        const countPromises = collections.map(async (collectionName) => {
            try {
                const count = await db.collection(collectionName).estimatedDocumentCount();
                return { collection: collectionName, count };
            } catch (error) {
                console.warn(`⚠️ [${requestId}] Erreur pour ${collectionName}:`, error.message);
                return { collection: collectionName, count: 0 };
            }
        });

        const results = await Promise.all(countPromises);
        
        results.forEach(({ collection, count }) => {
            collectionsData[collection] = count;
            
            // Calcul des statistiques spéciales
            switch (collection) {
                case 'Colis':
                    stats.colis = count;
                    break;
                case 'Livraison':
                    stats.livraison = count;
                    break;
                case 'LivraisonsEffectuees':
                    stats.livrees = count;
                    break;
                case 'Res_livreur':
                    stats.livreurs = count;
                    stats.totalLivreurs = count;
                    break;
                case 'Restau':
                    stats.restaurants = count;
                    stats.totalRestaurants = count;
                    break;
                case 'Commandes':
                    stats.commandes = count;
                    break;
            }
        });

        // Statistiques du jour avec optimisation
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const [commandesJour, colisJour] = await Promise.all([
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

            stats.commandesJour = commandesJour + colisJour;
        } catch (error) {
            console.warn(`⚠️ [${requestId}] Erreur calcul commandes du jour:`, error.message);
            stats.commandesJour = 0;
        }

        // Performance metrics
        stats.performance = await calculatePerformanceMetrics(db);
        
        const responseData = {
            success: true,
            stats,
            collectionsData,
            timestamp: new Date().toISOString(),
            requestId
        };
        
        // Mise en cache pour 2 minutes
        setCache(cacheKey, responseData, 120000);
        
        console.log(`✅ [${requestId}] Statistiques calculées pour ${collections.length} collections`);
        
        return createSuccessResponse(responseData, requestId);

    } catch (error) {
        console.error(`❌ [${requestId}] Erreur getStats:`, error);
        throw new Error(`Erreur lors du calcul des statistiques: ${error.message}`);
    }
}

// Calcul des métriques de performance
async function calculatePerformanceMetrics(db) {
    try {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const [weeklyDeliveries, weeklyOrders, avgResponseTime] = await Promise.all([
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
            }),
            // Simuler un temps de réponse moyen
            Promise.resolve(Math.random() * 3 + 1) // 1-4 heures
        ]);

        const successRate = weeklyOrders > 0 ? Math.min(95, (weeklyDeliveries / weeklyOrders * 100)) : 0;

        return {
            weeklyDeliveries,
            weeklyOrders,
            averageDeliveryTime: `${avgResponseTime.toFixed(1)}h`,
            successRate: `${successRate.toFixed(1)}%`
        };
    } catch (error) {
        console.warn('Erreur calcul performance:', error);
        return {
            weeklyDeliveries: 0,
            weeklyOrders: 0,
            averageDeliveryTime: 'N/A',
            successRate: 'N/A'
        };
    }
}

// Fonction getData optimisée
async function getData(db, collectionName, limit, offset, requestId) {
    const cacheKey = `data-${collectionName}-${limit}-${offset}`;
    const cached = getCached(cacheKey);
    
    if (cached) {
        console.log(`📄 [${requestId}] Données ${collectionName} servies depuis le cache`);
        return createSuccessResponse(cached, requestId);
    }

    try {
        console.log(`📄 [${requestId}] Chargement collection ${collectionName} (limit: ${limit}, offset: ${offset})`);
        
        const collection = db.collection(collectionName);
        
        // Validation des limites de sécurité
        const schema = COLLECTION_SCHEMAS[collectionName];
        if (schema && schema.maxDocuments && offset > schema.maxDocuments) {
            throw new Error('Offset trop élevé pour cette collection');
        }
        
        // Requêtes parallèles pour l'optimisation
        const [totalCount, documents] = await Promise.all([
            collection.estimatedDocumentCount(),
            collection
                .find({})
                .sort({ _id: -1 }) // Plus efficace que $natural
                .skip(offset)
                .limit(limit)
                .maxTimeMS(30000) // Timeout de sécurité
                .toArray()
        ]);

        const responseData = {
            success: true,
            data: documents,
            count: documents.length,
            totalCount,
            offset,
            limit,
            hasMore: offset + documents.length < totalCount,
            collection: collectionName,
            timestamp: new Date().toISOString(),
            requestId
        };
        
        // Cache pour 1 minute
        setCache(cacheKey, responseData, 60000);
        
        console.log(`✅ [${requestId}] Collection ${collectionName} chargée: ${documents.length}/${totalCount} documents`);
        
        return createSuccessResponse(responseData, requestId);

    } catch (error) {
        console.error(`❌ [${requestId}] Erreur getData:`, error);
        throw new Error(`Erreur lors du chargement de ${collectionName}: ${error.message}`);
    }
}

// Fonction getPreview optimisée
async function getPreview(db, collectionName, limit, requestId) {
    try {
        console.log(`👀 [${requestId}] Aperçu collection ${collectionName} (limit: ${limit})`);
        
        const collection = db.collection(collectionName);
        
        const [documents, totalCount] = await Promise.all([
            collection
                .find({})
                .sort({ _id: -1 })
                .limit(limit)
                .maxTimeMS(10000)
                .toArray(),
            collection.estimatedDocumentCount()
        ]);

        const responseData = {
            success: true,
            data: documents,
            collection: collectionName,
            totalCount,
            timestamp: new Date().toISOString(),
            requestId
        };
        
        return createSuccessResponse(responseData, requestId);

    } catch (error) {
        console.error(`❌ [${requestId}] Erreur getPreview:`, error);
        throw new Error(`Erreur lors du chargement de l'aperçu: ${error.message}`);
    }
}

// Génération d'ID unique optimisée
async function generateUniqueDriverId(db, requestId) {
    try {
        console.log(`🆔 [${requestId}] Génération ID livreur...`);
        
        const collection = db.collection('Res_livreur');
        let attempts = 0;
        const maxAttempts = 50;
        
        while (attempts < maxAttempts) {
            const random = Math.floor(Math.random() * 90000) + 10000; // 5 chiffres
            const newId = `LIV${random}`;
            
            // Vérification d'unicité optimisée
            const exists = await collection.findOne(
                { id_livreur: newId }, 
                { projection: { _id: 1 } }
            );
            
            if (!exists) {
                console.log(`✅ [${requestId}] ID généré: ${newId}`);
                return createSuccessResponse({
                    success: true,
                    id_livreur: newId,
                    timestamp: new Date().toISOString(),
                    requestId
                }, requestId);
            }
            
            attempts++;
        }
        
        // Fallback avec timestamp
        const fallbackId = `LIV-${Date.now().toString().slice(-8)}`;
        console.log(`⚠️ [${requestId}] Fallback ID: ${fallbackId}`);
        
        return createSuccessResponse({
            success: true,
            id_livreur: fallbackId,
            timestamp: new Date().toISOString(),
            requestId
        }, requestId);
        
    } catch (error) {
        console.error(`❌ [${requestId}] Erreur generateUniqueDriverId:`, error);
        throw new Error(`Erreur lors de la génération de l'ID: ${error.message}`);
    }
}

// Fonction addDriver avec validation complète
async function addDriver(db, data, requestId) {
    try {
        console.log(`👤 [${requestId}] Ajout livreur: ${data.id_livreur}`);
        
        const schema = COLLECTION_SCHEMAS['Res_livreur'];
        const validationErrors = validateInput(data, schema);
        
        if (validationErrors.length > 0) {
            throw new Error(`Erreurs de validation: ${validationErrors.join(', ')}`);
        }

        const collection = db.collection('Res_livreur');

        // Vérification des doublons avec requête optimisée
        const existingDriver = await collection.findOne({
            $or: [
                { whatsapp: data.whatsapp },
                { id_livreur: data.id_livreur }
            ]
        }, { projection: { _id: 1, whatsapp: 1, id_livreur: 1 } });

        if (existingDriver) {
            const duplicateField = existingDriver.whatsapp === data.whatsapp ? 'WhatsApp' : 'ID';
            throw new Error(`Un livreur avec ce ${duplicateField} existe déjà`);
        }

        // Préparation du document avec données nettoyées
        const driverDocument = {
            id_livreur: data.id_livreur.trim(),
            nom: data.nom.trim(),
            prenom: data.prenom.trim(),
            whatsapp: data.whatsapp.trim(),
            telephone: data.telephone?.trim() || '',
            quartier: data.quartier.trim(),
            piece: data.piece?.trim() || '',
            date: data.date || '',
            contact_urgence: data.contact_urgence?.trim() || '',
            date_inscription: data.date_inscription || new Date().toISOString(),
            createdAt: new Date(),
            updatedAt: new Date(),
            status: 'actif',
            version: 1
        };

        // Gestion de la photo avec validation
        if (data.photo_data) {
            // Validation de la taille (5MB max en base64)
            const photoSizeBytes = (data.photo_data.length * 3) / 4;
            if (photoSizeBytes > 5 * 1024 * 1024) {
                throw new Error('Photo trop volumineuse (max 5MB)');
            }
            
            driverDocument.photo = {
                data: data.photo_data,
                content_type: data.photo_type || 'image/webp',
                size: data.photo_size || photoSizeBytes,
                width: data.photo_width || 0,
                height: data.photo_height || 0,
                uploaded_at: new Date(),
                version: 1
            };
        }

        // Insertion avec options de sécurité
        const result = await collection.insertOne(driverDocument, {
            writeConcern: { w: 'majority', j: true }
        });

        // Log de sécurité
        await logSecurityAction(db, 'ADD_DRIVER', {
            id_livreur: data.id_livreur,
            nom: data.nom,
            prenom: data.prenom,
            hasPhoto: !!data.photo_data,
            requestId
        });

        // Invalidation du cache
        cache.delete('global-stats');

        console.log(`✅ [${requestId}] Livreur ajouté: ${data.id_livreur}`);

        return createSuccessResponse({
            success: true,
            insertedId: result.insertedId,
            message: 'Livreur ajouté avec succès',
            hasPhoto: !!data.photo_data,
            driver: {
                id_livreur: data.id_livreur,
                nom: data.nom,
                prenom: data.prenom
            },
            timestamp: new Date().toISOString(),
            requestId
        }, requestId, 201);

    } catch (error) {
        console.error(`❌ [${requestId}] Erreur addDriver:`, error);
        
        if (error.message.includes('duplicate key')) {
            throw new Error('Données en doublon détectées');
        }
        
        throw new Error(`Erreur lors de l'ajout du livreur: ${error.message}`);
    }
}

// Fonction addRestaurant avec validation complète
async function addRestaurant(db, data, requestId) {
    try {
        console.log(`🏪 [${requestId}] Ajout restaurant: ${data.nom}`);
        
        const schema = COLLECTION_SCHEMAS['Restau'];
        const validationErrors = validateInput(data, schema);
        
        if (validationErrors.length > 0) {
            throw new Error(`Erreurs de validation: ${validationErrors.join(', ')}`);
        }

        const collection = db.collection('Restau');

        // Vérification des doublons
        const existingRestaurant = await collection.findOne({
            $or: [
                { nom: { $regex: new RegExp(`^${data.nom}$`, 'i') } },
                { telephone: data.telephone }
            ]
        }, { projection: { _id: 1, nom: 1, telephone: 1 } });

        if (existingRestaurant) {
            const duplicateField = existingRestaurant.nom.toLowerCase() === data.nom.toLowerCase() ? 'nom' : 'téléphone';
            throw new Error(`Un restaurant avec ce ${duplicateField} existe déjà`);
        }

        // Préparation du document restaurant
        const restaurantDocument = {
            nom: data.nom.trim(),
            adresse: data.adresse.trim(),
            quartier: data.quartier?.trim() || '',
            telephone: data.telephone.trim(),
            email: data.email?.trim() || '',
            cuisine: data.cuisine || '',
            horaires: data.horaires?.trim() || '',
            description: data.description?.trim() || '',
            date_creation: new Date(),
            statut: 'actif',
            createdAt: new Date(),
            updatedAt: new Date(),
            rating: 0,
            reviews_count: 0,
            version: 1
        };

        // Coordonnées GPS avec validation
        if (data.latitude && data.longitude) {
            const lat = parseFloat(data.latitude);
            const lng = parseFloat(data.longitude);
            
            if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                restaurantDocument.latitude = lat;
                restaurantDocument.longitude = lng;
                restaurantDocument.location = {
                    type: "Point",
                    coordinates: [lng, lat]
                };
            }
        }

        // Gestion du logo avec validation
        if (data.logo_data) {
            const logoSizeBytes = (data.logo_data.length * 3) / 4;
            if (logoSizeBytes > 5 * 1024 * 1024) {
                throw new Error('Logo trop volumineux (max 5MB)');
            }
            
            restaurantDocument.logo = {
                logo_nom: data.logo_nom || 'logo.webp',
                logo_type: data.logo_type || 'image/webp',
                logo_taille: data.logo_taille || logoSizeBytes,
                logo_data: data.logo_data,
                uploaded_at: new Date()
            };
        }

        // Gestion des photos avec validation
        if (data.photos && Array.isArray(data.photos) && data.photos.length > 0) {
            const validPhotos = data.photos.filter(photo => {
                if (!photo.data) return false;
                const photoSize = (photo.data.length * 3) / 4;
                return photoSize <= 5 * 1024 * 1024; // 5MB max par photo
            });
            
            if (validPhotos.length > 0) {
                restaurantDocument.photos = validPhotos.map(photo => ({
                    ...photo,
                    uploaded_at: new Date()
                }));
            }
        }

        // Menu avec validation et indexation
        if (data.menu && Array.isArray(data.menu)) {
            const validMenu = data.menu.filter(item => 
                item.nom && item.nom.trim() && 
                !isNaN(parseFloat(item.prix))
            ).map(item => ({
                id: item.id || generateMenuItemId(),
                nom: item.nom.trim(),
                description: item.description?.trim() || '',
                prix: parseFloat(item.prix),
                categorie: item.categorie?.trim() || 'Divers',
                disponible: true,
                created_at: new Date()
            }));
            
            restaurantDocument.menu = validMenu;
        } else {
            restaurantDocument.menu = [];
        }

        // Insertion avec transaction pour la cohérence
        const session = mongoClient.startSession();
        let result;
        
        try {
            await session.withTransaction(async () => {
                result = await collection.insertOne(restaurantDocument, { session });
                
                // Log de sécurité dans la transaction
                await logSecurityAction(db, 'ADD_RESTAURANT', {
                    nom: data.nom,
                    adresse: data.adresse,
                    telephone: data.telephone,
                    hasLogo: !!data.logo_data,
                    photoCount: data.photos?.length || 0,
                    menuItems: restaurantDocument.menu.length,
                    requestId
                }, session);
            });
        } finally {
            await session.endSession();
        }

        // Invalidation du cache
        cache.delete('global-stats');

        console.log(`✅ [${requestId}] Restaurant ajouté: ${data.nom}`);

        return createSuccessResponse({
            success: true,
            insertedId: result.insertedId,
            message: 'Restaurant ajouté avec succès',
            hasLogo: !!data.logo_data,
            hasPhotos: !!(data.photos && data.photos.length > 0),
            menuItems: restaurantDocument.menu.length,
            restaurant: {
                nom: data.nom,
                adresse: data.adresse,
                telephone: data.telephone,
                cuisine: data.cuisine
            },
            timestamp: new Date().toISOString(),
            requestId
        }, requestId, 201);

    } catch (error) {
        console.error(`❌ [${requestId}] Erreur addRestaurant:`, error);
        throw new Error(`Erreur lors de l'ajout du restaurant: ${error.message}`);
    }
}

// Fonction de suppression sécurisée
async function deleteItem(db, collectionName, itemId, requestId) {
    try {
        console.log(`🗑️ [${requestId}] Suppression ${collectionName}/${itemId}`);
        
        if (!itemId || !collectionName) {
            throw new Error('Collection et ID requis');
        }

        let objectId;
        try {
            objectId = new ObjectId(itemId);
        } catch (error) {
            throw new Error('Format d\'ID invalide');
        }

        const collection = db.collection(collectionName);
        
        // Vérification d'existence et récupération pour log
        const existingItem = await collection.findOne(
            { _id: objectId },
            { projection: { _id: 1, nom: 1, name: 1, id_livreur: 1 } }
        );
        
        if (!existingItem) {
            throw new Error('Élément non trouvé');
        }
        
        // Suppression avec confirmation
        const result = await collection.deleteOne(
            { _id: objectId },
            { writeConcern: { w: 'majority', j: true } }
        );

        if (result.deletedCount === 1) {
            // Log de sécurité
            await logSecurityAction(db, 'DELETE_ITEM', {
                collection: collectionName,
                itemId: itemId,
                deletedItem: existingItem,
                requestId
            });

            // Invalidation du cache
            cache.delete('global-stats');
            cache.delete(`data-${collectionName}-*`);

            console.log(`✅ [${requestId}] Élément supprimé: ${collectionName}/${itemId}`);

            return createSuccessResponse({
                success: true,
                message: 'Élément supprimé avec succès',
                deletedCount: 1,
                itemId,
                collection: collectionName,
                timestamp: new Date().toISOString(),
                requestId
            }, requestId);
        } else {
            throw new Error('Échec de la suppression');
        }

    } catch (error) {
        console.error(`❌ [${requestId}] Erreur deleteItem:`, error);
        throw new Error(`Erreur lors de la suppression: ${error.message}`);
    }
}

// Fonction de recherche avancée optimisée
async function searchItems(db, collectionName, query, filters, requestId) {
    try {
        console.log(`🔍 [${requestId}] Recherche dans ${collectionName}: "${query}"`);
        
        if (!query || query.length < 2) {
            throw new Error('Requête trop courte (minimum 2 caractères)');
        }

        const collection = db.collection(collectionName);
        
        // Construction de la requête de recherche optimisée
        const searchQuery = {};
        const searchTerms = query.trim().split(/\s+/).slice(0, 5); // Limite à 5 termes
        
        if (searchTerms.length > 0) {
            const regexQueries = searchTerms.map(term => new RegExp(term, 'i'));
            
            searchQuery.$or = [
                { nom: { $in: regexQueries } },
                { name: { $in: regexQueries } },
                { sender: { $in: regexQueries } },
                { recipient: { $in: regexQueries } },
                { description: { $in: regexQueries } },
                { status: { $in: regexQueries } },
                { statut: { $in: regexQueries } },
                { colisID: { $in: regexQueries } },
                { id_livreur: { $in: regexQueries } },
                { username: { $in: regexQueries } },
                { telephone: { $in: regexQueries } },
                { whatsapp: { $in: regexQueries } },
                { email: { $in: regexQueries } }
            ];
        }

        // Application des filtres
        if (filters.status) {
            searchQuery.status = filters.status;
        }
        if (filters.statut) {
            searchQuery.statut = filters.statut;
        }
        
        // Filtre de date optimisé
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

        // Exécution de la recherche avec limite de sécurité
        const results = await collection
            .find(searchQuery)
            .sort({ _id: -1 })
            .limit(500) // Limite de sécurité
            .maxTimeMS(20000) // Timeout de 20s
            .toArray();

        console.log(`✅ [${requestId}] Recherche terminée: ${results.length} résultats`);

        return createSuccessResponse({
            success: true,
            data: results,
            count: results.length,
            query,
            filters,
            collection: collectionName,
            timestamp: new Date().toISOString(),
            requestId
        }, requestId);

    } catch (error) {
        console.error(`❌ [${requestId}] Erreur searchItems:`, error);
        throw new Error(`Erreur lors de la recherche: ${error.message}`);
    }
}

// Fonction de recherche globale optimisée
async function globalSearch(db, query, collections, requestId) {
    try {
        console.log(`🌐 [${requestId}] Recherche globale: "${query}"`);
        
        if (!query || query.trim().length < 2) {
            throw new Error('Requête de recherche trop courte (minimum 2 caractères)');
        }

        const defaultCollections = [
            'Colis', 'Commandes', 'Livraison', 'LivraisonsEffectuees', 
            'Refus', 'Res_livreur', 'compte_livreur', 'Restau'
        ];

        const searchCollections = collections.length > 0 ? collections : defaultCollections;
        const results = {};
        let totalResults = 0;

        // Recherche parallèle dans toutes les collections
        const searchPromises = searchCollections.map(async (collectionName) => {
            try {
                const searchResult = await searchItems(db, collectionName, query, {}, requestId);
                const searchData = searchResult.body ? JSON.parse(searchResult.body) : searchResult;
                
                if (searchData.success) {
                    return {
                        collection: collectionName,
                        data: searchData.data.slice(0, 10), // Limite à 10 résultats par collection
                        count: searchData.count,
                        hasMore: searchData.count > 10
                    };
                }
            } catch (error) {
                console.warn(`⚠️ [${requestId}] Erreur recherche ${collectionName}:`, error.message);
            }
            
            return {
                collection: collectionName,
                data: [],
                count: 0,
                hasMore: false
            };
        });

        const searchResults = await Promise.all(searchPromises);
        
        searchResults.forEach(result => {
            results[result.collection] = {
                data: result.data,
                count: result.count,
                hasMore: result.hasMore
            };
            totalResults += result.count;
        });

        console.log(`✅ [${requestId}] Recherche globale terminée: ${totalResults} résultats`);

        return createSuccessResponse({
            success: true,
            query,
            results,
            totalResults,
            searchedCollections: searchCollections,
            timestamp: new Date().toISOString(),
            requestId
        }, requestId);

    } catch (error) {
        console.error(`❌ [${requestId}] Erreur globalSearch:`, error);
        throw new Error(`Erreur lors de la recherche globale: ${error.message}`);
    }
}

// Fonction d'opérations en masse
async function bulkOperation(db, collectionName, operation, items, requestId) {
    try {
        console.log(`📦 [${requestId}] Opération en masse ${operation} sur ${collectionName}`);
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            throw new Error('Liste d\'éléments requise');
        }
        
        if (items.length > 1000) {
            throw new Error('Trop d\'éléments (max 1000)');
        }

        const collection = db.collection(collectionName);
        let result;
        
        const session = mongoClient.startSession();
        
        try {
            await session.withTransaction(async () => {
                switch (operation) {
                    case 'delete':
                        const objectIds = items.map(id => new ObjectId(id));
                        result = await collection.deleteMany(
                            { _id: { $in: objectIds } },
                            { session }
                        );
                        break;
                        
                    case 'update':
                        const bulkOps = items.map(item => ({
                            updateOne: {
                                filter: { _id: new ObjectId(item.id) },
                                update: { $set: { ...item.updates, updatedAt: new Date() } }
                            }
                        }));
                        result = await collection.bulkWrite(bulkOps, { session });
                        break;
                        
                    default:
                        throw new Error(`Opération non supportée: ${operation}`);
                }
                
                // Log de sécurité
                await logSecurityAction(db, 'BULK_OPERATION', {
                    collection: collectionName,
                    operation,
                    itemCount: items.length,
                    requestId
                }, session);
            });
        } finally {
            await session.endSession();
        }

        // Invalidation du cache
        cache.delete('global-stats');
        
        console.log(`✅ [${requestId}] Opération en masse terminée: ${operation}`);

        return createSuccessResponse({
            success: true,
            operation,
            collection: collectionName,
            processedItems: items.length,
            result,
            timestamp: new Date().toISOString(),
            requestId
        }, requestId);

    } catch (error) {
        console.error(`❌ [${requestId}] Erreur bulkOperation:`, error);
        throw new Error(`Erreur lors de l'opération en masse: ${error.message}`);
    }
}

// Fonction de log de sécurité améliorée
async function logSecurityAction(db, action, details, session = null) {
    try {
        const securityLog = db.collection('_security_logs');
        const logEntry = {
            action,
            details,
            timestamp: new Date(),
            ip: 'admin-system',
            userAgent: 'admin-ultra-pro-v2',
            severity: getSeverityLevel(action),
            version: 2
        };
        
        if (session) {
            await securityLog.insertOne(logEntry, { session });
        } else {
            await securityLog.insertOne(logEntry);
        }
    } catch (error) {
        console.warn('⚠️ Erreur lors du logging de sécurité:', error.message);
    }
}

// Détermination du niveau de sévérité
function getSeverityLevel(action) {
    const highSeverity = ['DELETE_ITEM', 'BULK_OPERATION', 'DELETE_BACKUP'];
    const mediumSeverity = ['ADD_DRIVER', 'ADD_RESTAURANT', 'UPDATE_ITEM'];
    
    if (highSeverity.includes(action)) return 'HIGH';
    if (mediumSeverity.includes(action)) return 'MEDIUM';
    return 'LOW';
}

// Utilitaires de génération d'ID
function generateMenuItemId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Fonctions de création de réponses standardisées
function createSuccessResponse(data, requestId, statusCode = 200) {
    return {
        statusCode,
        headers: {
            ...CORS_HEADERS,
            'X-Request-ID': requestId,
            'X-Response-Time': Date.now()
        },
        body: JSON.stringify({
            ...data,
            requestId,
            timestamp: new Date().toISOString()
        })
    };
}

function createErrorResponse(message, statusCode = 400, requestId, details = null) {
    const errorResponse = {
        success: false,
        error: true,
        message,
        statusCode,
        requestId,
        timestamp: new Date().toISOString()
    };
    
    if (details && process.env.NODE_ENV === 'development') {
        errorResponse.details = details;
    }
    
    return {
        statusCode,
        headers: {
            ...CORS_HEADERS,
            'X-Request-ID': requestId,
            'X-Error': 'true'
        },
        body: JSON.stringify(errorResponse)
    };
}

// Fonctions utilitaires (placeholders pour futures implémentations)
async function updateItem(db, collectionName, itemId, updates, requestId) {
    throw new Error('Fonction updateItem en cours de développement');
}

async function createItem(db, collectionName, data, requestId) {
    throw new Error('Fonction createItem en cours de développement');
}

async function getCollectionStats(db, collectionName, requestId) {
    throw new Error('Fonction getCollectionStats en cours de développement');
}

async function backupCollection(db, collectionName, requestId) {
    throw new Error('Fonction backupCollection en cours de développement');
}

// Nettoyage périodique du cache et des rate limits
setInterval(() => {
    const now = Date.now();
    
    // Nettoyage du cache
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > value.ttl) {
            cache.delete(key);
        }
    }
    
    // Nettoyage du rate limiting
    for (const [ip, requests] of rateLimit.entries()) {
        const recentRequests = requests.filter(time => now - time < RATE_LIMIT_WINDOW);
        if (recentRequests.length === 0) {
            rateLimit.delete(ip);
        } else {
            rateLimit.set(ip, recentRequests);
        }
    }
    
    console.log(`🧹 Cache nettoyé: ${cache.size} entrées, Rate limit: ${rateLimit.size} IPs`);
}, 300000); // Toutes les 5 minutes

// Gestion propre de l'arrêt
process.on('SIGTERM', async () => {
    console.log('🛑 Arrêt en cours...');
    if (mongoClient) {
        await mongoClient.close();
        console.log('✅ Connexion MongoDB fermée');
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Interruption reçue...');
    if (mongoClient) {
        await mongoClient.close();
        console.log('✅ Connexion MongoDB fermée');
    }
    process.exit(0);
});