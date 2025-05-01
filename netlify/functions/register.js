const { MongoClient } = require("mongodb");

exports.handler = async function (event, context) {
  // CORS
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
    return { statusCode: 405, headers, body: "Méthode non autorisée" };
  }

  try {
    const data = JSON.parse(event.body);
    console.log("Données reçues :", data);

    if (!data.password || data.password !== data.confirmPassword) {
      return {
        statusCode: 400,
        headers,
        body: "Mot de passe et confirmation invalides.",
      };
    }

    const uri = "mongodb+srv://kaboreabwa2020:ka23bo2re23@farmsconnect.vodgz.mongodb.net/livreur2_0?retryWrites=true&w=majority&appName=FarmsConnect";

    const client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    await client.connect();

    const collection = client.db("livreur2_0").collection("utilisateurs");

    await collection.insertOne({
      whatsapp: data.whatsapp,
      secondNumber: data.secondNumber,
      type: data.type,
      password: data.password,
    });

    await client.close();

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
  }
};
