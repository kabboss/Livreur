const { MongoClient } = require('mongodb');

// Chaîne de connexion MongoDB en dur (à utiliser uniquement pour le développement)
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';

exports.handler = async (event, context) => {
    // Gestion des requêtes OPTIONS pour CORS
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*", // Autorise toutes les origines
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ expedition: expeditionInfo })
        };
    }
    // Vérification de la méthode HTTP
    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: "Méthode non autorisée" }),
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        };
    }

    let client;
    try {
        // Connexion à MongoDB avec la chaîne en dur
        client = new MongoClient(MONGODB_URI, { 
            useNewUrlParser: true, 
            useUnifiedTopology: true,
            connectTimeoutMS: 5000,
            socketTimeoutMS: 30000,
        });
        
        await client.connect();
        const db = client.db('FarmsConnect');
        const expeditionCollection = db.collection('cour_expedition');
        const livraisonCollection = db.collection('Livraison');

        // Vérification du corps de la requête
        if (!event.body) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Données de requête manquantes" }),
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
            };
        }

        const { codeID } = JSON.parse(event.body);

        // Validation du code de suivi
        if (!codeID || !/^[A-Z0-9]{8,20}$/.test(codeID)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Code de suivi invalide" }),
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
            };
        }

        // 1. Recherche dans les expéditions en cours
        const expeditionInfo = await expeditionCollection.findOne({ 
            codeID: codeID 
        }, {
            projection: {
                _id: 0,
                codeID: 1,
                idLivreur: 1,
                telephoneLivreur1: 1,
                telephoneLivreur2: 1,
                dateDebut: 1,
                localisationLivreur: 1,
                distanceExpediteur: 1,
                distanceDestinataire: 1,
                distanceExpediteurDestinataire: 1,
                prixLivraison: 1,
                status: 1
            }
        });

        if (expeditionInfo) {
            // Déterminer le statut si non spécifié
            if (!expeditionInfo.status) {
                expeditionInfo.status = expeditionInfo.dateDebut ? 'in-transit' : 'pending';
            }
            
            return {
                statusCode: 200,
                body: JSON.stringify({ expedition: expeditionInfo }),
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
            };
        }

        // 2. Recherche dans les livraisons enregistrées
        const colisEnregistre = await livraisonCollection.findOne({ 
            codeID: codeID 
        }, {
            projection: {
                _id: 0,
                codeID: 1
            }
        });

        if (colisEnregistre) {
            return {
                statusCode: 200,
                body: JSON.stringify({ 
                    message: "Votre colis est enregistré mais n'a pas encore commencé son expédition. Veuillez réessayer ultérieurement.",
                    status: "pending"
                }),
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                },
            };
        }

        // 3. Code non trouvé
        return {
            statusCode: 404,
            body: JSON.stringify({ 
                error: "Code de suivi introuvable. Vérifiez le numéro et réessayez." 
            }),
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        };

    } catch (error) {
        console.error("Erreur:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: "Une erreur serveur est survenue. Veuillez réessayer plus tard." 
            }),
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        };
    } finally {
        if (client) {
            await client.close();
        }
    }
};