const { MongoClient } = require('mongodb');

// Configuration MongoDB
const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    livraison: "Livraison"
  }
};

// Configuration CORS
const setCorsHeaders = (response) => {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json'
    }
  };
};

// Génération de code de suivi
const generateTrackingCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Validation des données d'expédition
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

  if (!Array.isArray(data.photos) || data.photos.length === 0) {
    return { valid: false, message: 'Au moins une photo est requise' };
  }

  if (!data.location || typeof data.location.latitude !== 'number' || typeof data.location.longitude !== 'number') {
    return { valid: false, message: 'Localisation GPS invalide' };
  }

  return { valid: true };
};

// Validation des données de recherche
const validateSearchData = (data) => {
  if (!data.code || !data.nom || !data.numero) {
    return { valid: false, message: 'Code de suivi, nom et numéro requis' };
  }

  if (!/^[A-Z0-9]{6,20}$/i.test(data.code)) {
    return { valid: false, message: 'Format de code de suivi invalide' };
  }

  return { valid: true };
};

// Traitement des photos
const processPhotos = (photos) => {
  return photos.map((photo, index) => {
    let thumbnail = photo.thumbnail;
    
    if (thumbnail && !thumbnail.startsWith('data:')) {
      thumbnail = `data:image/jpeg;base64,${thumbnail}`;
    }
    
    if (thumbnail && thumbnail.length > 2 * 1024 * 1024) {
      console.warn(`Photo ${index + 1} trop volumineuse, compression recommandée`);
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

// Fonction principale
exports.handler = async (event) => {
  console.log('🚀 Requête reçue:', event.httpMethod);

  // Gestion CORS
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
        success: false, 
        message: 'Méthode non autorisée' 
      })
    });
  }

  let mongoClient;

  try {
    if (!event.body) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Données manquantes' 
        })
      });
    }

    const requestData = JSON.parse(event.body);
    console.log('📦 Type de requête détecté:', requestData.action || (requestData.code ? 'search' : 'create'));

    // Connexion MongoDB
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

    // === GESTION DE L'ACCEPTATION D'UN COLIS ===
    if (requestData.action === 'accept') {
      console.log('✅ Traitement acceptation colis:', requestData.colisID);
      
      const colis = await db.collection(mongoConfig.collections.colis).findOne({
        colisID: requestData.colisID
      });

      if (!colis) {
        return setCorsHeaders({
          statusCode: 404,
          body: JSON.stringify({ 
            success: false, 
            message: 'Colis non trouvé' 
          })
        });
      }

      // Préparer les données pour la collection Livraison
      const livraisonData = {
        ...colis, // Copie toutes les données du colis
        clientLocation: requestData.location,
        statut: 'en_cours_de_livraison',
        dateAcceptation: new Date(),
        processusDeclenche: true,
        historique: [
          ...(colis.history || []),
          {
            action: 'accepte_par_client',
            date: new Date(),
            location: requestData.location,
            notes: 'Client a accepté le colis - Processus de livraison déclenché'
          }
        ]
      };

      // Utiliser une transaction pour garantir la cohérence
      const session = mongoClient.startSession();
      
      try {
        await session.withTransaction(async () => {
          // 1. Insérer dans Livraison
          await db.collection(mongoConfig.collections.livraison).insertOne(livraisonData, { session });
          
          // 2. Mettre à jour le statut dans Colis
          await db.collection(mongoConfig.collections.colis).updateOne(
            { colisID: requestData.colisID },
            { 
              $set: { 
                status: 'accepte_en_livraison',
                dateAcceptation: new Date(),
                processusDeclenche: true
              },
              $push: {
                history: {
                  action: 'accepte_par_client',
                  date: new Date(),
                  location: requestData.location,
                  notes: 'Client a accepté - Transféré vers processus de livraison'
                }
              }
            },
            { session }
          );
        });

        console.log('✅ Colis accepté et transféré vers livraison');

        return setCorsHeaders({
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            message: 'Colis accepté avec succès. Le processus de livraison a été déclenché.',
            livraison: {
              colisID: requestData.colisID,
              statut: 'en_cours_de_livraison',
              dateAcceptation: new Date()
            }
          })
        });

      } finally {
        await session.endSession();
      }
    }

    // === GESTION DU REFUS D'UN COLIS ===
    if (requestData.action === 'decline') {
      console.log('❌ Traitement refus colis:', requestData.colisID);
      
      const session = mongoClient.startSession();
      
      try {
        await session.withTransaction(async () => {
          // Supprimer de toutes les collections
          await db.collection(mongoConfig.collections.colis).deleteOne(
            { colisID: requestData.colisID },
            { session }
          );
          
          await db.collection(mongoConfig.collections.livraison).deleteOne(
            { colisID: requestData.colisID },
            { session }
          );
        });

        console.log('❌ Colis refusé et supprimé définitivement');

        return setCorsHeaders({
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            message: 'Colis refusé et supprimé définitivement du système.'
          })
        });

      } finally {
        await session.endSession();
      }
    }

    // === RECHERCHE DE COLIS (CLIENT) ===
    if (requestData.code && !requestData.action) {
      console.log('🔍 Recherche de colis:', requestData.code);
      
      const validation = validateSearchData(requestData);
      if (!validation.valid) {
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            message: validation.message 
          })
        });
      }

      const colis = await db.collection(mongoConfig.collections.colis).findOne({
        colisID: requestData.code.toUpperCase()
      });

      if (!colis) {
        return setCorsHeaders({
          statusCode: 404,
          body: JSON.stringify({ 
            success: false, 
            message: 'Aucun colis trouvé avec ce code de suivi' 
          })
        });
      }

      console.log('✅ Colis trouvé:', colis.colisID);

      // Préparer les données de réponse sécurisées
      const responseData = {
        ...colis,
        photos: colis.photos ? colis.photos.map(photo => ({
          name: photo.name,
          type: photo.type,
          size: photo.size,
          thumbnail: photo.thumbnail,
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

    // === CRÉATION D'EXPÉDITION (EXPÉDITEUR) ===
    if (!requestData.code && !requestData.action) {
      console.log('📦 Création d\'expédition');
      
      const validation = validateExpeditionData(requestData);
      if (!validation.valid) {
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            message: validation.message 
          })
        });
      }

      // Génération d'un code unique
      let trackingCode = generateTrackingCode();
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        const existingColis = await db.collection(mongoConfig.collections.colis).findOne({
          colisID: trackingCode
        });

        if (!existingColis) {
          break;
        }
        
        trackingCode = generateTrackingCode();
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

      // Traitement des photos
      const processedPhotos = processPhotos(requestData.photos);
      
      // Données du colis
      const colisData = {
        colisID: trackingCode,
        sender: requestData.sender,
        senderPhone: requestData.senderPhone,
        recipient: requestData.recipient,
        recipientPhone: requestData.recipientPhone,
        address: requestData.address,
        packageType: requestData.packageType,
        description: requestData.description || '',
        photos: processedPhotos,
        location: requestData.location,
        status: 'en_attente_validation',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          userAgent: event.headers['user-agent'] || 'Unknown',
          ipAddress: event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'Unknown',
          photosCount: processedPhotos.length,
          totalPhotoSize: processedPhotos.reduce((sum, photo) => sum + (photo.size || 0), 0)
        },
        history: [{
          action: 'cree',
          date: new Date(),
          location: requestData.location,
          notes: 'Colis créé par l\'expéditeur - En attente de validation par le destinataire',
          accuracy: requestData.location.accuracy
        }]
      };

      // Insertion du colis
      const result = await db.collection(mongoConfig.collections.colis).insertOne(colisData);
      
      console.log('✅ Expédition créée:', trackingCode, 'ID:', result.insertedId);

      return setCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          trackingCode: trackingCode,
          colisID: trackingCode,
          message: 'Expédition enregistrée avec succès',
          timestamp: new Date().toISOString(),
          photosProcessed: processedPhotos.length
        })
      });
    }

    // Si aucune action correspondante
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ 
        success: false, 
        message: 'Action non reconnue' 
      })
    });

  } catch (error) {
    console.error('❌ Erreur dans colis-handler:', error);
    
    // Gestion spécifique des erreurs
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
        console.log('🔒 Connexion MongoDB fermée');
      } catch (closeError) {
        console.error('❌ Erreur fermeture MongoDB:', closeError);
      }
    }
  }
};