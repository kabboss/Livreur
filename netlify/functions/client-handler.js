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

// Gestion des connexions avec cache
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) return cachedDb;

  const client = new MongoClient(mongoConfig.uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    retryWrites: true
  });

  try {
    await client.connect();
    const db = client.db(mongoConfig.dbName);
    await db.command({ ping: 1 });
    
    // Stocker seulement la référence à la DB
    cachedDb = {
      db,
      client // Garder une référence au client pour les sessions
    };
    
    return cachedDb;
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

  let dbConnection;
  try {
    dbConnection = await connectToDatabase();
    const { db, client } = dbConnection;

    const data = JSON.parse(event.body);
    const { action } = data;

    if (!action) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ error: 'Action parameter is required' })
      });
    }

    // Journalisation pour le débogage
    console.log(`Processing action: ${action}`, {
      colisID: data.colisID,
      timestamp: new Date().toISOString()
    });

    switch (action) {
      case 'create':
        return await handleCreatePackage(db, data);
      case 'search':
        return await handleSearchPackage(db, data);
      case 'accept':
        return await handleAcceptPackage(db, client, data);
      case 'decline':
        return await handleDeclinePackage(db, client, data);
      default:
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ error: 'Unknown action' })
        });
    }
  } catch (error) {
    console.error("Handler error:", {
      message: error.message,
      stack: error.stack,
      event: event.body
    });
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
// FONCTIONS DE TRAITEMENT AMÉLIORÉES
// ================================================

async function handleCreatePackage(db, data) {
  const requiredFields = [
    'sender', 'senderPhone', 'recipient', 
    'recipientPhone', 'address', 'packageType', 'location'
  ];
  
  // Validation renforcée
  const missingFields = requiredFields.filter(field => !data[field]);
  if (missingFields.length > 0) {
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Missing required fields',
        fields: missingFields
      })
    });
  }

  try {
    const trackingCode = await generateTrackingCode(db);
    const now = new Date();
    
    const packageData = {
      _id: trackingCode,
      colisID: trackingCode,
      trackingCode,
      status: 'pending',
      ...data,
      createdAt: now,
      updatedAt: now,
      history: [{
        status: 'created',
        date: now,
        location: data.location
      }]
    };

    await db.collection(mongoConfig.collections.colis).insertOne(packageData);
    
    return setCorsHeaders({
      statusCode: 201,
      body: JSON.stringify({
        success: true,
        trackingCode,
        colisID: trackingCode,
        createdAt: now.toISOString()
      })
    });
  } catch (error) {
    console.error("Create error:", error);
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Create failed',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    });
  }
}

async function handleSearchPackage(db, data) {
  const { code, nom, numero } = data;
  
  if (!code || !nom || !numero) {
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Missing search parameters',
        required: ['code', 'nom', 'numero']
      })
    });
  }

  try {
    const colis = await db.collection(mongoConfig.collections.colis)
      .findOne({ trackingCode: code.toUpperCase() });

    if (!colis) {
      return setCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ error: 'Package not found' })
      });
    }

    // Vérification stricte du destinataire
    const isRecipientValid = (
      colis.recipient.toLowerCase() === nom.toLowerCase() &&
      colis.recipientPhone === numero
    );

    if (!isRecipientValid) {
      return setCorsHeaders({
        statusCode: 403,
        body: JSON.stringify({ error: 'Recipient information mismatch' })
      });
    }

    // Ne pas exposer les champs sensibles
    const { _id, ...safeColisData } = colis;
    
    return setCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        colis: safeColisData
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

async function handleAcceptPackage(db, mongoClient, data) {
    // Validation stricte
    if (!data.colisID || typeof data.colisID !== 'string') {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'colisID invalide ou manquant' })
        };
    }

    if (!data.location || typeof data.location !== 'object') {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Localisation requise' })
        };
    }

    // Modifier ici pour utiliser latitude/longitude au lieu de lat/lng
    if (typeof data.location.latitude !== 'number' || 
        typeof data.location.longitude !== 'number') {
        return {
            statusCode: 400,
            body: JSON.stringify({ 
                error: 'Format de localisation invalide',
                required: { latitude: 'number', longitude: 'number' }
            })
        };
    }

    const { colisID, location } = data;
    const session = mongoClient.startSession();
    
    try {
        let livraisonDoc;

        await session.withTransaction(async () => {
            const colis = await db.collection(mongoConfig.collections.colis)
                .findOne({ colisID: colisID.toUpperCase() }, { session });

            if (!colis) throw new Error('Package not found');

            // Préparer les données de livraison
            const now = new Date();
            livraisonDoc = {
                colisID: colis.colisID,
                livraisonID: `LIV_${colis.colisID}_${now.getTime()}`,
                expediteur: colis.sender, // Corrigé de 'expediteur' à 'sender'
                destinataire: colis.recipient, // Corrigé de 'destinataire' à 'recipient'
                colis: {
                    type: colis.packageType,
                    description: colis.description,
                    photos: colis.photos || []
                },
                statut: "en_cours_de_livraison",
                dateCreation: colis.createdAt,
                dateAcceptation: now,
                localisation: location,
                historique: [
                    ...(colis.history || []),
                    {
                        event: "accepté",
                        date: now,
                        location: location
                    }
                ]
            };

            // Opérations atomiques
            await db.collection(mongoConfig.collections.livraison)
                .insertOne(livraisonDoc, { session });

            await db.collection(mongoConfig.collections.colis)
                .updateOne(
                    { colisID: colis.colisID },
                    {
                        $set: { status: "accepted", updatedAt: now }, // Corrigé 'statut' à 'status'
                        $push: { 
                            history: {
                                status: 'accepted',
                                date: now,
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
                status: livraisonDoc.statut, // Uniformiser le nom du champ
                dateAcceptation: livraisonDoc.dateAcceptation.toISOString()
            })
        });
    } catch (error) {
        console.error("Accept error:", error);
        return setCorsHeaders({
            statusCode: error.message === 'Package not found' ? 404 : 500,
            body: JSON.stringify({ 
                error: error.message || 'Accept failed'
            })
        });
    } finally {
        await session.endSession();
    }
}

async function handleDeclinePackage(db, mongoClient, data) {
  const { colisID, reason = "Refus client" } = data;
  
  if (!colisID) {
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'colisID is required',
        example: { colisID: "ABC123", reason: "Optionnel" }
      })
    });
  }

  const session = mongoClient.startSession();
  try {
    await session.withTransaction(async () => {
      const colis = await db.collection(mongoConfig.collections.colis)
        .findOne({ colisID: colisID.toUpperCase() }, { session });

      if (!colis) throw new Error('Package not found');

      const now = new Date();

      // Archive du refus
      await db.collection(mongoConfig.collections.refus)
        .insertOne({
          colisID: colis.colisID,
          dateRefus: now,
          raison: reason,
          donneesOriginales: colis
        }, { session });

      // Suppression atomique
      await db.collection(mongoConfig.collections.colis)
        .deleteOne({ colisID: colis.colisID }, { session });

      await db.collection(mongoConfig.collections.livraison)
        .deleteMany({ colisID: colis.colisID }, { session });

      await db.collection(mongoConfig.collections.tracking)
        .deleteOne({ code: colis.colisID }, { session });
    });

    return setCorsHeaders({
      statusCode: 200,
      body: JSON.stringify({ 
        success: true,
        message: 'Package declined and removed'
      })
    });
  } catch (error) {
    console.error("Decline error:", error);
    return setCorsHeaders({
      statusCode: error.message === 'Package not found' ? 404 : 500,
      body: JSON.stringify({ 
        error: error.message || 'Decline failed'
      })
    });
  } finally {
    await session.endSession();
  }
}

// ================================================
// FONCTIONS UTILITAIRES
// ================================================

async function generateTrackingCode(db) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Évite les caractères ambigus
  const codeLength = 8;
  let code, exists;

  do {
    code = Array.from({ length: codeLength }, () => 
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');

    exists = await db.collection(mongoConfig.collections.tracking)
      .findOne({ code });
  } while (exists);

  await db.collection(mongoConfig.collections.tracking)
    .insertOne({ 
      code, 
      createdAt: new Date(),
      status: 'unused'
    });

  return code;
}