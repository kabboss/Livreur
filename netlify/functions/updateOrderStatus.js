const { MongoClient, ObjectId } = require('mongodb');

// --- Configuration directement dans le code ---
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Commandes';

// --- En-têtes CORS communs à toutes les réponses ---
const COMMON_HEADERS = {
  "Access-Control-Allow-Origin": "*", // Autorise toutes les origines
  "Access-Control-Allow-Methods": "POST, OPTIONS", // Méthodes autorisées pour cette fonction
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With"
};

// --- Handler de la fonction Netlify ---
exports.handler = async (event) => {
  // 1. Réponse immédiate pour les requêtes "preflight" OPTIONS
  if (event.httpMethod === "OPTIONS" ) {
    return {
      statusCode: 204, // "No Content" est la réponse standard
      headers: COMMON_HEADERS,
      body: ""
    };
  }

  // 2. Restriction de la méthode à POST uniquement
  if (event.httpMethod !== "POST" ) {
    return {
      statusCode: 405, // "Method Not Allowed"
      headers: COMMON_HEADERS,
      body: JSON.stringify({ error: "Méthode non autorisée. Seules les requêtes POST sont acceptées." })
    };
  }

  // Initialisation du client MongoDB
  const client = new MongoClient(MONGODB_URI);

  try {
    // 3. Analyse et validation du corps de la requête
    const { orderId, newStatus } = JSON.parse(event.body || "{}");

    if (!orderId || !newStatus) {
      return {
        statusCode: 400, // "Bad Request"
        headers: COMMON_HEADERS,
        body: JSON.stringify({ error: "Les champs 'orderId' et 'newStatus' sont requis." })
      };
    }

    // 4. Connexion à la base de données et mise à jour
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const result = await collection.updateOne(
      { _id: new ObjectId(orderId) },
      { $set: { status: newStatus, lastUpdate: new Date() } }
    );

    // 5. Vérification si la mise à jour a bien eu lieu
    if (result.modifiedCount === 0) {
      return {
        statusCode: 404, // "Not Found"
        headers: COMMON_HEADERS,
        body: JSON.stringify({ error: "Commande non trouvée ou le statut est déjà à jour." })
      };
    }

    // 6. Réponse de succès
    return {
      statusCode: 200, // "OK"
      headers: COMMON_HEADERS,
      body: JSON.stringify({ success: true, message: "Le statut de la commande a été mis à jour." })
    };

  } catch (error) {
    // 7. Gestion globale des erreurs (ex: JSON invalide, erreur DB)
    console.error("Erreur dans la fonction updateOrderStatus:", error);
    return {
      statusCode: 500, // "Internal Server Error"
      headers: COMMON_HEADERS,
      body: JSON.stringify({ error: "Une erreur interne est survenue.", details: error.message })
    };

  } finally {
    // 8. Fermeture de la connexion dans tous les cas
    await client.close();
  }
};
