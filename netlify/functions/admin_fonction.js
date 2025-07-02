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

async function connectToMongoDB() {
    try {
        if (!mongoClient) {
            mongoClient = new MongoClient(MONGODB_URI, {
                connectTimeoutMS: 30000,
                serverSelectionTimeoutMS: 30000,
                maxPoolSize: 10,
                retryWrites: true,
                w: 'majority'
            });
            await mongoClient.connect();
            console.log('Connexion MongoDB établie');
        }
        return mongoClient.db(DB_NAME);
    } catch (error) {
        console.error('Erreur de connexion MongoDB:', error);
        throw error;
    }
}

exports.handler = async (event, context) => {
    // Configuration du contexte pour éviter les timeouts
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
        const queryParams = event.queryStringParameters || {};
        const action = queryParams.action;

        console.log('Action reçue:', action);
        console.log('Méthode HTTP:', event.httpMethod);

        const db = await connectToMongoDB();

        // Gestion des actions GET
        if (event.httpMethod === 'GET') {
            switch (action) {
                case 'getStats':
                    return await getStats(db);
                
                case 'getData':
                    const collection = queryParams.collection;
                    const limit = parseInt(queryParams.limit || '1000');
                    const offset = parseInt(queryParams.offset || '0');
                    if (!collection) {
                        return errorResponse('Collection manquante', 400);
                    }
                    return await getData(db, collection, limit, offset);
                
                case 'getPreview':
                    const previewCollection = queryParams.collection;
                    const previewLimit = parseInt(queryParams.limit || '5');
                    if (!previewCollection) {
                        return errorResponse('Collection manquante', 400);
                    }
                    return await getPreview(db, previewCollection, previewLimit);
                
                case 'getCollectionStats':
                    const statsCollection = queryParams.collection;
                    if (!statsCollection) {
                        return errorResponse('Collection manquante', 400);
                    }
                    return await getCollectionStats(db, statsCollection);
                
                default:
                    return errorResponse('Action GET non supportée', 400);
            }
        }

        // Gestion des actions POST
        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            console.log('Action POST:', body.action);
            
            switch (body.action) {
                case 'addDriver':
                    return await addDriver(db, body);
                
                case 'addRestaurant':
                    return await addRestaurant(db, body);
                
                case 'generateDriverId':
                    return await generateUniqueDriverId(db);
                
                case 'deleteItem':
                    return await deleteItem(db, body.collection, body.itemId);
                
                case 'updateItem':
                    return await updateItem(db, body.collection, body.itemId, body.updates);
                
                case 'createItem':
                    return await createItem(db, body.collection, body.data);
                
                case 'exportCollection':
                    return await exportCollection(db, body.collection, body.format || 'json');
                
                case 'getAnalytics':
                    return await getAnalytics(db, body.collection, body.timeRange || '7d');
                
                case 'searchItems':
                    return await searchItems(db, body.collection, body.query, body.filters || {});
                
                case 'backupCollection':
                    return await backupCollection(db, body.collection);
                
                case 'restoreCollection':
                    return await restoreCollection(db, body.collection, body.backupName);
                
                case 'getBackups':
                    return await getBackups(db, body.collection);
                
                case 'deleteBackup':
                    return await deleteBackup(db, body.backupName);
                
                case 'globalSearch':
                    return await globalSearch(db, body.query, body.collections || []);
                
                case 'getSystemInfo':
                    return await getSystemInfo(db);
                
                default:
                    return errorResponse('Action POST non supportée', 400);
            }
        }

        return errorResponse('Méthode HTTP non supportée', 405);

    } catch (error) {
        console.error('Erreur serveur:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: 'Erreur interne du serveur',
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    }
};

// Fonction pour obtenir les statistiques globales
async function getStats(db) {
    try {
        console.log('Chargement des statistiques...');
        
        const collections = [
            'Colis', 'Commandes', 'Livraison', 'LivraisonsEffectuees', 
            'Refus', 'Res_livreur', 'compte_livreur', 'Restau', 
            'cour_expedition', 'pharmacyOrders', 'shopping_orders'
        ];

        const stats = {};
        const collectionsData = {};
        const recentActivity = [];

        // Obtenir le nombre de documents dans chaque collection
        for (const collection of collections) {
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
                                .limit(5)
                                .toArray();
                            recentActivity.push(...recentColis.map(item => ({
                                ...item,
                                collection: 'Colis',
                                type: 'colis'
                            })));
                        } catch (err) {
                            console.warn('Erreur activité récente Colis:', err);
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
                            stats.livreurs = activeDrivers;
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
                            stats.restaurants = activeRestaurants;
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
                console.warn(`Erreur pour la collection ${collection}:`, error);
                collectionsData[collection] = 0;
            }
        }

        // Commandes du jour
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        try {
            const commandesCommandes = await db.collection('Commandes').countDocuments({
                $or: [
                    { date_creation: { $gte: today, $lt: tomorrow } },
                    { createdAt: { $gte: today, $lt: tomorrow } }
                ]
            });

            const commandesColis = await db.collection('Colis').countDocuments({
                $or: [
                    { createdAt: { $gte: today, $lt: tomorrow } },
                    { dateCreation: { $gte: today, $lt: tomorrow } }
                ]
            });

            stats.commandesJour = commandesCommandes + commandesColis;
        } catch (error) {
            console.warn('Erreur calcul commandes du jour:', error);
            stats.commandesJour = 0;
        }

        // Statistiques de performance
        try {
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            
            const weeklyDeliveries = await db.collection('LivraisonsEffectuees').countDocuments({
                $or: [
                    { dateCreation: { $gte: weekAgo } },
                    { createdAt: { $gte: weekAgo } }
                ]
            });

            const weeklyOrders = await db.collection('Commandes').countDocuments({
                $or: [
                    { date_creation: { $gte: weekAgo } },
                    { createdAt: { $gte: weekAgo } }
                ]
            });

            stats.performance = {
                weeklyDeliveries,
                weeklyOrders,
                averageDeliveryTime: '2.5h',
                successRate: '94%'
            };
        } catch (error) {
            console.warn('Erreur calcul performance:', error);
            stats.performance = {
                weeklyDeliveries: 0,
                weeklyOrders: 0,
                averageDeliveryTime: 'N/A',
                successRate: 'N/A'
            };
        }

        // Trier l'activité récente par date
        recentActivity.sort((a, b) => {
            const dateA = new Date(a.createdAt || a.dateCreation || 0);
            const dateB = new Date(b.createdAt || b.dateCreation || 0);
            return dateB.getTime() - dateA.getTime();
        });

        console.log('Statistiques chargées avec succès');

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                stats,
                collectionsData,
                recentActivity: recentActivity.slice(0, 10),
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur getStats:', error);
        return errorResponse('Erreur lors du chargement des statistiques');
    }
}

// Fonction pour obtenir les données d'une collection avec pagination
async function getData(db, collectionName, limit = 1000, offset = 0) {
    try {
        console.log(`Chargement de la collection ${collectionName}`);
        
        const collection = db.collection(collectionName);
        
        // Obtenir le nombre total de documents
        const totalCount = await collection.countDocuments();
        
        // Obtenir les documents avec pagination et tri
        const documents = await collection
            .find({})
            .sort({ $natural: -1 })
            .skip(offset)
            .limit(Math.min(limit, 1000))
            .toArray();

        // Statistiques de la collection
        const stats = await getCollectionBasicStats(db, collectionName);

        console.log(`Collection ${collectionName} chargée: ${documents.length} documents`);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                data: documents,
                count: documents.length,
                totalCount,
                offset,
                limit,
                hasMore: offset + documents.length < totalCount,
                collection: collectionName,
                stats,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur getData:', error);
        return errorResponse(`Erreur lors du chargement de la collection ${collectionName}: ${error.message}`);
    }
}

// Fonction pour obtenir un aperçu d'une collection
async function getPreview(db, collectionName, limit = 5) {
    try {
        const collection = db.collection(collectionName);
        
        const documents = await collection
            .find({})
            .sort({ $natural: -1 })
            .limit(limit)
            .toArray();

        const totalCount = await collection.countDocuments();

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                data: documents,
                collection: collectionName,
                totalCount,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur getPreview:', error);
        return errorResponse(`Erreur lors du chargement de l'aperçu de ${collectionName}: ${error.message}`);
    }
}

// Fonction pour obtenir les statistiques d'une collection
async function getCollectionStats(db, collectionName) {
    try {
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
        
        for (const [period, date] of Object.entries(periods)) {
            try {
                periodStats[period] = await collection.countDocuments({
                    $or: [
                        { createdAt: { $gte: date } },
                        { dateCreation: { $gte: date } },
                        { date_creation: { $gte: date } },
                        { orderDate: { $gte: date } }
                    ]
                });
            } catch (error) {
                periodStats[period] = 0;
            }
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                collection: collectionName,
                totalCount,
                stats,
                periodStats,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur getCollectionStats:', error);
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
        console.warn('Erreur getCollectionBasicStats:', error);
        return {};
    }
}

// Fonction pour générer un ID unique de livreur
async function generateUniqueDriverId(db) {
    try {
        console.log('Génération d\'un nouvel ID livreur...');
        
        const collection = db.collection('Res_livreur');
        let isUnique = false;
        let newId = '';
        let attempts = 0;
        const maxAttempts = 100;
        
        while (!isUnique && attempts < maxAttempts) {
            const random = Math.floor(Math.random() * 9000) + 1000;
            newId = `LIV-${random}`;
            
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
        
        console.log('ID généré:', newId);
        
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                id_livreur: newId,
                timestamp: new Date().toISOString()
            })
        };
        
    } catch (error) {
        console.error('Erreur generateUniqueDriverId:', error);
        return errorResponse('Erreur lors de la génération de l\'ID');
    }
}

// Fonction pour ajouter un livreur
async function addDriver(db, data) {
    try {
        console.log('Ajout d\'un nouveau livreur...');
        
        // Validation des données
        const requiredFields = ['id_livreur', 'nom', 'prenom', 'whatsapp', 'quartier'];
        const missingFields = requiredFields.filter(field => !data[field]);
        
        if (missingFields.length > 0) {
            return errorResponse(`Champs obligatoires manquants: ${missingFields.join(', ')}`, 400);
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
            return errorResponse('Un livreur avec ce numéro WhatsApp ou cet ID existe déjà', 409);
        }

        // Préparation du document
        const driverDocument = {
            id_livreur: data.id_livreur,
            nom: data.nom,
            prenom: data.prenom,
            whatsapp: data.whatsapp,
            telephone: data.telephone || '',
            quartier: data.quartier,
            piece: data.piece || '',
            date: data.date || '',
            contact_urgence: data.contact_urgence || '',
            date_inscription: data.date_inscription || new Date().toISOString(),
            createdAt: new Date(),
            updatedAt: new Date(),
            status: 'actif'
        };

        // Ajout des données de la photo si elles existent
        if (data.photo_data) {
            driverDocument.photo = {
                data: data.photo_data,
                content_type: data.photo_type || 'image/webp',
                size: data.photo_size || 0,
                width: data.photo_width || 0,
                height: data.photo_height || 0,
                uploaded_at: new Date()
            };
        }

        // Insertion
        const result = await collection.insertOne(driverDocument);

        // Log de sécurité
        await logSecurityAction(db, 'ADD_DRIVER', {
            id_livreur: data.id_livreur,
            nom: data.nom,
            prenom: data.prenom,
            timestamp: new Date()
        });

        console.log('Livreur ajouté avec succès:', data.id_livreur);

        return {
            statusCode: 201,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                insertedId: result.insertedId,
                message: 'Livreur ajouté avec succès',
                hasPhoto: !!data.photo_data,
                driver: {
                    id_livreur: data.id_livreur,
                    nom: data.nom,
                    prenom: data.prenom
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur addDriver:', error);
        return errorResponse(`Erreur lors de l'ajout du livreur: ${error.message}`);
    }
}

// Fonction pour ajouter un restaurant
async function addRestaurant(db, data) {
    try {
        console.log('Ajout d\'un nouveau restaurant...');
        
        // Validation des données requises
        if (!data.nom || !data.adresse || !data.telephone) {
            return errorResponse('Champs obligatoires manquants: nom, adresse et telephone sont requis', 400);
        }

        const collection = db.collection('Restau');

        // Vérification des doublons par nom et téléphone
        const existingRestaurant = await collection.findOne({
            $or: [
                { nom: data.nom },
                { telephone: data.telephone }
            ]
        });

        if (existingRestaurant) {
            return errorResponse('Un restaurant avec ce nom ou ce numéro de téléphone existe déjà', 409);
        }

        // Préparation du document restaurant
        const restaurantDocument = {
            nom: data.nom,
            adresse: data.adresse,
            quartier: data.quartier || '',
            telephone: data.telephone,
            email: data.email || '',
            cuisine: data.cuisine || '',
            horaires: data.horaires || '',
            description: data.description || '',
            date_creation: new Date(),
            statut: 'actif',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Ajouter les coordonnées GPS si fournies
        if (data.latitude && data.longitude) {
            restaurantDocument.latitude = parseFloat(data.latitude);
            restaurantDocument.longitude = parseFloat(data.longitude);
            restaurantDocument.location = {
                type: "Point",
                coordinates: [parseFloat(data.longitude), parseFloat(data.latitude)]
            };
        }

        // Ajout du logo si fourni
        if (data.logo_data) {
            restaurantDocument.logo = {
                logo_nom: data.logo_nom || 'logo.webp',
                logo_type: data.logo_type || 'image/webp',
                logo_taille: data.logo_taille || 0,
                logo_data: data.logo_data
            };
        }

        // Ajout des photos si fournies
        if (data.photos && Array.isArray(data.photos) && data.photos.length > 0) {
            restaurantDocument.photos = data.photos;
        }

        // Menu par défaut ou fourni
        restaurantDocument.menu = data.menu || [];
        restaurantDocument.rating = 0;
        restaurantDocument.reviews_count = 0;

        // Insertion
        const result = await collection.insertOne(restaurantDocument);

        // Log de sécurité
        await logSecurityAction(db, 'ADD_RESTAURANT', {
            nom: data.nom,
            adresse: data.adresse,
            telephone: data.telephone,
            timestamp: new Date()
        });

        console.log('Restaurant ajouté avec succès:', data.nom);

        return {
            statusCode: 201,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                insertedId: result.insertedId,
                message: 'Restaurant ajouté avec succès',
                hasLogo: !!data.logo_data,
                hasPhotos: !!(data.photos && data.photos.length > 0),
                menuItems: data.menu ? data.menu.length : 0,
                restaurant: {
                    nom: data.nom,
                    adresse: data.adresse,
                    telephone: data.telephone,
                    cuisine: data.cuisine
                },
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur addRestaurant:', error);
        return errorResponse(`Erreur lors de l'ajout du restaurant: ${error.message}`);
    }
}

// Fonction pour supprimer un élément
async function deleteItem(db, collectionName, itemId) {
    try {
        console.log(`Suppression de l'élément ${itemId} dans ${collectionName}`);
        
        if (!itemId) {
            return errorResponse('ID de l\'élément manquant', 400);
        }

        if (!collectionName) {
            return errorResponse('Nom de collection manquant', 400);
        }

        const collection = db.collection(collectionName);
        
        // Vérifier que l'élément existe
        const existingItem = await collection.findOne({ _id: new ObjectId(itemId) });
        if (!existingItem) {
            return errorResponse('Élément non trouvé', 404);
        }
        
        const result = await collection.deleteOne({
            _id: new ObjectId(itemId)
        });

        if (result.deletedCount === 1) {
            // Log de sécurité
            await logSecurityAction(db, 'DELETE_ITEM', {
                collection: collectionName,
                itemId: itemId,
                deletedItem: existingItem,
                timestamp: new Date()
            });

            console.log('Élément supprimé avec succès');

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    message: 'Élément supprimé avec succès',
                    deletedCount: 1,
                    itemId,
                    collection: collectionName,
                    timestamp: new Date().toISOString()
                })
            };
        } else {
            return errorResponse('Échec de la suppression', 500);
        }

    } catch (error) {
        console.error('Erreur deleteItem:', error);
        return errorResponse(`Erreur lors de la suppression: ${error.message}`);
    }
}

// Fonction pour mettre à jour un élément
async function updateItem(db, collectionName, itemId, updates) {
    try {
        if (!itemId) {
            return errorResponse('ID de l\'élément manquant', 400);
        }

        if (!updates || typeof updates !== 'object') {
            return errorResponse('Données de mise à jour manquantes', 400);
        }

        const collection = db.collection(collectionName);
        
        // Ajouter la date de modification
        updates.updatedAt = new Date();
        
        // Vérifier que l'élément existe
        const existingItem = await collection.findOne({ _id: new ObjectId(itemId) });
        if (!existingItem) {
            return errorResponse('Élément non trouvé', 404);
        }
        
        const result = await collection.updateOne(
            { _id: new ObjectId(itemId) },
            { $set: updates }
        );

        if (result.matchedCount === 1) {
            // Récupérer l'élément mis à jour
            const updatedItem = await collection.findOne({ _id: new ObjectId(itemId) });
            
            // Log de sécurité
            await logSecurityAction(db, 'UPDATE_ITEM', {
                collection: collectionName,
                itemId: itemId,
                updates: updates,
                timestamp: new Date()
            });
            
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    message: 'Élément mis à jour avec succès',
                    modifiedCount: result.modifiedCount,
                    itemId,
                    updatedItem,
                    collection: collectionName,
                    timestamp: new Date().toISOString()
                })
            };
        } else {
            return errorResponse('Échec de la mise à jour', 500);
        }

    } catch (error) {
        console.error('Erreur updateItem:', error);
        return errorResponse(`Erreur lors de la mise à jour: ${error.message}`);
    }
}

// Fonction pour créer un élément
async function createItem(db, collectionName, data) {
    try {
        if (!data || typeof data !== 'object') {
            return errorResponse('Données manquantes', 400);
        }

        const collection = db.collection(collectionName);
        
        // Ajouter les dates de création et modification
        data.createdAt = new Date();
        data.updatedAt = new Date();
        
        const result = await collection.insertOne(data);

        // Log de sécurité
        await logSecurityAction(db, 'CREATE_ITEM', {
            collection: collectionName,
            itemId: result.insertedId,
            data: data,
            timestamp: new Date()
        });

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
        console.error('Erreur createItem:', error);
        return errorResponse(`Erreur lors de la création: ${error.message}`);
    }
}

// Fonction pour exporter une collection
async function exportCollection(db, collectionName, format = 'json') {
    try {
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
                    data: documents
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
            timestamp: new Date()
        });

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
        console.error('Erreur exportCollection:', error);
        return errorResponse(`Erreur lors de l'export: ${error.message}`);
    }
}

// Fonction pour les analyses temporelles
async function getAnalytics(db, collectionName, timeRange) {
    try {
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

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                analytics: analyticsData,
                statusDistribution: statusData,
                timeRange,
                startDate: startDate.toISOString(),
                endDate: now.toISOString(),
                collection: collectionName,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur getAnalytics:', error);
        return errorResponse(`Erreur lors de l'analyse: ${error.message}`);
    }
}

// Fonction de recherche avancée
async function searchItems(db, collectionName, query, filters = {}) {
    try {
        const collection = db.collection(collectionName);
        
        // Construction de la requête de recherche
        const searchQuery = {};

        // Recherche textuelle si une requête est fournie
        if (query && query.trim()) {
            const searchTerms = query.trim().split(/\s+/);
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

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                data: results,
                count: results.length,
                query,
                filters,
                collection: collectionName,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur searchItems:', error);
        return errorResponse(`Erreur lors de la recherche: ${error.message}`);
    }
}

// Fonction de sauvegarde
async function backupCollection(db, collectionName) {
    try {
        console.log(`Création de sauvegarde pour ${collectionName}`);
        
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
                    backupName
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
            status: 'completed'
        });

        // Log de sécurité
        await logSecurityAction(db, 'BACKUP_COLLECTION', {
            collection: collectionName,
            backupName: backupName,
            documentsCount: documents.length,
            timestamp: new Date()
        });

        console.log(`Sauvegarde créée: ${backupName}`);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: `Sauvegarde créée pour ${collectionName}`,
                backupName,
                documentsCount: documents.length,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur backupCollection:', error);
        return errorResponse(`Erreur lors de la sauvegarde: ${error.message}`);
    }
}

// Fonction de restauration
async function restoreCollection(db, collectionName, backupName) {
    try {
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
                restoredFrom: backupName
            };
        });
        
        // Vider la collection cible et insérer les données restaurées
        await targetCollection.deleteMany({});
        if (cleanDocuments.length > 0) {
            await targetCollection.insertMany(cleanDocuments);
        }

        // Log de sécurité
        await logSecurityAction(db, 'RESTORE_COLLECTION', {
            collection: collectionName,
            backupName: backupName,
            restoredCount: cleanDocuments.length,
            timestamp: new Date()
        });

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: `Collection ${collectionName} restaurée depuis ${backupName}`,
                restoredCount: cleanDocuments.length,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur restoreCollection:', error);
        return errorResponse(`Erreur lors de la restauration: ${error.message}`);
    }
}

// Fonction pour lister les sauvegardes
async function getBackups(db, collectionName) {
    try {
        const metadataCollection = db.collection('_backup_metadata');
        
        const query = collectionName ? { originalCollection: collectionName } : {};
        const backups = await metadataCollection
            .find(query)
            .sort({ backupDate: -1 })
            .toArray();

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                backups,
                count: backups.length,
                collection: collectionName,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur getBackups:', error);
        return errorResponse(`Erreur lors de la récupération des sauvegardes: ${error.message}`);
    }
}

// Fonction pour supprimer une sauvegarde
async function deleteBackup(db, backupName) {
    try {
        // Supprimer la collection de sauvegarde
        await db.collection(backupName).drop();
        
        // Supprimer les métadonnées
        const metadataCollection = db.collection('_backup_metadata');
        await metadataCollection.deleteOne({ backupName });

        // Log de sécurité
        await logSecurityAction(db, 'DELETE_BACKUP', {
            backupName: backupName,
            timestamp: new Date()
        });

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: `Sauvegarde ${backupName} supprimée`,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur deleteBackup:', error);
        return errorResponse(`Erreur lors de la suppression de la sauvegarde: ${error.message}`);
    }
}

// Fonction de recherche globale
async function globalSearch(db, query, collections = []) {
    try {
        if (!query || query.trim().length < 2) {
            return errorResponse('Requête de recherche trop courte (minimum 2 caractères)', 400);
        }

        const defaultCollections = [
            'Colis', 'Commandes', 'Livraison', 'LivraisonsEffectuees', 
            'Refus', 'Res_livreur', 'compte_livreur', 'Restau', 
            'cour_expedition', 'pharmacyOrders', 'shopping_orders'
        ];

        const searchCollections = collections.length > 0 ? collections : defaultCollections;
        const results = {};
        let totalResults = 0;

        for (const collectionName of searchCollections) {
            try {
                const searchResponse = await searchItems(db, collectionName, query, {});
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
                console.warn(`Erreur recherche dans ${collectionName}:`, error);
                results[collectionName] = { data: [], count: 0, hasMore: false };
            }
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                query,
                results,
                totalResults,
                searchedCollections: searchCollections,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur globalSearch:', error);
        return errorResponse(`Erreur lors de la recherche globale: ${error.message}`);
    }
}

// Fonction pour obtenir les informations système
async function getSystemInfo(db) {
    try {
        // Liste des collections
        const collections = await db.listCollections().toArray();
        
        const systemInfo = {
            database: DB_NAME,
            collections: collections.length,
            timestamp: new Date().toISOString()
        };

        const collectionsInfo = collections.map(col => ({
            name: col.name,
            type: col.type,
            options: col.options
        }));

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                systemInfo,
                collectionsInfo,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur getSystemInfo:', error);
        return errorResponse(`Erreur lors de la récupération des informations système: ${error.message}`);
    }
}

// Fonction de logging de sécurité
async function logSecurityAction(db, action, details) {
    try {
        const securityLog = db.collection('_security_logs');
        await securityLog.insertOne({
            action,
            details,
            timestamp: new Date(),
            ip: 'admin-system',
            userAgent: 'admin-ultra-pro',
        });
    } catch (error) {
        console.warn('Erreur lors du logging de sécurité:', error);
    }
}

// Fonction utilitaire pour convertir en CSV
function convertToCSV(data) {
    if (!data.length) return '';
    
    // Obtenir tous les champs possibles
    const allFields = new Set();
    data.forEach(item => {
        Object.keys(item).forEach(key => allFields.add(key));
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

// Fonction utilitaire pour les réponses d'erreur
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