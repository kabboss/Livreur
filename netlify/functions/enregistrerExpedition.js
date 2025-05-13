const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function(event, context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Méthode non autorisée' })
        };
    }

    const client = new MongoClient(uri, { 
        useNewUrlParser: true, 
        useUnifiedTopology: true 
    });

    try {
        await client.connect();
        const db = client.db(dbName);
        const expeditionCollection = db.collection('cour_expedition');

        if (!event.body) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Le corps de la requête est vide' })
            };
        }

        const { 
            codeID, 
            localisationLivreur, 
            telephoneLivreur1, 
            telephoneLivreur2, 
            idLivreur,
            nomLivreur, // Ajout de ce champ
            distanceExpediteur, 
            distanceDestinataire, 
            distanceExpediteurDestinataire, 
            prixLivraison 
        } = JSON.parse(event.body);

        // Validation des données requises (ajout de nomLivreur)
        if (!codeID || !localisationLivreur || !telephoneLivreur1 || !idLivreur || !nomLivreur) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Données requises manquantes',
                    required: ['codeID', 'localisationLivreur', 'telephoneLivreur1', 'idLivreur', 'nomLivreur']
                })
            };
        }

        // Document d'expédition complet
        const expeditionDoc = {
            codeID: codeID,
            localisationLivreur: localisationLivreur,
            telephoneLivreur1: telephoneLivreur1,
            telephoneLivreur2: telephoneLivreur2 || null,
            idLivreur: idLivreur,
            nomLivreur: nomLivreur, // Champ ajouté
            dateDebut: new Date(),
            statut: 'En cours',
            estExpedie: true, // Champ ajouté pour indiquer que le colis est pris en charge
            distanceExpediteur: distanceExpediteur || null,
            distanceDestinataire: distanceDestinataire || null,
            distanceExpediteurDestinataire: distanceExpediteurDestinataire || null,
            prixLivraison: prixLivraison || null,
            historique: [{
                date: new Date(),
                statut: 'En cours',
                localisation: localisationLivreur,
                action: 'Prise en charge',
                livreur: {
                    id: idLivreur,
                    nom: nomLivreur
                }
            }]
        };

        const expeditionResult = await expeditionCollection.insertOne(expeditionDoc);

        if (!expeditionResult.acknowledged) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Erreur lors de l\'enregistrement de l\'expédition' })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                message: 'Expédition enregistrée avec succès',
                expeditionId: expeditionResult.insertedId,
                estExpedie: true // Confirmation pour le frontend
            })
        };

    } catch (error) {
        console.error('Erreur:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Erreur serveur',
                details: error.message 
            })
        };
    } finally {
        await client.close();
    }
};