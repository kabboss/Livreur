const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = "FarmsConnect";

// Headers CORS optimisés
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block'
};

// Instance MongoDB réutilisable avec pool de connexions
let mongoClient = null;
let dbConnection = null;

// Configuration de sécurité et rate limiting
const RATE_LIMIT = {
    window: 60000, // 1 minute
    maxRequests: 1000,
    requests: new Map()
};

// Cache en mémoire pour optimiser les performances
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutes

// Fonctions utilitaires
const generateId = () => Math.random().toString(36).substr(2, 9);
const timestamp = () => new Date().toISOString();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Rate limiting middleware
function rateLimit(ip) {
    const now = Date.now();
    const userRequests = RATE_LIMIT.requests.get(ip) || [];
    const validRequests = userRequests.filter(time => now - time < RATE_LIMIT.window);
    
    if (validRequests.length >= RATE_LIMIT.maxRequests) {
        return false;
    }
    
    validRequests.push(now);
    RATE_LIMIT.requests.set(ip, validRequests);
    return true;
}

// Cache utilities
function setCache(key, value, ttl = CACHE_TTL) {
    cache.set(key, {
        value,
        expires: Date.now() + ttl
    });
}

function getCache(key) {
    const item = cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
        cache.delete(key);
        return null;
    }
    
    return item.value;
}

function clearCache(pattern = null) {
    if (pattern) {
        for (const key of cache.keys()) {
            if (key.includes(pattern)) {
                cache.delete(key);
            }
        }
    } else {
        cache.clear();
    }
}

// Connexion MongoDB avec gestion d'erreurs avancée
async function connectToMongoDB() {
    try {
        if (!mongoClient) {
            console.log('Initialisation de la connexion MongoDB...');
            mongoClient = new MongoClient(MONGODB_URI, {
                connectTimeoutMS: 30000,
                serverSelectionTimeoutMS: 30000,
                socketTimeoutMS: 45000,
                maxPoolSize: 50,
                minPoolSize: 5,
                maxIdleTimeMS: 30000,
                retryWrites: true,
                w: 'majority',
                readPreference: 'primaryPreferred',
                readConcern: { level: 'majority' },
                writeConcern: { w: 'majority', j: true },
                bufferMaxEntries: 0,
                useUnifiedTopology: true,
                useNewUrlParser: true
            });

            await mongoClient.connect();
            console.log('Connexion MongoDB établie avec succès');
            
            // Test de connexion
            await mongoClient.db(DB_NAME).admin().ping();
            console.log('Ping MongoDB réussi');
        }

        if (!dbConnection) {
            dbConnection = mongoClient.db(DB_NAME);
        }

        return dbConnection; 
    } catch (error) {
        console.error('Erreur de connexion MongoDB:', error);
        
        // Réinitialiser les connexions en cas d'erreur
        mongoClient = null;
        dbConnection = null;
        
        throw new Error(`Échec de connexion à MongoDB: ${error.message}`);
    }
}

// Gestion gracieuse de la fermeture
process.on('SIGINT', async () => {
    try {
        if (mongoClient) {
            await mongoClient.close();
            console.log('Connexion MongoDB fermée proprement');
        }
    } catch (error) {
        console.error('Erreur lors de la fermeture MongoDB:', error);
    }
    process.exit(0);
});

// Handler principal avec gestion d'erreurs complète
exports.handler = async (event, context) => {
    // Configuration Lambda
    context.callbackWaitsForEmptyEventLoop = false;

    const startTime = Date.now();
    const requestId = generateId();
    
    try {
        // Logging de la requête
        console.log(`[${requestId}] Nouvelle requête:`, {
            method: event.httpMethod,
            path: event.path,
            userAgent: event.headers?.['user-agent'],
            ip: event.headers?.['x-forwarded-for'] || event.headers?.['x-real-ip'] || 'unknown',
            timestamp: timestamp()
        });

        // Rate limiting
        const clientIp = event.headers?.['x-forwarded-for'] || event.headers?.['x-real-ip'] || 'unknown';
        if (!rateLimit(clientIp)) {
            console.warn(`[${requestId}] Rate limit dépassé pour IP: ${clientIp}`);
            return errorResponse('Trop de requêtes. Veuillez patienter.', 429, requestId);
        }

        // Gestion CORS preflight
        if (event.httpMethod === 'OPTIONS') {
            console.log(`[${requestId}] Requête OPTIONS - CORS preflight`);
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ success: true, message: 'CORS preflight' })
            };
        }

        // Validation de la méthode HTTP
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(event.httpMethod)) {
            return errorResponse('Méthode HTTP non supportée', 405, requestId);
        }

        // Parse des paramètres
        const queryParams = event.queryStringParameters || {};
        const action = queryParams.action || (event.body ? JSON.parse(event.body).action : null);

        if (!action) {
            return errorResponse('Action manquante', 400, requestId);
        }

        console.log(`[${requestId}] Action demandée: ${action}`);

        // Connexion à MongoDB
        const db = await connectToMongoDB();

        // Routeur principal
        let result;
        const actionStartTime = Date.now();

        switch (event.httpMethod) {
            case 'GET':
                result = await handleGetRequest(db, queryParams, requestId);
                break;
            case 'POST':
                const body = JSON.parse(event.body || '{}');
                result = await handlePostRequest(db, body, requestId);
                break;
            case 'PUT':
                const putBody = JSON.parse(event.body || '{}');
                result = await handlePutRequest(db, putBody, requestId);
                break;
            case 'DELETE':
                const deleteBody = JSON.parse(event.body || '{}');
                result = await handleDeleteRequest(db, deleteBody, requestId);
                break;
            default:
                result = errorResponse('Méthode non supportée', 405, requestId);
        }

        const actionDuration = Date.now() - actionStartTime;
        console.log(`[${requestId}] Action ${action} exécutée en ${actionDuration}ms`);

        // Ajout des métadonnées de performance
        if (result.body) {
            const parsedBody = JSON.parse(result.body);
            parsedBody.metadata = {
                requestId,
                executionTime: Date.now() - startTime,
                actionDuration,
                timestamp: timestamp(),
                version: '2.0'
            };
            result.body = JSON.stringify(parsedBody);
        }

        return result;

    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`[${requestId}] Erreur serveur (${duration}ms):`, {
            error: error.message,
            stack: error.stack,
            event: {
                method: event.httpMethod,
                path: event.path,
                query: event.queryStringParameters
            }
        });

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: 'Erreur interne du serveur',
                message: error.message,
                requestId,
                timestamp: timestamp(),
                ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
            })
        };
    }
};

// Gestionnaires de requêtes par méthode HTTP
async function handleGetRequest(db, params, requestId) {
    const { action } = params;

    switch (action) {
        case 'getStats':
            return await getSystemStats(db, requestId);
        case 'getData':
            return await getCollectionData(db, params, requestId);
        case 'getCollectionInfo':
            return await getCollectionInfo(db, params.collection, requestId);
        case 'searchGlobal':
            return await globalSearch(db, params, requestId);
        case 'getBackups':
            return await getBackupsList(db, params.collection, requestId);
        case 'exportData':
            return await exportCollectionData(db, params, requestId);
        case 'getAnalytics':
            return await getAnalytics(db, params, requestId);
        case 'getSystemHealth':
            return await getSystemHealth(db, requestId);
        case 'getLogs':
            return await getSystemLogs(db, params, requestId);
        default:
            return errorResponse(`Action GET '${action}' non supportée`, 400, requestId);
    }
}

async function handlePostRequest(db, body, requestId) {
    const { action } = body;

    switch (action) {
        case 'addDriver':
            return await addDriver(db, body, requestId);
        case 'addRestaurant':
            return await addRestaurant(db, body, requestId);
        case 'generateDriverId':
            return await generateUniqueDriverId(db, requestId);
        case 'createItem':
            return await createItem(db, body, requestId);
        case 'search':
            return await searchInCollection(db, body, requestId);
        case 'backup':
            return await createBackup(db, body, requestId);
        case 'restore':
            return await restoreFromBackup(db, body, requestId);
        case 'bulkAction':
            return await executeBulkAction(db, body, requestId);
        case 'validateData':
            return await validateData(db, body, requestId);
        case 'optimizeCollection':
            return await optimizeCollection(db, body, requestId);
        default:
            return errorResponse(`Action POST '${action}' non supportée`, 400, requestId);
    }
}

async function handlePutRequest(db, body, requestId) {
    const { action } = body;

    switch (action) {
        case 'updateItem':
            return await updateItem(db, body, requestId);
        case 'updateBulk':
            return await updateBulkItems(db, body, requestId);
        case 'updateSettings':
            return await updateSystemSettings(db, body, requestId);
        default:
            return errorResponse(`Action PUT '${action}' non supportée`, 400, requestId);
    }
}

async function handleDeleteRequest(db, body, requestId) {
    const { action } = body;

    switch (action) {
        case 'deleteItem':
            return await deleteItem(db, body, requestId);
        case 'deleteItems':
            return await deleteMultipleItems(db, body, requestId);
        case 'deleteCollection':
            return await deleteCollection(db, body, requestId);
        case 'deleteBackup':
            return await deleteBackup(db, body, requestId);
        case 'cleanupData':
            return await cleanupData(db, body, requestId);
        default:
            return errorResponse(`Action DELETE '${action}' non supportée`, 400, requestId);
    }
}

// Fonctions de données principales
async function getSystemStats(db, requestId) {
    try {
        const cacheKey = 'system_stats';
        const cached = getCache(cacheKey);
        
        if (cached) {
            console.log(`[${requestId}] Stats chargées depuis le cache`);
            return successResponse(cached, requestId);
        }

        console.log(`[${requestId}] Calcul des statistiques système...`);

        const collections = [
            'Colis', 'Commandes', 'Livraison', 'LivraisonsEffectuees', 
            'Refus', 'Res_livreur', 'compte_livreur', 'Restau', 
            'cour_expedition', 'pharmacyOrders', 'shopping_orders'
        ];

        const stats = {};
        const collectionsData = {};
        const promises = [];

        // Compter les documents dans chaque collection en parallèle
        for (const collectionName of collections) {
            promises.push(
                db.collection(collectionName).countDocuments()
                    .then(count => ({ name: collectionName, count }))
                    .catch(error => {
                        console.warn(`[${requestId}] Erreur collection ${collectionName}:`, error.message);
                        return { name: collectionName, count: 0 };
                    })
            );
        }

        const results = await Promise.all(promises);
        
        // Traitement des résultats
        for (const { name, count } of results) {
            collectionsData[name] = count;
            
            switch (name) {
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
                    break;
                case 'Restau':
                    stats.restaurants = count;
                    break;
                case 'Commandes':
                    stats.commandes = count;
                    break;
            }
        }

        // Statistiques avancées
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        try {
            const [commandesJour, performance] = await Promise.all([
                // Commandes du jour
                Promise.all([
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
                ]).then(([commandes, colis]) => commandes + colis),

                // Performance hebdomadaire
                (async () => {
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

                    return {
                        weeklyDeliveries,
                        weeklyOrders,
                        successRate: weeklyOrders > 0 ? Math.round((weeklyDeliveries / weeklyOrders) * 100) + '%' : '0%',
                        averageDeliveryTime: '2.5h'
                    };
                })()
            ]);

            stats.commandesJour = commandesJour;
            stats.performance = performance;

        } catch (error) {
            console.warn(`[${requestId}] Erreur calcul statistiques avancées:`, error.message);
            stats.commandesJour = 0;
            stats.performance = {
                weeklyDeliveries: 0,
                weeklyOrders: 0,
                successRate: 'N/A',
                averageDeliveryTime: 'N/A'
            };
        }

        // Activité récente
        const recentActivity = await getRecentActivity(db, 10);

        const response = {
            stats,
            collectionsData,
            recentActivity,
            systemInfo: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cacheSize: cache.size
            }
        };

        setCache(cacheKey, response, 120000); // Cache 2 minutes
        console.log(`[${requestId}] Statistiques calculées et mises en cache`);

        return successResponse(response, requestId);

    } catch (error) {
        console.error(`[${requestId}] Erreur getSystemStats:`, error);
        return errorResponse(`Erreur lors du calcul des statistiques: ${error.message}`, 500, requestId);
    }
}

async function getCollectionData(db, params, requestId) {
    try {
        const { 
            collection: collectionName, 
            limit = 100, 
            offset = 0, 
            sort = '_id', 
            order = 'desc',
            filter = '{}' 
        } = params;

        if (!collectionName) {
            return errorResponse('Nom de collection manquant', 400, requestId);
        }

        console.log(`[${requestId}] Chargement collection ${collectionName} (limit: ${limit}, offset: ${offset})`);

        const collection = db.collection(collectionName);
        
        // Parse du filtre
        let filterObj = {};
        try {
            filterObj = JSON.parse(filter);
        } catch (error) {
            console.warn(`[${requestId}] Filtre invalide, utilisation du filtre par défaut`);
        }

        // Configuration du tri
        const sortObj = {};
        sortObj[sort] = order === 'desc' ? -1 : 1;

        const limitNum = Math.min(parseInt(limit), 1000); // Limite max 1000
        const offsetNum = Math.max(parseInt(offset), 0);

        // Requêtes en parallèle
        const [documents, totalCount] = await Promise.all([
            collection
                .find(filterObj)
                .sort(sortObj)
                .skip(offsetNum)
                .limit(limitNum)
                .toArray(),
            collection.countDocuments(filterObj)
        ]);

        // Statistiques de la collection
        const stats = await getCollectionBasicStats(db, collectionName);

        console.log(`[${requestId}] Collection ${collectionName}: ${documents.length}/${totalCount} documents chargés`);

        return successResponse({
            data: documents,
            pagination: {
                count: documents.length,
                totalCount,
                offset: offsetNum,
                limit: limitNum,
                hasMore: offsetNum + documents.length < totalCount,
                totalPages: Math.ceil(totalCount / limitNum),
                currentPage: Math.floor(offsetNum / limitNum) + 1
            },
            collection: collectionName,
            stats,
            filter: filterObj,
            sort: { [sort]: order }
        }, requestId);

    } catch (error) {
        console.error(`[${requestId}] Erreur getCollectionData:`, error);
        return errorResponse(`Erreur lors du chargement: ${error.message}`, 500, requestId);
    }
}

async function deleteMultipleItems(db, body, requestId) {
    try {
        const { collection: collectionName, itemIds, confirm = false } = body;

        if (!collectionName || !itemIds || !Array.isArray(itemIds)) {
            return errorResponse('Données de suppression invalides', 400, requestId);
        }

        if (!confirm) {
            return errorResponse('Confirmation requise pour la suppression multiple', 400, requestId);
        }

        if (itemIds.length === 0) {
            return errorResponse('Aucun élément à supprimer', 400, requestId);
        }

        if (itemIds.length > 100) {
            return errorResponse('Trop d\'éléments à supprimer (max 100)', 400, requestId);
        }

        console.log(`[${requestId}] Suppression multiple: ${itemIds.length} éléments de ${collectionName}`);

        const collection = db.collection(collectionName);
        
        // Validation des IDs
        const objectIds = [];
        const invalidIds = [];

        for (const id of itemIds) {
            try {
                objectIds.push(new ObjectId(id));
            } catch (error) {
                invalidIds.push(id);
            }
        }

        if (invalidIds.length > 0) {
            console.warn(`[${requestId}] IDs invalides détectés:`, invalidIds);
        }

        if (objectIds.length === 0) {
            return errorResponse('Aucun ID valide fourni', 400, requestId);
        }

        // Vérification de l'existence des éléments
        const existingItems = await collection.find({
            _id: { $in: objectIds }
        }).toArray();

        if (existingItems.length === 0) {
            return errorResponse('Aucun élément trouvé avec les IDs fournis', 404, requestId);
        }

        // Sauvegarde avant suppression
        await logSecurityAction(db, 'BULK_DELETE_PREPARE', {
            collection: collectionName,
            itemCount: existingItems.length,
            items: existingItems.map(item => ({ _id: item._id, summary: JSON.stringify(item).substring(0, 100) })),
            requestId,
            timestamp: new Date()
        });

        // Suppression
        const deleteResult = await collection.deleteMany({
            _id: { $in: objectIds }
        });

        // Log de sécurité
        await logSecurityAction(db, 'BULK_DELETE_SUCCESS', {
            collection: collectionName,
            requestedCount: objectIds.length,
            deletedCount: deleteResult.deletedCount,
            invalidIds,
            requestId,
            timestamp: new Date()
        });

        // Nettoyage du cache
        clearCache(collectionName);

        console.log(`[${requestId}] Suppression réussie: ${deleteResult.deletedCount}/${objectIds.length} éléments`);

        return successResponse({
            deletedCount: deleteResult.deletedCount,
            requestedCount: objectIds.length,
            invalidIds,
            skippedCount: objectIds.length - deleteResult.deletedCount,
            collection: collectionName
        }, requestId);

    } catch (error) {
        console.error(`[${requestId}] Erreur deleteMultipleItems:`, error);
        
        // Log d'erreur de sécurité
        await logSecurityAction(db, 'BULK_DELETE_ERROR', {
            collection: body.collection,
            error: error.message,
            requestId,
            timestamp: new Date()
        }).catch(logError => console.error('Erreur log sécurité:', logError));

        return errorResponse(`Erreur lors de la suppression: ${error.message}`, 500, requestId);
    }
}

async function deleteItem(db, body, requestId) {
    try {
        const { collection: collectionName, itemId, confirm = false } = body;

        if (!collectionName || !itemId) {
            return errorResponse('Collection et ID requis', 400, requestId);
        }

        if (!confirm) {
            return errorResponse('Confirmation requise pour la suppression', 400, requestId);
        }

        console.log(`[${requestId}] Suppression élément ${itemId} de ${collectionName}`);

        let objectId;
        try {
            objectId = new ObjectId(itemId);
        } catch (error) {
            return errorResponse('Format d\'ID invalide', 400, requestId);
        }

        const collection = db.collection(collectionName);
        
        // Vérification de l'existence
        const existingItem = await collection.findOne({ _id: objectId });
        if (!existingItem) {
            return errorResponse('Élément non trouvé', 404, requestId);
        }

        // Log de sécurité avant suppression
        await logSecurityAction(db, 'DELETE_ITEM_PREPARE', {
            collection: collectionName,
            itemId,
            itemSummary: JSON.stringify(existingItem).substring(0, 200),
            requestId,
            timestamp: new Date()
        });

        // Suppression
        const result = await collection.deleteOne({ _id: objectId });

        if (result.deletedCount === 1) {
            // Log de succès
            await logSecurityAction(db, 'DELETE_ITEM_SUCCESS', {
                collection: collectionName,
                itemId,
                requestId,
                timestamp: new Date()
            });

            // Nettoyage du cache
            clearCache(collectionName);

            console.log(`[${requestId}] Élément supprimé avec succès`);

            return successResponse({
                deletedCount: 1,
                itemId,
                collection: collectionName
            }, requestId);
        } else {
            return errorResponse('Échec de la suppression', 500, requestId);
        }

    } catch (error) {
        console.error(`[${requestId}] Erreur deleteItem:`, error);
        
        await logSecurityAction(db, 'DELETE_ITEM_ERROR', {
            collection: body.collection,
            itemId: body.itemId,
            error: error.message,
            requestId,
            timestamp: new Date()
        }).catch(logError => console.error('Erreur log sécurité:', logError));

        return errorResponse(`Erreur lors de la suppression: ${error.message}`, 500, requestId);
    }
}

async function addDriver(db, data, requestId) {
    try {
        console.log(`[${requestId}] Ajout nouveau livreur:`, data.id_livreur);

        // Validation des données
        const requiredFields = ['id_livreur', 'nom', 'prenom', 'whatsapp', 'quartier'];
        const missingFields = requiredFields.filter(field => !data[field] || !data[field].toString().trim());

        if (missingFields.length > 0) {
            return errorResponse(`Champs obligatoires manquants: ${missingFields.join(', ')}`, 400, requestId);
        }

        // Validation du format WhatsApp
        const whatsappRegex = /^(\+228|228)?[0-9]{8}$/;
        if (!whatsappRegex.test(data.whatsapp.replace(/\s/g, ''))) {
            return errorResponse('Format WhatsApp invalide (exemple: +22812345678)', 400, requestId);
        }

        const collection = db.collection('Res_livreur');

        // Vérification des doublons
        const existingDriver = await collection.findOne({
            $or: [
                { whatsapp: data.whatsapp },
                { id_livreur: data.id_livreur }
            ]
        });

        if (existingDriver) {
            const duplicateField = existingDriver.whatsapp === data.whatsapp ? 'WhatsApp' : 'ID';
            return errorResponse(`Un livreur avec ce ${duplicateField} existe déjà`, 409, requestId);
        }

        // Préparation du document
        const driverDocument = {
            id_livreur: data.id_livreur.toString().trim(),
            nom: data.nom.toString().trim(),
            prenom: data.prenom.toString().trim(),
            whatsapp: data.whatsapp.toString().trim(),
            telephone: data.telephone ? data.telephone.toString().trim() : '',
            quartier: data.quartier.toString().trim(),
            piece: data.piece ? data.piece.toString().trim() : '',
            date: data.date || '',
            contact_urgence: data.contact_urgence ? data.contact_urgence.toString().trim() : '',
            date_inscription: data.date_inscription || new Date().toISOString(),
            createdAt: new Date(),
            updatedAt: new Date(),
            status: 'actif',
            metadata: {
                createdBy: 'admin_system',
                version: '1.0',
                requestId
            }
        };

        // Traitement de la photo
        if (data.photo_data) {
            try {
                // Validation de la taille (5MB max en base64)
                const sizeInBytes = (data.photo_data.length * 3) / 4;
                if (sizeInBytes > 5 * 1024 * 1024) {
                    return errorResponse('Photo trop volumineuse (max 5MB)', 400, requestId);
                }

                driverDocument.photo = {
                    data: data.photo_data,
                    content_type: data.photo_type || 'image/webp',
                    size: data.photo_size || sizeInBytes,
                    width: data.photo_width || 250,
                    height: data.photo_height || 250,
                    uploaded_at: new Date(),
                    compressed: true
                };

                console.log(`[${requestId}] Photo ajoutée: ${Math.round(sizeInBytes / 1024)}KB`);
            } catch (error) {
                console.warn(`[${requestId}] Erreur traitement photo:`, error.message);
                return errorResponse('Erreur lors du traitement de la photo', 400, requestId);
            }
        }

        // Insertion avec retry en cas d'erreur temporaire
        let insertResult;
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
            try {
                insertResult = await collection.insertOne(driverDocument);
                break;
            } catch (error) {
                retryCount++;
                if (retryCount === maxRetries) {
                    throw error;
                }
                console.warn(`[${requestId}] Tentative ${retryCount} échouée, retry...`);
                await sleep(100 * retryCount);
            }
        }

        // Log de sécurité
        await logSecurityAction(db, 'ADD_DRIVER', {
            id_livreur: data.id_livreur,
            nom: data.nom,
            prenom: data.prenom,
            whatsapp: data.whatsapp,
            hasPhoto: !!data.photo_data,
            insertedId: insertResult.insertedId,
            requestId,
            timestamp: new Date()
        });

        // Nettoyage du cache
        clearCache('Res_livreur');
        clearCache('system_stats');

        console.log(`[${requestId}] Livreur ajouté avec succès: ${data.id_livreur}`);

        return successResponse({
            insertedId: insertResult.insertedId,
            id_livreur: data.id_livreur,
            hasPhoto: !!data.photo_data,
            driver: {
                id_livreur: data.id_livreur,
                nom: data.nom,
                prenom: data.prenom,
                status: 'actif'
            }
        }, requestId, 201);

    } catch (error) {
        console.error(`[${requestId}] Erreur addDriver:`, error);
        
        await logSecurityAction(db, 'ADD_DRIVER_ERROR', {
            id_livreur: data.id_livreur,
            error: error.message,
            requestId,
            timestamp: new Date()
        }).catch(logError => console.error('Erreur log sécurité:', logError));

        return errorResponse(`Erreur lors de l'ajout du livreur: ${error.message}`, 500, requestId);
    }
}

async function addRestaurant(db, data, requestId) {
    try {
        console.log(`[${requestId}] Ajout nouveau restaurant:`, data.nom);

        // Validation des données requises
        const requiredFields = ['nom', 'adresse', 'telephone'];
        const missingFields = requiredFields.filter(field => !data[field] || !data[field].toString().trim());

        if (missingFields.length > 0) {
            return errorResponse(`Champs obligatoires manquants: ${missingFields.join(', ')}`, 400, requestId);
        }

        // Validation du téléphone
        const phoneRegex = /^(\+228|228)?[0-9]{8}$/;
        if (!phoneRegex.test(data.telephone.replace(/\s/g, ''))) {
            return errorResponse('Format téléphone invalide (exemple: +22812345678)', 400, requestId);
        }

        // Validation de l'email si fourni
        if (data.email && data.email.trim()) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(data.email)) {
                return errorResponse('Format email invalide', 400, requestId);
            }
        }

        const collection = db.collection('Restau');

        // Vérification des doublons
        const existingRestaurant = await collection.findOne({
            $or: [
                { nom: { $regex: new RegExp(`^${data.nom.trim()}$`, 'i') } },
                { telephone: data.telephone.trim() },
                ...(data.email ? [{ email: data.email.trim() }] : [])
            ]
        });

        if (existingRestaurant) {
            let duplicateField = 'nom';
            if (existingRestaurant.telephone === data.telephone.trim()) duplicateField = 'téléphone';
            if (existingRestaurant.email === data.email?.trim()) duplicateField = 'email';
            
            return errorResponse(`Un restaurant avec ce ${duplicateField} existe déjà`, 409, requestId);
        }

        // Génération d'un ID unique pour le restaurant
        const restaurantId = `REST_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        // Préparation du document restaurant
        const restaurantDocument = {
            id_restaurant: restaurantId,
            nom: data.nom.toString().trim(),
            adresse: data.adresse.toString().trim(),
            quartier: data.quartier ? data.quartier.toString().trim() : '',
            telephone: data.telephone.toString().trim(),
            email: data.email ? data.email.toString().trim().toLowerCase() : '',
            cuisine: data.cuisine ? data.cuisine.toString().trim() : '',
            horaires: data.horaires ? data.horaires.toString().trim() : '',
            description: data.description ? data.description.toString().trim() : '',
            date_creation: new Date(),
            statut: 'actif',
            createdAt: new Date(),
            updatedAt: new Date(),
            metadata: {
                createdBy: 'admin_system',
                version: '1.0',
                requestId
            },
            rating: 0,
            reviews_count: 0,
            total_orders: 0
        };

        // Traitement des coordonnées GPS
        if (data.latitude && data.longitude) {
            const lat = parseFloat(data.latitude);
            const lng = parseFloat(data.longitude);
            
            if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                return errorResponse('Coordonnées GPS invalides', 400, requestId);
            }

            restaurantDocument.coordinates = {
                latitude: lat,
                longitude: lng,
                accuracy: data.accuracy || 'unknown'
            };

            restaurantDocument.location = {
                type: "Point",
                coordinates: [lng, lat]
            };
        
            console.log(`[${requestId}] Coordonnées GPS ajoutées: ${lat}, ${lng}`);
        }

        // Traitement du logo
        if (data.logo_data) {
            try {
                const logoSizeInBytes = (data.logo_data.length * 3) / 4;
                if (logoSizeInBytes > 5 * 1024 * 1024) {
                    return errorResponse('Logo trop volumineux (max 5MB)', 400, requestId);
                }

                restaurantDocument.logo = {
                    data: data.logo_data,
                    type: data.logo_type || 'image/webp',
                    size: data.logo_taille || logoSizeInBytes,
                    name: data.logo_nom || 'logo.webp',
                    uploaded_at: new Date()
                };

                console.log(`[${requestId}] Logo ajouté: ${Math.round(logoSizeInBytes / 1024)}KB`);
            } catch (error) {
                console.warn(`[${requestId}] Erreur traitement logo:`, error.message);
            }
        }

        // Traitement des photos
        if (data.photos && Array.isArray(data.photos) && data.photos.length > 0) {
            const processedPhotos = [];
            let totalPhotoSize = 0;

            for (const photo of data.photos.slice(0, 10)) { // Max 10 photos
                try {
                    if (photo.data) {
                        const photoSize = (photo.data.length * 3) / 4;
                        totalPhotoSize += photoSize;
                        
                        if (totalPhotoSize > 20 * 1024 * 1024) { // Max 20MB total
                            console.warn(`[${requestId}] Limite photos atteinte`);
                            break;
                        }

                        processedPhotos.push({
                            data: photo.data,
                            type: photo.type || 'image/webp',
                            size: photo.taille || photoSize,
                            name: photo.nom || `photo_${processedPhotos.length + 1}.webp`,
                            uploaded_at: new Date()
                        });
                    }
                } catch (error) {
                    console.warn(`[${requestId}] Erreur photo ${processedPhotos.length}:`, error.message);
                }
            }

            if (processedPhotos.length > 0) {
                restaurantDocument.photos = processedPhotos;
                console.log(`[${requestId}] ${processedPhotos.length} photos ajoutées (${Math.round(totalPhotoSize / 1024)}KB)`);
            }
        }

        // Traitement du menu
        if (data.menu && Array.isArray(data.menu)) {
            const processedMenu = [];
            
            for (const item of data.menu.slice(0, 100)) { // Max 100 items
                if (item.nom && item.nom.trim()) {
                    const menuItem = {
                        id: `MENU_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                        nom: item.nom.toString().trim(),
                        description: item.description ? item.description.toString().trim() : '',
                        prix: item.prix ? parseFloat(item.prix) : 0,
                        categorie: item.categorie ? item.categorie.toString().trim() : 'Général',
                        disponible: true,
                        created_at: new Date()
                    };

                    // Validation du prix
                    if (isNaN(menuItem.prix) || menuItem.prix < 0) {
                        menuItem.prix = 0;
                    }

                    processedMenu.push(menuItem);
                }
            }

            restaurantDocument.menu = processedMenu;
            console.log(`[${requestId}] Menu ajouté: ${processedMenu.length} articles`);
        } else {
            restaurantDocument.menu = [];
        }

        // Insertion avec retry
        let insertResult;
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
            try {
                insertResult = await collection.insertOne(restaurantDocument);
                break;
            } catch (error) {
                retryCount++;
                if (retryCount === maxRetries) {
                    throw error;
                }
                console.warn(`[${requestId}] Tentative ${retryCount} échouée, retry...`);
                await sleep(100 * retryCount);
            }
        }

        // Log de sécurité
        await logSecurityAction(db, 'ADD_RESTAURANT', {
            id_restaurant: restaurantId,
            nom: data.nom,
            telephone: data.telephone,
            hasLogo: !!data.logo_data,
            photosCount: restaurantDocument.photos?.length || 0,
            menuItemsCount: restaurantDocument.menu?.length || 0,
            hasGPS: !!(data.latitude && data.longitude),
            insertedId: insertResult.insertedId,
            requestId,
            timestamp: new Date()
        });

        // Nettoyage du cache
        clearCache('Restau');
        clearCache('system_stats');

        console.log(`[${requestId}] Restaurant ajouté avec succès: ${restaurantId}`);

        return successResponse({
            insertedId: insertResult.insertedId,
            id_restaurant: restaurantId,
            hasLogo: !!data.logo_data,
            hasPhotos: !!(restaurantDocument.photos && restaurantDocument.photos.length > 0),
            menuItems: restaurantDocument.menu?.length || 0,
            restaurant: {
                id_restaurant: restaurantId,
                nom: data.nom,
                adresse: data.adresse,
                telephone: data.telephone,
                cuisine: data.cuisine,
                statut: 'actif'
            }
        }, requestId, 201);

    } catch (error) {
        console.error(`[${requestId}] Erreur addRestaurant:`, error);
        
        await logSecurityAction(db, 'ADD_RESTAURANT_ERROR', {
            nom: data.nom,
            error: error.message,
            requestId,
            timestamp: new Date()
        }).catch(logError => console.error('Erreur log sécurité:', logError));

        return errorResponse(`Erreur lors de l'ajout du restaurant: ${error.message}`, 500, requestId);
    }
}

async function generateUniqueDriverId(db, requestId) {
    try {
        console.log(`[${requestId}] Génération ID livreur unique...`);
        
        const collection = db.collection('Res_livreur');
        let isUnique = false;
        let newId = '';
        let attempts = 0;
        const maxAttempts = 50;
        
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
            // Fallback avec timestamp
            const timestamp = Date.now().toString().slice(-6);
            newId = `LIV-${timestamp}`;
            
            // Vérification finale
            const finalCheck = await collection.findOne({ id_livreur: newId });
            if (finalCheck) {
                newId = `LIV-${timestamp}-${Math.random().toString(36).substr(2, 3).toUpperCase()}`;
            }
        }
        
        console.log(`[${requestId}] ID généré après ${attempts} tentatives: ${newId}`);
        
        return successResponse({
            id_livreur: newId,
            attempts,
            method: isUnique ? 'random' : 'timestamp'
        }, requestId);
        
    } catch (error) {
        console.error(`[${requestId}] Erreur generateUniqueDriverId:`, error);
        
        // Fallback en cas d'erreur complète
        const fallbackId = `LIV-ERR-${Date.now().toString().slice(-8)}`;
        console.warn(`[${requestId}] Utilisation ID de fallback: ${fallbackId}`);
        
        return successResponse({
            id_livreur: fallbackId,
            fallback: true,
            error: error.message
        }, requestId);
    }
}

// Fonctions utilitaires et de support
async function getRecentActivity(db, limit = 10) {
    try {
        const collections = ['Colis', 'Commandes', 'Livraison', 'LivraisonsEffectuees'];
        const activities = [];

        for (const collectionName of collections) {
            try {
                const recentItems = await db.collection(collectionName)
                    .find({})
                    .sort({ $natural: -1 })
                    .limit(Math.ceil(limit / collections.length))
                    .toArray();

                activities.push(...recentItems.map(item => ({
                    ...item,
                    collection: collectionName,
                    type: getActivityType(collectionName)
                })));
            } catch (error) {
                console.warn(`Erreur activité récente ${collectionName}:`, error.message);
            }
        }

        // Tri par date et limitation
        activities.sort((a, b) => {
            const dateA = new Date(a.createdAt || a.dateCreation || a.date_creation || 0);
            const dateB = new Date(b.createdAt || b.dateCreation || b.date_creation || 0);
            return dateB.getTime() - dateA.getTime();
        });

        return activities.slice(0, limit);
    } catch (error) {
        console.warn('Erreur getRecentActivity:', error.message);
        return [];
    }
}

function getActivityType(collection) {
    const types = {
        'Colis': 'Nouveau colis',
        'Commandes': 'Nouvelle commande',
        'Livraison': 'Livraison démarrée',
        'LivraisonsEffectuees': 'Livraison terminée'
    };
    return types[collection] || 'Activité';
}

async function getCollectionBasicStats(db, collectionName) {
    try {
        const collection = db.collection(collectionName);
        
        // Statistiques par statut
        const statusPipeline = [
            {
                $group: {
                    _id: { $ifNull: ["$status", "$statut"] },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ];

        const statusResults = await collection.aggregate(statusPipeline).toArray();
        const statusDistribution = statusResults.reduce((acc, item) => {
            if (item._id) acc[item._id] = item.count;
            return acc;
        }, {});

        // Activité récente (dernières 24h)
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentCount = await collection.countDocuments({
            $or: [
                { createdAt: { $gte: yesterday } },
                { dateCreation: { $gte: yesterday } },
                { date_creation: { $gte: yesterday } }
            ]
        });

        return {
            statusDistribution,
            recentActivity: recentCount,
            lastUpdated: new Date().toISOString()
        };
    } catch (error) {
        console.warn(`Erreur stats collection ${collectionName}:`, error.message);
        return {
            statusDistribution: {},
            recentActivity: 0,
            lastUpdated: new Date().toISOString()
        };
    }
}

async function logSecurityAction(db, action, details) {
    try {
        const securityLog = db.collection('_security_logs');
        
        const logEntry = {
            action,
            details,
            timestamp: new Date(),
            date: new Date().toISOString().split('T')[0],
            ip: details.ip || 'admin-system',
            userAgent: details.userAgent || 'admin-ultra-pro',
            requestId: details.requestId || generateId(),
            level: getLogLevel(action)
        };

        await securityLog.insertOne(logEntry);
        
        // Nettoyage automatique des logs anciens (garde 30 jours)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await securityLog.deleteMany({ timestamp: { $lt: thirtyDaysAgo } });
        
    } catch (error) {
        console.error('Erreur logging sécurité:', error.message);
    }
}

function getLogLevel(action) {
    const levels = {
        'DELETE': 'HIGH',
        'BULK_DELETE': 'CRITICAL',
        'ADD': 'MEDIUM',
        'UPDATE': 'MEDIUM',
        'VIEW': 'LOW',
        'EXPORT': 'MEDIUM',
        'BACKUP': 'HIGH'
    };

    for (const [key, level] of Object.entries(levels)) {
        if (action.includes(key)) {
            return level;
        }
    }
    
    return 'LOW';
}

// Fonctions de réponse standardisées
function successResponse(data, requestId, statusCode = 200) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify({
            success: true,
            data,
            requestId,
            timestamp: timestamp()
        })
    };
}

function errorResponse(message, statusCode = 400, requestId = generateId()) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify({
            success: false,
            error: message,
            requestId,
            timestamp: timestamp()
        })
    };
}

// Fonctions d'analyse et de recherche
async function globalSearch(db, params, requestId) {
    try {
        const { query, collections = [], limit = 50 } = params;

        if (!query || query.trim().length < 2) {
            return errorResponse('Requête de recherche trop courte (minimum 2 caractères)', 400, requestId);
        }

        const searchTerm = query.trim();
        const defaultCollections = Object.keys({
            'Colis': true, 'Commandes': true, 'Livraison': true, 'LivraisonsEffectuees': true, 
            'Refus': true, 'Res_livreur': true, 'compte_livreur': true, 'Restau': true, 
            'cour_expedition': true, 'pharmacyOrders': true, 'shopping_orders': true
        });

        const searchCollections = collections.length > 0 ? collections : defaultCollections;
        const results = {};
        let totalResults = 0;

        const searchPromises = searchCollections.map(async (collectionName) => {
            try {
                const collection = db.collection(collectionName);
                const regex = new RegExp(searchTerm, 'i');
                
                // Recherche dans les champs texte communs
                const searchQuery = {
                    $or: [
                        { nom: regex },
                        { name: regex },
                        { prenom: regex },
                        { sender: regex },
                        { recipient: regex },
                        { description: regex },
                        { status: regex },
                        { statut: regex },
                        { colisID: regex },
                        { id_livreur: regex },
                        { username: regex },
                        { telephone: regex },
                        { whatsapp: regex },
                        { email: regex },
                        { adresse: regex },
                        { quartier: regex }
                    ]
                };

                const [items, count] = await Promise.all([
                    collection.find(searchQuery).limit(Math.ceil(limit / searchCollections.length)).toArray(),
                    collection.countDocuments(searchQuery)
                ]);

                return {
                    collection: collectionName,
                    data: items,
                    count,
                    hasMore: count > items.length
                };
            } catch (error) {
                console.warn(`[${requestId}] Erreur recherche ${collectionName}:`, error.message);
                return {
                    collection: collectionName,
                    data: [],
                    count: 0,
                    hasMore: false
                };
            }
        });

        const searchResults = await Promise.all(searchPromises);
        
        for (const result of searchResults) {
            results[result.collection] = {
                data: result.data,
                count: result.count,
                hasMore: result.hasMore
            };
            totalResults += result.count;
        }

        console.log(`[${requestId}] Recherche globale "${searchTerm}": ${totalResults} résultats`);

        return successResponse({
            query: searchTerm,
            results,
            totalResults,
            searchedCollections: searchCollections,
            executionTime: Date.now()
        }, requestId);

    } catch (error) {
        console.error(`[${requestId}] Erreur globalSearch:`, error);
        return errorResponse(`Erreur lors de la recherche: ${error.message}`, 500, requestId);
    }
}

async function getSystemHealth(db, requestId) {
    try {
        const startTime = Date.now();
        
        // Test de connectivité MongoDB
        const pingResult = await db.admin().ping();
        const mongoLatency = Date.now() - startTime;

        // Statistiques système
        const systemStats = {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.version,
            platform: process.platform,
            cacheSize: cache.size,
            mongoLatency,
            mongoStatus: pingResult.ok === 1 ? 'healthy' : 'degraded'
        };

        // Test des collections principales
        const collections = ['Colis', 'Res_livreur', 'Restau'];
        const collectionHealth = {};

        for (const collectionName of collections) {
            try {
                const testStart = Date.now();
                const count = await db.collection(collectionName).countDocuments({}, { limit: 1 });
                const responseTime = Date.now() - testStart;
                
                collectionHealth[collectionName] = {
                    status: 'healthy',
                    responseTime,
                    accessible: true
                };
            } catch (error) {
                collectionHealth[collectionName] = {
                    status: 'error',
                    responseTime: -1,
                    accessible: false,
                    error: error.message
                };
            }
        }

        const overallHealth = Object.values(collectionHealth).every(c => c.status === 'healthy') && 
                            systemStats.mongoStatus === 'healthy' ? 'healthy' : 'degraded';

        console.log(`[${requestId}] Health check: ${overallHealth} (${Date.now() - startTime}ms)`);

        return successResponse({
            status: overallHealth,
            timestamp: new Date().toISOString(),
            system: systemStats,
            collections: collectionHealth,
            checkDuration: Date.now() - startTime
        }, requestId);

    } catch (error) {
        console.error(`[${requestId}] Erreur getSystemHealth:`, error);
        return errorResponse(`Erreur health check: ${error.message}`, 500, requestId);
    }
}

// Nettoyage périodique du cache et des connexions
setInterval(() => {
    // Nettoyage du cache expiré
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now > value.expires) {
            cache.delete(key);
        }
    }
    
    // Nettoyage du rate limiting
    for (const [ip, requests] of RATE_LIMIT.requests.entries()) {
        const validRequests = requests.filter(time => now - time < RATE_LIMIT.window);
        if (validRequests.length === 0) {
            RATE_LIMIT.requests.delete(ip);
        } else {
            RATE_LIMIT.requests.set(ip, validRequests);
        }
    }
}, 60000); // Toutes les minutes

console.log('Admin fonction initialisée - Version 2.0 Ultra Pro');