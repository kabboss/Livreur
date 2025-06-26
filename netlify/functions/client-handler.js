const { MongoClient } = require('mongodb');

// Configuration MongoDB optimisée
const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    tracking: "TrackingCodes"
  }
};

// Connexion MongoDB simplifiée et sécurisée
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = new MongoClient(mongoConfig.uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    retryWrites: true,
    retryReads: true
  });

  try {
    await client.connect();
    const db = client.db(mongoConfig.dbName);
    
    // Test de la connexion
    await db.command({ ping: 1 });
    
    cachedClient = client;
    cachedDb = db;
    
    console.log("Successfully connected to MongoDB");
    return { client, db };
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw new Error("Database connection failed");
  }
}

// Gestion CORS
const setCorsHeaders = (response) => {
  return {
    ...response,
    headers: {
      ...response.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    }
  };
};

// Fonction principale
exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  
  console.log("Incoming request:", event.httpMethod, event.path);

  // Gestion des requêtes OPTIONS pour CORS
  if (event.httpMethod === 'OPTIONS') {
    return setCorsHeaders({
      statusCode: 204,
      body: ''
    });
  }

  // Vérification méthode POST
  if (event.httpMethod !== 'POST') {
    return setCorsHeaders({
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    });
  }

  let client;
  try {
    // Connexion à MongoDB
    const { client: mongoClient, db } = await connectToDatabase();
    client = mongoClient;

    // Parse du body
    let requestData;
    try {
      requestData = JSON.parse(event.body);
    } catch (e) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON format' })
      });
    }

    // Vérification action
    if (!requestData.action) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ error: 'Action parameter is required' })
      });
    }

    // Gestion des différentes actions
    switch (requestData.action) {
      case 'create':
        return await handleCreatePackage(db, requestData);
      case 'search':
        return await handleSearchPackage(db, requestData);
      case 'accept':
        return await handleAcceptPackage(db, requestData);
      case 'decline':
        return await handleDeclinePackage(db, requestData);
      default:
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ error: 'Unknown action' })
        });
    }
  } catch (error) {
    console.error("Handler error:", error);
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    });
  } finally {
    // Ne pas fermer la connexion pour permettre le pooling
    // La connexion sera réutilisée pour les requêtes suivantes
  }
};

// Fonctions de traitement

async function handleCreatePackage(db, data) {
  // Validation des données
  const requiredFields = [
    'sender', 'senderPhone', 'recipient', 
    'recipientPhone', 'address', 'packageType', 'location'
  ];
  
  for (const field of requiredFields) {
    if (!data[field]) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ error: `Missing required field: ${field}` })
      });
    }
  }

  // Génération du code de suivi
  const trackingCode = await generateTrackingCode(db);
  
  // Préparation du document
  const packageData = {
    _id: trackingCode,
    trackingCode,
    status: 'pending',
    ...data,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  // Insertion en base
  try {
    const result = await db.collection(mongoConfig.collections.colis).insertOne(packageData);
    
    return setCorsHeaders({
      statusCode: 201,
      body: JSON.stringify({
        success: true,
        trackingCode,
        colisID: trackingCode
      })
    });
  } catch (error) {
    console.error("Create package error:", error);
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to create package' })
    });
  }
}

async function generateTrackingCode(db) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  let exists;
  
  do {
    code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    exists = await db.collection(mongoConfig.collections.tracking).findOne({ code });
  } while (exists);
  
  await db.collection(mongoConfig.collections.tracking).insertOne({ code, createdAt: new Date() });
  return code;
}

async function handleSearchPackage(db, data) {
  const { code, nom, numero } = data;
  
  if (!code || !nom || !numero) {
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'Code, nom and numero are required' })
    });
  }

  try {
    const colis = await db.collection(mongoConfig.collections.colis).findOne({ 
      trackingCode: code.toUpperCase()
    });

    if (!colis) {
      return setCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Package not found' })
      });
    }

    // Vérification destinataire
    if (
      colis.recipient.toLowerCase() !== nom.toLowerCase() ||
      colis.recipientPhone !== numero
    ) {
      return setCorsHeaders({
        statusCode: 403,
        body: JSON.stringify({ error: 'Recipient information mismatch' })
      });
    }

    return setCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        colis: {
          ...colis,
          _id: undefined // Ne pas exposer l'ID interne
        }
      })
    });
  } catch (error) {
    console.error("Search error:", error);
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Search failed' })
    });
  }
}

async function handleAcceptPackage(db, data) {
  const { colisID } = data;
  
  if (!colisID) {
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'colisID is required' })
    });
  }

  try {
    const result = await db.collection(mongoConfig.collections.colis).updateOne(
      { _id: colisID },
      { 
        $set: { 
          status: 'accepted',
          updatedAt: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      return setCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Package not found' })
      });
    }

    return setCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({ success: true })
    });
  } catch (error) {
    console.error("Accept error:", error);
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Accept failed' })
    });
  }
}

async function handleDeclinePackage(db, data) {
  const { colisID } = data;
  
  if (!colisID) {
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'colisID is required' })
    });
  }

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const colis = await db.collection(mongoConfig.collections.colis).findOne(
        { _id: colisID },
        { session }
      );
      
      if (!colis) {
        throw new Error('Package not found');
      }

      await db.collection(mongoConfig.collections.colis).deleteOne(
        { _id: colisID },
        { session }
      );
      
      await db.collection(mongoConfig.collections.tracking).deleteOne(
        { code: colis.trackingCode },
        { session }
      );
    });

    return setCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({ success: true })
    });
  } catch (error) {
    console.error("Decline error:", error);
    return setCorsHeaders({
      statusCode: error.message === 'Package not found' ? 404 : 500,
      body: JSON.stringify({ error: error.message })
    });
  } finally {
    await session.endSession();
  }
}