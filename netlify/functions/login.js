const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

exports.handler = async function (event, context) {
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
      body: JSON.stringify({ message: "Méthode non autorisée" }),
    };
  }

  try {
    const data = JSON.parse(event.body);
    const { whatsapp, password, type } = data;

    if (!whatsapp || !password || !type) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "Tous les champs sont requis." }),
      };
    }

    const uri = "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/?retryWrites=true&w=majority";
    const client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    await client.connect();
    const db = client.db("FarmsConnect");
    const collection = db.collection("utilisateurs");

    const user = await collection.findOne({ whatsapp, type });
    await client.close();

    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ message: "Compte introuvable." }),
      };
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ message: "Mot de passe incorrect." }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: `Bienvenue cher ${user.type} ${user.username} !` }),
    };
  } catch (err) {
    console.error("Erreur serveur :", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: "Erreur serveur : " + err.message }),
    };
  }
};
