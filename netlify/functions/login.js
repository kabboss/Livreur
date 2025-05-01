const { MongoClient } = require("mongodb");

exports.handler = async function (event, context) {
  // ✅ Autoriser les requêtes OPTIONS (pré-vol CORS)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: "Méthode non autorisée",
    };
  }

  try {
    const data = JSON.parse(event.body);
    const { whatsapp, password, type } = data;

    // Vérification de base
    if (!whatsapp || !password || !type) {
      return {
        statusCode: 400,
        headers,
        body: "Tous les champs sont requis.",
      };
    }

    // Connexion MongoDB
    const uri = "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority";
    const client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    await client.connect();
    const db = client.db("livreur2_0");
    const collection = db.collection("utilisateurs");

    const user = await collection.findOne({ whatsapp, password, type });

    await client.close();

    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: "Identifiants incorrects.",
      };
    }

    return {
      statusCode: 200,
      headers,
      body: `Bienvenue ${type} !`,
    };
  } catch (err) {
    console.error("Erreur serveur :", err);
    return {
      statusCode: 500,
      headers,
      body: "Erreur serveur : " + err.message,
    };
  }
};
