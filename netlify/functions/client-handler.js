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

// Préparation des données complètes pour la livraison
const prepareLivraisonData = (colisData, clientLocation) => {
  return {
    colisID: colisData.colisID,
    livraisonID: `LIV_${colisData.colisID}_${Date.now()}`,
    
    expediteur: {
      nom: colisData.sender,
      telephone: colisData.senderPhone,
      location: colisData.location,
      precision: colisData.location.accuracy || 0,
      dateLocalisation: colisData.createdAt
    },
    
    destinataire: {
      nom: colisData.recipient,
      telephone: colisData.recipientPhone,
      adresse: colisData.address,
      location: clientLocation,
      precision: clientLocation ? clientLocation.accuracy || 0 : null,
      dateLocalisation: new Date()
    },
    
    colis: {
      type: colisData.packageType,
      description: colisData.description || '',
      photos: colisData.photos || [],
      photosCount: colisData.photos ? colisData.photos.length : 0,
      totalPhotoSize: colisData.photos ? 
        colisData.photos.reduce((sum, photo) => sum + (photo.size || 0), 0) : 0
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
      distanceEstimee: clientLocation && colisData.location ? 
        calculateDistance(
          colisData.location.latitude, 
          colisData.location.longitude,
          clientLocation.latitude, 
          clientLocation.longitude
        ) : null,
      zoneExpedition: 'zone_principale',
      zoneLivraison: 'zone_principale',
      complexite: 'standard'
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
          confirmation_explicite: true
        },
        notes: 'Client a accepté le colis - Processus de livraison déclenché'
      }
    ],
    
    metadata: {
      ...colisData.metadata,
      acceptationTimestamp: new Date().toISOString(),
      clientUserAgent: 'Client Web Application',
      livraisonInitiee: true,
      sourceAcceptation: 'interface_client_web'
    }
  };
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
        distance: livraisonData.logistique.distanceEstimee
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
                livraisonID: livraisonData.livraisonID
              },
              $push: {
                history: {
                  action: 'accepte_par_destinataire',
                  date: new Date(),
                  location: requestData.location,
                  notes: 'Client a accepté - Transféré vers processus de livraison',
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
          index: photo.index
        })) : [],
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