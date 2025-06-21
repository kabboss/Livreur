const { MongoClient } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

// Configuration CORS
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Client MongoDB réutilisable
let cachedClient = null;

async function connectToMongo() {
  if (cachedClient) {
    return cachedClient;
  }
  
  try {
    const client = new MongoClient(MONGODB_URI, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 0,
      maxPoolSize: 10,
    });
    
    await client.connect();
    cachedClient = client;
    return client;
  } catch (error) {
    console.error('Erreur de connexion MongoDB:', error);
    throw new Error('Impossible de se connecter à la base de données');
  }
}

// Fonction pour parser le multipart/form-data
function parseMultipartData(body, contentType) {
  const boundary = contentType.split('boundary=')[1];
  if (!boundary) {
    throw new Error('Boundary manquant dans Content-Type');
  }

  const parts = body.split(`--${boundary}`);
  const result = {};
  let files = {};

  for (const part of parts) {
    if (part.includes('Content-Disposition: form-data')) {
      const nameMatch = part.match(/name="([^"]+)"/);
      if (!nameMatch) continue;

      const fieldName = nameMatch[1];
      const contentStart = part.indexOf('\r\n\r\n') + 4;
      const contentEnd = part.lastIndexOf('\r\n');
      
      if (contentStart >= contentEnd) continue;
      
      const content = part.substring(contentStart, contentEnd);

      // Vérifier si c'est un fichier
      if (part.includes('filename=')) {
        const filenameMatch = part.match(/filename="([^"]+)"/);
        const contentTypeMatch = part.match(/Content-Type: ([^\r\n]+)/);
        
        files[fieldName] = {
          filename: filenameMatch ? filenameMatch[1] : 'unknown',
          contentType: contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream',
          data: Buffer.from(content, 'binary')
        };
      } else {
        result[fieldName] = content;
      }
    }
  }

  return { fields: result, files };
}

// Fonction de validation des données
function validateOrderData(data) {
  const errors = [];

  // Vérification des médicaments
  if (!Array.isArray(data.medications) || data.medications.length === 0) {
    errors.push('Au moins un médicament doit être spécifié');
  } else {
    data.medications.forEach((med, index) => {
      if (!med.name || med.name.trim().length === 0) {
        errors.push(`Le nom du médicament ${index + 1} est requis`);
      }
      if (!med.quantity || med.quantity < 1) {
        errors.push(`La quantité du médicament ${index + 1} doit être supérieure à 0`);
      }
    });
  }

  // Vérification du numéro de téléphone
  if (!data.phoneNumber || !/^\d{8,15}$/.test(data.phoneNumber)) {
    errors.push('Un numéro de téléphone valide (8-15 chiffres) est requis');
  }

  // Vérification de la position
  if (!data.clientPosition || 
      typeof data.clientPosition.latitude !== 'number' || 
      typeof data.clientPosition.longitude !== 'number') {
    errors.push('La position géographique est requise');
  }

  return errors;
}

// Fonction principale
exports.handler = async (event, context) => {
  // Gérer les requêtes OPTIONS (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  // Seules les requêtes POST sont autorisées
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ 
        success: false, 
        error: 'Méthode non autorisée' 
      })
    };
  }

  let client = null;

  try {
    // Parser le contenu de la requête
    let orderData = {};
    let prescriptionFile = null;

    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';

    if (contentType.includes('multipart/form-data')) {
      // Traitement des données multipart (avec fichier)
      const { fields, files } = parseMultipartData(event.body, contentType);
      
      if (fields.data) {
        orderData = JSON.parse(fields.data);
      }
      
      if (files.prescription) {
        prescriptionFile = files.prescription;
      }
    } else {
      // Traitement des données JSON standard
      orderData = JSON.parse(event.body || '{}');
    }

    // Validation des données
    const validationErrors = validateOrderData(orderData);
    if (validationErrors.length > 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Données invalides',
          details: validationErrors
        })
      };
    }

    // Connexion à MongoDB
    client = await connectToMongo();
    const db = client.db(DB_NAME);

    // Préparer les données de commande
    const newOrder = {
      serviceType: 'pharmacy',
      medications: orderData.medications.map(med => ({
        name: med.name.trim(),
        quantity: parseInt(med.quantity),
        notes: med.notes ? med.notes.trim() : ''
      })),
      phoneNumber: orderData.phoneNumber.trim(),
      secondaryPhone: orderData.secondaryPhone ? orderData.secondaryPhone.trim() : '',
      notes: orderData.notes ? orderData.notes.trim() : '',
      clientPosition: {
        latitude: orderData.clientPosition.latitude,
        longitude: orderData.clientPosition.longitude
      },
      orderDate: orderData.orderDate || new Date().toISOString(),
      status: 'pending',
      deliveryFee: 1000,
      hasPrescription: !!prescriptionFile,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Ajouter les informations de prescription si présente
    if (prescriptionFile) {
      newOrder.prescription = {
        filename: prescriptionFile.filename,
        contentType: prescriptionFile.contentType,
        size: prescriptionFile.data.length,
        uploadDate: new Date()
      };
    }

    // Insérer la commande dans la collection
    const ordersCollection = db.collection('pharmacyOrders');
    const result = await ordersCollection.insertOne(newOrder);

    // Stocker le fichier de prescription séparément si présent
    if (prescriptionFile) {
      const filesCollection = db.collection('prescriptionFiles');
      await filesCollection.insertOne({
        orderId: result.insertedId,
        filename: prescriptionFile.filename,
        contentType: prescriptionFile.contentType,
        data: prescriptionFile.data,
        uploadDate: new Date()
      });
    }

    // Réponse de succès
    return {
      statusCode: 201,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        message: 'Commande de pharmacie enregistrée avec succès',
        orderId: result.insertedId,
        orderNumber: `PHARM-${Date.now()}`,
        deliveryFee: 1000,
        hasPrescription: !!prescriptionFile
      })
    };

  } catch (error) {
    console.error('Erreur dans create-pharmacy-order:', error);

    // Gestion des erreurs spécifiques
    let errorMessage = 'Une erreur interne est survenue';
    let statusCode = 500;

    if (error.message.includes('JSON')) {
      errorMessage = 'Format de données invalide';
      statusCode = 400;
    } else if (error.message.includes('connexion') || error.message.includes('MongoDB')) {
      errorMessage = 'Erreur de base de données temporaire';
      statusCode = 503;
    } else if (error.message.includes('Boundary')) {
      errorMessage = 'Format de fichier invalide';
      statusCode = 400;
    }

    return {
      statusCode,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        ...(process.env.NODE_ENV === 'development' && { details: error.message })
      })
    };
  } finally {
    // Note: On ne ferme pas la connexion MongoDB ici pour permettre la réutilisation
    // La connexion sera fermée automatiquement par le runtime serverless
  }
};