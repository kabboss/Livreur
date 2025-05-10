const { MongoClient } = require('mongodb');

exports.handler = async (event, context) => {
    // Configurer les headers CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Répondre aux requêtes OPTIONS (prévol)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({})
        };
    }

    // Vérifier la méthode HTTP
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Méthode non autorisée' 
            })
        };
    }

    try {
        const { collection } = JSON.parse(event.body);
        
        if (!collection) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Nom de collection manquant' 
                })
            };
        }

        const client = new MongoClient(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            connectTimeoutMS: 5000,
            serverSelectionTimeoutMS: 5000
        });

        await client.connect();
        const db = client.db('FarmsConnect');
        
        // Supprimer tous les documents de la collection
        const result = await db.collection(collection).deleteMany({});
        await client.close();
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true, 
                deletedCount: result.deletedCount,
                message: `${result.deletedCount} documents supprimés de ${collection}`
            })
        };
    } catch (error) {
        console.error('Erreur MongoDB:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Erreur serveur',
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    }
};