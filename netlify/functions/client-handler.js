const { MongoClient } = require('mongodb');

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

const validateExpeditionData = (data) => {
  const requiredFields = [
    'sender', 'senderPhone', 'recipient',
    'recipientPhone', 'address', 'packageType',
    'photos', 'location'
  ];

  const missingFields = requiredFields.filter(field => !data[field]);
  if (missingFields.length > 0) {
    return { valid: false, message: `Champs manquants: ${missingFields.join(', ')}` };
  }

  return { valid: true };
};

const validateTrackingData = (data) => {
  if (!data.code || !data.nom || !data.prenom || !data.numero) {
    return { valid: false, message: 'Tous les champs de suivi sont requis' };
  }
  return { valid: true };
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return setCorsHeaders({ statusCode: 204, body: '' });
  }

  if (event.httpMethod !== 'POST') {
    return setCorsHeaders({
      statusCode: 405,
      body: JSON.stringify({ success: false, message: 'Méthode non autorisée' })
    });
  }

  try {
    if (!event.body) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ success: false, message: 'Données manquantes' })
      });
    }

    const requestData = JSON.parse(event.body);
    
    await client.connect();
    const db = client.db(mongoConfig.dbName);

    // Gestion des requêtes de suivi
    if (requestData.code) {
      const validation = validateTrackingData(requestData);
      if (!validation.valid) {
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ success: false, message: validation.message })
        });
      }

      const colis = await db.collection(mongoConfig.collections.colis).findOne({
        colisID: requestData.code.toUpperCase()
      });

      if (!colis) {
        return setCorsHeaders({
          statusCode: 404,
          body: JSON.stringify({ success: false, message: 'Colis non trouvé' })
        });
      }

      return setCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({ success: true, colis })
      });
    }
    // Gestion des requêtes d'expédition
    else {
      const validation = validateExpeditionData(requestData);
      if (!validation.valid) {
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ success: false, message: validation.message })
        });
      }

      const colisID = generateTrackingCode();
      const colisData = {
        colisID,
        sender: requestData.sender,
        senderPhone: requestData.senderPhone,
        recipient: requestData.recipient,
        recipientPhone: requestData.recipientPhone,
        address: requestData.address,
        packageType: requestData.packageType,
        description: requestData.description || '',
        photos: requestData.photos,
        location: requestData.location,
        status: 'registered',
        createdAt: new Date(),
        updatedAt: new Date(),
        history: [{
          status: 'registered',
          date: new Date(),
          location: requestData.location
        }]
      };

      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await db.collection(mongoConfig.collections.colis).insertOne(colisData, { session });
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
    }
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