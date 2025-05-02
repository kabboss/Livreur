const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority'; // Mets ici ton URI MongoDB si c'est distant
const dbName = 'FarmsConnect';
const client = new MongoClient(uri);

exports.handler = async function(event, context) {
  // Autoriser les pré-requêtes CORS (OPTIONS)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    };
  }

  // Autoriser uniquement la méthode POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Méthode non autorisée.' }),
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    };
  }

  try {
    const { codeID } = JSON.parse(event.body);

    await client.connect();
    const db = client.db(dbName);
    const colisCollection = db.collection('Colis');

    // Vérifie si le colis existe
    const colis = await colisCollection.findOne({ colisID: codeID });

    if (!colis) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Colis introuvable.' }),
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      };
    }

    // Supprime le colis
    await colisCollection.deleteOne({ colisID: codeID });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `📦 Le colis a été supprimé de notre serveur ! Veuillez recontacter votre expéditeur pour qu’il réexpédie votre commande (s’il y a eu une erreur).`,
        codeID: codeID,
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    };
  } catch (error) {
    console.error('Erreur lors du refus du colis :', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erreur serveur. Impossible de supprimer le colis.' }),
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    };
  } finally {
    await client.close();
  }
};
