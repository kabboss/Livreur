const { MongoClient } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Res_livreur';

const mongoClient = new MongoClient(MONGODB_URI, {
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000
});

const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({})
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'Méthode non autorisée'
      })
    };
  }

  try {
    // Validation des données
    const requestBody = JSON.parse(event.body);
    
    const requiredFields = ['id_livreur', 'nom', 'prenom', 'whatsapp', 'quartier'];
    const missingFields = requiredFields.filter(field => !requestBody[field]);
    
    if (missingFields.length > 0) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Champs obligatoires manquants',
          missingFields
        })
      };
    }

    // Connexion à MongoDB
    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);

    // Vérification des doublons
    const existingLivreur = await db.collection(COLLECTION_NAME).findOne({
      $or: [
        { whatsapp: requestBody.whatsapp },
        { id_livreur: requestBody.id_livreur }
      ]
    });

    if (existingLivreur) {
      return {
        statusCode: 409,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Un livreur avec ce numéro ou ID existe déjà'
        })
      };
    }

    // Préparation du document avec gestion de la photo
    const livreurDocument = {
      id_livreur: requestBody.id_livreur,
      nom: requestBody.nom,
      prenom: requestBody.prenom,
      whatsapp: requestBody.whatsapp,
      telephone: requestBody.telephone,
      quartier: requestBody.quartier,
      piece: requestBody.piece,
      date: requestBody.date,
      contact_urgence: requestBody.contact_urgence,
      date_inscription: requestBody.date_inscription || new Date().toISOString(),
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'actif'
    };

    // Ajout des données de la photo compressée si elles existent
    if (requestBody.photo_data) {
      livreurDocument.photo = {
        data: requestBody.photo_data, // Données base64 de l'image compressée
        content_type: requestBody.photo_type || 'image/webp',
        size: requestBody.photo_size || 0,
        width: requestBody.photo_width || 0,
        height: requestBody.photo_height || 0,
        uploaded_at: new Date()
      };
    }

    // Insertion
    const result = await db.collection(COLLECTION_NAME).insertOne(livreurDocument);

    return {
      statusCode: 201,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: true,
        insertedId: result.insertedId,
        message: 'Livreur ajouté avec succès',
        hasPhoto: !!requestBody.photo_data
      })
    };

  } catch (error) {
    console.error('Erreur:', error);
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'Erreur lors de l\'ajout du livreur',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };
  }
};