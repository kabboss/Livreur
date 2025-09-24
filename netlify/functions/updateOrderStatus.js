const { MongoClient, ObjectId } = require('mongodb');

// --- Configuration directement dans le code ---
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Commandes';

// --- En-têtes CORS complets ---
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept",
  "Access-Control-Max-Age": "86400" // Cache preflight pendant 24 heures
};

// --- Handler de la fonction Netlify ---
exports.handler = async (event) => {
  // 1. Gestion complète des requêtes OPTIONS (preflight)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: ""
    };
  }

  // 2. Restriction de la méthode à POST uniquement
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ 
        error: "Méthode non autorisée. Seules les requêtes POST sont acceptées." 
      })
    };
  }

  // Initialisation du client MongoDB
  const client = new MongoClient(MONGODB_URI);

  try {
    // 3. Validation du corps de la requête
    let requestBody;
    try {
      requestBody = JSON.parse(event.body || "{}");
    } catch (parseError) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ 
          error: "Corps de requête JSON invalide." 
        })
      };
    }

    const { orderId, newStatus } = requestBody;

    // Validation des champs requis
    if (!orderId || !newStatus) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ 
          error: "Les champs 'orderId' et 'newStatus' sont requis." 
        })
      };
    }

    // Validation du format de l'ID
    if (!ObjectId.isValid(orderId)) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ 
          error: "Format d'ID de commande invalide." 
        })
      };
    }

    // 4. Connexion à la base de données et mise à jour
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const result = await collection.updateOne(
      { _id: new ObjectId(orderId) },
      { 
        $set: { 
          status: newStatus, 
          lastUpdate: new Date() 
        } 
      }
    );

    // 5. Vérification si la mise à jour a bien eu lieu
    if (result.matchedCount === 0) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ 
          error: "Commande non trouvée." 
        })
      };
    }

    if (result.modifiedCount === 0) {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ 
          success: true, 
          message: "Le statut était déjà à jour." 
        })
      };
    }

    // 6. Réponse de succès
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ 
        success: true, 
        message: "Le statut de la commande a été mis à jour.",
        orderId: orderId,
        newStatus: newStatus
      })
    };

  } catch (error) {
    // 7. Gestion globale des erreurs
    console.error("Erreur dans la fonction updateOrderStatus:", error);
    
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ 
        error: "Une erreur interne est survenue.",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    };

  } finally {
    // 8. Fermeture de la connexion dans tous les cas
    await client.close();
  }
};