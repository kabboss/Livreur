const { MongoClient } = require('mongodb');

const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    clients: "infoclient",
    livraisons: "Livraison"
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

    const { codeID, clientLocation, timestamp } = JSON.parse(event.body);

    // Validation des données
    if (!codeID) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Code de colis requis' })
      });
    }

    if (!clientLocation || !clientLocation.latitude || !clientLocation.longitude) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Localisation client requise' })
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

    // Vérification si la livraison existe déjà
    const livraisonExistante = await db.collection(mongoConfig.collections.livraisons).findOne({ 
      codeID: codeID.toUpperCase() 
    });

    if (livraisonExistante) {
      return setCorsHeaders({
        statusCode: 409,
        body: JSON.stringify({ 
          success: false,
          error: 'Ce colis a déjà été enregistré comme reçu',
          livraison: {
            codeID: livraisonExistante.codeID,
            dateLivraison: livraisonExistante.dateLivraison,
            statut: livraisonExistante.statut
          }
        })
      });
    }

    // Récupération des informations du colis
    const colis = await db.collection(mongoConfig.collections.colis).findOne({ 
      colisID: codeID.toUpperCase() 
    });

    if (!colis) {
      return setCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ success: false, error: 'Colis introuvable avec ce code' })
      });
    }

    // Récupération des informations client
    const clientInfo = await db.collection(mongoConfig.collections.clients).findOne({ 
      code: codeID.toUpperCase() 
    });

    if (!clientInfo) {
      return setCorsHeaders({
        statusCode: 404,
        body: JSON.stringify({ success: false, error: 'Informations client introuvables' })
      });
    }

    // Préparation des données de livraison
    const livraisonData = {
      codeID: codeID.toUpperCase(),
      dateLivraison: new Date(),
      dateReception: new Date(),
      statut: 'livré',
      localisationReception: {
        latitude: clientLocation.latitude,
        longitude: clientLocation.longitude,
        accuracy: clientLocation.accuracy || null,
        timestamp: timestamp || new Date().toISOString()
      },
      colis: {
        type: colis.packageType || colis.type,
        details: colis.description || colis.details || '',
        photos: colis.photos ? colis.photos.map(p => ({ name: p.name, type: p.type })) : [],
        createdAt: colis.createdAt || colis.dateCreation || null,
      },
      expediteur: {
        nom: colis.sender,
        telephone: colis.senderPhone || colis.phone1,
        localisation: colis.location || null,
      },
      destinataire: {
        nom: clientInfo.nom || colis.recipient,
        prenom: clientInfo.prenom || '',
        telephone: clientInfo.numero || colis.recipientPhone || colis.phone,
        adresse: colis.address,
        localisation: clientInfo.localisation || null,
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Transaction pour assurer la cohérence des données
    const session = mongoClient.startSession();
    try {
      await session.withTransaction(async () => {
        // 1. Enregistrer la livraison
        await db.collection(mongoConfig.collections.livraisons).insertOne(livraisonData, { session });
        
        // 2. Mettre à jour le statut du colis
        await db.collection(mongoConfig.collections.colis).updateOne(
          { colisID: codeID.toUpperCase() },
          { 
            $set: { 
              status: 'livré', 
              dateLivraison: new Date(),
              updatedAt: new Date()
            },
            $push: {
              history: {
                status: 'livré',
                date: new Date(),
                location: clientLocation,
                notes: 'Colis confirmé comme reçu par le destinataire'
              }
            }
          },
          { session }
        );

        // 3. Mettre à jour les informations client
        await db.collection(mongoConfig.collections.clients).updateOne(
          { code: codeID.toUpperCase() },
          { 
            $set: { 
              localisation: clientLocation,
              dateReception: new Date(),
              updatedAt: new Date()
            }
          },
          { session }
        );
      });

      console.log('Livraison enregistrée avec succès pour le colis:', codeID);

      return setCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: '✅ Colis confirmé comme reçu avec succès !',
          livraison: {
            codeID: livraisonData.codeID,
            dateLivraison: livraisonData.dateLivraison,
            statut: livraisonData.statut,
            destinataire: livraisonData.destinataire.nom
          },
          timestamp: new Date().toISOString()
        })
      });

    } finally {
      await session.endSession();
    }

  } catch (error) {
    console.error('Erreur dans recevoir:', error);
    
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
        error: 'Erreur interne lors de l\'enregistrement de la réception',
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