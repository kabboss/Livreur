const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

const mongoClient = new MongoClient(MONGODB_URI, {
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000
});

const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Collections autorisées à être vidées
const ALLOWED_COLLECTIONS = [
  'Colis',
  'Livraison',
  'cour_expedition',
  'infoclient',
  'supressions_colis'
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({})
    };
  }

  if (event.httpMethod !== 'POST') {
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
    const { collection } = JSON.parse(event.body);

    // Validation de la collection
    if (!collection || !ALLOWED_COLLECTIONS.includes(collection)) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Nom de collection invalide ou non autorisé',
          allowedCollections: ALLOWED_COLLECTIONS
        })
      };
    }

    // Connexion à MongoDB
    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);

    // Vérification que la collection existe
    const collectionExists = await db.listCollections({ name: collection }).hasNext();
    if (!collectionExists) {
      return {
        statusCode: 404,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          success: false,
          error: `Collection "${collection}" non trouvée`
        })
      };
    }

    // Suppression des documents
    const result = await db.collection(collection).deleteMany({});

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: true,
        deletedCount: result.deletedCount,
        message: `${result.deletedCount} documents supprimés de la collection ${collection}`
      })
    };

  } catch (error) {
    console.error('Erreur:', error);
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'Erreur lors de la suppression',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};