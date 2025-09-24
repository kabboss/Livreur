const { MongoClient, ObjectId } = require('mongodb');

// Configuration MongoDB
const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    livraison: "Livraison",
    refus: "Refus",
    analytics: "Analytics"
  },
  options: {
    connectTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
    minPoolSize: 5,
    retryWrites: true,
    useUnifiedTopology: true
  }
};

// Cache de connexion
let cachedDb = null;

/**
 * Connexion MongoDB optimisée
 */
async function connectToDatabase() {
  if (cachedDb && cachedDb.client.topology?.isConnected()) {
    try {
      await cachedDb.db.command({ ping: 1 });
      return cachedDb;
    } catch (error) {
      console.warn('⚠️ Connexion cache invalide, reconnexion...');
      cachedDb = null;
    }
  }

  try {
    console.log('🔄 Connexion à MongoDB...');
    const client = new MongoClient(mongoConfig.uri, mongoConfig.options);
    await client.connect();
    
    const db = client.db(mongoConfig.dbName);
    await db.command({ ping: 1 });
    
    cachedDb = { db, client };
    console.log('✅ MongoDB connecté avec succès');
    return cachedDb;
    
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB:', error.message);
    throw new Error(`Impossible de se connecter à MongoDB: ${error.message}`);
  }
}

/**
 * Headers CORS sécurisés
 */
const getCorsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, must-revalidate'
});

/**
 * Validation et sanitisation des données
 */
function validateAndSanitize(data, requiredFields = []) {
  const errors = [];
  const sanitized = {};

  // Vérification des champs requis
  for (const field of requiredFields) {
    if (!data[field] || (typeof data[field] === 'string' && !data[field].trim())) {
      errors.push(`Champ requis manquant: ${field}`);
    }
  }

  // Sanitisation
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      sanitized[key] = value.trim().replace(/[<>\"']/g, '').substring(0, 2000);
    } else {
      sanitized[key] = value;
    }
  }

  // Validations spécifiques
  if (sanitized.senderPhone || sanitized.recipientPhone || sanitized.numero) {
    const phones = [sanitized.senderPhone, sanitized.recipientPhone, sanitized.numero].filter(Boolean);
    for (const phone of phones) {
// Nouvelle validation qui accepte :
// - Numéros commençant par +226 ou 0
// - Numéros à 8 chiffres sans indicatif (comme 56663638)
if (!/^(\+226|0)?[0-9\s\-]{8,}$/.test(phone.replace(/\s/g, '')) || 
    phone.replace(/\D/g, '').length < 8) {
  errors.push(`Format de téléphone invalide: ${phone}`);
}
    }
  }

  if (sanitized.code && !/^[A-Z0-9]{6,20}$/.test(sanitized.code)) {
    errors.push('Format de code de suivi invalide');
  }

  return { sanitized, errors, isValid: errors.length === 0 };
}

/**
 * Logging analytics
 */
async function logAnalytics(db, eventType, data, sessionId = null) {
  try {
    await db.collection(mongoConfig.collections.analytics).insertOne({
      eventType,
      timestamp: new Date(),
      sessionId,
      data: { ...data, userAgent: data.userAgent?.substring(0, 200) || null }
    });
  } catch (error) {
    console.warn('⚠️ Erreur analytics:', error.message);
  }
}

/**
 * Génération de code de suivi unique
 */
async function generateTrackingCode(db) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code, exists;
  let attempts = 0;

  do {
    if (attempts >= 10) {
      throw new Error('Impossible de générer un code unique');
    }

    code = Array.from({ length: 8 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');

    exists = await db.collection(mongoConfig.collections.colis)
      .findOne({ trackingCode: code });
    
    attempts++;
  } while (exists);

  return code;
}

/**
 * Calcul du prix de livraison
 */
function calculateDeliveryPrice(packageType, distanceKm) {
  const packageTypes = {
    petit: { basePrice: 700, additionalPrice: 100 },
    moyen: { basePrice: 1000, additionalPrice: 120 },
    gros: { basePrice: 2000, additionalPrice: 250 },
    fragile: { basePrice: 1500, additionalPrice: 200 }
  };

  const config = packageTypes[packageType] || packageTypes.petit;
  
  if (distanceKm <= 5) {
    return config.basePrice;
  } else {
    const additionalKm = Math.ceil(distanceKm - 5);
    return config.basePrice + (additionalKm * config.additionalPrice);
  }
}

/**
 * Calcul de distance géographique
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
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
 * Normalisation des chaînes
 */
function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Normalisation des numéros de téléphone
 */
function normalizePhone(phone) {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, ''); // Supprime tout sauf les chiffres
  
  // Si le numéro a 8 chiffres et ne commence pas par 0 ou +226, ajoute +226
  if (cleaned.length === 8 && !cleaned.startsWith('0') && !cleaned.startsWith('226')) {
    return `+226${cleaned}`;
  }
  
  // Sinon, traitement normal
  return cleaned.replace(/^0/, '+226');
}

/**
 * Création de colis
 */
async function handleCreatePackage(db, data, sessionId) {
  console.log('📦 Création d\'un nouveau colis');

  const requiredFields = [
    'sender', 'senderPhone', 'recipient', 'recipientPhone', 
    'address', 'packageType', 'location', 'photos'
  ];
  
  const validation = validateAndSanitize(data, requiredFields);
  if (!validation.isValid) {
    throw new Error(`Données invalides: ${validation.errors.join(', ')}`);
  }

  const sanitizedData = validation.sanitized;

  // Validations spécifiques
  const validPackageTypes = ['petit', 'moyen', 'gros', 'fragile'];
  if (!validPackageTypes.includes(sanitizedData.packageType)) {
    throw new Error(`Type de colis invalide. Types valides: ${validPackageTypes.join(', ')}`);
  }

  if (!sanitizedData.location?.latitude || !sanitizedData.location?.longitude) {
    throw new Error('Coordonnées GPS invalides');
  }

  if (!Array.isArray(sanitizedData.photos) || sanitizedData.photos.length === 0) {
    throw new Error('Au moins une photo est requise');
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
      
      // Géolocalisation
      location: {
        latitude: parseFloat(sanitizedData.location.latitude),
        longitude: parseFloat(sanitizedData.location.longitude),
        accuracy: sanitizedData.location.accuracy || 0
      },
      
      // Métadonnées
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
        version: '2.0'
      }
    };

    await db.collection(mongoConfig.collections.colis).insertOne(packageData);

    await logAnalytics(db, 'package_created', {
      trackingCode,
      packageType: sanitizedData.packageType,
      photosCount: sanitizedData.photos.length
    }, sessionId);

    console.log(`✅ Colis créé: ${trackingCode}`);
    
    return {
      success: true,
      trackingCode,
      colisID: trackingCode,
      packageType: sanitizedData.packageType,
      createdAt: now.toISOString(),
      message: 'Colis créé avec succès'
    };

  } catch (error) {
    if (error.code === 11000) {
      throw new Error('Code de suivi déjà existant, veuillez réessayer');
    }
    throw error;
  }
}

/**
 * Recherche de colis
 */
async function handleSearchPackage(db, data, sessionId) {
  console.log('🔍 Recherche d\'un colis');

  const requiredFields = ['code', 'nom', 'numero'];
  const validation = validateAndSanitize(data, requiredFields);
  
  if (!validation.isValid) {
    throw new Error(`Paramètres de recherche invalides: ${validation.errors.join(', ')}`);
  }

  const { code, nom, numero } = validation.sanitized;

  try {
    const colis = await db.collection(mongoConfig.collections.colis)
      .findOne({ trackingCode: code.toUpperCase() });

    if (!colis) {
      await logAnalytics(db, 'package_not_found', {
        searchCode: code,
        searchName: nom,
        searchPhone: numero
      }, sessionId);
      
      throw new Error('Colis introuvable avec ce code de suivi');
    }

    // Vérification des informations destinataire
    const nomMatch = normalizeString(colis.recipient) === normalizeString(nom);
    const numeroMatch = normalizePhone(colis.recipientPhone) === normalizePhone(numero);

    if (!nomMatch || !numeroMatch) {
      await logAnalytics(db, 'package_access_denied', {
        trackingCode: code,
        nomMatch,
        numeroMatch
      }, sessionId);
      
      throw new Error('Les informations ne correspondent pas au destinataire enregistré');
    }

    // Suppression des données sensibles
    const { _id, metadata, ...safeColisData } = colis;

    await logAnalytics(db, 'package_found', {
      trackingCode: code,
      packageType: colis.packageType,
      status: colis.status
    }, sessionId);

    console.log(`✅ Colis trouvé: ${code}`);
    
    return { 
      success: true, 
      colis: safeColisData,
      message: 'Colis localisé avec succès'
    };

  } catch (error) {
    throw error;
  }
}

/**
 * Acceptation de colis
 */
async function handleAcceptPackage(db, client, data, sessionId) {
  console.log('✅ Acceptation d\'un colis');

  const requiredFields = ['colisID', 'location'];
  const validation = validateAndSanitize(data, requiredFields);
  
  if (!validation.isValid) {
    throw new Error(`Données d'acceptation invalides: ${validation.errors.join(', ')}`);
  }

  const { colisID, location, paymentMethod, paymentStatus } = validation.sanitized;

  if (!location?.latitude || !location?.longitude) {
    throw new Error('Localisation GPS invalide pour l\'acceptation');
  }

  const session = client.startSession();
  
  try {
    let livraisonDoc;

    await session.withTransaction(async () => {
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
      let distance = 0;
      let deliveryPrice = 0;

      if (colis.location && location) {
        distance = calculateDistance(
          colis.location.latitude,
          colis.location.longitude,
          location.latitude,
          location.longitude
        );
        deliveryPrice = calculateDeliveryPrice(colis.packageType, distance);
      }
      
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
          photos: colis.photos || []
        },
        
        // Tarification
        pricing: {
          price: deliveryPrice,
          distance: parseFloat(distance.toFixed(1)),
          packageType: colis.packageType
        },
        
        // Informations de paiement
        payment: {
          method: paymentMethod || 'delivery',
          status: paymentStatus || (paymentMethod === 'delivery' ? 'pending' : 'verified'),
          amount: deliveryPrice,
          currency: 'XOF'
        },
        
        // Statut et dates
        statut: "en_attente_assignation",
        dateCreation: colis.createdAt,
        dateAcceptation: now,
        
        // Localisation
        localisation: {
          latitude: parseFloat(location.latitude),
          longitude: parseFloat(location.longitude),
          accuracy: location.accuracy || 0,
          timestamp: now
        },
        
        // Historique
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

      console.log(`✅ Colis accepté: ${colis.colisID}`);
    });

    await logAnalytics(db, 'package_accepted', {
      colisID,
      livraisonID: livraisonDoc.livraisonID,
      paymentMethod: paymentMethod || 'delivery',
      deliveryPrice: livraisonDoc.pricing.price
    }, sessionId);

    return {
      success: true,
      livraisonID: livraisonDoc.livraisonID,
      status: livraisonDoc.statut,
      dateAcceptation: livraisonDoc.dateAcceptation.toISOString(),
      pricing: livraisonDoc.pricing,
      payment: livraisonDoc.payment,
      message: 'Colis accepté avec succès'
    };

  } catch (error) {
    throw error;
  } finally {
    await session.endSession();
  }
}

/**
 * Refus de colis
 */
async function handleDeclinePackage(db, client, data, sessionId) {
  console.log('❌ Refus d\'un colis');

  const validation = validateAndSanitize(data, ['colisID']);
  if (!validation.isValid) {
    throw new Error('ID du colis requis pour le refus');
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

      console.log(`✅ Colis refusé et archivé: ${colis.colisID}`);
    });

    await logAnalytics(db, 'package_declined', {
      colisID,
      reason,
      declinedBy: 'destinataire'
    }, sessionId);

    return { 
      success: true, 
      message: 'Colis refusé et supprimé du système avec succès'
    };

  } catch (error) {
    throw error;
  } finally {
    await session.endSession();
  }
}

/**
 * Handler principal
 */
exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(2, 15);
  
  console.log(`📥 [${requestId}] Requête ${event.httpMethod} reçue`);

  // Gestion CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: getCorsHeaders(),
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: getCorsHeaders(),
      body: JSON.stringify({ 
        error: 'Méthode non autorisée',
        requestId
      })
    };
  }

  let dbConnection = null;
  
  try {
    // Connexion à la base de données
    dbConnection = await connectToDatabase();
    const { db, client } = dbConnection;

    // Parsing du body
    let data;
    try {
      data = JSON.parse(event.body || '{}');
    } catch (parseError) {
      throw new Error('Format JSON invalide');
    }

    const { action } = data;
    const sessionId = data.sessionId || requestId;

    if (!action) {
      throw new Error('Paramètre "action" requis');
    }

    console.log(`🎯 [${requestId}] Action: ${action}`);

    // Routage des actions
    let response;
    switch (action) {
      case 'create':
        response = await handleCreatePackage(db, data, sessionId);
        break;
      case 'search':
        response = await handleSearchPackage(db, data, sessionId);
        break;
      case 'accept':
        response = await handleAcceptPackage(db, client, data, sessionId);
        break;
      case 'decline':
        response = await handleDeclinePackage(db, client, data, sessionId);
        break;
      default:
        throw new Error(`Action "${action}" non reconnue`);
    }

    const processingTime = Date.now() - startTime;
    console.log(`✅ [${requestId}] ${action} traité avec succès (${processingTime}ms)`);
    
    return {
      statusCode: action === 'create' ? 201 : 200,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        ...response,
        requestId,
        processingTime
      })
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [${requestId}] Erreur (${processingTime}ms):`, error.message);

    const statusCode = 
      error.message.includes('introuvable') ? 404 :
      error.message.includes('déjà accepté') || error.message.includes('déjà existant') ? 409 :
      error.message.includes('invalide') || error.message.includes('requis') ? 400 :
      500;

    return {
      statusCode,
      headers: getCorsHeaders(),
      body: JSON.stringify({
        error: error.message,
        requestId,
        processingTime
      })
    };
  }
};