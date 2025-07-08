const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = "mongodb+srv://votre_utilisateur:votre_motdepasse@votre_cluster.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = "SEND20";

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
                useNewUrlParser: true,
                useUnifiedTopology: true,
                connectTimeoutMS: 30000,
                serverSelectionTimeoutMS: 30000
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
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, message: 'Méthode non autorisée' })
        };
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
            // Gestion des demandes
            case 'getDemandesLivreurs':
                return await getDemandesLivreurs(db, body);
            
            case 'getDemandesRestaurants':
                return await getDemandesRestaurants(db, body);
            
            case 'approuverDemande':
                return await approuverDemande(db, body);
            
            case 'rejeterDemande':
                return await rejeterDemande(db, body);
            
            // Gestion des collections
            case 'getStats':
                return await getStats(db);
            
            case 'getData':
                return await getData(db, body);
            
            case 'deleteItem':
                return await deleteItem(db, body);
            
            case 'updateItem':
                return await updateItem(db, body);
            
            case 'createItem':
                return await createItem(db, body);
            
            default:
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ success: false, message: 'Action non supportée' })
                };
        }

    } catch (error) {
        console.error('💥 Erreur serveur:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                success: false, 
                message: 'Erreur interne du serveur',
                error: error.message
            })
        };
    }
};

// ===== FONCTIONS POUR GESTION DES DEMANDES =====

async function getDemandesLivreurs(db, data) {
    try {
        const { statut, limit = 50, offset = 0, search = '' } = data;

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
                { quartier: searchRegex }
            ];
        }

        // Récupérer les demandes avec pagination
        const demandes = await db.collection('demande_livreur')
            .find(query)
            .sort({ dateCreation: -1 })
            .skip(offset)
            .limit(limit)
            .toArray();

        // Compter le total
        const totalCount = await db.collection('demande_livreur').countDocuments(query);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                data: demandes,
                totalCount,
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalCount / limit)
            })
        };

    } catch (error) {
        console.error('❌ Erreur getDemandesLivreurs:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: 'Erreur lors de la récupération des demandes de livreurs'
            })
        };
    }
}

async function getDemandesRestaurants(db, data) {
    try {
        const { statut, limit = 50, offset = 0, search = '' } = data;

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
                { adresse: searchRegex }
            ];
        }

        // Récupérer les demandes avec pagination
        const demandes = await db.collection('demande_restau')
            .find(query)
            .sort({ dateCreation: -1 })
            .skip(offset)
            .limit(limit)
            .toArray();

        // Compter le total
        const totalCount = await db.collection('demande_restau').countDocuments(query);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                data: demandes,
                totalCount,
                currentPage: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(totalCount / limit)
            })
        };

    } catch (error) {
        console.error('❌ Erreur getDemandesRestaurants:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: 'Erreur lors de la récupération des demandes de restaurants'
            })
        };
    }
}

async function approuverDemande(db, data) {
    try {
        const { demandeId, type } = data;

        if (!demandeId || !type) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    message: 'ID de demande et type requis'
                })
            };
        }

        const collectionName = type === 'livreur' ? 'demande_livreur' : 'demande_restau';
        
        // Mettre à jour la demande
        const updateResult = await db.collection(collectionName).updateOne(
            { _id: new ObjectId(demandeId) },
            {
                $set: {
                    statut: 'approuvee',
                    dateTraitement: new Date(),
                    updatedAt: new Date()
                }
            }
        );

        if (updateResult.matchedCount === 0) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    message: 'Demande non trouvée'
                })
            };
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: 'Demande approuvée avec succès'
            })
        };

    } catch (error) {
        console.error('❌ Erreur approuverDemande:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: 'Erreur lors de l\'approbation de la demande'
            })
        };
    }
}

async function rejeterDemande(db, data) {
    try {
        const { demandeId, type, motif } = data;

        if (!demandeId || !type || !motif) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    message: 'ID de demande, type et motif requis'
                })
            };
        }

        const collectionName = type === 'livreur' ? 'demande_livreur' : 'demande_restau';
        
        // Mettre à jour la demande
        const updateResult = await db.collection(collectionName).updateOne(
            { _id: new ObjectId(demandeId) },
            {
                $set: {
                    statut: 'rejetee',
                    dateTraitement: new Date(),
                    motifRejet: motif,
                    updatedAt: new Date()
                }
            }
        );

        if (updateResult.matchedCount === 0) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    message: 'Demande non trouvée'
                })
            };
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: 'Demande rejetée'
            })
        };

    } catch (error) {
        console.error('❌ Erreur rejeterDemande:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: 'Erreur lors du rejet de la demande'
            })
        };
    }
}

// ===== FONCTIONS POUR GESTION DES COLLECTIONS =====

async function getStats(db) {
    try {
        // Récupérer les statistiques de toutes les collections
        const [colis, livraison, livrees, livreurs, restaurants, commandes] = await Promise.all([
            db.collection('Colis').countDocuments(),
            db.collection('Livraison').countDocuments(),
            db.collection('LivraisonsEffectuees').countDocuments(),
            db.collection('Res_livreur').countDocuments(),
            db.collection('Restau').countDocuments(),
            db.collection('Commandes').countDocuments()
        ]);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                collections: {
                    colis,
                    livraison,
                    livrees,
                    livreurs,
                    restaurants,
                    commandes
                }
            })
        };

    } catch (error) {
        console.error('❌ Erreur getStats:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: 'Erreur lors du chargement des statistiques'
            })
        };
    }
}

async function getData(db, data) {
    try {
        const { collection, limit = 100, offset = 0, search = '' } = data;

        if (!collection) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    message: 'Nom de collection requis'
                })
            };
        }

        // Construire la requête
        let query = {};

        if (search && search.trim()) {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = [
                { nom: searchRegex },
                { name: searchRegex },
                { title: searchRegex }
            ];
        }

        // Exécuter la requête
        const [documents, totalCount] = await Promise.all([
            db.collection(collection)
                .find(query)
                .skip(offset)
                .limit(limit)
                .toArray(),
            db.collection(collection).countDocuments(query)
        ]);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                data: documents,
                totalCount,
                count: documents.length,
                offset,
                limit,
                hasMore: offset + documents.length < totalCount
            })
        };

    } catch (error) {
        console.error('❌ Erreur getData:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: `Erreur lors du chargement de la collection ${data.collection}`
            })
        };
    }
}

async function deleteItem(db, data) {
    try {
        const { collection, itemId } = data;

        if (!collection || !itemId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    message: 'Collection et ID d\'élément requis'
                })
            };
        }

        const result = await db.collection(collection).deleteOne({
            _id: new ObjectId(itemId)
        });

        if (result.deletedCount === 1) {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                })
            };
        } else {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    message: 'Élément non trouvé'
                })
            };
        }

    } catch (error) {
        console.error('❌ Erreur deleteItem:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: 'Erreur lors de la suppression'
            })
        };
    }
}

async function updateItem(db, data) {
    try {
        const { collection, itemId, updates } = data;

        if (!collection || !itemId || !updates) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    message: 'Collection, ID et données de mise à jour requis'
                })
            };
        }

        // Ajouter la date de modification
        updates.updatedAt = new Date();

        const result = await db.collection(collection).updateOne(
            { _id: new ObjectId(itemId) },
            { $set: updates }
        );

        if (result.matchedCount === 1) {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                })
            };
        } else {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    message: 'Élément non trouvé'
                })
            };
        }

    } catch (error) {
        console.error('❌ Erreur updateItem:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: 'Erreur lors de la mise à jour'
            })
        };
    }
}

async function createItem(db, data) {
    try {
        const { collection, itemData } = data;

        if (!collection || !itemData) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    message: 'Collection et données requises'
                })
            };
        }

        // Ajouter les dates de création
        itemData.createdAt = new Date();
        itemData.updatedAt = new Date();

        const result = await db.collection(collection).insertOne(itemData);

        return {
            statusCode: 201,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                insertedId: result.insertedId
            })
        };

    } catch (error) {
        console.error('❌ Erreur createItem:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                message: 'Erreur lors de la création'
            })
        };
    }
}