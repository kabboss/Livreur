const { MongoClient } = require('mongodb');

const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    clients: "infoclient",
    refus: "Refus"
  }
};

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

exports.handler = async (event) => {
  // Gestion CORS
  if (event.httpMethod === 'OPTIONS') {
    return setCorsHeaders({ statusCode: 204, body: '' });
  }

  if (event.httpMethod !== 'POST') {
    return setCorsHeaders({
      statusCode: 405,
      body: JSON.stringify({ success: false, error: 'Méthode non autorisée' })
    });
  }

  let mongoClient;

  try {
    if (!event.body) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Données manquantes' })
      });
    }

    const { codeID, timestamp, reason } = JSON.parse(event.body);

    // Validation des données
    if (!codeID) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Code de colis requis' })
      });
    }

    // Connexion à MongoDB
    mongoClient = new MongoClient(mongoConfig.uri, {
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 10000
    });
    
    await mongoClient.connect();
    const db = mongoClient.db(mongoConfig.dbName);

    // Vérification si le colis existe
    const colis = await db.collection(mongoConfig.collections.colis).findOne({ 
      colisID: codeID.toUpperCase() 
    });

    if (!colis) {
      return setCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ success: false, error: 'Colis introuvable avec ce code' })
      });
    }

    // Vérification si le colis n'a pas déjà été refusé
    const refusExistant = await db.collection(mongoConfig.collections.refus).findOne({ 
      codeID: codeID.toUpperCase() 
    });

    if (refusExistant) {
      return setCorsHeaders({
        statusCode: 409,
        body: JSON.stringify({ 
          success: false,
          error: 'Ce colis a déjà été refusé',
          refus: {
            codeID: refusExistant.codeID,
            dateRefus: refusExistant.dateRefus,
            raison: refusExistant.raison
          }
        })
      });
    }

    // Récupération des informations client
    const clientInfo = await db.collection(mongoConfig.collections.clients).findOne({ 
      code: codeID.toUpperCase() 
    });

    // Préparation des données de refus
    const refusData = {
      codeID: codeID.toUpperCase(),
      dateRefus: new Date(),
      raison: reason || 'Refus client',
      timestamp: timestamp || new Date().toISOString(),
      colis: {
        expediteur: colis.sender,
        destinataire: colis.recipient,
        type: colis.packageType || colis.type,
        description: colis.description || colis.details || '',
        dateCreation: colis.createdAt || colis.dateCreation
      },
      client: clientInfo ? {
        nom: clientInfo.nom,
        prenom: clientInfo.prenom,
        telephone: clientInfo.numero
      } : null,
      statut: 'refusé',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Transaction pour assurer la cohérence des données
    const session = mongoClient.startSession();
    try {
      await session.withTransaction(async () => {
        // 1. Enregistrer le refus
        await db.collection(mongoConfig.collections.refus).insertOne(refusData, { session });
        
        // 2. Supprimer le colis de la collection principale
        await db.collection(mongoConfig.collections.colis).deleteOne(
          { colisID: codeID.toUpperCase() },
          { session }
        );

        // 3. Mettre à jour les informations client
        if (clientInfo) {
          await db.collection(mongoConfig.collections.clients).updateOne(
            { code: codeID.toUpperCase() },
            { 
              $set: { 
                statut: 'refusé',
                dateRefus: new Date(),
                updatedAt: new Date()
              }
            },
            { session }
          );
        }
      });

      console.log('Refus enregistré avec succès pour le colis:', codeID);

      return setCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: '📦 Le colis a été refusé et supprimé du système. Veuillez recontacter votre expéditeur si nécessaire.',
          refus: {
            codeID: refusData.codeID,
            dateRefus: refusData.dateRefus,
            raison: refusData.raison
          },
          timestamp: new Date().toISOString()
        })
      });

    } finally {
      await session.endSession();
    }

  } catch (error) {
    console.error('Erreur dans decliner:', error);
    
    // Gestion spécifique des erreurs MongoDB
    if (error.name === 'MongoTimeoutError') {
      return setCorsHeaders({
        statusCode: 503,
        body: JSON.stringify({ 
          success: false, 
          error: 'Service temporairement indisponible. Veuillez réessayer.',
          details: 'Database timeout'
        })
      });
    }

    if (error.name === 'MongoNetworkError') {
      return setCorsHeaders({
        statusCode: 503,
        body: JSON.stringify({ 
          success: false, 
          error: 'Problème de connexion à la base de données',
          details: 'Network error'
        })
      });
    }

    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ 
        success: false, 
        error: 'Erreur interne lors du refus du colis',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      })
    });
  } finally {
    // Fermeture propre de la connexion
    if (mongoClient) {
      try {
        await mongoClient.close();
      } catch (closeError) {
        console.error('Erreur lors de la fermeture de la connexion MongoDB:', closeError);
      }
    }
  }
};