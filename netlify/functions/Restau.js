const { MongoClient } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Restau';

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
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // Vérifier et parser le corps de la requête
    if (!event.body) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ error: 'No data provided' })
      };
    }

    const restaurantData = JSON.parse(event.body);

    // Validation des données requises
    if (!restaurantData.nom || !restaurantData.adresse || !restaurantData.telephone) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ 
          error: 'Missing required fields: nom, adresse and telephone are required' 
        })
      };
    }

    // Ajout de la date de création
    restaurantData.date_creation = new Date();
    restaurantData.statut = 'actif'; // Statut par défaut

    // Connexion à MongoDB
    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Insertion du restaurant
    const result = await collection.insertOne(restaurantData);

    // Fermeture de la connexion
    await mongoClient.close();

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: true,
        insertedId: result.insertedId,
        message: 'Restaurant enregistré avec succès'
      })
    };

  } catch (error) {
    console.error('Erreur:', error);
    
    // Fermer la connexion en cas d'erreur
    try {
      await mongoClient.close();
    } catch (e) {
      console.error('Erreur lors de la fermeture de la connexion:', e);
    }

    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ 
        success: false,
        error: 'Erreur serveur',
        message: error.message
      })
    };
  }
};