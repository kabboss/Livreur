const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function(event, context) {
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

        // Vérifier si la commande existe
        const order = await db.collection('commandes').findOne({ codeID: data.codeID });
        if (!order) {
            return {
                statusCode: 404,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Commande non trouvée' 
                }),
            };
        }

        // Vérifier si la commande est déjà acceptée
        const existingDelivery = await db.collection('cour_expedition').findOne({ codeID: data.codeID });
        if (existingDelivery) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Cette commande a déjà été acceptée par un livreur' 
                }),
            };
        }

        // Enregistrer dans cour_expedition
        const deliveryData = {
            codeID: data.codeID,
            livreurId: data.livreurId,
            livreurNom: data.livreurNom,
            livreurTel: data.livreurTel,
            positionActuelle: {
                latitude: parseFloat(data.latitude),
                longitude: parseFloat(data.longitude),
                updatedAt: new Date()
            },
            statut: 'en_cours',
            dateAcceptation: new Date(),
            commandeDetails: order
        };

        await db.collection('cour_expedition').insertOne(deliveryData);

        // Mettre à jour la commande
        await db.collection('commandes').updateOne(
            { codeID: data.codeID },
            { $set: { 
                statut: 'en_cours',
                idLivreurEnCharge: data.livreurId,
                nomLivreur: data.livreurNom
            } }
        );

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
                success: true, 
                message: 'Livraison acceptée avec succès' 
            }),
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
                success: false, 
                message: 'Erreur serveur' 
            }),
        };
    } finally {
        await client.close();
    }
};