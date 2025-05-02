// netlify/functions/deleteLivraison.js

const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*', // Autorise toutes les origines
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // Gestion de la requête de pré-vol (preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: '', // Réponse vide pour la pré-vol
    };
  }

  // Vérifier si la méthode HTTP est bien POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' }),
    };
  }

  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    // Récupérer le codeID à partir du corps de la requête
    const { codeID } = JSON.parse(event.body);

    // Vérifier si le codeID est fourni
    if (!codeID) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Le codeID est requis' }),
      };
    }

    // Connexion à la base de données MongoDB
    await client.connect();
    const collection = client.db(dbName).collection('Livraison');

    // Suppression du colis correspondant au codeID
    const result = await collection.deleteOne({ codeID });

    // Vérifier si aucun colis n'a été supprimé
    if (result.deletedCount === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Aucun colis trouvé avec ce codeID' }),
      };
    }

    // Réponse de succès après suppression
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Colis terminé et supprimé avec succès' }),
    };

  } catch (error) {
    console.error('Erreur serveur:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur interne du serveur' }),
    };
  } finally {
    // Fermeture de la connexion à MongoDB
    await client.close();
  }
};
