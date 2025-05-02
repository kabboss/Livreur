const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);
const dbName = "FarmsConnect";

exports.handler = async function(event, context) {
  // Gérer les options préalables CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      body: "Méthode non autorisée"
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { nom, prenom, numero, code, location } = body;

    await client.connect();
    const db = client.db(dbName);

    // Enregistrement dans la collection infoclient
    await db.collection("infoclient").insertOne({
      nom,
      prenom,
      numero,
      code,
      localisation: location,
      date: new Date()
    });

    // Recherche du colis
    const colis = await db.collection("Colis").findOne({ colisID: code });

    if (!colis) {
      return {
        statusCode: 404,
        headers: {
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ message: "Colis non trouvé avec ce code." })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ message: "Colis trouvé", colis })
    };
  } catch (err) {
    console.error("Erreur serveur :", err);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ message: "Erreur serveur" })
    };
  } finally {
    await client.close();
  }
};
