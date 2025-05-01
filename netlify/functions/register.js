const { MongoClient } = require("mongodb");

const mongoURI = "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

exports.handler = async function (event, context) {
  // CORS preflight
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
    console.log("Données reçues :", data);

    // Vérification du mot de passe
    if (!data.password || data.password !== data.confirmPassword) {
      return {
        statusCode: 400,
        headers,
        body: "Mot de passe et confirmation invalides.",
      };
    }

    // Connexion à MongoDB
    await client.connect();
    const db = client.db("FarmsConnect");
    const collection = db.collection("utilisateurs");

    // Insertion des données
    await collection.insertOne({
      whatsapp: data.whatsapp,
      secondNumber: data.secondNumber,
      type: data.type,
      password: data.password,
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
