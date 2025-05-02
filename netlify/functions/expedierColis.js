// netlify/functions/updateLivraisonStatus.js

const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function(event, context) {
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    // Récupération du codeID depuis le corps de la requête
    const { codeID } = JSON.parse(event.body);

    // Connexion à la base de données MongoDB
    await client.connect();

    // Sélection de la collection "Livraison"
    const collection = client.db(dbName).collection('Livraison');

    // Mise à jour du statut du colis avec le codeID spécifié
    const result = await collection.updateOne(
      { codeID },
      { $set: { statut: 'en cours d\'expédition' } }
    );

    // Vérification si le colis a été trouvé et modifié
    if (result.modifiedCount === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Colis non trouvé.' }),
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      };
    }

    // Réponse de succès si la mise à jour est effectuée
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Statut mis à jour.' }),
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    };
  } catch (err) {
    console.error('Erreur lors de la mise à jour du statut :', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erreur lors de la mise à jour du statut.' }),
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    };
  } finally {
    // Fermeture de la connexion à MongoDB
    await client.close();
  }
};
