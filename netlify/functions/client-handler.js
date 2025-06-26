const { MongoClient } = require('mongodb');

// Configuration MongoDB optimisée
const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    livraison: "Livraison"
  },
  options: {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    retryWrites: true,
    retryReads: true,
    bufferMaxEntries: 0
  }
};

// Configuration CORS optimisée
const setCorsHeaders = (response) => {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Max-Age': '86400',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  };
};

// Génération de code de suivi sécurisé et unique
const generateTrackingCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Validation avancée des données
const validateExpeditionData = (data) => {
  const errors = [];

  // Validation expéditeur
  if (!data.sender || data.sender.length < 2) {
    errors.push('Nom de l\'expéditeur requis (minimum 2 caractères)');
  }
  if (!data.senderPhone || data.senderPhone.length < 8) {
    errors.push('Numéro de téléphone de l\'expéditeur invalide');
  }

  // Validation destinataire
  if (!data.recipient || data.recipient.length < 2) {
    errors.push('Nom du destinataire requis (minimum 2 caractères)');
  }
  if (!data.recipientPhone || data.recipientPhone.length < 8) {
    errors.push('Numéro de téléphone du destinataire invalide');
  }
  if (!data.address || data.address.length < 10) {
    errors.push('Adresse de livraison trop courte (minimum 10 caractères)');
  }

  // Validation colis
  if (!data.packageType) {
    errors.push('Type de colis requis');
  }
  if (!data.photos || data.photos.length === 0) {
    errors.push('Au moins une photo du colis est requise');
  }
  if (data.photos && data.photos.length > 5) {
    errors.push('Maximum 5 photos autorisées');
  }

  // Validation géolocalisation
  if (!data.location || !data.location.latitude || !data.location.longitude) {
    errors.push('Géolocalisation GPS requise');
  }
  if (data.location && data.location.accuracy > 50) {
    errors.push('Précision GPS insuffisante (requis: <50m, actuel: ' + Math.round(data.location.accuracy) + 'm)');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
};

const validateSearchData = (data) => {
  const errors = [];

  if (!data.code || !/^[A-Z0-9]{6,20}$/i.test(data.code)) {
    errors.push('Code de suivi invalide (format: 6-20 caractères alphanumériques)');
  }
  if (!data.nom || data.nom.length < 2) {
    errors.push('Nom requis (minimum 2 caractères)');
  }
  if (!data.numero || data.numero.length < 8) {
    errors.push('Numéro de téléphone invalide');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
};

// Calcul de distance optimisé
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

// Préparation des données complètes pour la livraison
const prepareLivraisonData = (colisData, clientLocation) => {
  const distance = clientLocation && colisData.location ? 
    calculateDistance(
      colisData.location.latitude, 
      colisData.location.longitude,
      clientLocation.latitude, 
      clientLocation.longitude
    ) : null;

  return {
    colisID: colisData.colisID,
    livraisonID: `LIV_${colisData.colisID}_${Date.now()}`,
    
    expediteur: {
      nom: colisData.sender,
      telephone: colisData.senderPhone,
      location: {
        latitude: colisData.location.latitude,
        longitude: colisData.location.longitude,
        precision: colisData.location.accuracy || 0
      },
      dateLocalisation: colisData.createdAt
    },
    
    destinataire: {
      nom: colisData.recipient,
      telephone: colisData.recipientPhone,
      adresse: colisData.address,
      location: clientLocation ? {
        latitude: clientLocation.latitude,
        longitude: clientLocation.longitude,
        precision: clientLocation.accuracy || 0
      } : null,
      dateLocalisation: new Date()
    },
    
    colis: {
      type: colisData.packageType,
      description: colisData.description || '',
      photos: colisData.photos || [],
      photosCount: colisData.photos ? colisData.photos.length : 0,
      totalPhotoSize: colisData.photos ? 
        colisData.photos.reduce((sum, photo) => sum + (photo.compressedSize || 0), 0) : 0
    },
    
    statut: 'en_cours_de_livraison',
    dateCreation: colisData.createdAt,
    dateAcceptation: new Date(),
    dateModification: new Date(),
    
    processus: {
      etape: 'accepte_par_destinataire',
      prochaine_etape: 'assignation_livreur',
      priorite: 'normale',
      delaiEstime: '24-48h'
    },
    
    logistique: {
      distanceEstimee: distance,
      zoneExpedition: 'zone_principale',
      zoneLivraison: 'zone_principale',
      complexite: distance && distance > 20 ? 'longue_distance' : 'standard',
      prixEstime: distance ? (distance <= 5 ? 500 : 500 + Math.ceil(distance - 5) * 100) : null
    },
    
    historique: [
      ...(colisData.history || []),
      {
        action: 'accepte_par_destinataire',
        date: new Date(),
        location: clientLocation,
        details: {
          precision_gps: clientLocation ? clientLocation.accuracy : null,
          agent_utilisateur: 'Client Web App',
          confirmation_explicite: true,
          distance_calculee: distance
        },
        notes: 'Client a accepté le colis - Processus de livraison déclenché automatiquement'
      }
    ],
    
    metadata: {
      ...colisData.metadata,
      acceptationTimestamp: new Date().toISOString(),
      clientUserAgent: 'Client Web Application',
      livraisonInitiee: true,
      sourceAcceptation: 'interface_client_web',
      versionAPI: '2.0',
      distanceCalculee: distance,
      prixCalcule: distance ? (distance <= 5 ? 500 : 500 + Math.ceil(distance - 5) * 100) : null
    }
  };
};

// Fonction principale optimisée
exports.handler = async (event) => {
  console.log('🚀 SEND 2.0 - Nouvelle requête:', event.httpMethod, new Date().toISOString());

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
        success: false, 
        message: 'Méthode HTTP non autorisée. Utilisez POST.',
        allowedMethods: ['POST', 'OPTIONS']
      })
    });
  }

  let mongoClient;
  const startTime = Date.now();

  try {
    // Validation du body de la requête
    if (!event.body) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Corps de la requête manquant',
          error: 'MISSING_BODY'
        })
      });
    }

    let requestData;
    try {
      requestData = JSON.parse(event.body);
    } catch (parseError) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Format JSON invalide dans le corps de la requête',
          error: 'INVALID_JSON'
        })
      });
    }

    // Détection du type de requête
    const requestType = requestData.action || (requestData.code ? 'search' : 'create');
    console.log(`📋 Type de requête: ${requestType}`);

    // Connexion MongoDB optimisée avec retry
    let connectionAttempts = 0;
    const maxAttempts = 3;
    
    while (connectionAttempts < maxAttempts) {
      try {
        mongoClient = new MongoClient(mongoConfig.uri, mongoConfig.options);
        await mongoClient.connect();
        console.log('✅ Connexion MongoDB établie');
        break;
      } catch (connectionError) {
        connectionAttempts++;
        console.error(`❌ Tentative de connexion ${connectionAttempts}/${maxAttempts} échouée:`, connectionError.message);
        
        if (connectionAttempts >= maxAttempts) {
          throw new Error('Impossible de se connecter à la base de données après plusieurs tentatives');
        }
        
        // Attendre avant de réessayer
        await new Promise(resolve => setTimeout(resolve, 1000 * connectionAttempts));
      }
    }
    
    const db = mongoClient.db(mongoConfig.dbName);

    // === CRÉATION D'UNE NOUVELLE EXPÉDITION ===
    if (requestType === 'create') {
      console.log('📦 Traitement création d\'expédition');
      
      // Validation des données
      const validation = validateExpeditionData(requestData);
      if (!validation.valid) {
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            message: 'Données d\'expédition invalides',
            errors: validation.errors
          })
        });
      }

      // Génération d'un code de suivi unique
      let trackingCode;
      let attempts = 0;
      const maxCodeAttempts = 10;
      
      do {
        trackingCode = generateTrackingCode();
        const existingColis = await db.collection(mongoConfig.collections.colis).findOne({
          colisID: trackingCode
        });
        
        if (!existingColis) break;
        attempts++;
        
        if (attempts >= maxCodeAttempts) {
          throw new Error('Impossible de générer un code de suivi unique');
        }
      } while (attempts < maxCodeAttempts);

      // Préparation des données du colis
      const colisData = {
        colisID: trackingCode,
        
        // Informations expéditeur
        sender: requestData.sender.trim(),
        senderPhone: requestData.senderPhone.trim(),
        
        // Informations destinataire
        recipient: requestData.recipient.trim(),
        recipientPhone: requestData.recipientPhone.trim(),
        address: requestData.address.trim(),
        
        // Informations colis
        packageType: requestData.packageType,
        description: requestData.description ? requestData.description.trim() : '',
        
        // Photos avec métadonnées
        photos: requestData.photos.map((photo, index) => ({
          ...photo,
          index: index,
          uploadedAt: new Date().toISOString()
        })),
        
        // Géolocalisation
        location: {
          latitude: requestData.location.latitude,
          longitude: requestData.location.longitude,
          accuracy: requestData.location.accuracy,
          timestamp: new Date()
        },
        
        // Statut et dates
        status: 'en_attente_validation',
        createdAt: new Date(),
        updatedAt: new Date(),
        
        // Historique
        history: [{
          action: 'colis_cree',
          date: new Date(),
          location: requestData.location,
          details: {
            precision_gps: requestData.location.accuracy,
            photos_count: requestData.photos.length,
            agent_utilisateur: requestData.userAgent || 'Unknown'
          },
          notes: 'Colis créé par l\'expéditeur via l\'interface web'
        }],
        
        // Métadonnées étendues
        metadata: {
          ...requestData.metadata,
          photosCount: requestData.photos.length,
          totalPhotoSize: requestData.photos.reduce((sum, photo) => sum + (photo.compressedSize || 0), 0),
          locationAccuracy: requestData.location.accuracy,
          creationTimestamp: new Date().toISOString(),
          userAgent: requestData.userAgent || 'Unknown',
          browserLanguage: requestData.metadata?.browserLanguage || 'Unknown',
          timeZone: requestData.metadata?.timeZone || 'Unknown',
          versionAPI: '2.0'
        }
      };

      // Insertion en base de données
      const insertResult = await db.collection(mongoConfig.collections.colis).insertOne(colisData);
      
      if (!insertResult.acknowledged) {
        throw new Error('Échec de l\'insertion en base de données');
      }

      console.log(`✅ Expédition créée avec succès: ${trackingCode}`);

      return setCorsHeaders({
        statusCode: 201,
        body: JSON.stringify({
          success: true,
          message: 'Expédition créée avec succès',
          trackingCode: trackingCode,
          colisID: trackingCode,
          createdAt: colisData.createdAt,
          status: colisData.status,
          metadata: {
            photosUploaded: colisData.photos.length,
            locationAccuracy: colisData.location.accuracy,
            processingTime: Date.now() - startTime
          }
        })
      });
    }

    // === RECHERCHE DE COLIS (CLIENT) ===
    if (requestType === 'search') {
      console.log('🔍 Traitement recherche de colis:', requestData.code);
      
      // Validation des données de recherche
      const validation = validateSearchData(requestData);
      if (!validation.valid) {
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            message: 'Données de recherche invalides',
            errors: validation.errors
          })
        });
      }

      // Recherche du colis avec vérification des informations
      const colis = await db.collection(mongoConfig.collections.colis).findOne({
        colisID: requestData.code.toUpperCase(),
        $or: [
          { recipient: { $regex: new RegExp(requestData.nom, 'i') } },
          { recipientPhone: requestData.numero }
        ]
      });

      if (!colis) {
        return setCorsHeaders({
          statusCode: 404,
          body: JSON.stringify({ 
            success: false, 
            message: 'Aucun colis trouvé avec ce code de suivi et ces informations. Vérifiez le code et vos données personnelles.',
            error: 'PACKAGE_NOT_FOUND'
          })
        });
      }

      // Vérification de correspondance exacte des informations
      const nameMatch = colis.recipient.toLowerCase().includes(requestData.nom.toLowerCase()) ||
                       requestData.nom.toLowerCase().includes(colis.recipient.toLowerCase());
      const phoneMatch = colis.recipientPhone === requestData.numero;

      if (!nameMatch && !phoneMatch) {
        return setCorsHeaders({
          statusCode: 403,
          body: JSON.stringify({ 
            success: false, 
            message: 'Les informations fournies ne correspondent pas au destinataire de ce colis.',
            error: 'RECIPIENT_MISMATCH'
          })
        });
      }

      console.log(`✅ Colis trouvé et vérifié: ${colis.colisID}`);

      // Préparer les données de réponse sécurisées
      const responseData = {
        ...colis,
        photos: colis.photos ? colis.photos.map(photo => ({
          name: photo.name,
          type: photo.type,
          thumbnail: photo.thumbnail,
          index: photo.index,
          uploadedAt: photo.uploadedAt
        })) : [],
        // Masquer les informations sensibles
        _id: undefined,
        metadata: {
          photosCount: colis.metadata?.photosCount || 0,
          createdAt: colis.createdAt,
          locationAccuracy: colis.location?.accuracy,
          lastUpdated: colis.updatedAt
        }
      };

      return setCorsHeaders({
        statusCode: 200,
        body: JSON.stringify({ 
          success: true, 
          colis: responseData,
          message: 'Colis localisé avec succès',
          searchMetadata: {
            searchTime: new Date(),
            processingTime: Date.now() - startTime,
            matchType: nameMatch && phoneMatch ? 'exact' : (nameMatch ? 'name' : 'phone')
          }
        })
      });
    }

    // === ACCEPTATION D'UN COLIS ===
    if (requestData.action === 'accept') {
      console.log('✅ Traitement acceptation colis:', requestData.colisID);
      
      if (!requestData.colisID) {
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            message: 'ID du colis manquant pour l\'acceptation',
            error: 'MISSING_COLIS_ID'
          })
        });
      }

      // Recherche du colis
      const colis = await db.collection(mongoConfig.collections.colis).findOne({
        colisID: requestData.colisID
      });

      if (!colis) {
        return setCorsHeaders({
          statusCode: 404,
          body: JSON.stringify({ 
            success: false, 
            message: 'Colis non trouvé dans le système',
            error: 'PACKAGE_NOT_FOUND'
          })
        });
      }

      // Vérifier que le colis n'est pas déjà traité
      if (colis.status === 'accepte_en_livraison') {
        return setCorsHeaders({
          statusCode: 409,
          body: JSON.stringify({ 
            success: false, 
            message: 'Ce colis a déjà été accepté',
            error: 'ALREADY_ACCEPTED'
          })
        });
      }

      // Préparation des données complètes pour la livraison
      const livraisonData = prepareLivraisonData(colis, requestData.location);
      
      console.log('📋 Données de livraison préparées:', {
        colisID: livraisonData.colisID,
        livraisonID: livraisonData.livraisonID,
        expediteur: livraisonData.expediteur.nom,
        destinataire: livraisonData.destinataire.nom,
        distance: livraisonData.logistique.distanceEstimee,
        prix: livraisonData.logistique.prixEstime
      });

      // Transaction pour garantir la cohérence des données
      const session = mongoClient.startSession();
      
      try {
        await session.withTransaction(async () => {
          // 1. Insérer dans la collection Livraison
          await db.collection(mongoConfig.collections.livraison).insertOne(livraisonData, { session });
          
          // 2. Mettre à jour le statut dans la collection Colis
          await db.collection(mongoConfig.collections.colis).updateOne(
            { colisID: requestData.colisID },
            { 
              $set: { 
                status: 'accepte_en_livraison',
                dateAcceptation: new Date(),
                processusDeclenche: true,
                livraisonID: livraisonData.livraisonID,
                updatedAt: new Date()
              },
              $push: {
                history: {
                  action: 'accepte_par_destinataire',
                  date: new Date(),
                  location: requestData.location,
                  notes: 'Client a accepté - Transféré vers processus de livraison',
                  livraisonID: livraisonData.livraisonID,
                  details: {
                    distance_calculee: livraisonData.logistique.distanceEstimee,
                    prix_estime: livraisonData.logistique.prixEstime
                  }
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
              prixEstime: livraisonData.logistique.prixEstime,
              delaiEstime: livraisonData.processus.delaiEstime
            },
            metadata: {
              processingTime: Date.now() - startTime,
              transactionCompleted: true
            }
          })
        });

      } finally {
        await session.endSession();
      }
    }

    // === REFUS D'UN COLIS ===
    if (requestData.action === 'decline') {
      console.log('❌ Traitement refus colis:', requestData.colisID);
      
      if (!requestData.colisID) {
        return setCorsHeaders({
          statusCode: 400,
          body: JSON.stringify({ 
            success: false, 
            message: 'ID du colis manquant pour le refus',
            error: 'MISSING_COLIS_ID'
          })
        });
      }

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

        if (deletedCount === 0) {
          return setCorsHeaders({
            statusCode: 404,
            body: JSON.stringify({ 
              success: false, 
              message: 'Aucun colis trouvé à supprimer',
              error: 'PACKAGE_NOT_FOUND'
            })
          });
        }

        console.log(`❌ Colis refusé et supprimé définitivement: ${deletedCount} document(s) supprimé(s)`);

        return setCorsHeaders({
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            message: 'Colis refusé et supprimé définitivement du système.',
            deletedDocuments: deletedCount,
            metadata: {
              processingTime: Date.now() - startTime,
              deletionTimestamp: new Date().toISOString()
            }
          })
        });

      } finally {
        await session.endSession();
      }
    }

    // Action non reconnue
    return setCorsHeaders({
      statusCode: 400,
      body: JSON.stringify({ 
        success: false, 
        message: 'Action non reconnue ou données invalides',
        error: 'INVALID_ACTION',
        supportedActions: ['create', 'search', 'accept', 'decline']
      })
    });

  } catch (error) {
    console.error('❌ Erreur dans send-handler:', error);
    
    // Gestion spécifique des erreurs avec codes d'erreur détaillés
    if (error.name === 'MongoTimeoutError') {
      return setCorsHeaders({
        statusCode: 503,
        body: JSON.stringify({ 
          success: false, 
          message: 'Service temporairement indisponible. Veuillez réessayer dans quelques instants.',
          error: 'DATABASE_TIMEOUT',
          retryAfter: 30
        })
      });
    }

    if (error.name === 'MongoNetworkError') {
      return setCorsHeaders({
        statusCode: 503,
        body: JSON.stringify({ 
          success: false, 
          message: 'Problème de connexion à la base de données. Veuillez réessayer.',
          error: 'NETWORK_ERROR',
          retryAfter: 15
        })
      });
    }

    if (error.name === 'MongoServerError' && error.code === 11000) {
      return setCorsHeaders({
        statusCode: 409,
        body: JSON.stringify({ 
          success: false, 
          message: 'Conflit de données. Un élément similaire existe déjà.',
          error: 'DUPLICATE_KEY'
        })
      });
    }

    if (error.message.includes('JSON')) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          success: false, 
          message: 'Format de données invalide. Vérifiez votre requête.',
          error: 'INVALID_JSON_FORMAT'
        })
      });
    }

    // Erreur générique
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({ 
        success: false, 
        message: 'Erreur interne du serveur. Veuillez réessayer plus tard.',
        error: 'INTERNAL_SERVER_ERROR',
        errorCode: error.code || 'UNKNOWN',
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        ...(process.env.NODE_ENV === 'development' && { 
          debugInfo: {
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 5)
          }
        })
      })
    });

  } finally {
    // Fermeture propre de la connexion MongoDB
    if (mongoClient) {
      try {
        await mongoClient.close();
        console.log('🔒 Connexion MongoDB fermée proprement');
      } catch (closeError) {
        console.error('❌ Erreur fermeture MongoDB:', closeError.message);
      }
    }
    
    console.log(`⏱️ Temps de traitement total: ${Date.now() - startTime}ms`);
  }
};