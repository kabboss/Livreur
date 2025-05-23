const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    const client = new MongoClient(uri, {
        connectTimeoutMS: 5000,
        socketTimeoutMS: 30000
    });

    try {
        await client.connect();
        const db = client.db(dbName);

        // Récupération des données avec filtrage des livraisons non terminées
        const [livraisons, expeditions] = await Promise.all([
            db.collection('Livraison').find({ 
                statut: { $ne: 'livrée' } 
            }).sort({ dateDebutExpedition: -1 }).toArray(),
            db.collection('cour_expedition').find({}).toArray()
        ]);

        // Formatage des données
        const data = livraisons.map(livraison => {
            const expedition = expeditions.find(e => e.codeID === livraison.codeID) || {};
            return {
                ...livraison,
                statut: expedition.statut || livraison.statut,
                idLivreur: expedition.idLivreur,
                nomLivreur: expedition.nomLivreur
            };
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ data })
        };

    } catch (error) {
        console.error('Erreur:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to fetch delivery data',
                details: error.message 
            })
        };
    } finally {
        await client.close();
    }
};