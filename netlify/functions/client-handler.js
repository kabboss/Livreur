const { MongoClient, ObjectId } = require('mongodb');

const mongoConfig = {
  uri: process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority",
  dbName: "FarmsConnect",
  collections: {
    colis: "Colis",
    livraison: "Livraison",
    refus: "Refus"
  }
};

let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && cachedDb.client.topology && cachedDb.client.topology.isConnected()) {
    return cachedDb;
  }

  const client = new MongoClient(mongoConfig.uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    retryWrites: true,
    useUnifiedTopology: true
  });

  try {
    await client.connect();
    const db = client.db(mongoConfig.dbName);
    await db.command({ ping: 1 });
    
    cachedDb = { db, client };
    console.log('✅ Connexion MongoDB établie');
    return cachedDb;
  } catch (error) {
    console.error("❌ Échec de connexion MongoDB:", error);
    throw new Error("Impossible de se connecter à la base de données");
  }
}

const setCorsHeaders = (response) => ({
  ...response,
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    ...response.headers
  }
});

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  console.log(`📥 Requête reçue: ${event.httpMethod} ${event.path}`);

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
        error: 'Méthode non autorisée',
        allowed: ['POST', 'OPTIONS']
      })
    });
  }

  try {
    const dbConnection = await connectToDatabase();
    const { db, client } = dbConnection;

    let data;
    try {
      data = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.error('❌ Erreur parsing JSON:', parseError);
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Format JSON invalide',
          details: parseError.message
        })
      });
    }

    const { action } = data;

    if (!action) {
      return setCorsHeaders({
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Paramètre "action" requis',
          validActions: ['create', 'search', 'accept', 'decline']
        })
      });
    }

    console.log(`🎯 Action demandée: ${action}`);

    let response;
    switch (action) {
      case 'create':
        response = await handleCreatePackage(db, data);
        break;
      case 'search':
        response = await handleSearchPackage(db, data);
        break;
      case 'accept':
        response = await handleAcceptPackage(db, client, data);
        break;
      case 'decline':
        response = await handleDeclinePackage(db, client, data);
        break;
      default:
        response = {
          statusCode: 400,
          body: JSON.stringify({ 
            error: `Action "${action}" non reconnue`,
            validActions: ['create', 'search', 'accept', 'decline']
          })
        };
    }

    console.log(`✅ Action ${action} traitée avec succès`);
    return setCorsHeaders(response);

  } catch (error) {
    console.error("❌ Erreur globale du handler:", error);
    return setCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({
        error: 'Erreur serveur interne',
        message: error.message
      })
    });
  }
};

async function handleCreatePackage(db, data) {
  console.log('📦 Création d\'un nouveau colis');

  const requiredFields = [
    'sender', 'senderPhone', 'recipient', 'recipientPhone', 
    'address', 'packageType', 'location', 'photos'
  ];
  
  const missingFields = requiredFields.filter(field => {
    const value = data[field];
    if (field === 'photos') {
      return !Array.isArray(value) || value.length === 0;
    }
    return !value || (typeof value === 'string' && value.trim() === '');
  });

  if (missingFields.length > 0) {
    console.error('❌ Champs manquants:', missingFields);
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Champs obligatoires manquants',
        missing: missingFields
      })
    };
  }

  // Validation du type de colis
  const validPackageTypes = ['petit', 'moyen', 'gros'];
  if (!validPackageTypes.includes(data.packageType)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Type de colis invalide',
        validTypes: validPackageTypes,
        received: data.packageType
      })
    };
  }

  if (!data.location.latitude || !data.location.longitude) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Coordonnées GPS invalides',
        received: data.location
      })
    };
  }

  try {
    const trackingCode = await generateTrackingCode(db);
    const now = new Date();

    const packageData = {
      _id: trackingCode,
      colisID: trackingCode,
      trackingCode,
      status: 'pending',
      
      sender: data.sender.trim(),
      senderPhone: data.senderPhone.trim(),
      
      recipient: data.recipient.trim(),
      recipientPhone: data.recipientPhone.trim(),
      address: data.address.trim(),
      
      packageType: data.packageType,
      description: data.description?.trim() || '',
      photos: data.photos,
      
      location: {
        latitude: parseFloat(data.location.latitude),
        longitude: parseFloat(data.location.longitude),
        accuracy: data.location.accuracy || 0
      },
      
      createdAt: now,
      updatedAt: now,
      timestamp: data.timestamp || now.toISOString(),
      
      history: [{
        status: 'created',
        date: now,
        location: data.location,
        action: 'Colis créé par l\'expéditeur'
      }],
      
      metadata: {
        userAgent: data.userAgent,
        ...data.metadata
      }
    };

    await db.collection(mongoConfig.collections.colis).insertOne(packageData);

    console.log(`✅ Colis créé avec succès: ${trackingCode}`);
    
    return {
      statusCode: 201,
      body: JSON.stringify({
        success: true,
        trackingCode,
        colisID: trackingCode,
        packageType: data.packageType,
        createdAt: now.toISOString(),
        message: 'Colis créé avec succès'
      })
    };

  } catch (error) {
    console.error("❌ Erreur lors de la création du colis:", error);
    
    if (error.code === 11000) {
      return {
        statusCode: 409,
        body: JSON.stringify({ 
          error: 'Code de suivi déjà existant',
          message: 'Veuillez réessayer'
        })
      };
    }
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Échec de création du colis',
        details: error.message
      })
    };
  }
}

async function handleSearchPackage(db, data) {
  console.log('🔍 Recherche d\'un colis');

  const { code, nom, numero } = data;

  if (!code || !nom || !numero) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Paramètres de recherche incomplets',
        required: ['code', 'nom', 'numero']
      })
    };
  }

  try {
    const colis = await db.collection(mongoConfig.collections.colis)
      .findOne({ 
        trackingCode: code.toUpperCase().trim()
      });

    if (!colis) {
      console.log(`❌ Colis introuvable: ${code}`);
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          error: 'Colis introuvable',
          code: code.toUpperCase()
        })
      };
    }

    const nomMatch = colis.recipient.toLowerCase().trim() === nom.toLowerCase().trim();
    const numeroMatch = colis.recipientPhone.trim() === numero.trim();

    if (!nomMatch || !numeroMatch) {
      console.log(`❌ Informations incorrectes pour le colis: ${code}`);
      return {
        statusCode: 403,
        body: JSON.stringify({ 
          error: 'Les informations ne correspondent pas au destinataire enregistré',
          hint: 'Vérifiez l\'orthographe exacte du nom et du numéro'
        })
      };
    }

    const { _id, ...safeColisData } = colis;

    console.log(`✅ Colis trouvé et validé: ${code}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        colis: safeColisData,
        message: 'Colis localisé avec succès'
      })
    };

  } catch (error) {
    console.error("❌ Erreur lors de la recherche:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Erreur lors de la recherche du colis',
        details: error.message
      })
    };
  }
}

async function handleAcceptPackage(db, client, data) {
  console.log('✅ Acceptation d\'un colis');

  const { colisID, location, paymentMethod } = data;

  if (!colisID) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'ID du colis requis'
      })
    };
  }

  if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'Localisation GPS invalide'
      })
    };
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
      
      // Calcul du prix de livraison selon le type de colis
      const deliveryPrice = calculateDeliveryPrice(colis, location);
      
      livraisonDoc = {
        colisID: colis.colisID,
        livraisonID: `LIV_${colis.colisID}_${now.getTime()}`,
        
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
        
        colis: {
          type: colis.packageType,
          description: colis.description,
          photos: colis.photos || []
        },
        
        // Informations de tarification
        pricing: {
          packageType: colis.packageType,
          deliveryPrice: deliveryPrice.price,
          distance: deliveryPrice.distance,
          calculation: deliveryPrice.calculation
        },
        
        // Paiement
        payment: {
          method: paymentMethod || 'delivery',
          status: paymentMethod === 'delivery' ? 'pending' : 'verified',
          amount: deliveryPrice.price
        },
        
        statut: "en_cours_de_livraison",
        dateCreation: colis.createdAt,
        dateAcceptation: now,
        
        localisation: {
          latitude: parseFloat(location.latitude),
          longitude: parseFloat(location.longitude),
          accuracy: location.accuracy || 0,
          timestamp: now
        },
        
        historique: [
          ...(colis.history || []),
          { 
            event: "accepté_par_destinataire", 
            date: now, 
            location: location,
            action: "Colis accepté par le destinataire",
            paymentMethod: paymentMethod || 'delivery'
          }
        ]
      };

      await db.collection(mongoConfig.collections.livraison)
        .insertOne(livraisonDoc, { session });

      await db.collection(mongoConfig.collections.colis).updateOne(
        { colisID: colis.colisID },
        {
          $set: { 
            status: "accepted", 
            updatedAt: now,
            acceptedAt: now,
            destinataireLocation: location,
            paymentMethod: paymentMethod || 'delivery'
          },
          $push: { 
            history: { 
              status: 'accepted', 
              date: now, 
              location: location,
              action: "Accepté par le destinataire",
              paymentMethod: paymentMethod || 'delivery'
            } 
          }
        },
        { session }
      );

      console.log(`✅ Colis accepté avec succès: ${colis.colisID}`);
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        livraisonID: livraisonDoc.livraisonID,
        status: livraisonDoc.statut,
        dateAcceptation: livraisonDoc.dateAcceptation.toISOString(),
        pricing: livraisonDoc.pricing,
        payment: livraisonDoc.payment,
        message: 'Colis accepté avec succès'
      })
    };

  } catch (error) {
    console.error("❌ Erreur lors de l'acceptation:", error);
    
    const statusCode = error.message === 'Colis introuvable' ? 404 : 
                      error.message === 'Colis déjà accepté' ? 409 : 500;
    
    return {
      statusCode,
      body: JSON.stringify({ 
        error: error.message,
        details: error.message === 'Colis introuvable' ? 
          'Vérifiez le code de suivi' : 
          'Contactez le support si le problème persiste'
      })
    };
  } finally {
    await session.endSession();
  }
}

async function handleDeclinePackage(db, client, data) {
  console.log('❌ Refus d\'un colis');

  const { colisID, reason = "Refus par le destinataire" } = data;

  if (!colisID) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: 'ID du colis requis'
      })
    };
  }

  const session = client.startSession();
  
  try {
    await session.withTransaction(async () => {
      const colis = await db.collection(mongoConfig.collections.colis)
        .findOne({ colisID: colisID.toUpperCase() }, { session });

      if (!colis) {
        throw new Error('Colis introuvable');
      }

      const now = new Date();

      await db.collection(mongoConfig.collections.refus).insertOne({
        colisID: colis.colisID,
        dateRefus: now,
        raison: reason,
        packageType: colis.packageType,
        donneesOriginales: colis,
        metadata: {
          refusePar: 'destinataire',
          timestamp: now.toISOString()
        }
      }, { session });

      await db.collection(mongoConfig.collections.colis)
        .deleteOne({ colisID: colis.colisID }, { session });
      
      await db.collection(mongoConfig.collections.livraison)
        .deleteMany({ colisID: colis.colisID }, { session });

      console.log(`✅ Colis refusé et supprimé: ${colis.colisID}`);
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Colis refusé et supprimé du système avec succès'
      })
    };

  } catch (error) {
    console.error("❌ Erreur lors du refus:", error);
    
    const statusCode = error.message === 'Colis introuvable' ? 404 : 500;
    
    return {
      statusCode,
      body: JSON.stringify({ 
        error: error.message,
        details: error.message === 'Colis introuvable' ? 
          'Le colis a peut-être déjà été supprimé' : 
          'Erreur technique lors du refus'
      })
    };
  } finally {
    await session.endSession();
  }
}

function calculateDeliveryPrice(colis, destinationLocation) {
  const packageTypes = {
    petit: { basePrice: 700, additionalPrice: 100 },
    moyen: { basePrice: 1000, additionalPrice: 120 },
    gros: { basePrice: 2000, additionalPrice: 250 }
  };

  const packageType = colis.packageType || 'petit';
  const config = packageTypes[packageType];

  // Calcul de la distance
  let distance = 0;
  if (colis.location && destinationLocation) {
    distance = calculateDistance(
      colis.location.latitude,
      colis.location.longitude,
      destinationLocation.latitude,
      destinationLocation.longitude
    );
  }

  // Calcul du prix
  let price = config.basePrice;
  let calculation = `${config.basePrice} FCFA (base ≤5km)`;

  if (distance > 5) {
    const additionalKm = Math.ceil(distance - 5);
    const additionalCost = additionalKm * config.additionalPrice;
    price += additionalCost;
    calculation = `${config.basePrice} FCFA (base) + ${additionalKm}km × ${config.additionalPrice} FCFA = ${price} FCFA`;
  }

  return {
    price,
    distance: parseFloat(distance.toFixed(1)),
    calculation,
    packageType
  };
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Rayon de la Terre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

async function generateTrackingCode(db) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codeLength = 8;
  let code, exists;
  let attempts = 0;
  const maxAttempts = 10;

  do {
    if (attempts >= maxAttempts) {
      throw new Error('Impossible de générer un code unique');
    }

    code = Array.from({ length: codeLength }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join('');

    exists = await db.collection(mongoConfig.collections.colis).findOne({ trackingCode: code });
    attempts++;
  } while (exists);

  console.log(`🎯 Code de suivi généré: ${code} (tentatives: ${attempts})`);
  return code;
}
