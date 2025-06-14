const { MongoClient } = require('mongodb');

const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    clients: "infoclient"
  }
};

const client = new MongoClient(mongoConfig.uri, {
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 10000,
  maxPoolSize: 10,
  retryWrites: true,
  retryReads: true
});

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
  return photos.map(photo => ({
    name: photo.name,
    type: photo.type,
    size: photo.size,
    thumbnail: photo.thumbnail || null, // Stocker la version miniature en base64
    data: photo.data // Conserver l'original si vraiment nécessaire
  }));
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
    
    // Connexion à MongoDB avec timeout
    mongoClient = new MongoClient(mongoConfig.uri, {
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 10000
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

      // Recherche du colis
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
        updatedAt: new Date()
      };

      // Mise à jour ou insertion des données client
      await db.collection(mongoConfig.collections.clients).updateOne(
        { code: requestData.code.toUpperCase() },
        { $set: clientData },
        { upsert: true }
      );

      console.log('Colis trouvé:', colis.colisID);

      return setCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({ 
          success: true, 
          colis: {
            ...colis,
            // Masquer les données sensibles si nécessaire
            photos: colis.photos ? colis.photos.map(p => ({ name: p.name, type: p.type })) : []
          }
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

      const colisID = generateTrackingCode();
      
      // Vérification de l'unicité du code
      const existingColis = await db.collection(mongoConfig.collections.colis).findOne({
        colisID: colisID
      });

      if (existingColis) {
        // Régénérer un nouveau code si collision
        const newColisID = generateTrackingCode();
        console.log('Collision de code détectée, nouveau code généré:', newColisID);
      }

      const colisData = {
        colisID,
        sender: requestData.sender,
        senderPhone: requestData.senderPhone,
        recipient: requestData.recipient,
        recipientPhone: requestData.recipientPhone,
        address: requestData.address,
        packageType: requestData.packageType,
        description: requestData.description || '',
        photos: processPhotos(requestData.photos),
        location: requestData.location,
        status: 'registered',
        createdAt: new Date(),
        updatedAt: new Date(),
        history: [{
          status: 'registered',
          date: new Date(),
          location: requestData.location,
          notes: 'Colis enregistré dans le système'
        }]
      };

      const clientData = {
        nom: requestData.recipient,
        prenom: '', // Sera rempli lors du suivi
        numero: requestData.recipientPhone,
        code: colisID,
        localisation: null, // Sera rempli lors du suivi
        dateCreation: new Date(),
        updatedAt: new Date()
      };

      // Transaction pour assurer la cohérence
      const session = mongoClient.startSession();
      try {
        await session.withTransaction(async () => {
          // Insertion du colis
          await db.collection(mongoConfig.collections.colis).insertOne(colisData, { session });
          
          // Insertion des informations client
          await db.collection(mongoConfig.collections.clients).insertOne(clientData, { session });
        });

        console.log('Expédition créée avec succès:', colisID);

        return setCorsHeaders({
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            colisID,
            message: 'Expédition enregistrée avec succès',
            timestamp: new Date().toISOString()
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

    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ 
        success: false, 
        message: 'Erreur interne du serveur',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
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