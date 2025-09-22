const { MongoClient } = require('mongodb');

// Assurez-vous que COMMON_HEADERS est défini globalement dans ce fichier de fonction
const COMMON_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // Autorise toutes les origines
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

exports.handler = async (event) => {
    // Gère les requêtes OPTIONS (pré-vol CORS)
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: COMMON_HEADERS };
    }

    let client; // Déclarez client ici pour qu'il soit accessible dans finally
    try {
        client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
        await client.connect(); // Tente de se connecter à MongoDB
        
        const db = client.db(DB_NAME);
        const orders = await db.collection('Livraison')
            .find({ 
                statut: { $in: ['En attente', 'En cours'] },
                // Vérifie si livreur.idLivreur n'existe pas OU correspond à driverId
                $or: [
                    { 'livreur.idLivreur': { $exists: false } },
                    { 'livreur.idLivreur': event.queryStringParameters?.driverId || '' }
                ]
            })
            .toArray();

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify(orders)
        };
    } catch (error) {
        console.error("Erreur dans getPackageOrders:", error); // Très important pour le débogage sur Netlify
        return {
            statusCode: 500, // Utilisez 500 pour les erreurs internes
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message || "Erreur interne du serveur lors de la récupération des commandes." })
        };
    } finally {
        if (client) {
            await client.close(); // Ferme la connexion MongoDB
        }
    }
};