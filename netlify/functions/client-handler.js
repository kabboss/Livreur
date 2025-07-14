const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB optimisée et sécurisée
const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority&appName=Cluster0",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    livraison: "Livraison",
    refus: "Refus",
    tracking: "TrackingCodes",
    clients: "infoclient",
    payments: "Payments"
  },
  options: {
    connectTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 10,
    minPoolSize: 2,
    retryWrites: true,
    useUnifiedTopology: true,
    bufferMaxEntries: 0,
    bufferCommands: false
  }
};

// Cache de connexion pour optimiser les performances
let cachedClient = null;
let cachedDb = null;

/**
 * Établit une connexion MongoDB avec gestion avancée du cache et des erreurs
 */
async function connectToDatabase() {
  // Vérification de la validité du cache
  if (cachedClient && cachedDb && cachedClient.topology && cachedClient.topology.isConnected()) {
    try {
      // Test rapide de la connexion
      await cachedDb.admin().ping();
      return { db: cachedDb, client: cachedClient };
    } catch (error) {
      console.warn('⚠️ Cache de connexion MongoDB invalide, reconnexion...');
      cachedClient = null;
      cachedDb = null;
    }
  }

  console.log('🔄 Établissement nouvelle connexion MongoDB...');
  
  const client = new MongoClient(mongoConfig.uri, mongoConfig.options);

  try {
    await client.connect();
    const db = client.db(mongoConfig.dbName);
    
    // Test de la connexion
    await db.admin().ping();
    
    // Mise en cache
    cachedClient = client;
    cachedDb = db;
    
    console.log('✅ Connexion MongoDB établie avec succès');
    return { db, client };
    
  } catch (error) {
    console.error("❌ Échec de connexion MongoDB:", error);
    
    // Nettoyage en cas d'erreur
    try {
      await client.close();
    } catch (closeError) {
      console.error("Erreur fermeture client:", closeError);
    }
    
    throw new Error(`Connexion DB impossible: ${error.message}`);
  }
}

/**
 * Applique les headers CORS optimisés pour tous les environnements
 */
const setCorsHeaders = (response) => ({
  ...response,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET, PUT, DELETE',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    ...response.headers
  }
});

/**
 * Validation avancée des données d'entrée
 */
function validateInput(data, requiredFields = []) {
  const errors = [];
  
  // Vérification des champs obligatoires
  for (const field of requiredFields) {
    if (field === 'photos' && Array.isArray(data[field])) {
      if (data[field].length === 0) {
        errors.push(`Le champ '${field}' ne peut pas être vide`);
      }
    } else if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
      errors.push(`Le champ '${field}' est obligatoire`);
    }
  }
  
  // Validation spécifique des types de données
  if (data.location) {
    if (typeof data.location.latitude !== 'number' || typeof data.location.longitude !== 'number') {
      errors.push('Les coordonnées GPS doivent être des nombres valides');
    }
    
    if (Math.abs(data.location.latitude) > 90 || Math.abs(data.location.longitude) > 180) {
      errors.push('Les coordonnées GPS sont hors limites valides');
    }
  }
  
  // Validation des numéros de téléphone
  if (data.senderPhone || data.recipientPhone || data.numero) {
    const phoneFields = ['senderPhone', 'recipientPhone', 'numero'];
    phoneFields.forEach(field => {
      if (data[field]) {
        const phone = data[field].toString().trim();
        if (phone.length < 8 || phone.length > 15) {
          errors.push(`Le numéro de téléphone '${field}' doit contenir entre 8 et 15 chiffres`);
        }
      }
    });
  }
  
  return errors;
}

/**
 * Sanitisation des données pour éviter les injections
 */
function sanitizeData(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  const sanitized = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Suppression des caractères dangereux et normalisation
      sanitized[key] = value
        .trim()
        .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // Caractères de contrôle
        .replace(/[<>]/g, '') // Balises HTML basiques
        .substring(0, 1000); // Limite de longueur
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => sanitizeData(item));
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeData(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Logger centralisé avec différents niveaux
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logData = data ? JSON.stringify(data, null, 2) : '';
  
  switch (level) {
    case 'error':
      console.error(`[${timestamp}] ❌ ${message}`, logData);
      break;
    case 'warn':
      console.warn(`[${timestamp}] ⚠️ ${message}`, logData);
      break;
    case 'info':
      console.log(`[${timestamp}] ℹ️ ${message}`, logData);
      break;
    case 'debug':
      if (process.env.NODE_ENV === 'development') {
        console.log(`[${timestamp}] 🐛 ${message}`, logData);
      }
      break;
    default:
      console.log(`[${timestamp}] 📝 ${message}`, logData);
  }
}

/**
 * Fonction principale du handler Netlify avec gestion d'erreurs robuste
 */
exports.handler = async (event, context) => {
  // Optimisation Netlify Functions
  context.callbackWaitsForEmptyEventLoop = false;
  
  const startTime = Date.now();
  log('info', `📥 Requête reçue: ${event.httpMethod} ${event.path}`);

  // Gestion CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return setCorsHeaders({ 
      statusCode: 204, 
      body: '' 
    });
  }

  // Validation de la méthode HTTP
  if (event.httpMethod !== 'POST') {
    return setCorsHeaders({
      statusCode: 405,
      body: JSON.stringify({ 
        success: false,
        error: 'Méthode non autorisée',
        allowedMethods: ['POST', 'OPTIONS']
      })
    });
  }

  let dbConnection = null;

  try {
    // Connexion à la base de données
    dbConnection = await connectToDatabase();
    const { db, client } = dbConnection;

    // Parsing et validation du body
    let data;
    try {
      data = JSON.parse(event.body || '{}');
      log('debug', 'Données reçues', data);
    } catch (parseError) {
      log('error', 'Erreur parsing JSON', parseError);
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          success: false,
          error: 'Format JSON invalide',
          details: parseError.message
        })
      });
    }

    // Sanitisation des données
    data = sanitizeData(data);

    // Validation de l'action
    const { action } = data;
    if (!action) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          success: false,
          error: 'Paramètre "action" requis',
          validActions: ['create', 'search', 'accept', 'decline']
        })
      });
    }

    log('info', `🎯 Action demandée: ${action}`);

    // Routage des actions avec gestion d'erreurs spécifique
    let response;
    try {
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
              success: false,
              error: `Action "${action}" non reconnue`,
              validActions: ['create', 'search', 'accept', 'decline']
            })
          };
      }
    } catch (actionError) {
      log('error', `Erreur lors de l'action ${action}`, actionError);
      
      // Gestion spécifique des erreurs MongoDB
      if (actionError.name === 'MongoNetworkError') {
        response = {
          statusCode: 503,
          body: JSON.stringify({
            success: false,
            error: 'Service temporairement indisponible',
            message: 'Problème de connexion à la base de données'
          })
        };
      } else if (actionError.code === 11000) {
        response = {
          statusCode: 409,
          body: JSON.stringify({
            success: false,
            error: 'Conflit de données',
            message: 'Un élément avec ces informations existe déjà'
          })
        };
      } else {
        response = {
          statusCode: 500,
          body: JSON.stringify({
            success: false,
            error: 'Erreur lors du traitement',
            message: actionError.message
          })
        };
      }
    }

    const processingTime = Date.now() - startTime;
    log('info', `✅ Action ${action} traitée en ${processingTime}ms`);
    
    return setCorsHeaders(response);

  } catch (globalError) {
    const processingTime = Date.now() - startTime;
    log('error', `Erreur globale après ${processingTime}ms`, globalError);
    
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: 'Erreur serveur interne',
        message: 'Une erreur inattendue s\'est produite',
        requestId: context.awsRequestId,
        details: process.env.NODE_ENV === 'development' ? globalError.message : undefined
      })
    });
  }
};

/**
 * Gère la création d'un nouveau colis avec validation complète
 */
async function handleCreatePackage(db, data) {
  log('info', '📦 Début création colis');

  // Validation des champs obligatoires
  const requiredFields = [
    'sender', 'senderPhone', 'recipient', 'recipientPhone', 
    'address', 'packageType', 'location', 'photos'
  ];
  
  const validationErrors = validateInput(data, requiredFields);
  
  if (validationErrors.length > 0) {
    log('warn', 'Erreurs de validation lors de la création', validationErrors);
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        success: false,
        error: 'Données invalides',
        details: validationErrors,
        received: Object.keys(data)
      })
    };
  }

  try {
    // Génération du code de suivi unique avec retry
    const trackingCode = await generateUniqueTrackingCode(db);
    const now = new Date();

    // Construction de l'objet colis avec données enrichies
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
        accuracy: data.location.accuracy || 0,
        timestamp: now
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
        action: 'Colis créé par l\'expéditeur',
        ip: data.clientIp || 'unknown'
      }],
      
      // Métadonnées techniques
      metadata: {
        userAgent: data.userAgent,
        clientIp: data.clientIp,
        platform: data.platform || 'web',
        version: '2.0',
        ...data.metadata
      },
      
      // Informations de sécurité
      security: {
        created: true,
        verified: false,
        attempts: 0,
        lastActivity: now
      }
    };

    // Insertion avec gestion d'erreur
    await db.collection(mongoConfig.collections.colis).insertOne(packageData);
    
    log('info', `✅ Colis créé avec succès: ${trackingCode}`);
    
    return {
      statusCode: 201,
      body: JSON.stringify({
        success: true,
        trackingCode,
        colisID: trackingCode,
        createdAt: now.toISOString(),
        message: 'Colis créé avec succès',
        qrCodeUrl: `${process.env.CLIENT_URL || 'https://send20.netlify.app/client.html'}?code=${trackingCode}`
      })
    };

  } catch (error) {
    log('error', "Erreur lors de la création du colis", error);
    
    // Gestion spécifique des erreurs
    if (error.code === 11000) {
      // Erreur de duplication
      return {
        statusCode: 409,
        body: JSON.stringify({ 
          success: false,
          error: 'Code de suivi en conflit',
          message: 'Veuillez réessayer dans quelques instants'
        })
      };
    }
    
    if (error.name === 'ValidationError') {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          success: false,
          error: 'Données invalides',
          details: error.message
        })
      };
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: 'Échec de création du colis',
        message: 'Erreur technique lors de la sauvegarde'
      })
    };
  }
}

/**
 * Gère la recherche d'un colis avec vérifications de sécurité
 */
async function handleSearchPackage(db, data) {
  log('info', '🔍 Début recherche colis');

  const { code, nom, numero } = data;

  // Validation des paramètres de recherche
  const validationErrors = validateInput(data, ['code', 'nom', 'numero']);
  
  if (validationErrors.length > 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: 'Paramètres de recherche incomplets',
        details: validationErrors,
        required: ['code', 'nom', 'numero']
      })
    };
  }

  try {
    const searchCode = code.toUpperCase().trim();
    
    // Recherche du colis avec enrichissement des données
    const colis = await db.collection(mongoConfig.collections.colis)
      .findOne({ 
        trackingCode: searchCode
      });

    if (!colis) {
      log('warn', `Colis introuvable: ${searchCode}`);
      
      // Log de tentative de recherche pour surveillance
      await logSearchAttempt(db, {
        code: searchCode,
        nom: nom.trim(),
        numero: numero.trim(),
        success: false,
        reason: 'not_found',
        timestamp: new Date(),
        ip: data.clientIp || 'unknown'
      });
      
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          success: false,
          error: 'Colis introuvable',
          message: 'Aucun colis ne correspond à ce code de suivi',
          code: searchCode
        })
      };
    }

    // Vérification des informations du destinataire avec normalisation
    const nomNormalized = normalizeString(nom);
    const colisNomNormalized = normalizeString(colis.recipient);
    const numeroNormalized = numero.trim().replace(/[\s\-\.]/g, '');
    const colisNumeroNormalized = colis.recipientPhone.trim().replace(/[\s\-\.]/g, '');

    const nomMatch = nomNormalized === colisNomNormalized;
    const numeroMatch = numeroNormalized === colisNumeroNormalized;

    if (!nomMatch || !numeroMatch) {
      log('warn', `Informations incorrectes pour le colis: ${searchCode}`, {
        nomMatch,
        numeroMatch,
        providedNom: nomNormalized,
        expectedNom: colisNomNormalized
      });
      
      // Incrémenter le compteur de tentatives
      await db.collection(mongoConfig.collections.colis).updateOne(
        { trackingCode: searchCode },
        { 
          $inc: { 'security.attempts': 1 },
          $set: { 'security.lastActivity': new Date() }
        }
      );
      
      await logSearchAttempt(db, {
        code: searchCode,
        nom: nom.trim(),
        numero: numero.trim(),
        success: false,
        reason: 'invalid_credentials',
        timestamp: new Date(),
        ip: data.clientIp || 'unknown'
      });
      
      return {
        statusCode: 403,
        body: JSON.stringify({ 
          success: false,
          error: 'Informations incorrectes',
          message: 'Le nom ou le numéro de téléphone ne correspond pas au destinataire enregistré',
          hint: 'Vérifiez l\'orthographe exacte du nom et du numéro de téléphone'
        })
      };
    }

    // Mise à jour de l'activité de sécurité
    await db.collection(mongoConfig.collections.colis).updateOne(
      { trackingCode: searchCode },
      { 
        $set: { 
          'security.lastActivity': new Date(),
          'security.verified': true
        }
      }
    );

    // Log de recherche réussie
    await logSearchAttempt(db, {
      code: searchCode,
      nom: nom.trim(),
      numero: numero.trim(),
      success: true,
      timestamp: new Date(),
      ip: data.clientIp || 'unknown'
    });

    // Préparation des données de réponse (suppression des champs sensibles)
    const { _id, security, metadata, ...safeColisData } = colis;

    log('info', `✅ Colis trouvé et validé: ${searchCode}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        colis: safeColisData,
        message: 'Colis localisé avec succès',
        searchTimestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    log('error', "Erreur lors de la recherche", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: 'Erreur lors de la recherche du colis',
        message: 'Problème technique lors de la recherche'
      })
    };
  }
}

/**
 * Gère l'acceptation d'un colis avec transaction complète
 */
async function handleAcceptPackage(db, client, data) {
  log('info', '✅ Début acceptation colis');

  const { colisID, location } = data;

  // Validation des paramètres
  const validationErrors = validateInput(data, ['colisID', 'location']);
  
  if (validationErrors.length > 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        success: false,
        error: 'Paramètres invalides',
        details: validationErrors
      })
    };
  }

  // Transaction MongoDB pour garantir la cohérence
  const session = client.startSession();
  
  try {
    let livraisonDoc;

    await session.withTransaction(async () => {
      // Recherche du colis avec verrouillage
      const colis = await db.collection(mongoConfig.collections.colis)
        .findOne({ colisID: colisID.toUpperCase() }, { session });

      if (!colis) {
        throw new Error('COLIS_NOT_FOUND');
      }

      if (colis.status === 'accepted') {
        throw new Error('COLIS_ALREADY_ACCEPTED');
      }

      if (colis.status === 'declined') {
        throw new Error('COLIS_ALREADY_DECLINED');
      }

      const now = new Date();
      
      // Calcul de la distance et du prix de livraison
      const distance = calculateDistance(
        colis.location.latitude,
        colis.location.longitude,
        location.latitude,
        location.longitude
      );
      
      const deliveryPrice = calculateDeliveryPrice(distance);
      
      // Génération de l'ID de livraison unique
      const livraisonID = `LIV_${colis.colisID}_${now.getTime()}`;
      
      // Création du document de livraison enrichi
      livraisonDoc = {
        _id: livraisonID,
        colisID: colis.colisID,
        livraisonID,
        
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
          location: {
            latitude: parseFloat(location.latitude),
            longitude: parseFloat(location.longitude),
            accuracy: location.accuracy || 0,
            timestamp: now
          }
        },
        
        // Détails du colis
        colis: {
          type: colis.packageType,
          description: colis.description,
          photos: colis.photos || []
        },
        
        // Informations de livraison
        livraison: {
          distance: Math.round(distance * 100) / 100, // Arrondi à 2 décimales
          prix: deliveryPrice,
          devise: 'XOF',
          calculationMethod: 'distance-based',
          basePrice: 700,
          additionalKmPrice: 100
        },
        
        // Statut et dates
        statut: "en_cours_de_livraison",
        dateCreation: colis.createdAt,
        dateAcceptation: now,
        
        // Historique complet
        historique: [
          ...(colis.history || []),
          { 
            event: "accepté_par_destinataire", 
            date: now, 
            location: location,
            action: "Colis accepté par le destinataire",
            details: {
              distance: `${distance.toFixed(2)} km`,
              price: `${deliveryPrice} XOF`
            }
          }
        ],
        
        // Métadonnées de création
        metadata: {
          createdBy: 'client-system',
          version: '2.0',
          ip: data.clientIp || 'unknown',
          userAgent: data.userAgent
        }
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
            destinataireLocation: location,
            deliveryInfo: {
              distance: distance,
              price: deliveryPrice,
              currency: 'XOF'
            }
          },
          $push: { 
            history: { 
              status: 'accepted', 
              date: now, 
              location: location,
              action: "Accepté par le destinataire",
              metadata: {
                distance: distance,
                deliveryPrice: deliveryPrice
              }
            } 
          }
        },
        { session }
      );

      log('info', `✅ Colis accepté avec succès: ${colis.colisID}`, {
        livraisonID,
        distance: `${distance.toFixed(2)} km`,
        price: `${deliveryPrice} XOF`
      });
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        livraisonID: livraisonDoc.livraisonID,
        status: livraisonDoc.statut,
        dateAcceptation: livraisonDoc.dateAcceptation.toISOString(),
        livraison: livraisonDoc.livraison,
        message: 'Colis accepté avec succès',
        nextSteps: [
          'Un livreur sera assigné dans les plus brefs délais',
          'Vous recevrez une notification avec les détails du livreur',
          'Le paiement sera requis à la livraison'
        ]
      })
    };

  } catch (error) {
    log('error', "Erreur lors de l'acceptation", error);
    
    // Gestion spécifique des erreurs métier
    const errorMap = {
      'COLIS_NOT_FOUND': {
        statusCode: 404,
        message: 'Colis introuvable',
        details: 'Vérifiez le code de suivi'
      },
      'COLIS_ALREADY_ACCEPTED': {
        statusCode: 409,
        message: 'Colis déjà accepté',
        details: 'Ce colis a déjà été accepté précédemment'
      },
      'COLIS_ALREADY_DECLINED': {
        statusCode: 409,
        message: 'Colis déjà refusé',
        details: 'Ce colis a été refusé et ne peut plus être accepté'
      }
    };
    
    const errorInfo = errorMap[error.message] || {
      statusCode: 500,
      message: 'Erreur technique',
      details: 'Contactez le support si le problème persiste'
    };
    
    return {
      statusCode: errorInfo.statusCode,
      body: JSON.stringify({ 
        success: false,
        error: errorInfo.message,
        details: errorInfo.details
      })
    };
  } finally {
    await session.endSession();
  }
}

/**
 * Gère le refus d'un colis avec archivage complet
 */
async function handleDeclinePackage(db, client, data) {
  log('info', '❌ Début refus colis');

  const { colisID, reason = "Refus par le destinataire" } = data;

  if (!colisID) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        success: false,
        error: 'ID du colis requis',
        received: data
      })
    };
  }

  // Transaction pour garantir la cohérence des données
  const session = client.startSession();
  
  try {
    let archiveData;

    await session.withTransaction(async () => {
      // Recherche du colis avec verrouillage
      const colis = await db.collection(mongoConfig.collections.colis)
        .findOne({ colisID: colisID.toUpperCase() }, { session });

      if (!colis) {
        throw new Error('COLIS_NOT_FOUND');
      }

      if (colis.status === 'declined') {
        throw new Error('COLIS_ALREADY_DECLINED');
      }

      const now = new Date();

      // Préparation des données d'archivage
      archiveData = {
        _id: `REFUSE_${colis.colisID}_${now.getTime()}`,
        colisID: colis.colisID,
        dateRefus: now,
        raison: reason.trim(),
        motif: 'refus_destinataire',
        
        // Données originales complètes pour audit
        donneesOriginales: colis,
        
        // Statistiques pour analyse
        statistiques: {
          dureeVie: now - new Date(colis.createdAt),
          tentativesAcces: colis.security?.attempts || 0,
          derniereActivite: colis.security?.lastActivity || colis.createdAt
        },
        
        // Métadonnées de refus
        metadata: {
          refusePar: 'destinataire',
          timestamp: now.toISOString(),
          ip: data.clientIp || 'unknown',
          userAgent: data.userAgent,
          version: '2.0'
        }
      };

      // Archivage dans la collection des refus
      await db.collection(mongoConfig.collections.refus)
        .insertOne(archiveData, { session });

      // Suppression des données associées
      const deletionResults = await Promise.all([
        db.collection(mongoConfig.collections.colis)
          .deleteOne({ colisID: colis.colisID }, { session }),
        db.collection(mongoConfig.collections.livraison)
          .deleteMany({ colisID: colis.colisID }, { session }),
        db.collection(mongoConfig.collections.tracking)
          .deleteOne({ code: colis.colisID }, { session })
      ]);

      log('info', `✅ Colis refusé et supprimé: ${colis.colisID}`, {
        deletedColis: deletionResults[0].deletedCount,
        deletedLivraisons: deletionResults[1].deletedCount,
        deletedTracking: deletionResults[2].deletedCount
      });
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Colis refusé et supprimé du système avec succès',
        archiveId: archiveData._id,
        dateRefus: archiveData.dateRefus.toISOString(),
        information: 'Les données ont été archivées pour audit'
      })
    };

  } catch (error) {
    log('error', "Erreur lors du refus", error);
    
    // Gestion spécifique des erreurs
    const errorMap = {
      'COLIS_NOT_FOUND': {
        statusCode: 404,
        message: 'Colis introuvable',
        details: 'Le colis a peut-être déjà été supprimé'
      },
      'COLIS_ALREADY_DECLINED': {
        statusCode: 409,
        message: 'Colis déjà refusé',
        details: 'Ce colis a déjà été refusé précédemment'
      }
    };
    
    const errorInfo = errorMap[error.message] || {
      statusCode: 500,
      message: 'Erreur technique lors du refus',
      details: 'Contactez le support technique'
    };
    
    return {
      statusCode: errorInfo.statusCode,
      body: JSON.stringify({ 
        success: false,
        error: errorInfo.message,
        details: errorInfo.details
      })
    };
  } finally {
    await session.endSession();
  }
}

/**
 * Génère un code de suivi unique avec retry automatique
 */
async function generateUniqueTrackingCode(db, maxAttempts = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Évite confusion (O,I,0,1)
  const codeLength = 8;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Génération du code
    const code = Array.from({ length: codeLength }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');

    // Vérification d'unicité
    const exists = await db.collection(mongoConfig.collections.colis)
      .findOne({ trackingCode: code });

    if (!exists) {
      log('info', `🎯 Code de suivi généré: ${code} (tentative: ${attempt})`);
      return code;
    }
    
    log('warn', `Code en conflit: ${code}, tentative ${attempt}/${maxAttempts}`);
  }

  throw new Error(`Impossible de générer un code unique après ${maxAttempts} tentatives`);
}

/**
 * Calcule la distance entre deux points GPS (formule de Haversine)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Rayon de la Terre en kilomètres
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c; // Distance en kilomètres
}

/**
 * Calcule le prix de livraison basé sur la distance
 */
function calculateDeliveryPrice(distanceKm) {
  const basePrice = 700; // 700 FCFA pour les 5 premiers km
  const additionalKmPrice = 100; // 100 FCFA par km supplémentaire
  
  if (distanceKm <= 5) {
    return basePrice;
  } else {
    const additionalKm = Math.ceil(distanceKm - 5);
    return basePrice + (additionalKm * additionalKmPrice);
  }
}

/**
 * Normalise une chaîne pour comparaison (supprime accents, espaces, etc.)
 */
function normalizeString(str) {
  return str
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Supprime les accents
    .replace(/[^\w\s]/gi, '') // Supprime la ponctuation
    .replace(/\s+/g, ' '); // Normalise les espaces
}

/**
 * Convertit les degrés en radians
 */
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Enregistre les tentatives de recherche pour surveillance et analyse
 */
async function logSearchAttempt(db, attemptData) {
  try {
    await db.collection('SearchAttempts').insertOne({
      ...attemptData,
      _id: `SEARCH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });
  } catch (error) {
    log('warn', 'Erreur lors de l\'enregistrement de la tentative de recherche', error);
    // N'interrompt pas le processus principal
  }
}