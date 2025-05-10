const { MongoClient } = require('mongodb');

exports.handler = async (event, context) => {
    // Configurer les headers CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Répondre immédiatement aux requêtes OPTIONS (prévol)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({})
        };
    }

    try {
        // Vérifier la méthode HTTP
        if (event.httpMethod !== 'POST') {
            return {
                statusCode: 405,
                headers,
                body: JSON.stringify({ success: false, message: 'Méthode non autorisée' })
            };
        }

        const data = JSON.parse(event.body);
        
        const client = await MongoClient.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            connectTimeoutMS: 5000,
            socketTimeoutMS: 30000
        });
        
        const db = client.db('FarmsConnect');
        
        // Vérifier si le livreur existe déjà
        const existingLivreur = await db.collection('Res_livreur').findOne({
            $or: [
                { whatsapp: data.whatsapp },
                { id_livreur: data.id_livreur }
            ]
        });
        
        if (existingLivreur) {
            await client.close();
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Un livreur avec ce numéro ou ID existe déjà' 
                })
            };
        }
        
        // Insérer le nouveau livreur
        const result = await db.collection('Res_livreur').insertOne(data);
        
        await client.close();
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true, 
                id: result.insertedId 
            })
        };
    } catch (error) {
        console.error('Erreur:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                success: false, 
                message: 'Erreur serveur',
                error: error.message 
            })
        };
    }
};