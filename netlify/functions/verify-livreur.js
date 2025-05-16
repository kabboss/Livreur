const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority";
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Res_livreur';

const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000
});

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

exports.handler = async function(event, context) {
    // Gestion des requêtes OPTIONS pour CORS
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({})
        };
    }

    // Vérification de la méthode HTTP
    if (event.httpMethod !== "GET") {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: false,
                error: "Méthode non autorisée. Seules les requêtes GET sont acceptées."
            })
        };
    }

    try {
        // Récupération du code depuis les paramètres de requête
        const code = event.queryStringParameters?.code;
        
        if (!code) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    success: false,
                    error: "Le paramètre 'code' est requis dans la requête."
                })
            };
        }

        // Connexion à MongoDB
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // Recherche du livreur
        const livreur = await collection.findOne({ 
            id_livreur: code.trim().toUpperCase(),
            status: { $ne: "inactif" }
        });

        // Réponse selon si le livreur est trouvé ou non
        if (livreur) {
            return {
                statusCode: 200,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    success: true,
                    exists: true,
                    livreur: {
                        id: livreur._id,
                        id_livreur: livreur.id_livreur,
                        nom: livreur.nom,
                        prenom: livreur.prenom,
                        quartier: livreur.quartier,
                        status: livreur.status
                    }
                })
            };
        } else {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    success: true,
                    exists: false,
                    message: "Aucun livreur actif trouvé avec ce code."
                })
            };
        }
    } catch (err) {
        console.error("Erreur serveur:", err);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: false,
                error: "Erreur serveur lors de la vérification du livreur",
                details: process.env.NODE_ENV === 'development' ? err.message : undefined
            })
        };
    } finally {
        // Fermeture de la connexion MongoDB
        try {
            await client.close();
        } catch (closeErr) {
            console.error("Erreur lors de la fermeture de la connexion MongoDB:", closeErr);
        }
    }
};