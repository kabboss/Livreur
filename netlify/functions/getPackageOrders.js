const { MongoClient } = require('mongodb');

// Définissez vos en-têtes CORS pour autoriser toutes les origines
const COMMON_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // Autorise toutes les origines
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', // Autorise les méthodes HTTP
    'Access-Control-Allow-Headers': 'Content-Type, Authorization' // Autorise les en-têtes spécifiques
};

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

exports.handler = async (event) => {
    // Gère les requêtes OPTIONS (pré-vol CORS)
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: COMMON_HEADERS };
    }

    try {
        const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
        await client.connect();
        
        const db = client.db(DB_NAME);
        const orders = await db.collection('Livraison')
            .find({ 
                statut: { $in: ['En attente', 'En cours'] },
                $or: [
                    { 'livreur.idLivreur': { $exists: false } },
                    { 'livreur.idLivreur': event.queryStringParameters?.driverId || '' }
                ]
            })
            .toArray();

        return {
            statusCode: 200,
            headers: COMMON_HEADERS, // Utilisez les en-têtes communs ici
            body: JSON.stringify(orders)
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: COMMON_HEADERS, // Utilisez les en-têtes communs ici
            body: JSON.stringify({ error: error.message })
        };
    } finally {
        // Assurez-vous de fermer la connexion à la base de données
        if (client) {
            await client.close();
        }
    }
};