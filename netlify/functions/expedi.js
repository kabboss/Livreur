const { MongoClient } = require('mongodb');

// Configuration MongoDB
const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collectionName: "Colis"
};

// Connexion pool
const client = new MongoClient(mongoConfig.uri, {
  connectTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 10,
  retryWrites: true,
  retryReads: true
});

// Middleware CORS
const setCorsHeaders = (response) => {
  response.headers = {
    ...response.headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  return response;
};

exports.handler = async function(event, context) {
  // Pré-vérification CORS
  if (event.httpMethod === 'OPTIONS') {
    return setCorsHeaders({
      statusCode: 204,
      body: ''
    });
  }

  // Vérification méthode HTTP
  if (event.httpMethod !== 'POST') {
    return setCorsHeaders({
      statusCode: 405,
      body: JSON.stringify({ message: 'Méthode non autorisée' })
    });
  }

  try {
    // Validation des données
    if (!event.body) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ message: 'Données manquantes' })
      });
    }

    const data = JSON.parse(event.body);
    
    // Validation des champs obligatoires
    const requiredFields = ['colisID', 'sender', 'phone1', 'recipient', 'phone', 'address', 'type'];
    const missingFields = requiredFields.filter(field => !data[field]);
    
    if (missingFields.length > 0) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          message: 'Champs manquants', 
          missing: missingFields 
        })
      });
    }

    // Connexion à MongoDB
    await client.connect();
    const db = client.db(mongoConfig.dbName);
    const collection = db.collection(mongoConfig.collectionName);

    // Vérification si le colis existe déjà
    const existingColis = await collection.findOne({ colisID: data.colisID });
    if (existingColis) {
      return setCorsHeaders({
        statusCode: 409,
        body: JSON.stringify({ message: 'Un colis avec cet ID existe déjà' })
      });
    }

    // Création du document
    const document = {
      ...data,
      status: 'enregistré',
      createdAt: new Date(),
      updatedAt: new Date(),
      history: [{
        status: 'enregistré',
        date: new Date(),
        location: data.location
      }]
    };

    // Insertion dans la base de données
    const result = await collection.insertOne(document);

    if (!result.acknowledged) {
      throw new Error('Échec de l\'insertion');
    }

    return setCorsHeaders({
      statusCode: 201,
      body: JSON.stringify({ 
        success: true,
        message: 'Colis enregistré avec succès',
        colisID: data.colisID
      })
    });

  } catch (error) {
    console.error('Erreur:', error);
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ 
        message: 'Erreur serveur',
        error: error.message
      })
    });
  }
};