const { MongoClient } = require('mongodb');

// Configuration MongoDB
const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    clients: "infoclient"
  }
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

// Validation des données
const validateRequest = (data) => {
  const requiredFields = ['nom', 'prenom', 'numero', 'code'];
  const missingFields = requiredFields.filter(field => !data[field]);
  
  if (missingFields.length > 0) {
    return {
      valid: false,
      message: `Champs manquants: ${missingFields.join(', ')}`
    };
  }
  
  if (!data.code.match(/^[A-Z0-9]{8,12}$/)) {
    return {
      valid: false,
      message: 'Code colis invalide'
    };
  }
  
  return { valid: true };
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
    const validation = validateRequest(data);
    
    if (!validation.valid) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ message: validation.message })
      });
    }

    // Connexion à MongoDB
    await client.connect();
    const db = client.db(mongoConfig.dbName);
    
    // Enregistrement des informations client
    await db.collection(mongoConfig.collections.clients).insertOne({
      nom: data.nom,
      prenom: data.prenom,
      numero: data.numero,
      code: data.code,
      localisation: data.location,
      date: new Date()
    });

    // Recherche du colis
    const colis = await db.collection(mongoConfig.collections.colis)
      .findOne({ colisID: data.code });
    
    if (!colis) {
      return setCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ 
          message: 'Colis non trouvé',
          suggestion: 'Vérifiez le code ou contactez l\'expéditeur'
        })
      });
    }

    // Formatage de la réponse
    const responseData = {
      message: 'Colis trouvé',
      colis: {
        colisID: colis.colisID,
        sender: colis.sender,
        phone1: colis.phone1,
        recipient: colis.recipient,
        phone: colis.phone,
        address: colis.address,
        type: colis.type,
        details: colis.details,
        photos: colis.photos || [],
        status: colis.status || 'enregistré',
        createdAt: colis.createdAt,
        history: colis.history || []
      }
    };

    return setCorsHeaders({
      statusCode: 200,
      body: JSON.stringify(responseData)
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