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
                    message: 'Vous n\'êtes pas autorisé à terminer cette livraison' 
                }),
            };
        }

        // Récupérer les infos complètes de la commande
        const commande = await db.collection('commandes').findOne({ codeID: data.codeID });
        
        if (!commande) {
            return {
                statusCode: 404,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ 
                    success: false, 
                    message: 'Commande non trouvée' 
                }),
            };
        }

        // Enregistrer dans LivraisonsEffectuees
        await db.collection('LivraisonsEffectuees').insertOne({
            ...commande,
            livreurId: data.livreurId,
            livreurNom: delivery.livreurNom,
            dateLivraisonReelle: new Date(),
            statut: 'livree',
            commentaires: data.commentaires || ''
        });

        // Supprimer des collections courantes
        await db.collection('cour_expedition').deleteOne({ codeID: data.codeID });
        await db.collection('commandes').deleteOne({ codeID: data.codeID });

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ success: true, message: 'Livraison terminée avec succès' }),
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