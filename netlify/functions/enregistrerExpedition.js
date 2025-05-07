const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function(event, context) {
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    await client.connect();
    const db = client.db(dbName);
    const expeditionCollection = db.collection('cour_expedition');

    const { codeID, localisationLivreur, telephoneLivreur1, telephoneLivreur2, idLivreur } = JSON.parse(event.body);

    // Enregistrer les informations d'expédition dans la nouvelle collection
    const expeditionResult = await expeditionCollection.insertOne({
      codeID: codeID,
      localisationLivreur: localisationLivreur,
      telephoneLivreur1: telephoneLivreur1,
      telephoneLivreur2: telephoneLivreur2,
      idLivreur: idLivreur,
      dateDebut: new Date(),
      statut: 'en cours de récupération', // Statut initial dans la nouvelle collection
    });

    if (!expeditionResult.acknowledged) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Erreur lors de l\'enregistrement de l\'expédition.' }),
        headers: { 'Access-Control-Allow-Origin': '*' },
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Informations d\'expédition enregistrées.' }),
      headers: { 'Access-Control-Allow-Origin': '*' },
    };

  } catch (error) {
    console.error('Erreur lors de l\'enregistrement de l\'expédition :', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erreur serveur lors de l\'enregistrement de l\'expédition.' }),
      headers: { 'Access-Control-Allow-Origin': '*' },
    };
  } finally {
    await client.close();
  }
};