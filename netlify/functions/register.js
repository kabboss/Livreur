const { MongoClient } = require("mongodb");

exports.handler = async function (event) {
  try {
    const uri = "mongodb+srv://kaboreabwa2020:ka23bo2re23@farmsconnect.vodgz.mongodb.net/livreur2_0?retryWrites=true&w=majority&appName=FarmsConnect";
    const client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    await client.connect();
    await client.db("livreur2_0").command({ ping: 1 });
    await client.close();

    return {
      statusCode: 200,
      body: "Connexion MongoDB OK !",
    };
  } catch (err) {
    console.error("Erreur MongoDB :", err);
    return {
      statusCode: 500,
      body: "Erreur MongoDB : " + err.message,
    };
  }
};
