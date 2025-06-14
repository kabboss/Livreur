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

const client = new MongoClient(mongoConfig.uri, {
  connectTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 10,
  retryWrites: true,
  retryReads: true
});

const setCorsHeaders = (response) => {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  };
};

const validateRequestData = (data) => {
  const requiredFields = [
    'sender', 'senderPhone', 'recipient', 
    'recipientPhone', 'address', 'packageType',
    'photos', 'location'
  ];

  const missingFields = requiredFields.filter(field => !data[field]);
  if (missingFields.length > 0) {
    return { valid: false, message: `Champs manquants: ${missingFields.join(', ')}` };
  }

  // Validation téléphone (format simplifié)
  const phoneRegex = /^\+?[\d\s-]{8,}$/;
  if (!phoneRegex.test(data.senderPhone) || !phoneRegex.test(data.recipientPhone)) {
    return { valid: false, message: 'Format de téléphone invalide' };
  }

  // Validation location
  if (typeof data.location !== 'object' || 
      !data.location.latitude || 
      !data.location.longitude ||
      !data.location.accuracy) {
    return { valid: false, message: 'Localisation invalide' };
  }

  // Validation photos
  if (!Array.isArray(data.photos) || data.photos.length === 0) {
    return { valid: false, message: 'Au moins une photo requise' };
  }

  return { valid: true };
};

exports.handler = async (event) => {
  // Gestion préflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return setCorsHeaders({ statusCode: 204, body: '' });
  }

  // Vérification méthode
  if (event.httpMethod !== 'POST') {
    return setCorsHeaders({
      statusCode: 405,
      body: JSON.stringify({ success: false, message: 'Méthode non autorisée' })
    });
  }

  try {
    // Vérification et parsing du body
    if (!event.body) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ success: false, message: 'Données manquantes' })
      });
    }

    const requestData = JSON.parse(event.body);
    const validation = validateRequestData(requestData);

    if (!validation.valid) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ success: false, message: validation.message })
      });
    }

    // Connexion MongoDB
    await client.connect();
    const db = client.db(mongoConfig.dbName);

    // Génération code colis (si non fourni)
    const colisID = requestData.colisID || generateTrackingCode();

    // Données du colis
    const colisData = {
      colisID,
      sender: requestData.sender,
      senderPhone: requestData.senderPhone,
      recipient: requestData.recipient,
      recipientPhone: requestData.recipientPhone,
      address: requestData.address,
      packageType: requestData.packageType,
      description: requestData.description || '',
      photos: requestData.photos.map(photo => ({
        name: photo.name,
        type: photo.type,
        data: photo.data // Base64
      })),
      location: {
        latitude: parseFloat(requestData.location.latitude),
        longitude: parseFloat(requestData.location.longitude),
        accuracy: parseFloat(requestData.location.accuracy),
        timestamp: new Date()
      },
      status: 'registered',
      createdAt: new Date(),
      updatedAt: new Date(),
      history: [{
        status: 'registered',
        date: new Date(),
        location: {
          latitude: parseFloat(requestData.location.latitude),
          longitude: parseFloat(requestData.location.longitude)
        }
      }]
    };

    // Transaction MongoDB pour insérer colis et client
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        // Insertion colis
        await db.collection(mongoConfig.collections.colis).insertOne(colisData, { session });
        
        // Insertion client
        await db.collection(mongoConfig.collections.clients).insertOne({
          name: requestData.sender,
          phone: requestData.senderPhone,
          colisID,
          createdAt: new Date()
        }, { session });
      });
    } finally {
      await session.endSession();
    }

    return setCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        colisID,
        message: 'Expédition enregistrée avec succès'
      })
    });

  } catch (error) {
    console.error('Erreur:', error);
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ 
        success: false, 
        message: 'Erreur serveur',
        error: error.message
      })
    });
  } finally {
    await client.close();
  }
};

function generateTrackingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}