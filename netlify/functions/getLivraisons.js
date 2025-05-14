const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';
const livraisonCollectionName = 'Livraison';
const expeditionCollectionName = 'cour_expedition';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers,
            body: ''
        };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ 
                error: 'Méthode non autorisée',
                message: 'Seules les requêtes GET sont acceptées'
            })
        };
    }

    // Récupération des paramètres de pagination
    const queryParams = event.queryStringParameters || {};
    const page = parseInt(queryParams.page) || 1;
    let limit = parseInt(queryParams.limit) || DEFAULT_LIMIT;
    
    // Limiter le nombre maximum de résultats par page
    limit = Math.min(limit, MAX_LIMIT);
    const skip = (page - 1) * limit;

    const client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 30000
    });

    try {
        await client.connect();
        const db = client.db(dbName);

        // Requêtes en parallèle pour meilleure performance
        const [livraisons, expeditions, totalCount] = await Promise.all([
            db.collection(livraisonCollectionName)
                .find({})
                .skip(skip)
                .limit(limit)
                .project({
                    codeID: 1,
                    colis: 1,
                    expediteur: 1,
                    destinataire: 1,
                    statut: 1,
                    dateLivraison: 1
                })
                .toArray(),
            
            db.collection(expeditionCollectionName)
                .find({})
                .project({
                    codeID: 1,
                    idLivreur: 1,
                    nomLivreur: 1,
                    statut: 1,
                    dateDebut: 1,
                    estExpedie: 1
                })
                .toArray(),
            
            db.collection(livraisonCollectionName)
                .countDocuments({})
        ]);

        if (!livraisons || !expeditions) {
            throw new Error('Données introuvables dans la base de données');
        }

        const expeditionsMap = new Map(
            expeditions.map(exp => [
                exp.codeID, 
                {
                    idLivreur: exp.idLivreur,
                    nomLivreur: exp.nomLivreur,
                    statut: exp.statut || 'En cours',
                    dateDebut: exp.dateDebut,
                    estExpedie: exp.estExpedie || false
                }
            ])
        );

        const formattedData = livraisons.map(livraison => {
            const expedition = expeditionsMap.get(livraison.codeID) || {};
            
            return {
                codeID: livraison.codeID,
                colis: {
                    type: livraison.colis?.type || 'Non spécifié',
                    details: livraison.colis?.details || 'Aucun détail',
                    photos: livraison.colis?.photos || []
                },
                expediteur: {
                    nom: livraison.expediteur?.nom || 'Non spécifié',
                    telephone: livraison.expediteur?.telephone || '',
                    localisation: livraison.expediteur?.localisation || null
                },
                destinataire: {
                    nom: livraison.destinataire?.nom || 'Non spécifié',
                    prenom: livraison.destinataire?.prenom || '',
                    telephone: livraison.destinataire?.telephone || '',
                    adresse: livraison.destinataire?.adresse || '',
                    localisation: livraison.destinataire?.localisation || null
                },
                statut: expedition.statut || livraison.statut || 'En attente',
                dateLivraison: livraison.dateLivraison,
                dateDebutExpedition: expedition.dateDebut,
                estExpedie: expedition.estExpedie || expeditionsMap.has(livraison.codeID),
                idLivreurEnCharge: expedition.idLivreur,
                nomLivreur: expedition.nomLivreur || 'Non spécifié'
            };
        });

        // Métadonnées de pagination
        const pagination = {
            total: totalCount,
            page,
            limit,
            totalPages: Math.ceil(totalCount / limit),
            hasNextPage: page * limit < totalCount,
            hasPrevPage: page > 1
        };

        headers['Cache-Control'] = 'public, max-age=300, must-revalidate';

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                data: formattedData,
                pagination
            })
        };

    } catch (error) {
        console.error('Erreur MongoDB:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Erreur serveur',
                message: 'Impossible de récupérer les livraisons',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    } finally {
        await client.close().catch(err => console.error('Erreur fermeture connexion:', err));
    }
};