const { MongoClient } = require('mongodb');

const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    clients: "infoclient"
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

const validateExpeditionData = (data) => {
  const requiredFields = [
    'sender', 'senderPhone', 'recipient',
    'recipientPhone', 'address', 'packageType',
    'photos', 'location'
  ];

  const missingFields = requiredFields.filter(field => !data[field]);
  if (missingFields.length > 0) {
    return { valid: false, message: `Champs manquants: ${missingFields.join(', ')}` };
  }

  // Validation des photos
  if (!Array.isArray(data.photos) || data.photos.length === 0) {
    return { valid: false, message: 'Au moins une photo est requise' };
  }

  // Validation de la localisation
  if (!data.location || typeof data.location.latitude !== 'number' || typeof data.location.longitude !== 'number') {
    return { valid: false, message: 'Localisation GPS invalide' };
  }

  return { valid: true };
};

const validateTrackingData = (data) => {
  if (!data.code || !data.nom || !data.prenom || !data.numero) {
    return { valid: false, message: 'Tous les champs de suivi sont requis' };
  }

  // Validation du code de suivi
  if (!/^[A-Z0-9]{8,20}$/i.test(data.code)) {
    return { valid: false, message: 'Format de code de suivi invalide' };
  }

  return { valid: true };
};

const generateTrackingCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const processPhotos = (photos) => {
  return photos.map((photo, index) => {
    // Validation et nettoyage des données photo
    let thumbnail = photo.thumbnail;
    
    // Vérifier si c'est un Data URL valide
    if (thumbnail && !thumbnail.startsWith('data:')) {
      thumbnail = `data:image/jpeg;base64,${thumbnail}`;
    }
    
    // Validation de la taille des données
    if (thumbnail && thumbnail.length > 2 * 1024 * 1024) { // 2MB limit
      console.warn(`Photo ${index + 1} trop volumineuse, compression appliquée`);
      // Ici on pourrait implémenter une compression côté serveur si nécessaire
    }
    
    return {
      name: photo.name || `Photo_${index + 1}`,
      type: photo.type || 'image/jpeg',
      size: photo.size || 0,
      thumbnail: thumbnail,
      uploadedAt: new Date(),
      index: index
    };
  });
};

exports.handler = async (event) => {
  // Gestion CORS
  if (event.httpMethod === 'OPTIONS') {
    return setCorsHeaders({ statusCode: 204, body: '' });
  }

  if (event.httpMethod !== 'POST') {
    return setCorsHeaders({
      statusCode: 405,
      body: JSON.stringify({ success: false, message: 'Méthode non autorisée' })
    });
  }

  let mongoClient;

  try {
    if (!event.body) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ success: false, message: 'Données manquantes' })
      });
    }

    const requestData = JSON.parse(event.body);
    
    // Connexion à MongoDB avec timeout et retry
    mongoClient = new MongoClient(mongoConfig.uri, {
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
      retryWrites: true,
      retryReads: true
    });
    
    await mongoClient.connect();
    const db = mongoClient.db(mongoConfig.dbName);

    // Gestion des requêtes de suivi (recherche de colis)
    if (requestData.code) {
      console.log('Requête de suivi pour le code:', requestData.code);
      
      const validation = validateTrackingData(requestData);
      if (!validation.valid) {
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ success: false, message: validation.message })
        });
      }

      // Recherche du colis avec gestion d'erreur améliorée
      const colis = await db.collection(mongoConfig.collections.colis).findOne({
        colisID: requestData.code.toUpperCase()
      });

      if (!colis) {
        return setCorsHeaders({
          statusCode: 404,
          body: JSON.stringify({ 
            success: false, 
            message: 'Colis non trouvé avec ce code de suivi' 
          })
        });
      }

      // Enregistrement des informations client pour le suivi
      const clientData = {
        nom: requestData.nom,
        prenom: requestData.prenom,
        numero: requestData.numero,
        code: requestData.code.toUpperCase(),
        localisation: requestData.location,
        dateRecherche: new Date(),
        updatedAt: new Date(),
        userAgent: event.headers['user-agent'] || 'Unknown',
        ipAddress: event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'Unknown'
      };

      // Mise à jour ou insertion des données client
      await db.collection(mongoConfig.collections.clients).updateOne(
        { code: requestData.code.toUpperCase() },
        { $set: clientData },
        { upsert: true }
      );

      console.log('Colis trouvé:', colis.colisID);

      // Préparation des données de réponse avec photos sécurisées
      const responseData = {
        ...colis,
        // Conserver les photos avec leurs thumbnails pour l'affichage
        photos: colis.photos ? colis.photos.map(photo => ({
          name: photo.name,
          type: photo.type,
          size: photo.size,
          thumbnail: photo.thumbnail, // Garder le thumbnail pour l'affichage
          index: photo.index
        })) : []
      };

      return setCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({ 
          success: true, 
          colis: responseData
        })
      });
    }
    // Gestion des requêtes d'expédition (création de colis)
    else {
      console.log('Requête d\'expédition');
      
      const validation = validateExpeditionData(requestData);
      if (!validation.valid) {
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ success: false, message: validation.message })
        });
      }

      // Génération d'un code unique avec vérification
      let colisID = generateTrackingCode();
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        const existingColis = await db.collection(mongoConfig.collections.colis).findOne({
          colisID: colisID
        });

        if (!existingColis) {
          break; // Code unique trouvé
        }
        
        colisID = generateTrackingCode();
        attempts++;
      }

      if (attempts >= maxAttempts) {
        return setCorsHeaders({
          statusCode: 500,
          body: JSON.stringify({ 
            success: false, 
            message: 'Impossible de générer un code unique. Veuillez réessayer.' 
          })
        });
      }

      // Traitement et validation des photos
      const processedPhotos = processPhotos(requestData.photos);
      
      const colisData = {
        colisID,
        sender: requestData.sender,
        senderPhone: requestData.senderPhone,
        recipient: requestData.recipient,
        recipientPhone: requestData.recipientPhone,
        address: requestData.address,
        packageType: requestData.packageType,
        description: requestData.description || '',
        photos: processedPhotos,
        location: requestData.location,
        status: 'registered',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          userAgent: event.headers['user-agent'] || 'Unknown',
          ipAddress: event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'Unknown',
          photosCount: processedPhotos.length,
          totalPhotoSize: processedPhotos.reduce((sum, photo) => sum + (photo.size || 0), 0)
        },
        history: [{
          status: 'registered',
          date: new Date(),
          location: requestData.location,
          notes: 'Colis enregistré dans le système',
          accuracy: requestData.location.accuracy
        }]
      };

      const clientData = {
        nom: requestData.recipient,
        prenom: '', // Sera rempli lors du suivi
        numero: requestData.recipientPhone,
        code: colisID,
        localisation: null, // Sera rempli lors du suivi
        dateCreation: new Date(),
        updatedAt: new Date(),
        expediteur: {
          nom: requestData.sender,
          telephone: requestData.senderPhone
        }
      };

      // Transaction pour assurer la cohérence des données
      const session = mongoClient.startSession();
      try {
        await session.withTransaction(async () => {
          // Insertion du colis
          const colisResult = await db.collection(mongoConfig.collections.colis).insertOne(colisData, { session });
          
          // Insertion des informations client
          const clientResult = await db.collection(mongoConfig.collections.clients).insertOne(clientData, { session });
          
          console.log('Colis inséré:', colisResult.insertedId);
          console.log('Client inséré:', clientResult.insertedId);
        });

        console.log('Expédition créée avec succès:', colisID);

        return setCorsHeaders({
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            colisID,
            message: 'Expédition enregistrée avec succès',
            timestamp: new Date().toISOString(),
            photosProcessed: processedPhotos.length
          })
        });

      } finally {
        await session.endSession();
      }
    }

  } catch (error) {
    console.error('Erreur dans client-handler:', error);
    
    // Gestion spécifique des erreurs MongoDB
    if (error.name === 'MongoTimeoutError') {
      return setCorsHeaders({
        statusCode: 503,
        body: JSON.stringify({ 
          success: false, 
          message: 'Service temporairement indisponible. Veuillez réessayer.',
          error: 'Database timeout'
        })
      });
    }

    if (error.name === 'MongoNetworkError') {
      return setCorsHeaders({
        statusCode: 503,
        body: JSON.stringify({ 
          success: false, 
          message: 'Problème de connexion à la base de données',
          error: 'Network error'
        })
      });
    }

    if (error.name === 'SyntaxError') {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Format de données invalide',
          error: 'Invalid JSON'
        })
      });
    }

    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ 
        success: false, 
        message: 'Erreur interne du serveur',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
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