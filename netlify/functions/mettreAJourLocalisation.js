const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function(event, context) {
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    await client.connect();
    const db = client.db(dbName);
    const expeditionCollection = db.collection('cour_expedition');

    const { codeID, localisation } = JSON.parse(event.body);

    const updateResult = await expeditionCollection.updateOne(
      { codeID },
      { $set: { localisationLivreur: localisation, dateMiseAJourLocalisation: new Date() } }
    );

    if (updateResult.modifiedCount === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Expédition non trouvée.' }),
        headers: { 'Access-Control-Allow-Origin': '*' },
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Localisation du livreur mise à jour.' }),
      headers: { 'Access-Control-Allow-Origin': '*' },
    };

  } catch (error) {
    console.error('Erreur lors de la mise à jour de la localisation :', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erreur serveur lors de la mise à jour de la localisation.' }),
      headers: { 'Access-Control-Allow-Origin': '*' },
    };
  } finally {
    await client.close();
  }
};