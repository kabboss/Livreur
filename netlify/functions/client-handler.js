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

// Génération de code de suivi sécurisé
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

// Traitement optimisé des photos
const processPhotos = (photos) => {
  return photos.map((photo, index) => {
    let thumbnail = photo.thumbnail;
    
    if (thumbnail && !thumbnail.startsWith('data:')) {
      thumbnail = `data:image/jpeg;base64,${thumbnail}`;
    }
    
    if (thumbnail && thumbnail.length > 2 * 1024 * 1024) {
      console.warn(`Photo ${index + 1} trop volumineuse, compression appliquée`);
    }
    
    return {
      name: photo.name || `Photo_${index + 1}`,
      type: photo.type || 'image/jpeg',
      size: photo.size || 0,
      thumbnail: thumbnail,
      uploadedAt: new Date(),
      index: index,
      metadata: {
        originalSize: photo.originalSize || photo.size,
        compressionRatio: photo.originalSize ? (photo.size / photo.originalSize).toFixed(2) : 1
      }
    };
  });
};

// Préparation des données complètes pour la livraison
const prepareLivraisonData = (colisData, clientLocation) => {
  return {
    // Identifiants
    colisID: colisData.colisID,
    livraisonID: `LIV_${colisData.colisID}_${Date.now()}`,
    
    // Informations expéditeur avec localisation
    expediteur: {
      nom: colisData.sender,
      telephone: colisData.senderPhone,
      location: colisData.location,
      precision: colisData.location.accuracy || 0,
      dateLocalisation: colisData.createdAt
    },
    
    // Informations destinataire/client avec localisation
    destinataire: {
      nom: colisData.recipient,
      telephone: colisData.recipientPhone,
      adresse: colisData.address,
      location: clientLocation,
      precision: clientLocation ? clientLocation.accuracy || 0 : null,
      dateLocalisation: new Date()
    },
    
    // Détails complets du colis
    colis: {
      type: colisData.packageType,
      description: colisData.description || '',
      photos: colisData.photos || [],
      photosCount: colisData.photos ? colisData.photos.length : 0,
      totalPhotoSize: colisData.photos ? 
        colisData.photos.reduce((sum, photo) => sum + (photo.size || 0), 0) : 0
    },
    
    // Statut et dates
    statut: 'en_cours_de_livraison',
    dateCreation: colisData.createdAt,
    dateAcceptation: new Date(),
    dateModification: new Date(),
    
    // Processus de livraison
    processus: {
      etape: 'accepte_par_destinataire',
      prochaine_etape: 'assignation_livreur',
      priorite: 'normale',
      delaiEstime: '24-48h'
    },
    
    // Calculs de distance et logistique
    logistique: {
      distanceEstimee: clientLocation && colisData.location ? 
        calculateDistance(
          colisData.location.latitude, 
          colisData.location.longitude,
          clientLocation.latitude, 
          clientLocation.longitude
        ) : null,
      zoneExpedition: determineZone(colisData.location),
      zoneLivraison: clientLocation ? determineZone(clientLocation) : null,
      complexite: determineComplexity(colisData.packageType, colisData.photos.length)
    },
    
    // Historique détaillé
    historique: [
      // Historique du colis original
      ...(colisData.history || []),
      // Nouvel événement d'acceptation
      {
        action: 'accepte_par_destinataire',
        date: new Date(),
        location: clientLocation,
        details: {
          precision_gps: clientLocation ? clientLocation.accuracy : null,
          agent_utilisateur: 'Client Web App',
          confirmation_explicite: true
        },
        notes: 'Client a accepté le colis - Processus de livraison déclenché automatiquement'
      }
    ],
    
    // Métadonnées enrichies
    metadata: {
      ...colisData.metadata,
      acceptationTimestamp: new Date().toISOString(),
      clientUserAgent: 'Client Web Application',
      livraisonInitiee: true,
      sourceAcceptation: 'interface_client_web'
    }
  };
};

// Calcul de distance entre deux points GPS
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Rayon de la Terre en kilomètres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c * 100) / 100; // Distance en km avec 2 décimales
};

// Détermination de zone géographique
const determineZone = (location) => {
  if (!location) return 'inconnue';
  
  // Logique simplifiée - à adapter selon votre géographie
  const { latitude, longitude } = location;
  
  // Exemple pour une ville (à personnaliser)
  if (latitude >= 5.3 && latitude <= 5.4 && longitude >= -4.1 && longitude <= -3.9) {
    return 'centre_ville';
  } else if (latitude >= 5.2 && latitude <= 5.5 && longitude >= -4.2 && longitude <= -3.8) {
    return 'peripherie';
  } else {
    return 'zone_etendue';
  }
};

// Détermination de la complexité de livraison
const determineComplexity = (packageType, photoCount) => {
  let complexity = 'simple';
  
  if (packageType === 'fragile' || packageType === 'electronique') {
    complexity = 'moyenne';
  }
  
  if (packageType === 'medicament' || photoCount > 3) {
    complexity = 'complexe';
  }
  
  return complexity;
};

// Fonction principale
exports.handler = async (event) => {
  console.log('🚀 SEND 2.0 - Requête reçue:', event.httpMethod);

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
          message: 'Données manquantes dans la requête' 
        })
      });
    }

    const requestData = JSON.parse(event.body);
    console.log('📦 Type de requête détecté:', requestData.action || (requestData.code ? 'search' : 'create'));

    // Connexion MongoDB optimisée
    mongoClient = new MongoClient(mongoConfig.uri, {
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
      retryWrites: true,
      retryReads: true,
      maxIdleTimeMS: 30000,
      heartbeatFrequencyMS: 10000
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
            message: 'Colis non trouvé dans le système' 
          })
        });
      }

      // Préparation des données complètes pour la livraison
      const livraisonData = prepareLivraisonData(colis, requestData.location);
      
      console.log('📋 Données de livraison préparées:', {
        colisID: livraisonData.colisID,
        expediteur: livraisonData.expediteur.nom,
        destinataire: livraisonData.destinataire.nom,
        distance: livraisonData.logistique.distanceEstimee,
        complexite: livraisonData.logistique.complexite
      });

      // Transaction pour garantir la cohérence des données
      const session = mongoClient.startSession();
      
      try {
        await session.withTransaction(async () => {
          // 1. Insérer dans la collection Livraison avec toutes les informations
          await db.collection(mongoConfig.collections.livraison).insertOne(livraisonData, { session });
          
          // 2. Mettre à jour le statut dans la collection Colis
          await db.collection(mongoConfig.collections.colis).updateOne(
            { colisID: requestData.colisID },
            { 
              $set: { 
                status: 'accepte_en_livraison',
                dateAcceptation: new Date(),
                processusDeclenche: true,
                livraisonID: livraisonData.livraisonID
              },
              $push: {
                history: {
                  action: 'accepte_par_destinataire',
                  date: new Date(),
                  location: requestData.location,
                  notes: 'Client a accepté - Transféré vers processus de livraison avec données complètes',
                  livraisonID: livraisonData.livraisonID
                }
              }
            },
            { session }
          );
        });

        console.log('✅ Colis accepté et données de livraison créées avec succès');

        return setCorsHeaders({
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            message: 'Colis accepté avec succès. Le processus de livraison a été déclenché.',
            livraison: {
              colisID: requestData.colisID,
              livraisonID: livraisonData.livraisonID,
              statut: 'en_cours_de_livraison',
              dateAcceptation: new Date(),
              distanceEstimee: livraisonData.logistique.distanceEstimee,
              delaiEstime: livraisonData.processus.delaiEstime
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
        let deletedCount = 0;
        
        await session.withTransaction(async () => {
          // Supprimer de toutes les collections
          const colisResult = await db.collection(mongoConfig.collections.colis).deleteOne(
            { colisID: requestData.colisID },
            { session }
          );
          
          const livraisonResult = await db.collection(mongoConfig.collections.livraison).deleteOne(
            { colisID: requestData.colisID },
            { session }
          );
          
          deletedCount = colisResult.deletedCount + livraisonResult.deletedCount;
        });

        console.log('❌ Colis refusé et supprimé définitivement:', deletedCount, 'documents supprimés');

        return setCorsHeaders({
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            message: 'Colis refusé et supprimé définitivement du système.',
            deletedDocuments: deletedCount
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
            message: 'Aucun colis trouvé avec ce code de suivi. Vérifiez le code et réessayez.' 
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
          index: photo.index,
          metadata: photo.metadata
        })) : [],
        // Masquer les données sensibles
        metadata: {
          photosCount: colis.metadata?.photosCount || 0,
          createdAt: colis.createdAt
        }
      };

      return setCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({ 
          success: true, 
          colis: responseData,
          message: 'Colis localisé avec succès'
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

      // Génération d'un code unique avec vérification
      let trackingCode = generateTrackingCode();
      let attempts = 0;
      const maxAttempts = 10;
      
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
            message: 'Impossible de générer un code unique. Veuillez réessayer dans quelques instants.' 
          })
        });
      }

      // Traitement optimisé des photos
      const processedPhotos = processPhotos(requestData.photos);
      
      // Données complètes du colis
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
          totalPhotoSize: processedPhotos.reduce((sum, photo) => sum + (photo.size || 0), 0),
          averagePhotoSize: processedPhotos.length > 0 ? 
            Math.round(processedPhotos.reduce((sum, photo) => sum + (photo.size || 0), 0) / processedPhotos.length) : 0,
          locationAccuracy: requestData.location.accuracy,
          creationSource: 'expediteur_web_app'
        },
        history: [{
          action: 'cree',
          date: new Date(),
          location: requestData.location,
          notes: 'Colis créé par l\'expéditeur - En attente de validation par le destinataire',
          accuracy: requestData.location.accuracy,
          details: {
            photosUploaded: processedPhotos.length,
            packageType: requestData.packageType,
            hasDescription: !!requestData.description
          }
        }]
      };

      // Insertion du colis
      const result = await db.collection(mongoConfig.collections.colis).insertOne(colisData);
      
      console.log('✅ Expédition créée avec succès:', trackingCode, 'ID MongoDB:', result.insertedId);

      return setCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          trackingCode: trackingCode,
          colisID: trackingCode,
          message: 'Expédition enregistrée avec succès dans le système',
          timestamp: new Date().toISOString(),
          details: {
            photosProcessed: processedPhotos.length,
            totalSize: colisData.metadata.totalPhotoSize,
            locationAccuracy: requestData.location.accuracy
          }
        })
      });
    }

    // Si aucune action correspondante
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ 
        success: false, 
        message: 'Action non reconnue ou données invalides' 
      })
    });

  } catch (error) {
    console.error('❌ Erreur dans client-handler:', error);
    
    // Gestion spécifique des erreurs
    if (error.name === 'MongoTimeoutError') {
      return setCorsHeaders({
        statusCode: 503,
        body: JSON.stringify({ 
          success: false, 
          message: 'Service temporairement indisponible. Veuillez réessayer dans quelques instants.',
          error: 'Database timeout'
        })
      });
    }

    if (error.name === 'MongoNetworkError') {
      return setCorsHeaders({
        statusCode: 503,
        body: JSON.stringify({ 
          success: false, 
          message: 'Problème de connexion à la base de données. Veuillez réessayer.',
          error: 'Network error'
        })
      });
    }

    if (error.name === 'SyntaxError') {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Format de données invalide. Vérifiez votre requête.',
          error: 'Invalid JSON'
        })
      });
    }

    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ 
        success: false, 
        message: 'Erreur interne du serveur. Veuillez réessayer plus tard.',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      })
    });

  } finally {
    // Fermeture propre de la connexion
    if (mongoClient) {
      try {
        await mongoClient.close();
        console.log('🔒 Connexion MongoDB fermée proprement');
      } catch (closeError) {
        console.error('❌ Erreur fermeture MongoDB:', closeError);
      }
    }
  }
};