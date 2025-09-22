const { MongoClient } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

// Client MongoDB avec pool de connexions
const mongoClient = new MongoClient(MONGODB_URI, {
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  maxPoolSize: 50,
  retryWrites: true,
  retryReads: true
});

// Headers CORS communs
const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  // Gestion des requêtes OPTIONS (prévol CORS)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({})
    };
  }

  // Vérification méthode HTTP
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ 
        success: false,
        error: 'Méthode non autorisée' 
      })
    };
  }

  try {
    // Validation du paramètre collection
    const collectionName = event.queryStringParameters?.collection;
    if (!collectionName) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Le paramètre "collection" est requis'
        })
      };
    }

    // Connexion à MongoDB
    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);

    // Vérification que la collection existe
    const collectionExists = await db.listCollections({ name: collectionName }).hasNext();
    if (!collectionExists) {
      return {
        statusCode: 404,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          success: false,
          error: `Collection "${collectionName}" non trouvée`
        })
      };
    }

    // Récupération des données avec une limite raisonnable
    const data = await db.collection(collectionName)
      .find({})
      .limit(500)
      .toArray();

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: true,
        count: data.length,
        data
      })
    };

  } catch (error) {
    console.error('Erreur MongoDB:', error);
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'Erreur serveur',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};