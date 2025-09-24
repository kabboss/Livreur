const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Commandes';

const getCorsHeaders = (origin) => {
    const allowedOrigins = [
        'https://send20.netlify.app',
        'http://localhost:3000',
        'http://localhost:8000',
        'http://127.0.0.1:8000'
    ];
    
    const allowedOrigin = allowedOrigins.includes(origin) ? origin : '*';
    
    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, Origin",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
};

exports.handler = async (event) => {
    const origin = event.headers.origin || event.headers.Origin || '';
    const corsHeaders = getCorsHeaders(origin);

    // Réponse immédiate pour les requêtes OPTIONS (preflight)
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ""
        };
    }

    // Vérifier que c'est une requête POST
    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: "Méthode non autorisée. Utilisez POST." 
            })
        };
    }

    const client = new MongoClient(MONGODB_URI);

    try {
        // Parser le corps de la requête
        let body;
        try {
            body = JSON.parse(event.body || "{}");
        } catch (error) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: "JSON invalide dans le corps de la requête" 
                })
            };
        }

        const { orderId, newStatus } = body;

        // Validation des champs requis
        if (!orderId || !newStatus) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: "Les champs 'orderId' et 'newStatus' sont requis" 
                })
            };
        }

        // Validation du format de l'ID
        if (!ObjectId.isValid(orderId)) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: "ID de commande invalide" 
                })
            };
        }

        // Connexion à la base de données
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // Mise à jour de la commande
        const result = await collection.updateOne(
            { _id: new ObjectId(orderId) },
            { 
                $set: { 
                    status: newStatus,
                    lastUpdate: new Date() 
                } 
            }
        );

        // Vérifier si la commande a été trouvée et mise à jour
        if (result.matchedCount === 0) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: "Commande non trouvée" 
                })
            };
        }

        // Réponse de succès
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                message: "Statut mis à jour avec succès",
                orderId: orderId,
                newStatus: newStatus,
                modifiedCount: result.modifiedCount
            })
        };

    } catch (error) {
        console.error("Erreur serveur:", error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: "Erreur interne du serveur",
                details: error.message
            })
        };
    } finally {
        await client.close();
    }
};