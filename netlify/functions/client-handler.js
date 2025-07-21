const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB ultra-sécurisée
const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    livraison: "Livraison",
    refus: "Refus",
    analytics: "Analytics",
    sessions: "Sessions"
  },
  options: {
    connectTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
    minPoolSize: 5,
    retryWrites: true,
    useUnifiedTopology: true,
    maxIdleTimeMS: 30000,
    bufferMaxEntries: 0
  }
};

// Cache de connexion optimisé
let cachedDb = null;
let connectionAttempts = 0;
const maxConnectionAttempts = 3;

/**
 * Connexion MongoDB ultra-robuste avec retry et monitoring
 */
async function connectToDatabase() {
  // Vérification du cache de connexion
  if (cachedDb && cachedDb.client.topology && cachedDb.client.topology.isConnected()) {
    try {
      await cachedDb.db.command({ ping: 1 });
      return cachedDb;
    } catch (error) {
      console.warn('⚠️ Connexion cache invalide, reconnexion...');
      cachedDb = null;
    }
  }

  // Tentatives de connexion avec retry
  while (connectionAttempts < maxConnectionAttempts) {
    try {
      connectionAttempts++;
      console.log(`🔄 Tentative de connexion MongoDB ${connectionAttempts}/${maxConnectionAttempts}`);
      
      const client = new MongoClient(mongoConfig.uri, mongoConfig.options);
      await client.connect();
      
      const db = client.db(mongoConfig.dbName);
      await db.command({ ping: 1 });
      
      // Test des collections critiques
      await Promise.all([
        db.collection(mongoConfig.collections.colis).findOne({}, { limit: 1 }),
        db.collection(mongoConfig.collections.livraison).findOne({}, { limit: 1 })
      ]);
      
      cachedDb = { db, client };
      connectionAttempts = 0; // Reset sur succès
      
      console.log('✅ Connexion MongoDB établie avec succès');
      return cachedDb;
      
    } catch (error) {
      console.error(`❌ Échec connexion MongoDB (tentative ${connectionAttempts}):`, error.message);
      
      if (connectionAttempts >= maxConnectionAttempts) {
        throw new Error(`Impossible de se connecter à MongoDB après ${maxConnectionAttempts} tentatives: ${error.message}`);
      }
      
      // Délai exponentiel entre les tentatives
      const delay = Math.min(1000 * Math.pow(2, connectionAttempts - 1), 5000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Headers CORS ultra-sécurisés
 */
const setCorsHeaders = (response) => ({
  ...response,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Client-ID, X-API-Version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...response.headers
  }
});

/**
 * Validation et sanitisation ultra-avancée
 */
function validateAndSanitizeInput(data, requiredFields = []) {
  const errors = [];
  const sanitized = {};

  // Vérification des champs requis
  for (const field of requiredFields) {
    if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
      errors.push(`Champ requis manquant: ${field}`);
    }
  }

  // Sanitisation des chaînes
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      sanitized[key] = value
        .trim()
        .replace(/[<>\"']/g, '') // Suppression XSS basique
        .substring(0, key === 'description' ? 2000 : 500); // Limite de longueur
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = value; // Objets passés tels quels (location, etc.)
    } else {
      sanitized[key] = value;
    }
  }

  // Validations spécifiques
  if (sanitized.senderPhone || sanitized.recipientPhone || sanitized.numero) {
    const phones = [sanitized.senderPhone, sanitized.recipientPhone, sanitized.numero].filter(Boolean);
    for (const phone of phones) {
      if (!/^(\+226|0)[0-9\s\-]{8,}$/.test(phone.replace(/\s/g, ''))) {
        errors.push(`Format de téléphone invalide: ${phone}`);
      }
    }
  }

  if (sanitized.sender || sanitized.recipient || sanitized.nom) {
    const names = [sanitized.sender, sanitized.recipient, sanitized.nom].filter(Boolean);
    for (const name of names) {
      if (!/^[a-zA-ZÀ-ÿ\s\-'\.]+$/.test(name)) {
        errors.push(`Format de nom invalide: ${name}`);
      }
    }
  }

  if (sanitized.code && !/^[A-Z0-9]{6,20}$/.test(sanitized.code)) {
    errors.push('Format de code de suivi invalide');
  }

  return { sanitized, errors, isValid: errors.length === 0 };
}

/**
 * Logging et analytics avancés
 */
async function logAnalytics(db, eventType, data, sessionId = null) {
  try {
    const analyticsData = {
      eventType,
      timestamp: new Date(),
      sessionId,
      data: {
        ...data,
        userAgent: data.userAgent ? data.userAgent.substring(0, 200) : null
      },
      metadata: {
        serverTimestamp: new Date().toISOString(),
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      }
    };

    await db.collection(mongoConfig.collections.analytics).insertOne(analyticsData);
  } catch (error) {
    console.warn('⚠️ Erreur logging analytics:', error.message);
  }
}

/**
 * Handler principal ultra-robuste
 */
exports.handler = async (event, context) => {
  // Optimisation Lambda
  context.callbackWaitsForEmptyEventLoop = false;
  
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 15);
  
  console.log(`📥 [${requestId}] Requête reçue: ${event.httpMethod} ${event.path}`);

  // Gestion CORS préliminaire
  if (event.httpMethod === 'OPTIONS') {
    return setCorsHeaders({ 
      statusCode: 204, 
      body: '' 
    });
  }

  if (event.httpMethod !== 'POST') {
    return setCorsHeaders({
      statusCode: 405,
      body: JSON.stringify({ 
        error: 'Méthode non autorisée',
        allowed: ['POST', 'OPTIONS'],
        requestId
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
    } catch (parseError) {
      console.error(`❌ [${requestId}] Erreur parsing JSON:`, parseError);
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Format JSON invalide',
          details: parseError.message,
          requestId
        })
      });
    }

    const { action } = data;
    const sessionId = data.sessionId || data.clientId || event.headers['x-client-id'] || requestId;

    if (!action) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Paramètre "action" requis',
          validActions: ['create', 'search', 'accept', 'decline'],
          requestId
        })
      });
    }

    console.log(`🎯 [${requestId}] Action demandée: ${action}`);

    // Analytics de la requête
    await logAnalytics(db, 'request_received', {
      action,
      userAgent: event.headers['user-agent'],
      origin: event.headers.origin,
      referer: event.headers.referer
    }, sessionId);

    // Routage des actions
    let response;
    switch (action) {
      case 'create':
        response = await handleCreatePackage(db, data, sessionId, requestId);
        break;
      case 'search':
        response = await handleSearchPackage(db, data, sessionId, requestId);
        break;
      case 'accept':
        response = await handleAcceptPackage(db, client, data, sessionId, requestId);
        break;
      case 'decline':
        response = await handleDeclinePackage(db, client, data, sessionId, requestId);
        break;
      default:
        response = {
          statusCode: 400,
          body: JSON.stringify({ 
            error: `Action "${action}" non reconnue`,
            validActions: ['create', 'search', 'accept', 'decline'],
            requestId
          })
        };
    }

    // Analytics de succès
    const processingTime = Date.now() - startTime;
    await logAnalytics(db, 'request_completed', {
      action,
      statusCode: response.statusCode,
      processingTime,
      success: response.statusCode < 400
    }, sessionId);

    console.log(`✅ [${requestId}] Action ${action} traitée avec succès (${processingTime}ms)`);
    
    // Ajout des métadonnées de réponse
    const responseBody = JSON.parse(response.body);
    responseBody.requestId = requestId;
    responseBody.processingTime = processingTime;
    response.body = JSON.stringify(responseBody);
    
    return setCorsHeaders(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [${requestId}] Erreur globale du handler (${processingTime}ms):`, error);

    // Analytics d'erreur
    if (dbConnection) {
      try {
        await logAnalytics(dbConnection.db, 'request_error', {
          error: error.message,
          stack: error.stack?.substring(0, 1000),
          processingTime
        }, event.headers['x-client-id']);
      } catch (logError) {
        console.warn('⚠️ Erreur logging analytics:', logError.message);
      }
    }

    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({
        error: 'Erreur serveur interne',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Une erreur est survenue',
        requestId,
        processingTime
      })
    });
  }
};

/**
 * Création de colis ultra-sécurisée
 */
async function handleCreatePackage(db, data, sessionId, requestId) {
  console.log(`📦 [${requestId}] Création d'un nouveau colis`);

  const requiredFields = [
    'sender', 'senderPhone', 'recipient', 'recipientPhone', 
    'address', 'packageType', 'location', 'photos'
  ];
  
  const validation = validateAndSanitizeInput(data, requiredFields);
  if (!validation.isValid) {
    console.error(`❌ [${requestId}] Validation échouée:`, validation.errors);
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Données invalides',
        details: validation.errors,
        requestId
      })
    };
  }

  const sanitizedData = validation.sanitized;

  // Validations spécifiques
  const validPackageTypes = ['petit', 'moyen', 'gros', 'fragile'];
  if (!validPackageTypes.includes(sanitizedData.packageType)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Type de colis invalide',
        validTypes: validPackageTypes,
        received: sanitizedData.packageType,
        requestId
      })
    };
  }

  if (!sanitizedData.location?.latitude || !sanitizedData.location?.longitude) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Coordonnées GPS invalides',
        received: sanitizedData.location,
        requestId
      })
    };
  }

  if (!Array.isArray(sanitizedData.photos) || sanitizedData.photos.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Au moins une photo est requise',
        requestId
      })
    };
  }

  try {
    const trackingCode = await generateTrackingCode(db);
    const now = new Date();

    const packageData = {
      _id: trackingCode,
      colisID: trackingCode,
      trackingCode,
      status: 'pending',
      
      // Informations expéditeur
      sender: sanitizedData.sender,
      senderPhone: sanitizedData.senderPhone,
      
      // Informations destinataire
      recipient: sanitizedData.recipient,
      recipientPhone: sanitizedData.recipientPhone,
      address: sanitizedData.address,
      
      // Détails du colis
      packageType: sanitizedData.packageType,
      description: sanitizedData.description || '',
      photos: sanitizedData.photos,
      
      // Instructions spéciales
      deliveryInstructions: sanitizedData.deliveryInstructions || '',
      urgencyLevel: sanitizedData.urgencyLevel || 'normal',
      
      // Géolocalisation
      location: {
        latitude: parseFloat(sanitizedData.location.latitude),
        longitude: parseFloat(sanitizedData.location.longitude),
        accuracy: sanitizedData.location.accuracy || 0,
        source: sanitizedData.location.source || 'gps'
      },
      
      // Métadonnées temporelles
      createdAt: now,
      updatedAt: now,
      timestamp: sanitizedData.timestamp || now.toISOString(),
      
      // Historique
      history: [{
        status: 'created',
        date: now,
        location: sanitizedData.location,
        action: 'Colis créé par l\'expéditeur',
        sessionId
      }],
      
      // Métadonnées techniques
      metadata: {
        sessionId,
        userAgent: sanitizedData.userAgent,
        version: sanitizedData.version || '2.0',
        ...sanitizedData.metadata
      }
    };

    // Insertion avec gestion des doublons
    await db.collection(mongoConfig.collections.colis).insertOne(packageData);

    // Analytics de création
    await logAnalytics(db, 'package_created', {
      trackingCode,
      packageType: sanitizedData.packageType,
      photosCount: sanitizedData.photos.length,
      hasDescription: !!sanitizedData.description,
      urgencyLevel: sanitizedData.urgencyLevel,
      locationAccuracy: sanitizedData.location.accuracy
    }, sessionId);

    console.log(`✅ [${requestId}] Colis créé avec succès: ${trackingCode}`);
    
    return {
      statusCode: 201,
      body: JSON.stringify({
        success: true,
        trackingCode,
        colisID: trackingCode,
        packageType: sanitizedData.packageType,
        createdAt: now.toISOString(),
        message: 'Colis créé avec succès',
        requestId
      })
    };

  } catch (error) {
    console.error(`❌ [${requestId}] Erreur lors de la création du colis:`, error);
    
    if (error.code === 11000) {
      return {
        statusCode: 409,
        body: JSON.stringify({ 
          error: 'Code de suivi déjà existant',
          message: 'Veuillez réessayer',
          requestId
        })
      };
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Échec de création du colis',
        details: error.message,
        requestId
      })
    };
  }
}

/**
 * Recherche de colis ultra-sécurisée
 */
async function handleSearchPackage(db, data, sessionId, requestId) {
  console.log(`🔍 [${requestId}] Recherche d'un colis`);

  const requiredFields = ['code', 'nom', 'numero'];
  const validation = validateAndSanitizeInput(data, requiredFields);
  
  if (!validation.isValid) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Paramètres de recherche invalides',
        details: validation.errors,
        requestId
      })
    };
  }

  const { code, nom, numero } = validation.sanitized;

  try {
    // Recherche avec index optimisé
    const colis = await db.collection(mongoConfig.collections.colis)
      .findOne({ 
        trackingCode: code.toUpperCase()
      });

    if (!colis) {
      console.log(`❌ [${requestId}] Colis introuvable: ${code}`);
      
      await logAnalytics(db, 'package_not_found', {
        searchCode: code,
        searchName: nom,
        searchPhone: numero
      }, sessionId);
      
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          error: 'Colis introuvable',
          code: code.toUpperCase(),
          message: 'Vérifiez le code de suivi et réessayez',
          requestId
        })
      };
    }

    // Vérification des informations destinataire
    const nomMatch = normalizeString(colis.recipient) === normalizeString(nom);
    const numeroMatch = normalizePhone(colis.recipientPhone) === normalizePhone(numero);

    if (!nomMatch || !numeroMatch) {
      console.log(`❌ [${requestId}] Informations incorrectes pour le colis: ${code}`);
      
      await logAnalytics(db, 'package_access_denied', {
        trackingCode: code,
        nomMatch,
        numeroMatch,
        providedName: nom,
        providedPhone: numero
      }, sessionId);
      
      return {
        statusCode: 403,
        body: JSON.stringify({ 
          error: 'Les informations ne correspondent pas au destinataire enregistré',
          hint: 'Vérifiez l\'orthographe exacte du nom et du numéro de téléphone',
          requestId
        })
      };
    }

    // Suppression des données sensibles
    const { _id, metadata, ...safeColisData } = colis;

    // Analytics de recherche réussie
    await logAnalytics(db, 'package_found', {
      trackingCode: code,
      packageType: colis.packageType,
      status: colis.status,
      createdAt: colis.createdAt
    }, sessionId);

    console.log(`✅ [${requestId}] Colis trouvé et validé: ${code}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        colis: safeColisData,
        message: 'Colis localisé avec succès',
        requestId
      })
    };

  } catch (error) {
    console.error(`❌ [${requestId}] Erreur lors de la recherche:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Erreur lors de la recherche du colis',
        details: error.message,
        requestId
      })
    };
  }
}

/**
 * Acceptation de colis avec transaction ultra-sécurisée
 */
async function handleAcceptPackage(db, client, data, sessionId, requestId) {
  console.log(`✅ [${requestId}] Acceptation d'un colis`);

  const requiredFields = ['colisID', 'location'];
  const validation = validateAndSanitizeInput(data, requiredFields);
  
  if (!validation.isValid) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Données d\'acceptation invalides',
        details: validation.errors,
        requestId
      })
    };
  }

  const { colisID, location, paymentMethod, paymentStatus } = validation.sanitized;

  if (!location?.latitude || !location?.longitude) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Localisation GPS invalide pour l\'acceptation',
        requestId
      })
    };
  }

  const session = client.startSession();
  
  try {
    let livraisonDoc;

    await session.withTransaction(async () => {
      // Vérification de l'existence du colis
      const colis = await db.collection(mongoConfig.collections.colis)
        .findOne({ colisID: colisID.toUpperCase() }, { session });

      if (!colis) {
        throw new Error('Colis introuvable');
      }

      if (colis.status === 'accepted') {
        throw new Error('Colis déjà accepté');
      }

      const now = new Date();
      
      // Calcul du prix de livraison
      const deliveryPricing = calculateAdvancedDeliveryPrice(colis, location);
      
      // Génération de l'ID de livraison
      const livraisonID = `LIV_${colis.colisID}_${now.getTime()}`;
      
      livraisonDoc = {
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
          location: location
        },
        
        // Détails du colis
        colis: {
          type: colis.packageType,
          description: colis.description,
          photos: colis.photos || [],
          urgencyLevel: colis.urgencyLevel || 'normal'
        },
        
        // Tarification avancée
        pricing: deliveryPricing,
        
        // Informations de paiement
        payment: {
          method: paymentMethod || 'delivery',
          status: paymentStatus || (paymentMethod === 'delivery' ? 'pending' : 'verified'),
          amount: deliveryPricing.price,
          currency: 'XOF'
        },
        
        // Statut et dates
        statut: "en_cours_de_livraison",
        dateCreation: colis.createdAt,
        dateAcceptation: now,
        
        // Localisation précise
        localisation: {
          latitude: parseFloat(location.latitude),
          longitude: parseFloat(location.longitude),
          accuracy: location.accuracy || 0,
          timestamp: now,
          source: location.source || 'gps'
        },
        
        // Historique complet
        historique: [
          ...(colis.history || []),
          { 
            event: "accepté_par_destinataire", 
            date: now, 
            location: location,
            action: "Colis accepté par le destinataire",
            paymentMethod: paymentMethod || 'delivery',
            sessionId
          }
        ],
        
        // Métadonnées
        metadata: {
          sessionId,
          acceptedAt: now.toISOString(),
          userAgent: data.userAgent,
          version: '2.0'
        }
      };

      // Insertion de la livraison
      await db.collection(mongoConfig.collections.livraison)
        .insertOne(livraisonDoc, { session });

      // Mise à jour du colis
      await db.collection(mongoConfig.collections.colis).updateOne(
        { colisID: colis.colisID },
        {
          $set: { 
            status: "accepted", 
            updatedAt: now,
            acceptedAt: now,
            destinataireLocation: location,
            paymentMethod: paymentMethod || 'delivery',
            livraisonID
          },
          $push: { 
            history: { 
              status: 'accepted', 
              date: now, 
              location: location,
              action: "Accepté par le destinataire",
              paymentMethod: paymentMethod || 'delivery',
              sessionId
            } 
          }
        },
        { session }
      );

      console.log(`✅ [${requestId}] Colis accepté avec succès: ${colis.colisID}`);
    });

    // Analytics d'acceptation
    await logAnalytics(db, 'package_accepted', {
      colisID,
      livraisonID: livraisonDoc.livraisonID,
      paymentMethod: paymentMethod || 'delivery',
      deliveryPrice: livraisonDoc.pricing.price,
      distance: livraisonDoc.pricing.distance
    }, sessionId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        livraisonID: livraisonDoc.livraisonID,
        status: livraisonDoc.statut,
        dateAcceptation: livraisonDoc.dateAcceptation.toISOString(),
        pricing: livraisonDoc.pricing,
        payment: livraisonDoc.payment,
        message: 'Colis accepté avec succès',
        requestId
      })
    };

  } catch (error) {
    console.error(`❌ [${requestId}] Erreur lors de l'acceptation:`, error);
    
    const statusCode = error.message === 'Colis introuvable' ? 404 : 
                      error.message === 'Colis déjà accepté' ? 409 : 500;
    
    return {
      statusCode,
      body: JSON.stringify({ 
        error: error.message,
        details: error.message === 'Colis introuvable' ? 
          'Vérifiez le code de suivi' : 
          'Contactez le support si le problème persiste',
        requestId
      })
    };
  } finally {
    await session.endSession();
  }
}

/**
 * Refus de colis avec archivage sécurisé
 */
async function handleDeclinePackage(db, client, data, sessionId, requestId) {
  console.log(`❌ [${requestId}] Refus d'un colis`);

  const validation = validateAndSanitizeInput(data, ['colisID']);
  if (!validation.isValid) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'ID du colis requis',
        requestId
      })
    };
  }

  const { colisID, reason = "Refus par le destinataire" } = validation.sanitized;

  const session = client.startSession();
  
  try {
    await session.withTransaction(async () => {
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
        packageType: colis.packageType,
        donneesOriginales: colis,
        metadata: {
          refusePar: 'destinataire',
          sessionId,
          timestamp: now.toISOString(),
          userAgent: data.userAgent
        }
      }, { session });

      // Suppression du colis principal
      await db.collection(mongoConfig.collections.colis)
        .deleteOne({ colisID: colis.colisID }, { session });
      
      // Suppression des livraisons associées
      await db.collection(mongoConfig.collections.livraison)
        .deleteMany({ colisID: colis.colisID }, { session });

      console.log(`✅ [${requestId}] Colis refusé et archivé: ${colis.colisID}`);
    });

    // Analytics de refus
    await logAnalytics(db, 'package_declined', {
      colisID,
      reason,
      declinedBy: 'destinataire'
    }, sessionId);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Colis refusé et supprimé du système avec succès',
        requestId
      })
    };

  } catch (error) {
    console.error(`❌ [${requestId}] Erreur lors du refus:`, error);
    
    const statusCode = error.message === 'Colis introuvable' ? 404 : 500;
    
    return {
      statusCode,
      body: JSON.stringify({ 
        error: error.message,
        details: error.message === 'Colis introuvable' ? 
          'Le colis a peut-être déjà été supprimé' : 
          'Erreur technique lors du refus',
        requestId
      })
    };
  } finally {
    await session.endSession();
  }
}

/**
 * Calcul avancé du prix de livraison
 */
function calculateAdvancedDeliveryPrice(colis, destinationLocation) {
  const packageTypes = {
    petit: { basePrice: 700, additionalPrice: 100, name: 'Petit Colis Express' },
    moyen: { basePrice: 1000, additionalPrice: 120, name: 'Moyen Colis Standard' },
    gros: { basePrice: 2000, additionalPrice: 250, name: 'Gros Colis Premium' },
    fragile: { basePrice: 1500, additionalPrice: 200, name: 'Colis Fragile VIP' }
  };

  const packageType = colis.packageType || 'petit';
  const config = packageTypes[packageType];

  // Calcul de la distance
  let distance = 0;
  if (colis.location && destinationLocation) {
    distance = calculateDistance(
      colis.location.latitude,
      colis.location.longitude,
      destinationLocation.latitude,
      destinationLocation.longitude
    );
  }

  // Calcul du prix de base
  let price = config.basePrice;
  let calculation = `${config.basePrice} FCFA (base ≤5km)`;

  // Ajout pour distance supplémentaire
  if (distance > 5) {
    const additionalKm = Math.ceil(distance - 5);
    const additionalCost = additionalKm * config.additionalPrice;
    price += additionalCost;
    calculation = `${config.basePrice} FCFA (base) + ${additionalKm}km × ${config.additionalPrice} FCFA = ${price} FCFA`;
  }

  // Majoration pour urgence
  const urgencyMultipliers = {
    normal: 1,
    urgent: 1.2,
    express: 1.4
  };
  
  const urgencyLevel = colis.urgencyLevel || 'normal';
  const urgencyMultiplier = urgencyMultipliers[urgencyLevel] || 1;
  
  if (urgencyMultiplier > 1) {
    const urgencyPrice = Math.round(price * urgencyMultiplier);
    const urgencyFee = urgencyPrice - price;
    price = urgencyPrice;
    calculation += ` + ${Math.round((urgencyMultiplier - 1) * 100)}% urgence (${urgencyFee} FCFA) = ${price} FCFA`;
  }

  return {
    price,
    basePrice: config.basePrice,
    distance: parseFloat(distance.toFixed(1)),
    calculation,
    packageType,
    packageTypeName: config.name,
    urgencyLevel,
    urgencyMultiplier,
    breakdown: {
      base: config.basePrice,
      distance: distance > 5 ? Math.ceil(distance - 5) * config.additionalPrice : 0,
      urgency: urgencyMultiplier > 1 ? Math.round(config.basePrice * (urgencyMultiplier - 1)) : 0
    }
  };
}

/**
 * Calcul de distance géographique optimisé
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Rayon de la Terre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Génération de code de suivi ultra-sécurisé
 */
async function generateTrackingCode(db) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codeLength = 8;
  let code, exists;
  let attempts = 0;
  const maxAttempts = 15;

  do {
    if (attempts >= maxAttempts) {
      throw new Error('Impossible de générer un code unique après plusieurs tentatives');
    }

    // Génération avec meilleure entropie
    code = Array.from({ length: codeLength }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');

    // Vérification d'unicité
    exists = await db.collection(mongoConfig.collections.colis)
      .findOne({ trackingCode: code }, { projection: { _id: 1 } });
    
    attempts++;
  } while (exists);

  console.log(`🎯 Code de suivi généré: ${code} (tentatives: ${attempts})`);
  return code;
}

/**
 * Normalisation des chaînes pour comparaison
 */
function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Suppression des accents
    .replace(/[^a-z0-9\s]/g, '') // Suppression caractères spéciaux
    .replace(/\s+/g, ' '); // Normalisation espaces
}

/**
 * Normalisation des numéros de téléphone
 */
function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\(\)]/g, '').replace(/^0/, '+226');
}

/**
 * Middleware de monitoring des performances
 */
function monitorPerformance(functionName, fn) {
  return async (...args) => {
    const start = Date.now();
    try {
      const result = await fn(...args);
      const duration = Date.now() - start;
      console.log(`⚡ ${functionName} exécuté en ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      console.error(`❌ ${functionName} échoué après ${duration}ms:`, error.message);
      throw error;
    }
  };
}

// Export des fonctions avec monitoring
module.exports = {
  handler: monitorPerformance('handler', exports.handler)
};