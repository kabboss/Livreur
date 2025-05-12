// Fonction Netlify: updateLivreurPosition.js
const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

  exports.handler = async function(event, context) {
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400', // 24 hours
        },
      };
    }

  try {
    await client.connect();
    const db = client.db(dbName);
    const expeditionCollection = db.collection('cour_expedition');

    const { codeID, localisation } = JSON.parse(event.body);

    // Vérifier d'abord si le livreur est bien responsable de ce colis
    const expedition = await expeditionCollection.findOne({ codeID });
    
    if (!expedition) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Expédition non trouvée.' }),
        headers: { 'Access-Control-Allow-Origin': '*' },
      };
    }

    // Ici vous pourriez ajouter une vérification supplémentaire
    // pour confirmer que l'utilisateur actuel est bien le livreur responsable
    // (nécessite un système d'authentification)

    const updateResult = await expeditionCollection.updateOne(
      { codeID },
      { $set: { 
          localisationLivreur: localisation, 
          dateMiseAJourLocalisation: new Date() 
      }}
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Localisation mise à jour.' }),
      headers: { 'Access-Control-Allow-Origin': '*' },
    };

  } catch (error) {
    console.error('Erreur:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erreur serveur.' }),
      headers: { 'Access-Control-Allow-Origin': '*' },
    };
  } finally {
    await client.close();
  }
};