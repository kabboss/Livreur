const { MongoClient } = require("mongodb");

exports.handler = async function (event, context) {
  // Autoriser les requêtes CORS (y compris OPTIONS)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "Pré-vol CORS accepté",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: "Méthode non autorisée",
    };
  }

  const data = JSON.parse(event.body);

  const uri = "mongodb+srv://kaboreabwa2020:ka23bo2re23@farmsconnect.vodgz.mongodb.net/livreur2_0?retryWrites=true&w=majority&appName=FarmsConnect";

  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    await client.connect();
    const collection = client.db("livreur2_0").collection("utilisateurs");

    // Vérifie si les mots de passe correspondent
    if (data.password !== data.confirmPassword) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
        body: "Mot de passe et confirmation ne correspondent pas.",
      };
    }

    // Enregistre les données dans MongoDB
    await collection.insertOne({
      whatsapp: data.whatsapp,
      secondNumber: data.secondNumber,
      type: data.type,
      password: data.password, // ⚠️ À crypter plus tard avec bcrypt !
    });

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: "Inscription réussie !",
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: "Erreur serveur : " + err.toString(),
    };
  } finally {
    await client.close();
  }
};
