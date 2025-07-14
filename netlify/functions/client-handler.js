const { MongoClient, ObjectId } = require('mongodb');

// 1. Configuration centralisée
const CONFIG = {
  mongo: {
    uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
    dbName: "FarmsConnect",
    collections: {
      packages: "Colis",
      deliveries: "Livraison",
      refusals: "Refus",
      tracking: "TrackingCodes",
      clients: "infoclient",
      payments: "Payments",
      searchAttempts: "SearchAttempts"
    },
    options: {
      connectTimeoutMS: 10000,
      socketTimeoutMS: 30000,
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 15,
      minPoolSize: 2,
      retryWrites: true,
      retryReads: true
    }
  },
  delivery: {
    basePrice: 700, // XOF
    additionalKmPrice: 100, // XOF
    freeKm: 5 // km
  },
  security: {
    maxSearchAttempts: 5,
    trackingCodeLength: 8,
    allowedChars: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclut les caractères ambigus
  }
};

// 2. Gestion de connexion MongoDB avec cache
let mongoClient = null;

async function getMongoConnection() {
  if (mongoClient && mongoClient.isConnected()) {
    return {
      client: mongoClient,
      db: mongoClient.db(CONFIG.mongo.dbName)
    };
  }

  try {
    mongoClient = new MongoClient(CONFIG.mongo.uri, CONFIG.mongo.options);
    await mongoClient.connect();
    
    // Vérification de la connexion
    await mongoClient.db(CONFIG.mongo.dbName).command({ ping: 1 });
    
    return {
      client: mongoClient,
      db: mongoClient.db(CONFIG.mongo.dbName)
    };
  } catch (error) {
    mongoClient = null;
    throw new Error(`MongoDB connection failed: ${error.message}`);
  }
}

// 3. Utilitaires généraux
const utils = {
  // Formatage des réponses
  response: (statusCode, body, headers = {}) => ({
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET, PUT, DELETE',
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  }),

  // Validation des données
  validate: (data, rules) => {
    const errors = [];
    
    for (const [field, validator] of Object.entries(rules)) {
      const value = data[field];
      const error = validator(value, data);
      if (error) errors.push({ field, error });
    }
    
    return errors.length ? errors : null;
  },

  // Sanitisation des données
  sanitize: (input) => {
    if (typeof input !== 'object' || input === null) return input;
    
    const output = Array.isArray(input) ? [] : {};
    
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string') {
        output[key] = value
          .trim()
          .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
          .substring(0, 1000);
      } else if (typeof value === 'object') {
        output[key] = utils.sanitize(value);
      } else {
        output[key] = value;
      }
    }
    
    return output;
  },

  // Génération de codes uniques
  generateTrackingCode: async (db) => {
    const { allowedChars, trackingCodeLength } = CONFIG.security;
    
    for (let attempt = 1; attempt <= 5; attempt++) {
      const code = Array.from({ length: trackingCodeLength }, () =>
        allowedChars.charAt(Math.floor(Math.random() * allowedChars.length))
      ).join('');

      const exists = await db.collection(CONFIG.mongo.collections.packages)
        .findOne({ trackingCode: code });

      if (!exists) return code;
    }
    
    throw new Error('Failed to generate unique tracking code');
  },

  // Calcul de distance et prix
  calculateDelivery: (origin, destination) => {
    // Formule Haversine simplifiée
    const R = 6371;
    const dLat = (destination.latitude - origin.latitude) * Math.PI / 180;
    const dLon = (destination.longitude - origin.longitude) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(origin.latitude * Math.PI / 180) * 
      Math.cos(destination.latitude * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    // Calcul du prix
    const { basePrice, additionalKmPrice, freeKm } = CONFIG.delivery;
    const price = distance <= freeKm 
      ? basePrice 
      : basePrice + Math.ceil(distance - freeKm) * additionalKmPrice;

    return { distance: parseFloat(distance.toFixed(2)), price };
  }
};

// 4. Logging amélioré
class Logger {
  static log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...data
    };

    console.log(JSON.stringify(logEntry));
    
    // En production, vous pourriez envoyer les logs à un service externe
    if (level === 'error' && process.env.NODE_ENV === 'production') {
      // TODO: Implémenter l'envoi des erreurs critiques
    }
  }
}

// 5. Handlers métier
const packageHandlers = {
  create: async (db, data) => {
    // Validation
    const errors = utils.validate(data, {
      sender: v => !v ? 'Sender is required' : null,
      senderPhone: v => !/^\d{8,15}$/.test(v) ? 'Invalid phone format' : null,
      recipient: v => !v ? 'Recipient is required' : null,
      recipientPhone: v => !/^\d{8,15}$/.test(v) ? 'Invalid phone format' : null,
      address: v => !v ? 'Address is required' : null,
      packageType: v => !v ? 'Package type is required' : null,
      location: v => !v || !v.latitude || !v.longitude ? 'Valid location required' : null,
      photos: v => !Array.isArray(v) || v.length === 0 ? 'At least one photo required' : null
    });

    if (errors) {
      throw { 
        statusCode: 400, 
        message: 'Validation failed',
        details: errors 
      };
    }

    // Génération du code de suivi
    const trackingCode = await utils.generateTrackingCode(db);
    const now = new Date();

    // Construction du package
    const packageData = {
      _id: trackingCode,
      trackingCode,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...utils.sanitize(data),
      history: [{
        status: 'created',
        date: now,
        action: 'Package created',
        location: data.location
      }],
      security: {
        attempts: 0,
        lastActivity: now
      }
    };

    // Insertion en base
    await db.collection(CONFIG.mongo.collections.packages)
      .insertOne(packageData);

    Logger.log('info', 'Package created', { trackingCode });

    return {
      trackingCode,
      createdAt: now,
      qrCodeUrl: `${process.env.CLIENT_URL || 'https://send20.netlify.app'}/track?code=${trackingCode}`
    };
  },

  search: async (db, data) => {
    const errors = utils.validate(data, {
      code: v => !v ? 'Tracking code is required' : null,
      nom: v => !v ? 'Name is required' : null,
      numero: v => !/^\d{8,15}$/.test(v) ? 'Invalid phone format' : null
    });

    if (errors) {
      throw { 
        statusCode: 400, 
        message: 'Validation failed',
        details: errors 
      };
    }

    const { code, nom, numero } = data;
    const normalizedCode = code.toUpperCase().trim();
    const normalizedPhone = numero.replace(/\D/g, '');

    // Recherche du colis
    const package = await db.collection(CONFIG.mongo.collections.packages)
      .findOne({ trackingCode: normalizedCode });

    if (!package) {
      Logger.log('warn', 'Package not found', { code: normalizedCode });
      throw { statusCode: 404, message: 'Package not found' };
    }

    // Vérification des informations
    const nameMatch = utils.normalizeString(nom) === utils.normalizeString(package.recipient);
    const phoneMatch = normalizedPhone === package.recipientPhone.replace(/\D/g, '');

    if (!nameMatch || !phoneMatch) {
      Logger.log('warn', 'Invalid package credentials', {
        code: normalizedCode,
        nameMatch,
        phoneMatch
      });

      // Enregistrement de la tentative échouée
      await db.collection(CONFIG.mongo.collections.searchAttempts).insertOne({
        code: normalizedCode,
        attemptAt: new Date(),
        success: false,
        ip: data.clientIp
      });

      throw { statusCode: 403, message: 'Invalid credentials' };
    }

    // Mise à jour de l'activité
    await db.collection(CONFIG.mongo.collections.packages).updateOne(
      { trackingCode: normalizedCode },
      { $set: { 'security.lastActivity': new Date() } }
    );

    // Retour des données (sans les champs sensibles)
    const { _id, security, history, ...responseData } = package;
    
    return responseData;
  },

  accept: async (db, client, data) => {
    const session = client.startSession();
    
    try {
      let deliveryDoc;

      await session.withTransaction(async () => {
        // Validation
        const errors = utils.validate(data, {
          colisID: v => !v ? 'Package ID is required' : null,
          location: v => !v || !v.latitude || !v.longitude ? 'Valid location required' : null
        });

        if (errors) throw { statusCode: 400, details: errors };

        // Récupération du colis
        const package = await db.collection(CONFIG.mongo.collections.packages)
          .findOne({ colisID: data.colisID }, { session });

        if (!package) throw { statusCode: 404, message: 'Package not found' };
        if (package.status !== 'pending') {
          throw { 
            statusCode: 409, 
            message: `Package already ${package.status}`
          };
        }

        // Calcul de la livraison
        const now = new Date();
        const { distance, price } = utils.calculateDelivery(
          package.location,
          data.location
        );

        // Création de la livraison
        deliveryDoc = {
          _id: `DLV_${Date.now()}`,
          packageId: package._id,
          status: 'in_progress',
          distance,
          price,
          currency: 'XOF',
          acceptedAt: now,
          history: [
            ...(package.history || []),
            {
              status: 'accepted',
              date: now,
              action: 'Package accepted by recipient'
            }
          ]
        };

        // Mise à jour du statut
        await db.collection(CONFIG.mongo.collections.packages).updateOne(
          { _id: package._id },
          { $set: { status: 'accepted', updatedAt: now } },
          { session }
        );

        // Création de la livraison
        await db.collection(CONFIG.mongo.collections.deliveries)
          .insertOne(deliveryDoc, { session });

        Logger.log('info', 'Package accepted', { 
          packageId: package._id,
          distance,
          price 
        });
      });

      return {
        deliveryId: deliveryDoc._id,
        status: deliveryDoc.status,
        price: deliveryDoc.price,
        currency: deliveryDoc.currency
      };
    } finally {
      await session.endSession();
    }
  },

  decline: async (db, client, data) => {
    const session = client.startSession();
    
    try {
      let refusalDoc;

      await session.withTransaction(async () => {
        if (!data.colisID) {
          throw { statusCode: 400, message: 'Package ID is required' };
        }

        // Récupération du colis
        const package = await db.collection(CONFIG.mongo.collections.packages)
          .findOne({ colisID: data.colisID }, { session });

        if (!package) throw { statusCode: 404, message: 'Package not found' };
        if (package.status === 'declined') {
          throw { statusCode: 409, message: 'Package already declined' };
        }

        // Archivage du refus
        const now = new Date();
        refusalDoc = {
          _id: `REF_${Date.now()}`,
          packageId: package._id,
          reason: data.reason || 'No reason provided',
          declinedAt: now,
          originalData: package
        };

        await db.collection(CONFIG.mongo.collections.refusals)
          .insertOne(refusalDoc, { session });

        // Suppression du colis
        await db.collection(CONFIG.mongo.collections.packages)
          .deleteOne({ _id: package._id }, { session });

        Logger.log('info', 'Package declined', { 
          packageId: package._id,
          reason: refusalDoc.reason 
        });
      });

      return {
        refusalId: refusalDoc._id,
        declinedAt: refusalDoc.declinedAt
      };
    } finally {
      await session.endSession();
    }
  }
};

// 6. Handler principal
exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  
  try {
    // Gestion des OPTIONS CORS
    if (event.httpMethod === 'OPTIONS') {
      return utils.response(204, {});
    }

    // Vérification de la méthode
    if (event.httpMethod !== 'POST') {
      return utils.response(405, { error: 'Method not allowed' });
    }

    // Connexion à MongoDB
    const { db, client } = await getMongoConnection();
    
    // Parsing du body
    let data;
    try {
      data = JSON.parse(event.body || '{}');
      data = utils.sanitize(data);
    } catch (e) {
      return utils.response(400, { error: 'Invalid JSON format' });
    }

    // Vérification de l'action
    if (!data.action || !packageHandlers[data.action]) {
      return utils.response(400, { 
        error: 'Invalid action',
        validActions: Object.keys(packageHandlers)
      });
    }

    // Ajout des métadonnées de la requête
    data.clientIp = event.headers['client-ip'] || event.headers['x-forwarded-for'];
    data.userAgent = event.headers['user-agent'];

    // Exécution du handler
    const result = await packageHandlers[data.action](db, client, data);
    
    return utils.response(200, { success: true, ...result });
    
  } catch (error) {
    Logger.log('error', 'Handler error', { 
      error: error.message,
      stack: error.stack 
    });

    const statusCode = error.statusCode || 500;
    const response = {
      success: false,
      error: error.message || 'Internal server error'
    };

    if (error.details) response.details = error.details;
    if (process.env.NODE_ENV === 'development') response.stack = error.stack;

    return utils.response(statusCode, response);
  }
};