const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async (event, context) => {
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    try {
        await client.connect();
        const db = client.db(dbName);
        const expeditionCollection = db.collection('cour_expedition');
        const livraisonsCollection = db.collection('livraisons'); // Assurez-vous du nom de votre collection de livraisons

        const { codeID } = JSON.parse(event.body);

        const expedition = await expeditionCollection.findOne({ codeID: codeID });

        if (expedition) {
            return {
                statusCode: 200,
                body: JSON.stringify({ expedition: expedition }),
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            };
        } else {
            // Vérifier si le colis existe dans la collection principale des livraisons
            const colisExistant = await livraisonsCollection.findOne({ colisID: codeID }); // Assurez-vous du bon champ d'identification

            if (colisExistant) {
                return {
                    statusCode: 200,
                    body: JSON.stringify({ message: 'Le processus d\'expédition pour ce colis n\'a pas encore commencé. Veuillez réessayer de suivre son statut ultérieurement.' }),
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                };
            } else {
                return {
                    statusCode: 404,
                    body: JSON.stringify({ error: 'Code de colis invalide ou inexistant.' }),
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                };
            }
        }

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