const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

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

// Cache pour optimiser les performances
const cache = new Map();
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

// Configuration des collections avec nettoyage automatique
const COLLECTIONS_CONFIG = {
    'Colis': {
        name: 'Colis',
        deleteAfterDays: 2,
        deleteCondition: { status: { $in: ['pending', 'created'] } },
        cleanupField: 'createdAt',
        searchFields: ['colisID', 'trackingCode', 'sender', 'recipient', 'address', 'description']
    },
    'Livraison': {
        name: 'Livraison',
        deleteAfterDays: 2,
        deleteCondition: { statut: { $in: ['pending', 'en_attente'] } },
        cleanupField: 'dateCreation',
        searchFields: ['livraisonID', 'colisID', 'expediteur.nom', 'destinataire.nom', 'destinataire.adresse']
    },
    'cour_expedition': {
        name: 'cour_expedition',
        deleteAfterDays: null,
        cleanupField: 'assignedAt',
        searchFields: ['colisID', 'livraisonID', 'driverName', 'driverId']
    },
    'LivraisonsEffectuees': {
        name: 'LivraisonsEffectuees',
        deleteAfterDays: 3,
        deleteCondition: {},
        cleanupField: 'deliveredAt',
        searchFields: ['colisID', 'livraisonID', 'driverName', 'deliveryNotes']
    },
    'Refus': {
        name: 'Refus',
        deleteAfterDays: 1,
        deleteCondition: {},
        cleanupField: 'dateRefus',
        searchFields: ['colisID', 'raison']
    },
    'Commandes': {
        name: 'Commandes',
        deleteAfterDays: null,
        cleanupField: 'orderDate',
        searchFields: ['codeCommande', 'restaurant.name', 'client.name', 'client.phone']
    },
    'pharmacyOrders': {
        name: 'pharmacyOrders',
        deleteAfterDays: null,
        cleanupField: 'orderDate',
        searchFields: ['phoneNumber', 'secondaryPhone', 'medicaments.name']
    },
    'shopping_orders': {
        name: 'shopping_orders',
        deleteAfterDays: null,
        cleanupField: 'orderDate',
        searchFields: ['phone1', 'phone2', 'shoppingList.nom']
    },
    'demande_livreur': {
        name: 'demande_livreur',
        deleteAfterDays: null,
        cleanupField: 'dateCreation',
        searchFields: ['nom', 'prenom', 'whatsapp', 'telephone', 'quartier', 'vehicule', 'immatriculation']
    },
    'demande_restau': {
        name: 'demande_restau',
        deleteAfterDays: null,
        cleanupField: 'dateCreation',
        searchFields: ['nom', 'nomCommercial', 'telephone', 'email', 'adresse', 'quartier', 'cuisine']
    },
    'Res_livreur': {
        name: 'Res_livreur',
        deleteAfterDays: null,
        cleanupField: 'createdAt',
        searchFields: ['id_livreur', 'nom', 'prenom', 'whatsapp', 'telephone', 'quartier']
    },
    'Restau': {
        name: 'Restau',
        deleteAfterDays: null,
        cleanupField: 'dateCreation',
        searchFields: ['restaurantId', 'nom', 'nomCommercial', 'telephone', 'email', 'adresse', 'quartier', 'cuisine']
    },
    'compte_livreur': {
        name: 'compte_livreur',
        deleteAfterDays: null,
        cleanupField: 'created_at',
        searchFields: ['id_livreur', 'username', 'nom', 'prenom', 'email']
    }
};

async function connectToMongoDB() {
    try {
        if (!mongoClient) {
            mongoClient = new MongoClient(MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                connectTimeoutMS: 30000,
                serverSelectionTimeoutMS: 30000,
                maxPoolSize: 50,
                retryWrites: true,
                w: 'majority'
            });
            await mongoClient.connect();
            console.log('✅ Connexion MongoDB Admin établie');
        }
        return mongoClient.db(DB_NAME);
    } catch (error) {
        console.error('❌ Erreur de connexion MongoDB Admin:', error);
        throw error;
    }
}

exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

    // Gestion des requêtes OPTIONS (preflight CORS)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    // Vérification de la méthode HTTP
    if (event.httpMethod !== 'POST') {
        return createResponse(405, { 
            success: false, 
            message: 'Méthode non autorisée' 
        });
    }

    try {
        // Parse du body de la requête
        const body = JSON.parse(event.body || '{}');
        const { action } = body;

        console.log(`🚀 Action admin reçue: ${action}`);

        // Connexion à MongoDB
        const db = await connectToMongoDB();

        // Router vers la fonction appropriée
        switch (action) {
            // Statistiques générales
            case 'getStats':
                return await getStats(db);
            
            // Gestion des collections
            case 'getCollectionData':
                return await getCollectionData(db, body);
            
            case 'getItemDetails':
                return await getItemDetails(db, body);
            
            case 'updateCollectionItem':
                return await updateCollectionItem(db, body);
            
            case 'deleteCollectionItem':
                return await deleteCollectionItem(db, body);
            
            case 'bulkDeleteItems':
                return await bulkDeleteItems(db, body);
            
            // Gestion des demandes de livreurs
            case 'getDemandesLivreurs':
                return await getDemandesLivreurs(db, body);
            
            case 'getDemandesRestaurants':
                return await getDemandesRestaurants(db, body);
            
            case 'approuverDemande':
                return await approuverDemande(db, body);
            
            case 'rejeterDemande':
                return await rejeterDemande(db, body);
            
            case 'envoyerNotification':
                return await envoyerNotification(db, body);
            
            // Nettoyage automatique
            case 'runCleanup':
                return await runCleanup(db, body);
            
            case 'getCleanupStatus':
                return await getCleanupStatus(db);
            
            // Analyses
            case 'getAnalytics':
                return await getAnalytics(db, body);
            
            // Export
            case 'exportData':
                return await exportData(db, body);
            
            // Recherche globale
            case 'globalSearch':
                return await globalSearch(db, body);
            
            default:
                return createResponse(400, { 
                    success: false, 
                    message: `Action non supportée: ${action}` 
                });
        }

    } catch (error) {
        console.error('💥 Erreur serveur admin:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur interne du serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ===== STATISTIQUES GÉNÉRALES =====

async function getStats(db) {
    try {
        console.log('📊 Chargement des statistiques générales');
        
        const cacheKey = 'admin_stats_global';
        const cached = getCachedData(cacheKey);
        
        if (cached) {
            console.log('📋 Statistiques récupérées du cache');
            return createResponse(200, { success: true, ...cached });
        }

        // Obtenir les statistiques de toutes les collections
        const collectionPromises = Object.keys(COLLECTIONS_CONFIG).map(async (collectionName) => {
            try {
                const count = await db.collection(collectionName).countDocuments();
                return { [collectionName]: count };
            } catch (error) {
                console.warn(`⚠️ Erreur collection ${collectionName}:`, error.message);
                return { [collectionName]: 0 };
            }
        });

        const collectionCounts = await Promise.all(collectionPromises);
        const collections = collectionCounts.reduce((acc, curr) => ({ ...acc, ...curr }), {});

        // Statistiques des demandes par statut
        const [statsDemandesLivreurs, statsDemandesRestaurants] = await Promise.all([
            getDemandesStats(db, 'demande_livreur'),
            getDemandesStats(db, 'demande_restau')
        ]);

        // Statistiques temporelles (dernières 24h)
        const derniere24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const activite24h = await getActivity24h(db, derniere24h);

        const result = {
            collections: {
                colis: collections.Colis || 0,
                livraison: collections.Livraison || 0,
                expedition: collections.cour_expedition || 0,
                livrees: collections.LivraisonsEffectuees || 0,
                refus: collections.Refus || 0,
                commandes: collections.Commandes || 0,
                pharmacy: collections.pharmacyOrders || 0,
                shopping: collections.shopping_orders || 0,
                livreurs: collections.Res_livreur || 0,
                restaurants: collections.Restau || 0,
                compteLivreur: collections.compte_livreur || 0
            },
            demandes: {
                livreurs: {
                    total: collections.demande_livreur || 0,
                    parStatut: statsDemandesLivreurs
                },
                restaurants: {
                    total: collections.demande_restau || 0,
                    parStatut: statsDemandesRestaurants
                }
            },
            activite24h,
            timestamp: new Date().toISOString()
        };

        // Mettre en cache
        setCachedData(cacheKey, result);
        
        console.log('✅ Statistiques générales chargées');
        return createResponse(200, { success: true, ...result });

    } catch (error) {
        console.error('❌ Erreur getStats:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors du chargement des statistiques'
        });
    }
}

async function getDemandesStats(db, collectionName) {
    try {
        const stats = await db.collection(collectionName).aggregate([
            { $group: { _id: '$statut', count: { $sum: 1 } } }
        ]).toArray();

        return stats.reduce((acc, item) => {
            acc[item._id || 'sans_statut'] = item.count;
            return acc;
        }, {});
    } catch (error) {
        console.warn(`⚠️ Erreur stats demandes ${collectionName}:`, error.message);
        return {};
    }
}

async function getActivity24h(db, startDate) {
    try {
        const [
            nouveauxColis,
            nouvellesLivraisons,
            nouvellesCommandes,
            nouvellesDemandesLivreurs,
            nouvellesDemandesRestaurants
        ] = await Promise.all([
            safeCount(db, 'Colis', { createdAt: { $gte: startDate } }),
            safeCount(db, 'Livraison', { dateCreation: { $gte: startDate } }),
            safeCount(db, 'Commandes', { orderDate: { $gte: startDate } }),
            safeCount(db, 'demande_livreur', { dateCreation: { $gte: startDate } }),
            safeCount(db, 'demande_restau', { dateCreation: { $gte: startDate } })
        ]);

        return {
            nouveauxColis,
            nouvellesLivraisons,
            nouvellesCommandes,
            nouvellesDemandesLivreurs,
            nouvellesDemandesRestaurants
        };
    } catch (error) {
        console.warn('⚠️ Erreur activité 24h:', error.message);
        return {};
    }
}

async function safeCount(db, collectionName, query = {}) {
    try {
        return await db.collection(collectionName).countDocuments(query);
    } catch (error) {
        console.warn(`⚠️ Erreur count ${collectionName}:`, error.message);
        return 0;
    }
}

// ===== GESTION DES COLLECTIONS =====

async function getCollectionData(db, data) {
    try {
        const { 
            collection, 
            page = 1, 
            limit = 20, 
            search = '', 
            status = '',
            period = '',
            sortBy = null,
            sortOrder = 'desc' 
        } = data;

        console.log(`📋 Récupération collection: ${collection}`);

        if (!collection || !COLLECTIONS_CONFIG[collection]) {
            return createResponse(400, {
                success: false,
                message: 'Collection non supportée'
            });
        }

        const config = COLLECTIONS_CONFIG[collection];
        const offset = (page - 1) * limit;

        // Construction de la requête
        let query = {};
        
        // Recherche textuelle
        if (search && search.trim()) {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = config.searchFields.map(field => ({ [field]: searchRegex }));
        }

        // Filtre par statut
        if (status) {
            const statusField = getStatusField(collection);
            if (statusField) {
                query[statusField] = status;
            }
        }

        // Filtre par période
        if (period) {
            const dateField = config.cleanupField;
            if (dateField) {
                const dateFilter = getPeriodFilter(period);
                if (dateFilter) {
                    query[dateField] = dateFilter;
                }
            }
        }

        // Déterminer le tri par défaut
        let defaultSortField = config.cleanupField || '_id';
        const actualSortBy = sortBy || defaultSortField;
        
        // Tri
        const sortQuery = {};
        sortQuery[actualSortBy] = sortOrder === 'asc' ? 1 : -1;

        // Exécution des requêtes
        const [documents, totalCount] = await Promise.all([
            db.collection(collection)
                .find(query)
                .sort(sortQuery)
                .skip(offset)
                .limit(Math.min(limit, 100))
                .toArray(),
            db.collection(collection).countDocuments(query)
        ]);

        console.log(`✅ ${documents.length} documents récupérés de ${collection}`);

        return createResponse(200, {
            success: true,
            data: documents,
            totalCount,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalCount / limit),
                hasMore: offset + documents.length < totalCount,
                itemsPerPage: limit
            },
            collection,
            filters: { search, status, period, sortBy: actualSortBy, sortOrder }
        });

    } catch (error) {
        console.error('❌ Erreur getCollectionData:', error);
        return createResponse(500, {
            success: false,
            message: `Erreur lors du chargement de la collection ${data.collection}`
        });
    }
}

async function getItemDetails(db, data) {
    try {
        const { collection, itemId } = data;

        console.log(`🔍 Récupération détails: ${collection}/${itemId}`);

        if (!collection || !itemId) {
            return createResponse(400, {
                success: false,
                message: 'Collection et ID requis'
            });
        }

        if (!COLLECTIONS_CONFIG[collection]) {
            return createResponse(400, {
                success: false,
                message: 'Collection non supportée'
            });
        }

        // Rechercher l'élément
        const item = await db.collection(collection).findOne({
            _id: new ObjectId(itemId)
        });

        if (!item) {
            return createResponse(404, {
                success: false,
                message: 'Élément non trouvé'
            });
        }

        console.log(`✅ Détails récupérés pour ${collection}/${itemId}`);

        return createResponse(200, {
            success: true,
            data: item,
            collection,
            itemId
        });

    } catch (error) {
        console.error('❌ Erreur getItemDetails:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la récupération des détails'
        });
    }
}

function getStatusField(collection) {
    const statusFieldMap = {
        'Colis': 'status',
        'Livraison': 'statut',
        'cour_expedition': 'status',
        'LivraisonsEffectuees': 'status',
        'Commandes': 'status',
        'pharmacyOrders': 'status',
        'shopping_orders': 'status',
        'Res_livreur': 'statut',
        'Restau': 'statut',
        'compte_livreur': 'statut',
        'demande_livreur': 'statut',
        'demande_restau': 'statut',
        'Refus': null
    };

    return statusFieldMap[collection];
}

function getPeriodFilter(period) {
    const now = new Date();
    
    switch (period) {
        case 'today':
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return { $gte: startOfDay };
        case 'week':
            const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            return { $gte: startOfWeek };
        case 'month':
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            return { $gte: startOfMonth };
        case 'year':
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            return { $gte: startOfYear };
        default:
            return null;
    }
}

async function updateCollectionItem(db, data) {
    try {
        const { collection, itemId, updates } = data;

        console.log(`✏️ Mise à jour ${collection}: ${itemId}`);

        if (!collection || !itemId || !updates) {
            return createResponse(400, {
                success: false,
                message: 'Collection, ID et données de mise à jour requis'
            });
        }

        if (!COLLECTIONS_CONFIG[collection]) {
            return createResponse(400, {
                success: false,
                message: 'Collection non supportée'
            });
        }

        // Ajouter la date de modification
        updates.updatedAt = new Date();

        const result = await db.collection(collection).updateOne(
            { _id: new ObjectId(itemId) },
            { $set: updates }
        );

        if (result.matchedCount === 1) {
            clearCache();
            
            console.log(`✅ Élément ${itemId} mis à jour dans ${collection}`);
            return createResponse(200, {
                success: true,
                message: 'Élément mis à jour avec succès',
                modifiedCount: result.modifiedCount
            });
        } else {
            return createResponse(404, {
                success: false,
                message: 'Élément non trouvé'
            });
        }

    } catch (error) {
        console.error('❌ Erreur updateCollectionItem:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la mise à jour'
        });
    }
}

async function deleteCollectionItem(db, data) {
    try {
        const { collection, itemId } = data;

        console.log(`🗑️ Suppression ${collection}: ${itemId}`);

        if (!collection || !itemId) {
            return createResponse(400, {
                success: false,
                message: 'Collection et ID requis'
            });
        }

        if (!COLLECTIONS_CONFIG[collection]) {
            return createResponse(400, {
                success: false,
                message: 'Collection non supportée'
            });
        }

        // Vérifier que l'élément existe avant de le supprimer
        const existingItem = await db.collection(collection).findOne({
            _id: new ObjectId(itemId)
        });

        if (!existingItem) {
            return createResponse(404, {
                success: false,
                message: 'Élément non trouvé'
            });
        }

        // Pour les livraisons effectuées, supprimer aussi des autres collections
        if (collection === 'LivraisonsEffectuees' && existingItem.colisID) {
            await cleanupRelatedCollections(db, existingItem.colisID);
        }

        // Effectuer la suppression
        const result = await db.collection(collection).deleteOne({
            _id: new ObjectId(itemId)
        });

        if (result.deletedCount === 1) {
            clearCache();
            
            console.log(`✅ Élément ${itemId} supprimé de ${collection}`);
            return createResponse(200, {
                success: true,
                message: 'Élément supprimé avec succès',
                deletedCount: result.deletedCount
            });
        } else {
            return createResponse(500, {
                success: false,
                message: 'Erreur lors de la suppression'
            });
        }

    } catch (error) {
        console.error('❌ Erreur deleteCollectionItem:', error);
        
        // Gestion spécifique des erreurs ObjectId
        if (error.message && error.message.includes('ObjectId')) {
            return createResponse(400, {
                success: false,
                message: 'ID d\'élément invalide'
            });
        }
        
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la suppression'
        });
    }
}

async function bulkDeleteItems(db, data) {
    try {
        const { collection, itemIds } = data;

        console.log(`🗑️ Suppression en lot ${collection}: ${itemIds.length} éléments`);

        if (!collection || !itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
            return createResponse(400, {
                success: false,
                message: 'Collection et liste d\'IDs requis'
            });
        }

        if (!COLLECTIONS_CONFIG[collection]) {
            return createResponse(400, {
                success: false,
                message: 'Collection non supportée'
            });
        }

        // Convertir les IDs en ObjectId
        const objectIds = itemIds.map(id => {
            try {
                return new ObjectId(id);
            } catch (error) {
                console.warn(`⚠️ ID invalide ignoré: ${id}`);
                return null;
            }
        }).filter(id => id !== null);

        if (objectIds.length === 0) {
            return createResponse(400, {
                success: false,
                message: 'Aucun ID valide fourni'
            });
        }

        const result = await db.collection(collection).deleteMany({
            _id: { $in: objectIds }
        });

        clearCache();
        
        console.log(`✅ ${result.deletedCount} éléments supprimés de ${collection}`);
        return createResponse(200, {
            success: true,
            message: `${result.deletedCount} éléments supprimés avec succès`,
            deletedCount: result.deletedCount,
            requestedCount: itemIds.length
        });

    } catch (error) {
        console.error('❌ Erreur bulkDeleteItems:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la suppression en lot'
        });
    }
}

async function cleanupRelatedCollections(db, colisID) {
    try {
        // Supprimer de toutes les collections liées
        const collections = ['Colis', 'Livraison', 'cour_expedition'];
        
        for (const collection of collections) {
            const result = await db.collection(collection).deleteMany({ colisID: colisID });
            console.log(`🧹 ${collection}: ${result.deletedCount} éléments liés supprimés pour ${colisID}`);
        }

        console.log(`🧹 Nettoyage des collections liées terminé pour le colis: ${colisID}`);
    } catch (error) {
        console.warn(`⚠️ Erreur nettoyage collections liées:`, error);
    }
}

// ===== GESTION DES DEMANDES =====

async function getDemandesLivreurs(db, data) {
    try {
        console.log('📋 Récupération des demandes de livreurs');

        const { 
            statut = 'en_attente', 
            limit = 50, 
            offset = 0, 
            search = '',
            periode = '',
            sortBy = 'dateCreation',
            sortOrder = 'desc' 
        } = data;

        // Construction de la requête
        let query = {};
        
        if (statut && statut !== 'tous' && statut !== '') {
            query.statut = statut;
        }

        if (search && search.trim()) {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = [
                { nom: searchRegex },
                { prenom: searchRegex },
                { whatsapp: searchRegex },
                { telephone: searchRegex },
                { quartier: searchRegex },
                { vehicule: searchRegex },
                { immatriculation: searchRegex }
            ];
        }

        if (periode) {
            const dateFilter = getPeriodFilter(periode);
            if (dateFilter) {
                query.dateCreation = dateFilter;
            }
        }

        // Tri
        const sortQuery = {};
        sortQuery[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Exécution des requêtes
        const [demandes, totalCount, stats] = await Promise.all([
            db.collection('demande_livreur')
                .find(query)
                .sort(sortQuery)
                .skip(offset)
                .limit(Math.min(limit, 100))
                .toArray(),
            db.collection('demande_livreur').countDocuments(query),
            getDemandesStats(db, 'demande_livreur')
        ]);

        // Enrichir les demandes avec des informations supplémentaires
        const enrichedDemandes = demandes.map(demande => ({
            ...demande,
            hasDocuments: !!(demande.documents?.photoIdentite && demande.documents?.documentVehicule),
            hasSignature: !!demande.signature,
            dateCreationFormatted: new Date(demande.dateCreation).toLocaleDateString('fr-FR', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            tempsEcoule: getTempsEcoule(demande.dateCreation)
        }));

        console.log(`✅ ${demandes.length} demandes de livreurs récupérées`);

        return createResponse(200, {
            success: true,
            data: enrichedDemandes,
            totalCount,
            stats,
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalCount / limit),
                hasMore: offset + demandes.length < totalCount,
                itemsPerPage: limit
            },
            filters: {
                statut,
                search,
                periode,
                sortBy,
                sortOrder
            }
        });

    } catch (error) {
        console.error('❌ Erreur getDemandesLivreurs:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la récupération des demandes de livreurs'
        });
    }
}

async function getDemandesRestaurants(db, data) {
    try {
        console.log('📋 Récupération des demandes de restaurants');

        const { 
            statut = 'en_attente', 
            limit = 50, 
            offset = 0, 
            search = '',
            cuisine = '',
            sortBy = 'dateCreation',
            sortOrder = 'desc' 
        } = data;

        // Construction de la requête
        let query = {};
        
        if (statut && statut !== 'tous' && statut !== '') {
            query.statut = statut;
        }

        if (search && search.trim()) {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = [
                { nom: searchRegex },
                { nomCommercial: searchRegex },
                { telephone: searchRegex },
                { email: searchRegex },
                { adresse: searchRegex },
                { quartier: searchRegex },
                { responsableNom: searchRegex }
            ];
        }

        if (cuisine) {
            query.cuisine = cuisine;
        }

        // Tri
        const sortQuery = {};
        sortQuery[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Exécution des requêtes
        const [demandes, totalCount, stats] = await Promise.all([
            db.collection('demande_restau')
                .find(query)
                .sort(sortQuery)
                .skip(offset)
                .limit(Math.min(limit, 100))
                .toArray(),
            db.collection('demande_restau').countDocuments(query),
            getDemandesStats(db, 'demande_restau')
        ]);

        // Enrichir les demandes
        const enrichedDemandes = demandes.map(demande => ({
            ...demande,
            hasLogo: !!demande.logo,
            hasPhotos: !!(demande.photos && demande.photos.length > 0),
            hasSignature: !!demande.signature,
            hasGPS: !!(demande.location && demande.location.latitude && demande.location.longitude),
            menuItemsCount: demande.menu ? demande.menu.length : 0,
            dateCreationFormatted: new Date(demande.dateCreation).toLocaleDateString('fr-FR', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            tempsEcoule: getTempsEcoule(demande.dateCreation)
        }));

        console.log(`✅ ${demandes.length} demandes de restaurants récupérées`);

        return createResponse(200, {
            success: true,
            data: enrichedDemandes,
            totalCount,
            stats,
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalCount / limit),
                hasMore: offset + demandes.length < totalCount,
                itemsPerPage: limit
            },
            filters: {
                statut,
                search,
                cuisine,
                sortBy,
                sortOrder
            }
        });

    } catch (error) {
        console.error('❌ Erreur getDemandesRestaurants:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la récupération des demandes de restaurants'
        });
    }
}

async function approuverDemande(db, data) {
    try {
        const { demandeId, type, comment = '' } = data;

        console.log(`✅ Approbation demande: ${demandeId} (${type})`);

        if (!demandeId || !type) {
            return createResponse(400, {
                success: false,
                message: 'ID de demande et type requis'
            });
        }

        const collectionName = type === 'livreur' ? 'demande_livreur' : 'demande_restau';
        
        // Vérifier que la demande existe et est en attente
        const demande = await db.collection(collectionName).findOne({
            _id: new ObjectId(demandeId),
            statut: 'en_attente'
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Demande non trouvée ou déjà traitée'
            });
        }

        // Générer un code d'autorisation unique
        const codeAutorisation = await genererCodeAutorisation(db, type);

        // Mettre à jour la demande
        const updateResult = await db.collection(collectionName).updateOne(
            { _id: new ObjectId(demandeId) },
            {
                $set: {
                    statut: 'approuvee',
                    dateTraitement: new Date(),
                    traiteePar: 'admin',
                    codeAutorisation: codeAutorisation,
                    commentaireApprobation: comment,
                    updatedAt: new Date()
                }
            }
        );

        if (updateResult.matchedCount === 0) {
            return createResponse(404, {
                success: false,
                message: 'Erreur lors de la mise à jour'
            });
        }

        // Nettoyer le cache
        clearCache();

        console.log(`✅ Demande ${demandeId} approuvée avec le code ${codeAutorisation}`);

        return createResponse(200, {
            success: true,
            message: 'Demande approuvée avec succès',
            codeAutorisation: codeAutorisation,
            demandeId: demandeId,
            type: type
        });

    } catch (error) {
        console.error('❌ Erreur approuverDemande:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de l\'approbation de la demande'
        });
    }
}

async function rejeterDemande(db, data) {
    try {
        const { demandeId, type, motif, recommandations = '' } = data;

        console.log(`❌ Rejet demande: ${demandeId} (${type})`);

        if (!demandeId || !type || !motif) {
            return createResponse(400, {
                success: false,
                message: 'ID de demande, type et motif requis'
            });
        }

        const collectionName = type === 'livreur' ? 'demande_livreur' : 'demande_restau';
        
        // Vérifier que la demande existe et est en attente
        const demande = await db.collection(collectionName).findOne({
            _id: new ObjectId(demandeId),
            statut: 'en_attente'
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Demande non trouvée ou déjà traitée'
            });
        }

        // Mettre à jour la demande
        const updateResult = await db.collection(collectionName).updateOne(
            { _id: new ObjectId(demandeId) },
            {
                $set: {
                    statut: 'rejetee',
                    dateTraitement: new Date(),
                    traiteePar: 'admin',
                    motifRejet: motif,
                    recommandations: recommandations,
                    updatedAt: new Date()
                }
            }
        );

        if (updateResult.matchedCount === 0) {
            return createResponse(404, {
                success: false,
                message: 'Erreur lors de la mise à jour'
            });
        }

        // Nettoyer le cache
        clearCache();

        console.log(`✅ Demande ${demandeId} rejetée`);

        return createResponse(200, {
            success: true,
            message: 'Demande rejetée avec succès',
            demandeId: demandeId,
            type: type,
            motif: motif
        });

    } catch (error) {
        console.error('❌ Erreur rejeterDemande:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors du rejet de la demande'
        });
    }
}

async function envoyerNotification(db, data) {
    try {
        const { demandeId, type, message } = data;

        console.log(`📲 Envoi notification: ${demandeId} (${type})`);

        if (!demandeId || !type) {
            return createResponse(400, {
                success: false,
                message: 'ID de demande et type requis'
            });
        }

        const collectionName = type === 'livreur' ? 'demande_livreur' : 'demande_restau';
        
        // Récupérer la demande
        const demande = await db.collection(collectionName).findOne({
            _id: new ObjectId(demandeId)
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Demande non trouvée'
            });
        }

        // Marquer la notification comme envoyée
        await db.collection(collectionName).updateOne(
            { _id: new ObjectId(demandeId) },
            {
                $set: {
                    dateNotification: new Date(),
                    notificationEnvoyee: true,
                    updatedAt: new Date()
                }
            }
        );

        // Simuler l'envoi de notification
        // TODO: Intégrer un service réel de WhatsApp/SMS
        
        return createResponse(200, {
            success: true,
            message: 'Notification envoyée avec succès',
            destinataire: demande.whatsapp || demande.telephone,
            contenu: genererMessageNotification(demande, type)
        });

    } catch (error) {
        console.error('❌ Erreur envoyerNotification:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de l\'envoi de la notification'
        });
    }
}

// ===== NETTOYAGE AUTOMATIQUE =====

async function runCleanup(db, data = {}) {
    try {
        console.log('🧹 Démarrage du nettoyage automatique');

        const { forceAll = false } = data;
        const results = [];

        for (const [collectionName, config] of Object.entries(COLLECTIONS_CONFIG)) {
            if (!config.deleteAfterDays && !forceAll) {
                continue;
            }

            try {
                const result = await cleanupCollection(db, collectionName, config);
                results.push(result);
            } catch (error) {
                console.error(`❌ Erreur nettoyage ${collectionName}:`, error);
                results.push({
                    collection: collectionName,
                    error: error.message,
                    deletedCount: 0
                });
            }
        }

        // Enregistrer l'historique du nettoyage
        await saveCleanupHistory(db, results);

        // Nettoyer le cache
        clearCache();

        console.log('✅ Nettoyage automatique terminé');

        return createResponse(200, {
            success: true,
            message: 'Nettoyage automatique terminé',
            results: results,
            totalDeleted: results.reduce((sum, r) => sum + (r.deletedCount || 0), 0)
        });

    } catch (error) {
        console.error('❌ Erreur runCleanup:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors du nettoyage automatique'
        });
    }
}

async function cleanupCollection(db, collectionName, config) {
    if (!config.deleteAfterDays) {
        return {
            collection: collectionName,
            skipped: true,
            reason: 'Nettoyage automatique désactivé'
        };
    }

    const cutoffDate = new Date(Date.now() - config.deleteAfterDays * 24 * 60 * 60 * 1000);
    
    let query = {
        [config.cleanupField]: { $lt: cutoffDate }
    };

    // Ajouter des conditions spécifiques si définies
    if (config.deleteCondition) {
        query = { ...query, ...config.deleteCondition };
    }

    const result = await db.collection(collectionName).deleteMany(query);

    // Pour les livraisons effectuées, nettoyer aussi les collections liées
    if (collectionName === 'LivraisonsEffectuees' && result.deletedCount > 0) {
        await cleanupRelatedCollectionsForCompleted(db, cutoffDate);
    }

    console.log(`🧹 ${collectionName}: ${result.deletedCount} éléments supprimés`);

    return {
        collection: collectionName,
        deletedCount: result.deletedCount,
        cutoffDate: cutoffDate.toISOString(),
        query: query
    };
}

async function cleanupRelatedCollectionsForCompleted(db, cutoffDate) {
    try {
        // Récupérer les IDs des colis livrés avant la date limite
        const completedOrders = await db.collection('LivraisonsEffectuees')
            .find(
                { deliveredAt: { $lt: cutoffDate } },
                { projection: { colisID: 1 } }
            )
            .toArray();

        const colisIDs = completedOrders.map(order => order.colisID);
        
        if (colisIDs.length > 0) {
            // Supprimer de toutes les collections liées
            const collections = ['Colis', 'Livraison', 'cour_expedition'];
            
            for (const collection of collections) {
                const result = await db.collection(collection).deleteMany({ 
                    colisID: { $in: colisIDs } 
                });
                console.log(`🧹 ${collection}: ${result.deletedCount} éléments liés supprimés`);
            }
        }
    } catch (error) {
        console.warn(`⚠️ Erreur nettoyage collections liées pour livraisons terminées:`, error);
    }
}

async function saveCleanupHistory(db, results) {
    try {
        const historyEntry = {
            timestamp: new Date(),
            results: results,
            totalDeleted: results.reduce((sum, r) => sum + (r.deletedCount || 0), 0),
            type: 'automatic'
        };

        await db.collection('cleanup_history').insertOne(historyEntry);
    } catch (error) {
        console.warn('⚠️ Erreur sauvegarde historique nettoyage:', error);
    }
}

async function getCleanupStatus(db) {
    try {
        // Récupérer l'historique récent
        const recentHistory = await db.collection('cleanup_history')
            .find({})
            .sort({ timestamp: -1 })
            .limit(10)
            .toArray();

        // Calculer les statistiques par collection
        const stats = {};
        for (const [collectionName, config] of Object.entries(COLLECTIONS_CONFIG)) {
            if (config.deleteAfterDays) {
                const cutoffDate = new Date(Date.now() - config.deleteAfterDays * 24 * 60 * 60 * 1000);
                let query = {
                    [config.cleanupField]: { $lt: cutoffDate }
                };

                if (config.deleteCondition) {
                    query = { ...query, ...config.deleteCondition };
                }

                const eligibleForDeletion = await safeCount(db, collectionName, query);
                
                stats[collectionName] = {
                    eligibleForDeletion,
                    deleteAfterDays: config.deleteAfterDays,
                    cutoffDate: cutoffDate.toISOString()
                };
            }
        }

        return createResponse(200, {
            success: true,
            recentHistory,
            stats,
            nextScheduledRun: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        });

    } catch (error) {
        console.error('❌ Erreur getCleanupStatus:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la récupération du statut de nettoyage'
        });
    }
}

// ===== RECHERCHE GLOBALE =====

async function globalSearch(db, data) {
    try {
        const { query, limit = 50 } = data;

        if (!query || query.trim().length < 2) {
            return createResponse(400, {
                success: false,
                message: 'Requête de recherche trop courte (minimum 2 caractères)'
            });
        }

        console.log(`🔍 Recherche globale: "${query}"`);

        const searchRegex = new RegExp(query.trim(), 'i');
        const results = {};

        // Rechercher dans toutes les collections configurées
        const searchPromises = Object.entries(COLLECTIONS_CONFIG).map(async ([collectionName, config]) => {
            try {
                const searchQuery = {
                    $or: config.searchFields.map(field => ({ [field]: searchRegex }))
                };
                
                const items = await db.collection(collectionName)
                    .find(searchQuery)
                    .limit(limit)
                    .toArray();

                if (items.length > 0) {
                    results[collectionName] = {
                        count: items.length,
                        items: items.slice(0, 10) // Limiter à 10 résultats par collection pour l'affichage
                    };
                }
            } catch (error) {
                console.warn(`⚠️ Erreur recherche ${collectionName}:`, error.message);
            }
        });

        await Promise.all(searchPromises);

        const totalResults = Object.values(results).reduce((sum, collection) => sum + collection.count, 0);

        console.log(`✅ Recherche terminée: ${totalResults} résultats trouvés`);

        return createResponse(200, {
            success: true,
            query,
            totalResults,
            results
        });

    } catch (error) {
        console.error('❌ Erreur globalSearch:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la recherche globale'
        });
    }
}

// ===== ANALYSES =====

async function getAnalytics(db, data) {
    try {
        const { type = 'general', timeRange = '7d' } = data;

        console.log(`📊 Génération d'analyses: ${type} (${timeRange})`);

        // Définir la plage de temps
        const { startDate } = getTimeRange(timeRange);

        let analytics = {};

        switch (type) {
            case 'general':
                analytics = await getGeneralAnalytics(db, startDate);
                break;
            case 'deliveries':
                analytics = await getDeliveryAnalytics(db, startDate);
                break;
            case 'performance':
                analytics = await getPerformanceAnalytics(db, startDate);
                break;
            default:
                return createResponse(400, {
                    success: false,
                    message: 'Type d\'analyse non supporté'
                });
        }

        console.log(`✅ Analyses ${type} générées`);

        return createResponse(200, {
            success: true,
            type,
            timeRange,
            analytics,
            period: {
                start: startDate.toISOString(),
                end: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Erreur getAnalytics:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la génération des analyses'
        });
    }
}

function getTimeRange(timeRange) {
    const now = new Date();
    
    switch (timeRange) {
        case '24h':
            return {
                startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000)
            };
        case '7d':
            return {
                startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
            };
        case '30d':
            return {
                startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
            };
        case '90d':
            return {
                startDate: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
            };
        default:
            return {
                startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
            };
    }
}

async function getGeneralAnalytics(db, startDate) {
    try {
        const [totalColis, totalLivrees, efficaciteGlobale] = await Promise.all([
            safeCount(db, 'Colis', { createdAt: { $gte: startDate } }),
            safeCount(db, 'LivraisonsEffectuees', { deliveredAt: { $gte: startDate } }),
            calculateGlobalEfficiency(db, startDate)
        ]);

        return {
            totalColis,
            totalLivrees,
            efficaciteGlobale
        };
    } catch (error) {
        console.warn('⚠️ Erreur analyses générales:', error.message);
        return {};
    }
}

async function getDeliveryAnalytics(db, startDate) {
    try {
        const [tauxReussite] = await Promise.all([
            calculateSuccessRate(db, startDate)
        ]);

        return {
            tauxReussite
        };
    } catch (error) {
        console.warn('⚠️ Erreur analyses livraisons:', error.message);
        return {};
    }
}

async function getPerformanceAnalytics(db, startDate) {
    try {
        const [topRestaurants] = await Promise.all([
            getTopRestaurants(db, startDate)
        ]);

        return {
            topRestaurants
        };
    } catch (error) {
        console.warn('⚠️ Erreur analyses performance:', error.message);
        return {};
    }
}

async function calculateGlobalEfficiency(db, startDate) {
    try {
        const [totalColis, totalLivrees] = await Promise.all([
            safeCount(db, 'Colis', { createdAt: { $gte: startDate } }),
            safeCount(db, 'LivraisonsEffectuees', { deliveredAt: { $gte: startDate } })
        ]);

        const efficiency = totalColis > 0 ? (totalLivrees / totalColis * 100).toFixed(1) : 0;
        
        return {
            totalColis,
            totalLivrees,
            efficiency: parseFloat(efficiency)
        };
    } catch (error) {
        console.warn('⚠️ Erreur calcul efficacité:', error.message);
        return { efficiency: 0 };
    }
}

async function calculateSuccessRate(db, startDate) {
    try {
        const [totalOrders, successfulDeliveries, refusedOrders] = await Promise.all([
            safeCount(db, 'Colis', { createdAt: { $gte: startDate } }),
            safeCount(db, 'LivraisonsEffectuees', { deliveredAt: { $gte: startDate } }),
            safeCount(db, 'Refus', { dateRefus: { $gte: startDate } })
        ]);

        const successRate = totalOrders > 0 ? (successfulDeliveries / totalOrders * 100).toFixed(1) : 0;
        const refusalRate = totalOrders > 0 ? (refusedOrders / totalOrders * 100).toFixed(1) : 0;

        return {
            totalOrders,
            successfulDeliveries,
            refusedOrders,
            successRate: parseFloat(successRate),
            refusalRate: parseFloat(refusalRate)
        };
    } catch (error) {
        console.warn('⚠️ Erreur taux réussite:', error.message);
        return { successRate: 0 };
    }
}

async function getTopRestaurants(db, startDate) {
    try {
        return await db.collection('Commandes').aggregate([
            { $match: { orderDate: { $gte: startDate } } },
            {
                $group: {
                    _id: '$restaurant.name',
                    orders: { $sum: 1 },
                    revenue: { $sum: '$totalAmount' }
                }
            },
            { $sort: { orders: -1 } },
            { $limit: 10 }
        ]).toArray();
    } catch (error) {
        console.warn('⚠️ Erreur top restaurants:', error.message);
        return [];
    }
}

// ===== EXPORT =====

async function exportData(db, data) {
    try {
        const { type, format = 'json', collection, filters = {} } = data;

        console.log(`📤 Export de données: ${type} (${format})`);

        let exportData = {};

        switch (type) {
            case 'collection':
                if (!collection) {
                    return createResponse(400, {
                        success: false,
                        message: 'Collection requise pour l\'export'
                    });
                }
                exportData = await exportCollection(db, collection, filters);
                break;
            case 'demandes_livreurs':
                exportData = await exportDemandesLivreurs(db, filters);
                break;
            case 'demandes_restaurants':
                exportData = await exportDemandesRestaurants(db, filters);
                break;
            case 'analytics':
                exportData = await exportAnalytics(db, filters);
                break;
            default:
                return createResponse(400, {
                    success: false,
                    message: 'Type d\'export non supporté'
                });
        }

        // Formater les données selon le format demandé
        let formattedData;
        let contentType;

        if (format === 'csv') {
            formattedData = convertToCSV(exportData);
            contentType = 'text/csv';
        } else {
            formattedData = JSON.stringify(exportData, null, 2);
            contentType = 'application/json';
        }

        console.log(`✅ Export ${type} généré (${format})`);

        return createResponse(200, {
            success: true,
            type,
            format,
            data: formattedData,
            contentType,
            filename: `export_${type}_${new Date().toISOString().split('T')[0]}.${format}`,
            size: formattedData.length
        });

    } catch (error) {
        console.error('❌ Erreur exportData:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de l\'export'
        });
    }
}

async function exportCollection(db, collectionName, filters) {
    const query = buildFilterQuery(filters);
    
    const documents = await db.collection(collectionName)
        .find(query)
        .sort({ _id: -1 })
        .limit(10000) // Limite de sécurité
        .toArray();

    return {
        type: 'collection',
        collection: collectionName,
        count: documents.length,
        filters,
        exportDate: new Date().toISOString(),
        data: documents
    };
}

async function exportDemandesLivreurs(db, filters) {
    const query = buildFilterQuery(filters);
    
    const demandes = await db.collection('demande_livreur')
        .find(query)
        .sort({ dateCreation: -1 })
        .toArray();

    return {
        type: 'demandes_livreurs',
        count: demandes.length,
        filters,
        exportDate: new Date().toISOString(),
        data: demandes.map(demande => ({
            id: demande._id,
            nom: demande.nom,
            prenom: demande.prenom,
            whatsapp: demande.whatsapp,
            telephone: demande.telephone,
            quartier: demande.quartier,
            vehicule: demande.vehicule,
            immatriculation: demande.immatriculation,
            experience: demande.experience,
            statut: demande.statut,
            dateCreation: demande.dateCreation,
            dateTraitement: demande.dateTraitement,
            codeAutorisation: demande.codeAutorisation,
            motifRejet: demande.motifRejet
        }))
    };
}

async function exportDemandesRestaurants(db, filters) {
    const query = buildFilterQuery(filters);
    
    const demandes = await db.collection('demande_restau')
        .find(query)
        .sort({ dateCreation: -1 })
        .toArray();

    return {
        type: 'demandes_restaurants',
        count: demandes.length,
        filters,
        exportDate: new Date().toISOString(),
        data: demandes.map(demande => ({
            id: demande._id,
            nom: demande.nom,
            nomCommercial: demande.nomCommercial,
            telephone: demande.telephone,
            email: demande.email,
            adresse: demande.adresse,
            quartier: demande.quartier,
            cuisine: demande.cuisine,
            statut: demande.statut,
            dateCreation: demande.dateCreation,
            dateTraitement: demande.dateTraitement,
            codeAutorisation: demande.codeAutorisation,
            motifRejet: demande.motifRejet,
            hasGPS: !!(demande.location && demande.location.latitude),
            menuItemsCount: demande.menu ? demande.menu.length : 0
        }))
    };
}

async function exportAnalytics(db, filters) {
    const stats = await getStats(db);
    return {
        type: 'analytics',
        exportDate: new Date().toISOString(),
        data: stats
    };
}

function buildFilterQuery(filters) {
    const query = {};
    
    if (filters.statut && filters.statut !== 'tous') {
        query.statut = filters.statut;
    }
    
    if (filters.dateDebut && filters.dateFin) {
        const dateField = filters.dateField || 'dateCreation';
        query[dateField] = {
            $gte: new Date(filters.dateDebut),
            $lte: new Date(filters.dateFin)
        };
    }
    
    return query;
}

function convertToCSV(data) {
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        return 'Aucune donnée à exporter';
    }
    
    const headers = Object.keys(data.data[0]);
    const csvHeaders = headers.join(',');
    
    const csvRows = data.data.map(row => {
        return headers.map(header => {
            let value = row[header];
            
            // Traitement spécial pour les objets et arrays
            if (typeof value === 'object' && value !== null) {
                value = JSON.stringify(value);
            }
            
            // Échappement des virgules et guillemets
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                value = `"${value.replace(/"/g, '""')}"`;
            }
            
            return value || '';
        }).join(',');
    });
    
    return [csvHeaders, ...csvRows].join('\n');
}

// ===== FONCTIONS UTILITAIRES =====

async function genererCodeAutorisation(db, type) {
    const prefix = type === 'livreur' ? 'LIV' : 'REST';
    const collectionExistante = type === 'livreur' ? 'Res_livreur' : 'Restau';
    const collectionDemande = type === 'livreur' ? 'demande_livreur' : 'demande_restau';
    
    let isUnique = false;
    let newCode = '';
    let attempts = 0;
    const maxAttempts = 100;
    
    while (!isUnique && attempts < maxAttempts) {
        const timestamp = Date.now().toString().slice(-4);
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        newCode = `${prefix}${timestamp}${random}`;
        
        // Vérifier dans la collection existante
        const existingInCollection = await safeCount(db, collectionExistante, {
            codeAutorisation: newCode
        });
        
        // Vérifier dans les demandes
        const existingInDemandes = await safeCount(db, collectionDemande, {
            codeAutorisation: newCode
        });
        
        if (existingInCollection === 0 && existingInDemandes === 0) {
            isUnique = true;
        }
        attempts++;
    }
    
    if (!isUnique) {
        // Fallback avec timestamp complet
        newCode = `${prefix}${Date.now()}`;
    }
    
    return newCode;
}

function genererMessageNotification(demande, type) {
    const nom = type === 'livreur' ? `${demande.nom} ${demande.prenom}` : demande.nom;
    const code = demande.codeAutorisation;
    
    if (demande.statut === 'approuvee') {
        return `🎉 Félicitations ${nom} ! Votre demande SEND2.0 a été approuvée. Votre code d'autorisation est : ${code}. Finalisez votre inscription sur notre plateforme avec ce code.`;
    } else if (demande.statut === 'rejetee') {
        return `❌ Bonjour ${nom}, nous regrettons de vous informer que votre demande SEND2.0 a été rejetée. Motif : ${demande.motifRejet}. Vous pouvez soumettre une nouvelle demande après correction.`;
    }
    
    return `📋 Bonjour ${nom}, votre demande SEND2.0 est en cours de traitement. Vous recevrez une notification dès qu'elle sera traitée.`;
}

function getTempsEcoule(dateCreation) {
    const now = new Date();
    const created = new Date(dateCreation);
    const diff = now - created;
    
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days}j`;
    } else if (hours > 0) {
        return `${hours}h`;
    } else {
        return `${minutes}min`;
    }
}

// Fonctions de cache
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

function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify(body)
    };
}