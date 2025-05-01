const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

const mongoURI = "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

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
      body: "Méthode non autorisée",
    };
  }

  try {
    const data = JSON.parse(event.body);
    const { whatsapp, secondNumber, type, password, confirmPassword, username } = data;

    // Vérification des champs obligatoires
    if (!whatsapp || !type || !password || !confirmPassword || !username) {
      return {
        statusCode: 400,
        headers,
        body: "Tous les champs sont requis.",
      };
    }

    if (password !== confirmPassword) {
      return {
        statusCode: 400,
        headers,
        body: "Le mot de passe et sa confirmation ne correspondent pas.",
      };
    }

    await client.connect();
    const db = client.db("FarmsConnect");
    const collection = db.collection("utilisateurs");

    // Vérifier si l'utilisateur existe déjà (whatsapp + type)
    const existingUser = await collection.findOne({ whatsapp, type });
    if (existingUser) {
      return {
        statusCode: 409,
        headers,
        body: "Un utilisateur avec ce numéro WhatsApp et ce type existe déjà.",
      };
    }

    // Hachage du mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insertion du nouvel utilisateur
    await collection.insertOne({
      whatsapp,
      secondNumber: secondNumber || null,
      type,
      username,
      password: hashedPassword,
      createdAt: new Date(),
    });

    return {
      statusCode: 200,
      headers,
      body: "Inscription réussie !",
    };
  } catch (err) {
    console.error("Erreur serveur :", err);
    return {
      statusCode: 500,
      headers,
      body: "Erreur serveur : " + err.message,
    };
  } finally {
    await client.close();
  }
};
