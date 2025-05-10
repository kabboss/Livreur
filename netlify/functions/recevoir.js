const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';
const client = new MongoClient(uri);

exports.handler = async function(event, context) {
    // Gestion CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Méthode non autorisée.' }),
            headers: { 'Access-Control-Allow-Origin': '*' },
        };
    }

    const { codeID, clientLocation } = JSON.parse(event.body);

    try {
        await client.connect();
        const db = client.db(dbName);
        const colisCollection = db.collection('Colis');
        const clientCollection = db.collection('infoclient');
        const livraisonCollection = db.collection('Livraison');

        // Vérification si la livraison existe déjà
        const livraisonExistante = await livraisonCollection.findOne({ codeID });
        if (livraisonExistante) {
            return {
                statusCode: 400,
                body: JSON.stringify({ 
                    error: 'Ce colis a déjà été enregistré comme reçu.',
                    livraison: livraisonExistante 
                }),
                headers: { 'Access-Control-Allow-Origin': '*' },
            };
        }

        // Récupération des informations
        const colis = await colisCollection.findOne({ colisID: codeID });
        if (!colis) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Colis introuvable.' }),
                headers: { 'Access-Control-Allow-Origin': '*' },
            };
        }

        const clientInfo = await clientCollection.findOne({ code: codeID });
        if (!clientInfo) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Client introuvable.' }),
                headers: { 'Access-Control-Allow-Origin': '*' },
            };
        }

        // Préparation des données avec statut "livré"
        const livraisonData = {
            codeID,
            dateLivraison: new Date(),
            statut: 'En cour de livraison', // Changement de statut
            dateReception: new Date(), // Ajout de la date de réception
            localisationReception: clientLocation, // Ajout de la localisation du client
            colis: {
                type: colis.type,
                details: colis.details || '',
                photos: colis.photos || [],
                createdAt: colis.createdAt || null,
            },
            expediteur: {
                nom: colis.sender,
                telephone: colis.phone1,
                localisation: colis.location || null,
            },
            destinataire: {
                nom: clientInfo.nom,
                prenom: clientInfo.prenom,
                telephone: clientInfo.numero,
                adresse: colis.address,
                localisation: clientInfo.localisation || null,
            }
        };

        // Enregistrement avec transaction pour plus de sécurité
        const session = client.startSession();
        try {
            await session.withTransaction(async () => {
                // 1. Enregistrer la livraison
                await livraisonCollection.insertOne(livraisonData, { session });
                
                // 2. Mettre à jour le statut du colis (optionnel)
                await colisCollection.updateOne(
                    { colisID: codeID },
                    { $set: { status: 'livré', dateLivraison: new Date() } },
                    { session }
                );
            });
        } finally {
            await session.endSession();
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: '✅ Colis enregistré comme reçu avec succès !',
                livraison: livraisonData,
            }),
            headers: { 'Access-Control-Allow-Origin': '*' },
        };

    } catch (error) {
        console.error('Erreur Livraison:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Erreur serveur lors de l\'enregistrement.',
                details: error.message 
            }),
            headers: { 'Access-Control-Allow-Origin': '*' },
        };
    } finally {
        await client.close();
    }
};