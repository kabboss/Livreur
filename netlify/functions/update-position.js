const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function(event, context) {
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            },
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    try {
        await client.connect();
        const db = client.db(dbName);
        const data = JSON.parse(event.body);

        // Vérifier que le livreur est bien celui en charge
        const delivery = await db.collection('cour_expedition').findOne({ 
            codeID: data.codeID,
            livreurId: data.livreurId
        });

        if (!delivery) {
            return {
                statusCode: 403,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Vous n\'êtes pas autorisé à mettre à jour cette livraison' 
                }),
            };
        }

        // Mettre à jour la position dans cour_expedition
        await db.collection('cour_expedition').updateOne(
            { codeID: data.codeID },
            { $set: { 
                'positionActuelle': {
                    latitude: parseFloat(data.latitude),
                    longitude: parseFloat(data.longitude),
                    updatedAt: new Date()
                }
            } }
        );

        // Enregistrer également dans cour_livraison pour le suivi historique
        await db.collection('cour_livraison').insertOne({
            codeID: data.codeID,
            livreurId: data.livreurId,
            position: {
                latitude: parseFloat(data.latitude),
                longitude: parseFloat(data.longitude)
            },
            datePosition: new Date(),
            statut: 'en_route'
        });

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ success: true, message: 'Position mise à jour avec succès' }),
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ success: false, message: 'Erreur serveur' }),
        };
    } finally {
        await client.close();
    }
};