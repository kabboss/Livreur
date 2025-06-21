const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async (event, context) => {
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
            },
            body: "",
        };
    }

    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    try {
        await client.connect();
        const db = client.db(dbName);
        const expeditionCollection = db.collection('cour_expedition');
        const livraisonCollection = db.collection('Livraison');

        const { codeID } = JSON.parse(event.body);

        // Chercher dans cour_expedition par colisID
        const expeditionInfo = await expeditionCollection.findOne({ 
            colisID: codeID 
        });

        if (expeditionInfo) {
            return {
                statusCode: 200,
                body: JSON.stringify({ 
                    expedition: expeditionInfo,
                    message: 'Informations de suivi récupérées avec succès'
                }),
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            };
        }

        // Si non trouvé, chercher dans Livraison par colisID
        const colisEnregistre = await livraisonCollection.findOne({ 
            colisID: codeID 
        });

        if (colisEnregistre) {
            return {
                statusCode: 200,
                body: JSON.stringify({ 
                    message: 'Le processus d\'expédition pour ce colis n\'a pas encore démarré. Veuillez réessayer de suivre son statut ultérieurement.'
                }),
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            };
        }

        return {
            statusCode: 404,
            body: JSON.stringify({ error: 'Code de colis invalide ou inexistant.' }),
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        };

    } catch (error) {
        console.error('Erreur lors de la récupération des informations d\'expédition :', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Erreur serveur lors de la récupération des informations d\'expédition.' }),
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        };
    } finally {
        await client.close();
    }
};