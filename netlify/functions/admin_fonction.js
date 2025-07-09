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

// Cache pour optimiser les performances
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function connectToMongoDB() {
    try {
        if (!mongoClient) {
            mongoClient = new MongoClient(MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                connectTimeoutMS: 30000,
                serverSelectionTimeoutMS: 30000,
                maxPoolSize: 10,
                retryWrites: true,
                w: 'majority'
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
            // Statistiques globales
            case 'getStats':
                return await getStats(db);
            
            // Gestion des demandes de livreurs
            case 'getDemandesLivreurs':
                return await getDemandesLivreurs(db, body);
            
            case 'getDemandesRestaurants':
                return await getDemandesRestaurants(db, body);
            
            case 'approuverDemande':
                return await approuverDemande(db, body);
            
            case 'rejeterDemande':
                return await rejeterDemande(db, body);
            
            case 'bulkApprove':
                return await bulkApprove(db, body);
            
            case 'envoyerNotification':
                return await envoyerNotification(db, body);
            
            // Gestion des collections existantes
            case 'getData':
                return await getData(db, body);
            
            case 'deleteItem':
                return await deleteItem(db, body);
            
            case 'bulkDelete':
                return await bulkDelete(db, body);
            
            case 'updateItem':
                return await updateItem(db, body);
            
            case 'createItem':
                return await createItem(db, body);
            
            // Recherche avancée
            case 'searchGlobal':
                return await searchGlobal(db, body);
            
            case 'getAnalytics':
                return await getAnalytics(db, body);
            
            // Export de données
            case 'exportData':
                return await exportData(db, body);
            
            default:
                return createResponse(400, { 
                    success: false, 
                    message: 'Action non supportée' 
                });
        }

    } catch (error) {
        console.error('💥 Erreur serveur:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur interne du serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ===== FONCTIONS PRINCIPALES =====

// Obtenir les statistiques globales
async function getStats(db) {
    try {
        console.log('📊 Chargement des statistiques globales');
        
        const cacheKey = 'global_stats';
        const cached = getCachedData(cacheKey);
        
        if (cached) {
            return createResponse(200, { success: true, ...cached });
        }

        // Statistiques des collections principales
        const [
            colis, livraison, livrees, livreurs, restaurants, commandes,
            demandesLivreurs, demandesRestaurants
        ] = await Promise.all([
            db.collection('Colis').estimatedDocumentCount(),
            db.collection('Livraison').estimatedDocumentCount(),
            db.collection('LivraisonsEffectuees').estimatedDocumentCount(),
            db.collection('Res_livreur').estimatedDocumentCount(),
            db.collection('Restau').estimatedDocumentCount(),
            db.collection('Commandes').estimatedDocumentCount(),
            db.collection('demande_livreur').estimatedDocumentCount(),
            db.collection('demande_restau').estimatedDocumentCount()
        ]);

        // Statistiques détaillées des demandes
        const [statsDemandesLivreurs, statsDemandesRestaurants] = await Promise.all([
            db.collection('demande_livreur').aggregate([
                { $group: { _id: '$statut', count: { $sum: 1 } } }
            ]).toArray(),
            db.collection('demande_restau').aggregate([
                { $group: { _id: '$statut', count: { $sum: 1 } } }
            ]).toArray()
        ]);

        const result = {
            collections: {
                colis,
                livraison,
                livrees,
                livreurs,
                restaurants,
                commandes
            },
            demandes: {
                livreurs: {
                    total: demandesLivreurs,
                    parStatut: statsDemandesLivreurs.reduce((acc, item) => {
                        acc[item._id || 'sans_statut'] = item.count;
                        return acc;
                    }, { en_attente: 0, approuvee: 0, rejetee: 0, finalisee: 0 })
                },
                restaurants: {
                    total: demandesRestaurants,
                    parStatut: statsDemandesRestaurants.reduce((acc, item) => {
                        acc[item._id || 'sans_statut'] = item.count;
                        return acc;
                    }, { en_attente: 0, approuvee: 0, rejetee: 0, finalisee: 0 })
                }
            },
            timestamp: new Date().toISOString()
        };

        setCachedData(cacheKey, result);
        
        console.log('✅ Statistiques chargées avec succès');
        return createResponse(200, { success: true, ...result });

    } catch (error) {
        console.error('❌ Erreur getStats:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors du chargement des statistiques'
        });
    }
}

// Récupérer les demandes de livreurs
async function getDemandesLivreurs(db, data) {
    try {
        console.log('📋 Récupération des demandes de livreurs');

        const { statut, limit = 20, offset = 0, search = '' } = data;

        // Construction de la requête
        let query = {};
        
        if (statut && statut !== 'tous') {
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

        // Récupérer les demandes avec pagination
        const [demandes, totalCount] = await Promise.all([
            db.collection('demande_livreur')
                .find(query)
                .sort({ dateCreation: -1 })
                .skip(offset)
                .limit(limit)
                .toArray(),
            db.collection('demande_livreur').countDocuments(query)
        ]);

        // Statistiques par statut
        const statsStatut = await db.collection('demande_livreur').aggregate([
            { $group: { _id: '$statut', count: { $sum: 1 } } }
        ]).toArray();

        const stats = {
            en_attente: 0,
            approuvee: 0,
            rejetee: 0,
            finalisee: 0
        };

        statsStatut.forEach(stat => {
            if (stat._id && stats.hasOwnProperty(stat._id)) {
                stats[stat._id] = stat.count;
            }
        });

        console.log(`✅ ${demandes.length} demandes de livreurs récupérées`);

        return createResponse(200, {
            success: true,
            data: demandes,
            totalCount,
            stats,
            currentPage: Math.floor(offset / limit) + 1,
            totalPages: Math.ceil(totalCount / limit),
            hasMore: offset + demandes.length < totalCount
        });

    } catch (error) {
        console.error('❌ Erreur getDemandesLivreurs:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la récupération des demandes de livreurs'
        });
    }
}

// Récupérer les demandes de restaurants
async function getDemandesRestaurants(db, data) {
    try {
        console.log('📋 Récupération des demandes de restaurants');

        const { statut, limit = 20, offset = 0, search = '' } = data;

        // Construction de la requête
        let query = {};
        
        if (statut && statut !== 'tous') {
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
                { cuisine: searchRegex },
                { responsableNom: searchRegex }
            ];
        }

        // Récupérer les demandes avec pagination
        const [demandes, totalCount] = await Promise.all([
            db.collection('demande_restau')
                .find(query)
                .sort({ dateCreation: -1 })
                .skip(offset)
                .limit(limit)
                .toArray(),
            db.collection('demande_restau').countDocuments(query)
        ]);

        // Statistiques par statut
        const statsStatut = await db.collection('demande_restau').aggregate([
            { $group: { _id: '$statut', count: { $sum: 1 } } }
        ]).toArray();

        const stats = {
            en_attente: 0,
            approuvee: 0,
            rejetee: 0,
            finalisee: 0
        };

        statsStatut.forEach(stat => {
            if (stat._id && stats.hasOwnProperty(stat._id)) {
                stats[stat._id] = stat.count;
            }
        });

        console.log(`✅ ${demandes.length} demandes de restaurants récupérées`);

        return createResponse(200, {
            success: true,
            data: demandes,
            totalCount,
            stats,
            currentPage: Math.floor(offset / limit) + 1,
            totalPages: Math.ceil(totalCount / limit),
            hasMore: offset + demandes.length < totalCount
        });

    } catch (error) {
        console.error('❌ Erreur getDemandesRestaurants:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la récupération des demandes de restaurants'
        });
    }
}

// Approuver une demande
async function approuverDemande(db, data) {
    try {
        const { demandeId, type, motif = '' } = data;

        console.log(`✅ Approbation demande: ${demandeId} (${type})`);

        if (!demandeId || !type) {
            return createResponse(400, {
                success: false,
                message: 'ID de demande et type requis'
            });
        }

        const collectionName = type === 'livreur' ? 'demande_livreur' : 'demande_restau';
        
        // Vérifier que la demande existe
        const demande = await db.collection(collectionName).findOne({
            _id: new ObjectId(demandeId)
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Demande non trouvée'
            });
        }

        if (demande.statut !== 'en_attente') {
            return createResponse(400, {
                success: false,
                message: 'Cette demande a déjà été traitée'
            });
        }

        // Générer un identifiant unique
        const identifiant = await genererIdentifiantUnique(db, type);

        // Mettre à jour la demande
        const updateResult = await db.collection(collectionName).updateOne(
            { _id: new ObjectId(demandeId) },
            {
                $set: {
                    statut: 'approuvee',
                    dateTraitement: new Date(),
                    traiteePar: 'admin',
                    identifiantGenere: identifiant,
                    motifApprobation: motif,
                    updatedAt: new Date()
                }
            }
        );

        if (updateResult.matchedCount === 0) {
            return createResponse(404, {
                success: false,
                message: 'Demande non trouvée'
            });
        }

        // Nettoyer le cache
        clearCache();

        console.log(`✅ Demande ${demandeId} approuvée avec l'identifiant ${identifiant}`);

        return createResponse(200, {
            success: true,
            message: 'Demande approuvée avec succès',
            identifiantGenere: identifiant,
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

// Rejeter une demande
async function rejeterDemande(db, data) {
    try {
        const { demandeId, type, motif } = data;

        console.log(`❌ Rejet demande: ${demandeId} (${type})`);

        if (!demandeId || !type || !motif) {
            return createResponse(400, {
                success: false,
                message: 'ID de demande, type et motif requis'
            });
        }

        const collectionName = type === 'livreur' ? 'demande_livreur' : 'demande_restau';
        
        // Vérifier que la demande existe
        const demande = await db.collection(collectionName).findOne({
            _id: new ObjectId(demandeId)
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Demande non trouvée'
            });
        }

        if (demande.statut !== 'en_attente') {
            return createResponse(400, {
                success: false,
                message: 'Cette demande a déjà été traitée'
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
                    updatedAt: new Date()
                }
            }
        );

        if (updateResult.matchedCount === 0) {
            return createResponse(404, {
                success: false,
                message: 'Demande non trouvée'
            });
        }

        // Nettoyer le cache
        clearCache();

        console.log(`✅ Demande ${demandeId} rejetée`);

        return createResponse(200, {
            success: true,
            message: 'Demande rejetée',
            demandeId: demandeId,
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

// Approbation en masse
async function bulkApprove(db, data) {
    try {
        const { type, itemIds } = data;

        console.log(`✅ Approbation en masse: ${itemIds.length} demandes (${type})`);

        if (!type || !itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
            return createResponse(400, {
                success: false,
                message: 'Type et liste d\'IDs requis'
            });
        }

        const collectionName = type === 'livreur' ? 'demande_livreur' : 'demande_restau';
        
        // Vérifier que toutes les demandes existent et sont en attente
        const demandes = await db.collection(collectionName).find({
            _id: { $in: itemIds.map(id => new ObjectId(id)) },
            statut: 'en_attente'
        }).toArray();

        if (demandes.length !== itemIds.length) {
            return createResponse(400, {
                success: false,
                message: 'Certaines demandes ne peuvent pas être approuvées'
            });
        }

        // Générer les identifiants
        const identifiants = [];
        for (let i = 0; i < demandes.length; i++) {
            identifiants.push(await genererIdentifiantUnique(db, type));
        }

        // Mettre à jour toutes les demandes
        const bulkOperations = demandes.map((demande, index) => ({
            updateOne: {
                filter: { _id: demande._id },
                update: {
                    $set: {
                        statut: 'approuvee',
                        dateTraitement: new Date(),
                        traiteePar: 'admin',
                        identifiantGenere: identifiants[index],
                        motifApprobation: 'Approbation en masse',
                        updatedAt: new Date()
                    }
                }
            }
        }));

        const result = await db.collection(collectionName).bulkWrite(bulkOperations);

        // Nettoyer le cache
        clearCache();

        console.log(`✅ ${result.modifiedCount} demandes approuvées en masse`);

        return createResponse(200, {
            success: true,
            message: `${result.modifiedCount} demandes approuvées`,
            modifiedCount: result.modifiedCount,
            identifiants: identifiants
        });

    } catch (error) {
        console.error('❌ Erreur bulkApprove:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de l\'approbation en masse'
        });
    }
}

// Obtenir les données d'une collection
async function getData(db, data) {
    try {
        const { collection, limit = 20, offset = 0, search = '', sort = 'createdAt', direction = 'desc', filters = {} } = data;

        console.log(`📋 Chargement collection: ${collection}`);

        if (!collection) {
            return createResponse(400, {
                success: false,
                message: 'Nom de collection requis'
            });
        }

        // Construire la requête
        let query = {};

        // Recherche textuelle
        if (search && search.trim()) {
            const searchRegex = new RegExp(search.trim(), 'i');
            
            // Champs de recherche par collection
            const searchFields = {
                'Res_livreur': ['nom', 'prenom', 'whatsapp', 'quartier', 'id_livreur'],
                'Restau': ['nom', 'adresse', 'telephone', 'cuisine', 'restaurant_id'],
                'Colis': ['sender', 'recipient', 'colisID', 'senderPhone', 'recipientPhone'],
                'Livraison': ['livreur', 'restaurant', 'colisID', 'status'],
                'Commandes': ['customerName', 'orderID', 'restaurant', 'status']
            };

            const fields = searchFields[collection] || ['nom', 'name', 'title'];
            query.$or = fields.map(field => ({ [field]: searchRegex }));
        }

        // Filtres additionnels
        Object.entries(filters).forEach(([key, value]) => {
            if (value && value !== 'tous') {
                query[key] = value;
            }
        });

        // Tri
        let sortQuery = {};
        if (sort && sort !== 'createdAt') {
            sortQuery[sort] = direction === 'asc' ? 1 : -1;
        } else {
            sortQuery = { $natural: -1 };
        }

        // Exécuter la requête
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
            count: documents.length,
            offset,
            limit,
            hasMore: offset + documents.length < totalCount,
            collection,
            query: { search, filters, sort, direction }
        });

    } catch (error) {
        console.error('❌ Erreur getData:', error);
        return createResponse(500, {
            success: false,
            message: `Erreur lors du chargement de la collection ${data.collection}`
        });
    }
}

// Supprimer un élément
async function deleteItem(db, data) {
    try {
        const { collection, itemId } = data;

        console.log(`🗑️ Suppression élément: ${itemId} dans ${collection}`);

        if (!collection || !itemId) {
            return createResponse(400, {
                success: false,
                message: 'Collection et ID d\'élément requis'
            });
        }

        const result = await db.collection(collection).deleteOne({
            _id: new ObjectId(itemId)
        });

        if (result.deletedCount === 1) {
            clearCache();
            
            console.log(`✅ Élément ${itemId} supprimé de ${collection}`);
            return createResponse(200, {
                success: true,
                message: 'Élément supprimé avec succès',
                deletedCount: 1
            });
        } else {
            return createResponse(404, {
                success: false,
                message: 'Élément non trouvé'
            });
        }

    } catch (error) {
        console.error('❌ Erreur deleteItem:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la suppression'
        });
    }
}

// Suppression en masse
async function bulkDelete(db, data) {
    try {
        const { collection, itemIds } = data;

        console.log(`🗑️ Suppression en masse: ${itemIds.length} éléments dans ${collection}`);

        if (!collection || !itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
            return createResponse(400, {
                success: false,
                message: 'Collection et liste d\'IDs requis'
            });
        }

        const result = await db.collection(collection).deleteMany({
            _id: { $in: itemIds.map(id => new ObjectId(id)) }
        });

        clearCache();

        console.log(`✅ ${result.deletedCount} éléments supprimés de ${collection}`);

        return createResponse(200, {
            success: true,
            message: `${result.deletedCount} éléments supprimés`,
            deletedCount: result.deletedCount
        });

    } catch (error) {
        console.error('❌ Erreur bulkDelete:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la suppression en masse'
        });
    }
}

// Mettre à jour un élément
async function updateItem(db, data) {
    try {
        const { collection, itemId, updates } = data;

        console.log(`✏️ Mise à jour élément: ${itemId} dans ${collection}`);

        if (!collection || !itemId || !updates) {
            return createResponse(400, {
                success: false,
                message: 'Collection, ID et données de mise à jour requis'
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
        console.error('❌ Erreur updateItem:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la mise à jour'
        });
    }
}

// Créer un nouvel élément
async function createItem(db, data) {
    try {
        const { collection, itemData } = data;

        console.log(`➕ Création élément dans ${collection}`);

        if (!collection || !itemData) {
            return createResponse(400, {
                success: false,
                message: 'Collection et données requises'
            });
        }

        // Ajouter les dates de création
        itemData.createdAt = new Date();
        itemData.updatedAt = new Date();

        const result = await db.collection(collection).insertOne(itemData);

        clearCache();

        console.log(`✅ Élément créé dans ${collection}: ${result.insertedId}`);
        return createResponse(201, {
            success: true,
            message: 'Élément créé avec succès',
            insertedId: result.insertedId
        });

    } catch (error) {
        console.error('❌ Erreur createItem:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la création'
        });
    }
}

// Recherche globale
async function searchGlobal(db, data) {
    try {
        const { query, collections, limit = 10 } = data;

        console.log(`🔍 Recherche globale: "${query}"`);

        if (!query || query.trim().length < 2) {
            return createResponse(400, {
                success: false,
                message: 'Requête de recherche trop courte (minimum 2 caractères)'
            });
        }

        const searchCollections = collections || [
            'demande_livreur', 'demande_restau', 'Res_livreur', 'Restau', 'Colis', 'Livraison', 'Commandes'
        ];

        const results = {};
        let totalResults = 0;

        const searchPromises = searchCollections.map(async (collection) => {
            try {
                const searchRegex = new RegExp(query.trim(), 'i');
                let searchQuery = {};

                // Définir les champs de recherche par collection
                const searchFields = {
                    'demande_livreur': ['nom', 'prenom', 'whatsapp', 'quartier', 'vehicule'],
                    'demande_restau': ['nom', 'nomCommercial', 'telephone', 'adresse', 'cuisine'],
                    'Res_livreur': ['nom', 'prenom', 'whatsapp', 'id_livreur', 'quartier'],
                    'Restau': ['nom', 'adresse', 'telephone', 'cuisine', 'restaurant_id'],
                    'Colis': ['sender', 'recipient', 'colisID', 'senderPhone'],
                    'Livraison': ['livreur', 'restaurant', 'colisID'],
                    'Commandes': ['customerName', 'orderID', 'restaurant']
                };

                const fields = searchFields[collection] || ['nom', 'name', 'title'];
                searchQuery.$or = fields.map(field => ({ [field]: searchRegex }));

                const items = await db.collection(collection)
                    .find(searchQuery)
                    .limit(limit)
                    .toArray();

                results[collection] = {
                    data: items,
                    count: items.length
                };

                totalResults += items.length;

            } catch (error) {
                console.warn(`⚠️ Erreur recherche dans ${collection}:`, error);
                results[collection] = { data: [], count: 0 };
            }
        });

        await Promise.all(searchPromises);

        console.log(`✅ Recherche terminée: ${totalResults} résultats`);

        return createResponse(200, {
            success: true,
            query,
            results,
            totalResults,
            searchedCollections: searchCollections
        });

    } catch (error) {
        console.error('❌ Erreur searchGlobal:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la recherche'
        });
    }
}

// Analyses avancées
async function getAnalytics(db, data) {
    try {
        const { collection, timeRange = '7d', type = 'timeline' } = data;

        console.log(`📊 Analyses pour ${collection} (${timeRange})`);

        if (!collection) {
            return createResponse(400, {
                success: false,
                message: 'Collection requise'
            });
        }

        // Définir la plage de temps
        const now = new Date();
        let startDate;
        let groupFormat;

        switch (timeRange) {
            case '24h':
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%m-%d %H";
                break;
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%m-%d";
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%m-%d";
                break;
            default:
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%m-%d";
        }

        // Analyser les tendances temporelles
        const dateField = collection.includes('demande') ? 'dateCreation' : 'createdAt';
        
        const timeline = await db.collection(collection).aggregate([
            {
                $match: {
                    [dateField]: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: groupFormat,
                            date: `$${dateField}`
                        }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id": 1 } }
        ]).toArray();

        // Analyser la distribution par statut
        const statusField = collection.includes('demande') ? 'statut' : 'status';
        const statusDistribution = await db.collection(collection).aggregate([
            {
                $group: {
                    _id: `$${statusField}`,
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]).toArray();

        // Statistiques générales
        const totalCount = await db.collection(collection).countDocuments();
        const recentCount = await db.collection(collection).countDocuments({
            [dateField]: { $gte: startDate }
        });

        console.log(`✅ Analyses terminées pour ${collection}`);

        return createResponse(200, {
            success: true,
            collection,
            timeRange,
            analytics: {
                timeline,
                statusDistribution,
                totalCount,
                recentCount,
                startDate: startDate.toISOString(),
                endDate: now.toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Erreur getAnalytics:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de l\'analyse'
        });
    }
}

// Export de données
async function exportData(db, data) {
    try {
        const { collection, format = 'json', filters = {} } = data;

        console.log(`📁 Export données: ${collection} (${format})`);

        if (!collection) {
            return createResponse(400, {
                success: false,
                message: 'Collection requise'
            });
        }

        // Construire la requête
        let query = {};
        Object.entries(filters).forEach(([key, value]) => {
            if (value && value !== 'tous') {
                query[key] = value;
            }
        });

        // Récupérer les données
        const documents = await db.collection(collection)
            .find(query)
            .limit(10000) // Limite de sécurité
            .toArray();

        if (format === 'csv') {
            // Conversion en CSV
            if (documents.length === 0) {
                return createResponse(200, {
                    success: true,
                    data: '',
                    format: 'csv',
                    count: 0
                });
            }

            const headers = Object.keys(documents[0]).filter(key => !key.startsWith('_'));
            const csvData = [
                headers.join(','),
                ...documents.map(doc => 
                    headers.map(header => {
                        const value = doc[header];
                        if (typeof value === 'object' && value !== null) {
                            return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
                        }
                        return `"${String(value || '').replace(/"/g, '""')}"`;
                    }).join(',')
                )
            ].join('\n');

            return createResponse(200, {
                success: true,
                data: csvData,
                format: 'csv',
                count: documents.length
            });
        }

        // Format JSON par défaut
        return createResponse(200, {
            success: true,
            data: documents,
            format: 'json',
            count: documents.length
        });

    } catch (error) {
        console.error('❌ Erreur exportData:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de l\'export'
        });
    }
}

// Envoyer une notification
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

        // Simuler l'envoi de notification
        const notification = {
            destinataire: demande.whatsapp || demande.telephone,
            message: message || `Votre demande a été traitée. Identifiant: ${demande.identifiantGenere || 'N/A'}`,
            statut: 'envoye',
            dateEnvoi: new Date(),
            type: 'whatsapp',
            demandeId: demandeId,
            typeDestination: type
        };

        // Enregistrer la notification
        await db.collection('notifications').insertOne(notification);

        // Marquer la demande comme notifiée
        await db.collection(collectionName).updateOne(
            { _id: new ObjectId(demandeId) },
            {
                $set: {
                    notificationEnvoyee: true,
                    dateNotification: new Date()
                }
            }
        );

        console.log(`✅ Notification envoyée à ${notification.destinataire}`);

        return createResponse(200, {
            success: true,
            message: 'Notification envoyée avec succès',
            destinataire: notification.destinataire,
            dateEnvoi: notification.dateEnvoi
        });

    } catch (error) {
        console.error('❌ Erreur envoyerNotification:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de l\'envoi de la notification'
        });
    }
}

// ===== FONCTIONS UTILITAIRES =====

// Générer un identifiant unique
async function genererIdentifiantUnique(db, type) {
    const prefix = type === 'livreur' ? 'LIV' : 'REST';
    const collectionExistante = type === 'livreur' ? 'Res_livreur' : 'Restau';
    const collectionDemande = type === 'livreur' ? 'demande_livreur' : 'demande_restau';
    const fieldName = type === 'livreur' ? 'id_livreur' : 'restaurant_id';
    
    let isUnique = false;
    let newId = '';
    let attempts = 0;
    const maxAttempts = 100;
    
    while (!isUnique && attempts < maxAttempts) {
        const random = Math.floor(Math.random() * 9000) + 1000;
        newId = `${prefix}${random}`;
        
        // Vérifier dans la collection existante
        const [existingInCollection, existingInDemandes] = await Promise.all([
            db.collection(collectionExistante).findOne({ [fieldName]: newId }),
            db.collection(collectionDemande).findOne({ identifiantGenere: newId })
        ]);
        
        if (!existingInCollection && !existingInDemandes) {
            isUnique = true;
        }
        attempts++;
    }
    
    if (!isUnique) {
        // Fallback avec timestamp
        const timestamp = Date.now().toString().slice(-6);
        newId = `${prefix}${timestamp}`;
    }
    
    return newId;
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

// Créer une réponse standardisée
function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify(body, null, 2)
    };
}

// Fonction de logging avancée
function logActivity(action, details = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${action}:`, JSON.stringify(details, null, 2));
}

// Validation des données
function validateData(data, requiredFields) {
    const missingFields = requiredFields.filter(field => !data[field]);
    if (missingFields.length > 0) {
        throw new Error(`Champs manquants: ${missingFields.join(', ')}`);
    }
    return true;
}

// Nettoyage des données sensibles
function sanitizeData(data) {
    const sanitized = { ...data };
    
    // Supprimer les champs sensibles
    delete sanitized.ip;
    delete sanitized.metadata;
    delete sanitized.__v;
    
    return sanitized;
}