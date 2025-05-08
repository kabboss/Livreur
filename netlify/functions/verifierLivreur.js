const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function(event, context) {
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    try {
        await client.connect();
        const db = client.db(dbName);
        const expeditionCollection = db.collection('cour_expedition');

        const { codeID, livreurId } = JSON.parse(event.body);

        const expedition = await expeditionCollection.findOne({ codeID: codeID, idLivreur: livreurId });

        if (expedition) {
            return {
                statusCode: 200,
                body: JSON.stringify({ isAuthorized: true }),
                headers: { 'Access-Control-Allow-Origin': '*' },
            };
        } else {
            return {
                statusCode: 200,
                body: JSON.stringify({ isAuthorized: false }),
                headers: { 'Access-Control-Allow-Origin': '*' },
            };
        }

    } catch (error) {
        console.error('Erreur lors de la vérification de l\'identifiant du livreur:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Erreur serveur lors de la vérification.' }),
            headers: { 'Access-Control-Allow-Origin': '*' },
        };
    } finally {
        await client.close();
    }
};