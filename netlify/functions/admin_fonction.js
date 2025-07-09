const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

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
            
            // Gestion des demandes de livreurs
            case 'getDemandesLivreurs':
                return await getDemandesLivreurs(db, body);
            
            case 'approuverDemande':
                return await approuverDemande(db, body);
            
            case 'rejeterDemande':
                return await rejeterDemande(db, body);
            
            case 'envoyerNotification':
                return await envoyerNotification(db, body);
            
            // Gestion des demandes de restaurants
            case 'getDemandesRestaurants':
                return await getDemandesRestaurants(db, body);
            
            // Gestion des collections
            case 'getCollectionData':
                return await getCollectionData(db, body);
            
            case 'updateCollectionItem':
                return await updateCollectionItem(db, body);
            
            case 'deleteCollectionItem':
                return await deleteCollectionItem(db, body);
            
            // Analyses
            case 'getAnalytics':
                return await getAnalytics(db, body);
            
            // Export
            case 'exportData':
                return await exportData(db, body);
            
            default:
                return createResponse(400, { 
                    success: false, 
                    message: 'Action non supportée' 
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

        // Obtenir les statistiques des collections principales
        const [
            totalColis,
            totalLivraison,
            totalLivrees,
            totalLivreurs,
            totalRestaurants,
            totalCommandes,
            totalDemandesLivreurs,
            totalDemandesRestaurants
        ] = await Promise.all([
            db.collection('Colis').countDocuments(),
            db.collection('Livraison').countDocuments(),
            db.collection('LivraisonsEffectuees').countDocuments(),
            db.collection('Res_livreur').countDocuments({ status: 'actif' }),
            db.collection('Restau').countDocuments({ statut: 'actif' }),
            db.collection('Commandes').countDocuments(),
            db.collection('demande_livreur').countDocuments(),
            db.collection('demande_restau').countDocuments()
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

        // Statistiques temporelles (dernières 24h)
        const derniere24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        const [
            nouvellesDemandesLivreurs24h,
            nouvellesDemandesRestaurants24h,
            nouvellesLivraisons24h,
            nouveauxColis24h
        ] = await Promise.all([
            db.collection('demande_livreur').countDocuments({ 
                dateCreation: { $gte: derniere24h } 
            }),
            db.collection('demande_restau').countDocuments({ 
                dateCreation: { $gte: derniere24h } 
            }),
            db.collection('Livraison').countDocuments({ 
                createdAt: { $gte: derniere24h } 
            }),
            db.collection('Colis').countDocuments({ 
                createdAt: { $gte: derniere24h } 
            })
        ]);

        const result = {
            collections: {
                colis: totalColis,
                livraison: totalLivraison,
                livrees: totalLivrees,
                livreurs: totalLivreurs,
                restaurants: totalRestaurants,
                commandes: totalCommandes
            },
            demandes: {
                livreurs: {
                    total: totalDemandesLivreurs,
                    nouvelles24h: nouvellesDemandesLivreurs24h,
                    parStatut: statsDemandesLivreurs.reduce((acc, item) => {
                        acc[item._id || 'sans_statut'] = item.count;
                        return acc;
                    }, {})
                },
                restaurants: {
                    total: totalDemandesRestaurants,
                    nouvelles24h: nouvellesDemandesRestaurants24h,
                    parStatut: statsDemandesRestaurants.reduce((acc, item) => {
                        acc[item._id || 'sans_statut'] = item.count;
                        return acc;
                    }, {})
                }
            },
            activite24h: {
                nouvellesLivraisons: nouvellesLivraisons24h,
                nouveauxColis: nouveauxColis24h,
                nouvellesDemandesLivreurs: nouvellesDemandesLivreurs24h,
                nouvellesDemandesRestaurants: nouvellesDemandesRestaurants24h
            },
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

// ===== GESTION DES DEMANDES DE LIVREURS =====

async function getDemandesLivreurs(db, data) {
    try {
        console.log('📋 Récupération des demandes de livreurs');

        const { 
            statut = 'en_attente', 
            limit = 50, 
            offset = 0, 
            search = '',
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

        // Tri
        const sortQuery = {};
        sortQuery[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Exécution des requêtes
        const [demandes, totalCount] = await Promise.all([
            db.collection('demande_livreur')
                .find(query)
                .sort(sortQuery)
                .skip(offset)
                .limit(Math.min(limit, 100))
                .toArray(),
            db.collection('demande_livreur').countDocuments(query)
        ]);

        // Statistiques par statut (pour les filtres)
        const statsStatut = await db.collection('demande_livreur').aggregate([
            { $group: { _id: '$statut', count: { $sum: 1 } } }
        ]).toArray();

        const stats = {
            en_attente: 0,
            approuvee: 0,
            rejetee: 0,
            finalisee: 0,
            total: totalCount
        };

        statsStatut.forEach(stat => {
            if (stat._id && stats.hasOwnProperty(stat._id)) {
                stats[stat._id] = stat.count;
            }
        });

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
                    traiteePar: 'admin', // TODO: récupérer l'ID de l'admin connecté
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

        // Préparer les données pour l'envoi de notification
        const notificationData = {
            destinataire: demande.whatsapp || demande.telephone,
            nom: type === 'livreur' ? `${demande.nom} ${demande.prenom}` : demande.nom,
            type: type,
            code: codeAutorisation
        };

        console.log(`✅ Demande ${demandeId} approuvée avec le code ${codeAutorisation}`);

        return createResponse(200, {
            success: true,
            message: 'Demande approuvée avec succès',
            codeAutorisation: codeAutorisation,
            demandeId: demandeId,
            type: type,
            notification: notificationData
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
        const { demandeId, type, motif } = data;

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

        // Préparer les données pour l'envoi de notification
        const notificationData = {
            destinataire: demande.whatsapp || demande.telephone,
            nom: type === 'livreur' ? `${demande.nom} ${demande.prenom}` : demande.nom,
            type: type,
            motif: motif
        };

        console.log(`✅ Demande ${demandeId} rejetée`);

        return createResponse(200, {
            success: true,
            message: 'Demande rejetée avec succès',
            demandeId: demandeId,
            type: type,
            motif: motif,
            notification: notificationData
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

        // Créer la notification
        const notification = {
            demandeId: demandeId,
            type: type,
            destinataire: demande.whatsapp || demande.telephone,
            nom: type === 'livreur' ? `${demande.nom} ${demande.prenom}` : demande.nom,
            message: message || genererMessageNotification(demande, type),
            statut: 'en_attente',
            dateCreation: new Date(),
            tentatives: 0,
            maxTentatives: 3
        };


        // TODO: Intégrer ici un service réel de WhatsApp/SMS
        // Exemples: Twilio, Africa's Talking, WhatsApp Business API

        return createResponse(200, {
            success: true,
            message: 'Notification programmée avec succès',
            notificationId: notificationResult.insertedId,
            destinataire: notification.destinataire,
            contenu: notification.message
        });

    } catch (error) {
        console.error('❌ Erreur envoyerNotification:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de l\'envoi de la notification'
        });
    }
}

// ===== GESTION DES DEMANDES DE RESTAURANTS =====

async function getDemandesRestaurants(db, data) {
    try {
        console.log('📋 Récupération des demandes de restaurants');

        const { 
            statut = 'en_attente', 
            limit = 50, 
            offset = 0, 
            search = '',
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
                { cuisine: searchRegex },
                { responsableNom: searchRegex }
            ];
        }

        // Tri
        const sortQuery = {};
        sortQuery[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Exécution des requêtes
        const [demandes, totalCount] = await Promise.all([
            db.collection('demande_restau')
                .find(query)
                .sort(sortQuery)
                .skip(offset)
                .limit(Math.min(limit, 100))
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
            finalisee: 0,
            total: totalCount
        };

        statsStatut.forEach(stat => {
            if (stat._id && stats.hasOwnProperty(stat._id)) {
                stats[stat._id] = stat.count;
            }
        });

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

// ===== GESTION DES COLLECTIONS =====

async function getCollectionData(db, data) {
    try {
        const { 
            collection, 
            limit = 50, 
            offset = 0, 
            search = '', 
            filters = {},
            sortBy = 'createdAt',
            sortOrder = 'desc' 
        } = data;

        console.log(`📋 Récupération collection: ${collection}`);

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
                'Restau': ['nom', 'adresse', 'telephone', 'cuisine', 'restaurantId'],
                'Colis': ['sender', 'recipient', 'colisID', 'status'],
                'Livraison': ['livreur', 'status', 'destination'],
                'LivraisonsEffectuees': ['livreur', 'destination', 'status'],
                'Commandes': ['customerName', 'orderID', 'status', 'restaurant']
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
        const sortQuery = {};
        sortQuery[sortBy] = sortOrder === 'asc' ? 1 : -1;

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
            pagination: {
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalCount / limit),
                hasMore: offset + documents.length < totalCount,
                itemsPerPage: limit
            },
            collection,
            filters: { search, ...filters, sortBy, sortOrder }
        });

    } catch (error) {
        console.error('❌ Erreur getCollectionData:', error);
        return createResponse(500, {
            success: false,
            message: `Erreur lors du chargement de la collection ${data.collection}`
        });
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

        const result = await db.collection(collection).deleteOne({
            _id: new ObjectId(itemId)
        });

        if (result.deletedCount === 1) {
            clearCache();
            
            console.log(`✅ Élément ${itemId} supprimé de ${collection}`);
            return createResponse(200, {
                success: true,
                message: 'Élément supprimé avec succès'
            });
        } else {
            return createResponse(404, {
                success: false,
                message: 'Élément non trouvé'
            });
        }

    } catch (error) {
        console.error('❌ Erreur deleteCollectionItem:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la suppression'
        });
    }
}

// ===== ANALYSES =====

async function getAnalytics(db, data) {
    try {
        const { type = 'general', timeRange = '7d', collection } = data;

        console.log(`📊 Génération d'analyses: ${type} (${timeRange})`);

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
            case '90d':
                startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%U";
                break;
            default:
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                groupFormat = "%Y-%m-%d";
        }

        let analytics = {};

        if (type === 'general') {
            // Analyses générales
            analytics = await getGeneralAnalytics(db, startDate, groupFormat);
        } else if (type === 'demandes') {
            // Analyses des demandes
            analytics = await getDemandesAnalytics(db, startDate, groupFormat);
        } else if (type === 'collection' && collection) {
            // Analyses d'une collection spécifique
            analytics = await getCollectionAnalytics(db, collection, startDate, groupFormat);
        }

        console.log(`✅ Analyses ${type} générées`);

        return createResponse(200, {
            success: true,
            type,
            timeRange,
            collection,
            analytics,
            period: {
                start: startDate.toISOString(),
                end: now.toISOString()
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

async function getGeneralAnalytics(db, startDate, groupFormat) {
    // Analyses générales du système
    const [
        evolutionColis,
        evolutionLivraisons,
        evolutionDemandes,
        topQuartiers,
        performanceLivreurs
    ] = await Promise.all([
        // Évolution des colis
        db.collection('Colis').aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: groupFormat, date: "$createdAt" } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id": 1 } }
        ]).toArray(),
        
        // Évolution des livraisons
        db.collection('Livraison').aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: groupFormat, date: "$createdAt" } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id": 1 } }
        ]).toArray(),
        
        // Évolution des demandes
        db.collection('demande_livreur').aggregate([
            { $match: { dateCreation: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: groupFormat, date: "$dateCreation" } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id": 1 } }
        ]).toArray(),
        
        // Top quartiers
        db.collection('Res_livreur').aggregate([
            { $group: { _id: '$quartier', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray(),
        
        // Performance des livreurs
        db.collection('LivraisonsEffectuees').aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: { _id: '$livreur', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray()
    ]);

    return {
        evolutionColis,
        evolutionLivraisons,
        evolutionDemandes,
        topQuartiers,
        performanceLivreurs
    };
}

async function getDemandesAnalytics(db, startDate, groupFormat) {
    // Analyses spécifiques aux demandes
    const [
        evolutionDemandesLivreurs,
        evolutionDemandesRestaurants,
        tempsTraitement,
        tauxApprobation
    ] = await Promise.all([
        // Évolution demandes livreurs
        db.collection('demande_livreur').aggregate([
            { $match: { dateCreation: { $gte: startDate } } },
            {
                $group: {
                    _id: { 
                        date: { $dateToString: { format: groupFormat, date: "$dateCreation" } },
                        statut: '$statut'
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.date": 1 } }
        ]).toArray(),
        
        // Évolution demandes restaurants
        db.collection('demande_restau').aggregate([
            { $match: { dateCreation: { $gte: startDate } } },
            {
                $group: {
                    _id: { 
                        date: { $dateToString: { format: groupFormat, date: "$dateCreation" } },
                        statut: '$statut'
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.date": 1 } }
        ]).toArray(),
        
        // Temps de traitement moyen
        db.collection('demande_livreur').aggregate([
            { 
                $match: { 
                    dateCreation: { $gte: startDate },
                    dateTraitement: { $exists: true }
                }
            },
            {
                $project: {
                    tempsTraitement: {
                        $divide: [
                            { $subtract: ['$dateTraitement', '$dateCreation'] },
                            1000 * 60 * 60 // Convertir en heures
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    tempsTraitementMoyen: { $avg: '$tempsTraitement' },
                    tempsTraitementMin: { $min: '$tempsTraitement' },
                    tempsTraitementMax: { $max: '$tempsTraitement' }
                }
            }
        ]).toArray(),
        
        // Taux d'approbation
        db.collection('demande_livreur').aggregate([
            { $match: { dateCreation: { $gte: startDate } } },
            {
                $group: {
                    _id: '$statut',
                    count: { $sum: 1 }
                }
            }
        ]).toArray()
    ]);

    return {
        evolutionDemandesLivreurs,
        evolutionDemandesRestaurants,
        tempsTraitement: tempsTraitement[0] || {},
        tauxApprobation
    };
}

async function getCollectionAnalytics(db, collection, startDate, groupFormat) {
    // Analyses d'une collection spécifique
    const dateField = collection.includes('demande') ? 'dateCreation' : 'createdAt';
    
    const [
        evolution,
        distribution,
        statistiques
    ] = await Promise.all([
        // Évolution temporelle
        db.collection(collection).aggregate([
            { $match: { [dateField]: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: groupFormat, date: `$${dateField}` } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id": 1 } }
        ]).toArray(),
        
        // Distribution par statut
        db.collection(collection).aggregate([
            {
                $group: {
                    _id: '$statut',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]).toArray(),
        
        // Statistiques de base
        db.collection(collection).aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    recent: {
                        $sum: {
                            $cond: [
                                { $gte: [`$${dateField}`, startDate] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]).toArray()
    ]);

    return {
        evolution,
        distribution,
        statistiques: statistiques[0] || { total: 0, recent: 0 }
    };
}

// ===== EXPORT =====

async function exportData(db, data) {
    try {
        const { type, format = 'json', filters = {} } = data;

        console.log(`📤 Export de données: ${type} (${format})`);

        let exportData = {};

        switch (type) {
            case 'demandes_livreurs':
                exportData = await exportDemandesLivreurs(db, filters);
                break;
            case 'demandes_restaurants':
                exportData = await exportDemandesRestaurants(db, filters);
                break;
            case 'stats_general':
                exportData = await exportStatsGeneral(db);
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

async function exportDemandesLivreurs(db, filters) {
    const query = {};
    
    if (filters.statut && filters.statut !== 'tous') {
        query.statut = filters.statut;
    }
    
    if (filters.dateDebut && filters.dateFin) {
        query.dateCreation = {
            $gte: new Date(filters.dateDebut),
            $lte: new Date(filters.dateFin)
        };
    }

    const demandes = await db.collection('demande_livreur')
        .find(query)
        .sort({ dateCreation: -1 })
        .toArray();

    return {
        type: 'demandes_livreurs',
        count: demandes.length,
        filters,
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
    const query = {};
    
    if (filters.statut && filters.statut !== 'tous') {
        query.statut = filters.statut;
    }
    
    if (filters.dateDebut && filters.dateFin) {
        query.dateCreation = {
            $gte: new Date(filters.dateDebut),
            $lte: new Date(filters.dateFin)
        };
    }

    const demandes = await db.collection('demande_restau')
        .find(query)
        .sort({ dateCreation: -1 })
        .toArray();

    return {
        type: 'demandes_restaurants',
        count: demandes.length,
        filters,
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

async function exportStatsGeneral(db) {
    const stats = await getStats(db);
    return {
        type: 'stats_general',
        generatedAt: new Date().toISOString(),
        data: stats
    };
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
        const existingInCollection = await db.collection(collectionExistante).findOne({
            codeAutorisation: newCode
        });
        
        // Vérifier dans les demandes
        const existingInDemandes = await db.collection(collectionDemande).findOne({
            codeAutorisation: newCode
        });
        
        if (!existingInCollection && !existingInDemandes) {
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
        return `🎉 Félicitations ${nom} ! Votre demande a été approuvée. Votre code d'autorisation est : ${code}. Finalisez votre inscription sur notre site avec ce code.`;
    } else if (demande.statut === 'rejetee') {
        return `❌ Bonjour ${nom}, nous regrettons de vous informer que votre demande a été rejetée. Motif : ${demande.motifRejet}. Vous pouvez soumettre une nouvelle demande après correction.`;
    }
    
    return `📋 Bonjour ${nom}, votre demande est en cours de traitement. Vous recevrez une notification dès qu'elle sera traitée.`;
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

function convertToCSV(data) {
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        return '';
    }
    
    const headers = Object.keys(data.data[0]);
    const csvHeaders = headers.join(',');
    
    const csvRows = data.data.map(row => {
        return headers.map(header => {
            const value = row[header];
            if (typeof value === 'string' && value.includes(',')) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        }).join(',');
    });
    
    return [csvHeaders, ...csvRows].join('\n');
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