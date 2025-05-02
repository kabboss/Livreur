const { MongoClient } = require('mongodb');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*', // Autorise toutes les origines
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Gestion de la requête de pré-vol (preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: '', // Réponse vide pour la pré-vol
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' }),
    };
  }

  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    const { codeID } = JSON.parse(event.body);

    if (!codeID) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Le codeID est requis' }),
      };
    }

    await client.connect();
    const collection = client.db('FarmsConnect').collection('Livraison');

    const result = await collection.deleteOne({ codeID });

    if (result.deletedCount === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Aucun colis trouvé avec ce codeID' }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Colis terminé et supprimé avec succès' }),
    };

  } catch (error) {
    console.error('Erreur serveur:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur interne du serveur' }),
    };
  } finally {
    await client.close();
  }
};
