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
        const data = JSON.parse(event.body);
        
        if (!data.id_livreur || !data.nom || !data.prenom || !data.whatsapp) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Données requises manquantes' 
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
                id: result.insertedId,
                message: 'Livreur ajouté avec succès'
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