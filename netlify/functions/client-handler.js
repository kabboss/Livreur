const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB optimisée
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

// Cache de connexion pour optimiser les performances
let cachedDb = null;

/**
 * Établit une connexion à MongoDB avec gestion du cache
 */
async function connectToDatabase() {
  if (cachedDb && cachedDb.client.topology && cachedDb.client.topology.isConnected()) {
    return cachedDb;
  }

  const client = new MongoClient(mongoConfig.uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    retryWrites: true,
    useUnifiedTopology: true
  });

  try {
    await client.connect();
    const db = client.db(mongoConfig.dbName);
    
    // Test de la connexion
    await db.command({ ping: 1 });
    
    cachedDb = { db, client };
    console.log('✅ Connexion MongoDB établie');
    return cachedDb;
  } catch (error) {
    console.error("❌ Échec de connexion MongoDB:", error);
    throw new Error("Impossible de se connecter à la base de données");
  }
}

/**
 * Applique les headers CORS à toutes les réponses
 */
const setCorsHeaders = (response) => ({
  ...response,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    ...response.headers
  }
});

/**
 * Fonction principale du handler Netlify
 */
exports.handler = async (event, context) => {
  // Optimisation Netlify
  context.callbackWaitsForEmptyEventLoop = false;

  console.log(`📥 Requête reçue: ${event.httpMethod} ${event.path}`);

  // Gestion des requêtes OPTIONS (pré-vol CORS)
  if (event.httpMethod === 'OPTIONS') {
    return setCorsHeaders({ 
      statusCode: 204, 
      body: '' 
    });
  }

  // Vérification de la méthode HTTP
  if (event.httpMethod !== 'POST') {
    return setCorsHeaders({
      statusCode: 405,
      body: JSON.stringify({ 
        error: 'Méthode non autorisée',
        allowed: ['POST', 'OPTIONS']
      })
    });
  }

  try {
    // Connexion à la base de données
    const dbConnection = await connectToDatabase();
    const { db, client } = dbConnection;

    // Parsing du body de la requête
    let data;
    try {
      data = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.error('❌ Erreur parsing JSON:', parseError);
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Format JSON invalide',
          details: parseError.message
        })
      });
    }

    const { action } = data;

    // Validation de l'action
    if (!action) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Paramètre "action" requis',
          validActions: ['create', 'search', 'accept', 'decline']
        })
      });
    }

    console.log(`🎯 Action demandée: ${action}`);

    // Routage des actions
    let response;
    switch (action) {
      case 'create':
        response = await handleCreatePackage(db, data);
        break;
      case 'search':
        response = await handleSearchPackage(db, data);
        break;
      case 'accept':
        response = await handleAcceptPackage(db, client, data);
        break;
      case 'decline':
        response = await handleDeclinePackage(db, client, data);
        break;
      default:
        response = {
          statusCode: 400,
          body: JSON.stringify({ 
            error: `Action "${action}" non reconnue`,
            validActions: ['create', 'search', 'accept', 'decline']
          })
        };
    }

    console.log(`✅ Action ${action} traitée avec succès`);
    return setCorsHeaders(response);

  } catch (error) {
    console.error("❌ Erreur globale du handler:", error);
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({
        error: 'Erreur serveur interne',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    });
  }
};

/**
 * Gère la création d'un nouveau colis
 */
async function handleCreatePackage(db, data) {
  console.log('📦 Création d\'un nouveau colis');

  // Validation des champs obligatoires
  const requiredFields = [
    'sender', 'senderPhone', 'recipient', 'recipientPhone', 
    'address', 'packageType', 'location', 'photos'
  ];
  
  const missingFields = requiredFields.filter(field => {
    const value = data[field];
    if (field === 'photos') {
      return !Array.isArray(value) || value.length === 0;
    }
    return !value || (typeof value === 'string' && value.trim() === '');
  });

  if (missingFields.length > 0) {
    console.error('❌ Champs manquants:', missingFields);
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Champs obligatoires manquants',
        missing: missingFields,
        received: Object.keys(data)
      })
    };
  }

  // Validation de la localisation
  if (!data.location.latitude || !data.location.longitude) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Coordonnées GPS invalides',
        received: data.location
      })
    };
  }

  try {
    // Génération du code de suivi unique
    const trackingCode = await generateTrackingCode(db);
    const now = new Date();

    // Construction de l'objet colis
    const packageData = {
      _id: trackingCode,
      colisID: trackingCode,
      trackingCode,
      status: 'pending',
      
      // Informations expéditeur
      sender: data.sender.trim(),
      senderPhone: data.senderPhone.trim(),
      
      // Informations destinataire
      recipient: data.recipient.trim(),
      recipientPhone: data.recipientPhone.trim(),
      address: data.address.trim(),
      
      // Détails du colis
      packageType: data.packageType,
      description: data.description?.trim() || '',
      photos: data.photos,
      
      // Localisation et métadonnées
      location: {
        latitude: parseFloat(data.location.latitude),
        longitude: parseFloat(data.location.longitude),
        accuracy: data.location.accuracy || 0
      },
      
      // Timestamps
      createdAt: now,
      updatedAt: now,
      timestamp: data.timestamp || now.toISOString(),
      
      // Historique des statuts
      history: [{
        status: 'created',
        date: now,
        location: data.location,
        action: 'Colis créé par l\'expéditeur'
      }],
      
      // Métadonnées techniques
      metadata: {
        userAgent: data.userAgent,
        ...data.metadata
      }
    };

    // Insertion en base de données
    await db.collection(mongoConfig.collections.colis).insertOne(packageData);

    console.log(`✅ Colis créé avec succès: ${trackingCode}`);
    
    return {
      statusCode: 201,
      body: JSON.stringify({
        success: true,
        trackingCode,
        colisID: trackingCode,
        createdAt: now.toISOString(),
        message: 'Colis créé avec succès'
      })
    };

  } catch (error) {
    console.error("❌ Erreur lors de la création du colis:", error);
    
    // Gestion des erreurs de duplication
    if (error.code === 11000) {
      return {
        statusCode: 409,
        body: JSON.stringify({ 
          error: 'Code de suivi déjà existant',
          message: 'Veuillez réessayer'
        })
      };
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Échec de création du colis',
        details: error.message
      })
    };
  }
}

/**
 * Gère la recherche d'un colis
 */
async function handleSearchPackage(db, data) {
  console.log('🔍 Recherche d\'un colis');

  const { code, nom, numero } = data;

  // Validation des paramètres de recherche
  if (!code || !nom || !numero) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Paramètres de recherche incomplets',
        required: ['code', 'nom', 'numero'],
        received: { code: !!code, nom: !!nom, numero: !!numero }
      })
    };
  }

  try {
    // Recherche du colis par code de suivi
    const colis = await db.collection(mongoConfig.collections.colis)
      .findOne({ 
        trackingCode: code.toUpperCase().trim()
      });

    if (!colis) {
      console.log(`❌ Colis introuvable: ${code}`);
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          error: 'Colis introuvable',
          code: code.toUpperCase()
        })
      };
    }

    // Vérification des informations du destinataire
    const nomMatch = colis.recipient.toLowerCase().trim() === nom.toLowerCase().trim();
    const numeroMatch = colis.recipientPhone.trim() === numero.trim();

    if (!nomMatch || !numeroMatch) {
      console.log(`❌ Informations incorrectes pour le colis: ${code}`);
      return {
        statusCode: 403,
        body: JSON.stringify({ 
          error: 'Les informations ne correspondent pas au destinataire enregistré',
          hint: 'Vérifiez l\'orthographe exacte du nom et du numéro de téléphone'
        })
      };
    }

    // Suppression des champs sensibles avant envoi
    const { _id, ...safeColisData } = colis;

    console.log(`✅ Colis trouvé et validé: ${code}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        colis: safeColisData,
        message: 'Colis localisé avec succès'
      })
    };

  } catch (error) {
    console.error("❌ Erreur lors de la recherche:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Erreur lors de la recherche du colis',
        details: error.message
      })
    };
  }
}

/**
 * Gère l'acceptation d'un colis par le destinataire
 */
async function handleAcceptPackage(db, client, data) {
  console.log('✅ Acceptation d\'un colis');

  const { colisID, location } = data;

  // Validation des paramètres
  if (!colisID) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'ID du colis requis',
        received: data
      })
    };
  }

  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Localisation GPS invalide',
        required: 'latitude et longitude numériques',
        received: location
      })
    };
  }

  // Transaction pour garantir la cohérence des données
  const session = client.startSession();
  
  try {
    let livraisonDoc;

    await session.withTransaction(async () => {
      // Recherche du colis
      const colis = await db.collection(mongoConfig.collections.colis)
        .findOne({ colisID: colisID.toUpperCase() }, { session });

      if (!colis) {
        throw new Error('Colis introuvable');
      }

      if (colis.status === 'accepted') {
        throw new Error('Colis déjà accepté');
      }

      const now = new Date();
      
      // Création du document de livraison
      livraisonDoc = {
        colisID: colis.colisID,
        livraisonID: `LIV_${colis.colisID}_${now.getTime()}`,
        
        // Informations des parties
        expediteur: {
          nom: colis.sender,
          telephone: colis.senderPhone,
          location: colis.location
        },
        destinataire: {
          nom: colis.recipient,
          telephone: colis.recipientPhone,
          adresse: colis.address,
          location: location
        },
        
        // Détails du colis
        colis: {
          type: colis.packageType,
          description: colis.description,
          photos: colis.photos || []
        },
        
        // Statut et dates
        statut: "en_cours_de_livraison",
        dateCreation: colis.createdAt,
        dateAcceptation: now,
        
        // Localisation du destinataire
        localisation: {
          latitude: parseFloat(location.latitude),
          longitude: parseFloat(location.longitude),
          accuracy: location.accuracy || 0,
          timestamp: now
        },
        
        // Historique complet
        historique: [
          ...(colis.history || []),
          { 
            event: "accepté_par_destinataire", 
            date: now, 
            location: location,
            action: "Colis accepté par le destinataire"
          }
        ]
      };

      // Insertion du document de livraison
      await db.collection(mongoConfig.collections.livraison)
        .insertOne(livraisonDoc, { session });

      // Mise à jour du statut du colis
      await db.collection(mongoConfig.collections.colis).updateOne(
        { colisID: colis.colisID },
        {
          $set: { 
            status: "accepted", 
            updatedAt: now,
            acceptedAt: now,
            destinataireLocation: location
          },
          $push: { 
            history: { 
              status: 'accepted', 
              date: now, 
              location: location,
              action: "Accepté par le destinataire"
            } 
          }
        },
        { session }
      );

      console.log(`✅ Colis accepté avec succès: ${colis.colisID}`);
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        livraisonID: livraisonDoc.livraisonID,
        status: livraisonDoc.statut,
        dateAcceptation: livraisonDoc.dateAcceptation.toISOString(),
        message: 'Colis accepté avec succès'
      })
    };

  } catch (error) {
    console.error("❌ Erreur lors de l'acceptation:", error);
    
    const statusCode = error.message === 'Colis introuvable' ? 404 : 
                      error.message === 'Colis déjà accepté' ? 409 : 500;
    
    return {
      statusCode,
      body: JSON.stringify({ 
        error: error.message,
        details: error.message === 'Colis introuvable' ? 
          'Vérifiez le code de suivi' : 
          'Contactez le support si le problème persiste'
      })
    };
  } finally {
    await session.endSession();
  }
}

/**
 * Gère le refus d'un colis par le destinataire
 */
async function handleDeclinePackage(db, client, data) {
  console.log('❌ Refus d\'un colis');

  const { colisID, reason = "Refus par le destinataire" } = data;

  if (!colisID) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'ID du colis requis',
        received: data
      })
    };
  }

  // Transaction pour garantir la cohérence
  const session = client.startSession();
  
  try {
    await session.withTransaction(async () => {
      // Recherche du colis
      const colis = await db.collection(mongoConfig.collections.colis)
        .findOne({ colisID: colisID.toUpperCase() }, { session });

      if (!colis) {
        throw new Error('Colis introuvable');
      }

      const now = new Date();

      // Archivage dans la collection des refus
      await db.collection(mongoConfig.collections.refus).insertOne({
        colisID: colis.colisID,
        dateRefus: now,
        raison: reason,
        donneesOriginales: colis,
        metadata: {
          refusePar: 'destinataire',
          timestamp: now.toISOString()
        }
      }, { session });

      // Suppression du colis et des données associées
      await db.collection(mongoConfig.collections.colis)
        .deleteOne({ colisID: colis.colisID }, { session });
      
      await db.collection(mongoConfig.collections.livraison)
        .deleteMany({ colisID: colis.colisID }, { session });
      
      await db.collection(mongoConfig.collections.tracking)
        .deleteOne({ code: colis.colisID }, { session });

      console.log(`✅ Colis refusé et supprimé: ${colis.colisID}`);
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Colis refusé et supprimé du système avec succès'
      })
    };

  } catch (error) {
    console.error("❌ Erreur lors du refus:", error);
    
    const statusCode = error.message === 'Colis introuvable' ? 404 : 500;
    
    return {
      statusCode,
      body: JSON.stringify({ 
        error: error.message,
        details: error.message === 'Colis introuvable' ? 
          'Le colis a peut-être déjà été supprimé' : 
          'Erreur technique lors du refus'
      })
    };
  } finally {
    await session.endSession();
  }
}

/**
 * Génère un code de suivi unique
 */
async function generateTrackingCode(db) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codeLength = 8;
  let code, exists;
  let attempts = 0;
  const maxAttempts = 10;

  do {
    if (attempts >= maxAttempts) {
      throw new Error('Impossible de générer un code unique après plusieurs tentatives');
    }

    // Génération du code aléatoire
    code = Array.from({ length: codeLength }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');

    // Vérification de l'unicité
    exists = await db.collection(mongoConfig.collections.tracking)
      .findOne({ code });
    
    attempts++;
  } while (exists);

  // Enregistrement du code généré
  await db.collection(mongoConfig.collections.tracking).insertOne({
    code,
    createdAt: new Date(),
    status: 'generated',
    attempts
  });

  console.log(`🎯 Code de suivi généré: ${code} (tentatives: ${attempts})`);
  return code;
}