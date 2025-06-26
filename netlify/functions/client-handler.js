const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB
const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    livraison: "Livraison",
    refus: "Refus",
    tracking: "TrackingCodes",
    clients: "infoclient"
  }
};

// Gestion des connexions
let cachedClient = null;

async function connectToDatabase() {
  if (cachedClient) return cachedClient;

  const client = new MongoClient(mongoConfig.uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    retryWrites: true
  });

  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    cachedClient = client;
    return client;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw new Error("Database connection failed");
  }
}

// Headers CORS
const setCorsHeaders = (response) => ({
  ...response,
  headers: {
    ...response.headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  }
});

// Fonction principale
exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  // Gestion CORS
  if (event.httpMethod === 'OPTIONS') {
    return setCorsHeaders({ statusCode: 204, body: '' });
  }

  if (event.httpMethod !== 'POST') {
    return setCorsHeaders({
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    });
  }

  let client;
  try {
    client = await connectToDatabase();
    const db = client.db(mongoConfig.dbName);

    const data = JSON.parse(event.body);
    const { action } = data;

    if (!action) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ error: 'Action parameter is required' })
      });
    }

    switch (action) {
      case 'create':
        return await handleCreatePackage(db, data);
      case 'search':
        return await handleSearchPackage(db, data);
      case 'accept':
        return await handleAcceptPackage(db, data);
      case 'decline':
        return await handleDeclinePackage(db, data);
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
  }
};

// ================================================
// FONCTIONS DE TRAITEMENT
// ================================================

// Création d'un colis
async function handleCreatePackage(db, data) {
  const requiredFields = [
    'sender', 'senderPhone', 'recipient', 
    'recipientPhone', 'address', 'packageType', 'location'
  ];
  
  // Validation
  for (const field of requiredFields) {
    if (!data[field]) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ error: `Missing required field: ${field}` })
      });
    }
  }

  try {
    // Génération du code de suivi
    const trackingCode = await generateTrackingCode(db);
    
    // Préparation du document
    const packageData = {
      _id: trackingCode,
      colisID: trackingCode,
      trackingCode,
      status: 'pending',
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
      history: [{
        status: 'created',
        date: new Date(),
        location: data.location
      }]
    };

    // Insertion
    await db.collection(mongoConfig.collections.colis).insertOne(packageData);
    
    return setCorsHeaders({
      statusCode: 201,
      body: JSON.stringify({
        success: true,
        trackingCode,
        colisID: trackingCode
      })
    });

  } catch (error) {
    console.error("Create error:", error);
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ error: 'Create failed' })
    });
  }
}

// Recherche d'un colis
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
          _id: undefined // Masquer l'ID interne
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

// Acceptation d'un colis
async function handleAcceptPackage(db, data) {
  const { colisID, location } = data;
  
  if (!colisID || !location) {
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'colisID and location are required' })
    });
  }

  const session = client.startSession();
  try {
    let livraisonDoc;

    await session.withTransaction(async () => {
      // 1. Récupérer le colis
      const colis = await db.collection(mongoConfig.collections.colis).findOne(
        { colisID: colisID.toUpperCase() },
        { session }
      );

      if (!colis) throw new Error('Colis introuvable');

      // 2. Créer l'enregistrement de livraison
      livraisonDoc = {
        _id: new ObjectId(),
        colisID: colis.colisID,
        livraisonID: `LIV_${colis.colisID}_${Date.now()}`,
        expediteur: colis.expediteur,
        destinataire: colis.destinataire,
        colis: {
          type: colis.packageType,
          description: colis.description,
          poids: colis.poids
        },
        statut: "en_cours_de_livraison",
        dateCreation: colis.createdAt,
        dateAcceptation: new Date(),
        dateModification: new Date(),
        localisation: location,
        processus: colis.processus || {},
        historique: [
          ...(colis.historique || []),
          {
            event: "accepté",
            date: new Date(),
            location: location
          }
        ]
      };

      await db.collection(mongoConfig.collections.livraison).insertOne(livraisonDoc, { session });

      // 3. Mettre à jour le statut du colis
      await db.collection(mongoConfig.collections.colis).updateOne(
        { colisID: colis.colisID },
        {
          $set: {
            statut: "accepté",
            dateModification: new Date()
          },
          $push: {
            history: {
              status: 'accepted',
              date: new Date(),
              location: location
            }
          }
        },
        { session }
      );
    });

    return setCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        livraisonID: livraisonDoc.livraisonID,
        statut: livraisonDoc.statut
      })
    });

  } catch (error) {
    return setCorsHeaders({
      statusCode: error.message === 'Colis introuvable' ? 404 : 500,
      body: JSON.stringify({ error: error.message })
    });
  } finally {
    await session.endSession();
  }
}

// Refus d'un colis
async function handleDeclinePackage(db, data) {
  const { colisID, reason } = data;
  
  if (!colisID) {
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ error: 'colisID is required' })
    });
  }

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      // 1. Vérifier et récupérer le colis
      const colis = await db.collection(mongoConfig.collections.colis).findOne(
        { colisID: colisID.toUpperCase() },
        { session }
      );
      
      if (!colis) throw new Error('Colis introuvable');

      // 2. Archiver le refus
      await db.collection(mongoConfig.collections.refus).insertOne({
        colisID: colis.colisID,
        dateRefus: new Date(),
        raison: reason || "Refus client",
        donneesOriginales: colis
      }, { session });

      // 3. Supprimer de toutes les collections
      await db.collection(mongoConfig.collections.colis).deleteOne(
        { colisID: colis.colisID },
        { session }
      );

      await db.collection(mongoConfig.collections.livraison).deleteMany(
        { colisID: colis.colisID },
        { session }
      );

      await db.collection(mongoConfig.collections.tracking).deleteOne(
        { code: colis.colisID },
        { session }
      );
    });

    return setCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({ success: true })
    });

  } catch (error) {
    return setCorsHeaders({
      statusCode: error.message === 'Colis introuvable' ? 404 : 500,
      body: JSON.stringify({ error: error.message })
    });
  } finally {
    await session.endSession();
  }
}

// ================================================
// FONCTIONS UTILITAIRES
// ================================================

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
  
  await db.collection(mongoConfig.collections.tracking).insertOne({ 
    code, 
    createdAt: new Date() 
  });
  
  return code;
}