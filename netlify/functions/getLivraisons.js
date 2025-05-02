const { MongoClient } = require('mongodb');

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*', // Autoriser toutes les origines
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  // Réponse pré-vol CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
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
    await client.connect();
    const collection = client.db('FarmsConnect').collection('Livraison');

    const livraisons = await collection.find({}).toArray();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(livraisons),
    };
  } catch (error) {
    console.error('Erreur lors de la récupération des livraisons:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur interne du serveur' }),
    };
  } finally {
    await client.close();
  }
};
