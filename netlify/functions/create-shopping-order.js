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

let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;

  await mongoClient.connect();
  cachedDb = mongoClient.db(DB_NAME);
  return cachedDb;
}

exports.handler = async function(event, context) {
  // Gérer les pré-requêtes CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ message: 'Pré-vol CORS autorisé' })
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ message: 'Méthode non autorisée' })
    };
  }

  try {
    const data = JSON.parse(event.body);

    // Connexion à la base
    const db = await connectToDatabase();
    const collection = db.collection('shopping_orders'); // ou un autre nom

    // Insertion dans la collection
    const result = await collection.insertOne(data);

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ message: 'Commande enregistrée avec succès', id: result.insertedId })
    };

  } catch (error) {
    console.error('Erreur MongoDB:', error);
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ message: 'Erreur serveur', error: error.message })
    };
  }
};
