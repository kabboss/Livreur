// netlify/functions/getLivraisons.js

const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  // Gestion des requêtes CORS préalables (OPTIONS)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: '',
    };
  }

  // Refuser les méthodes autres que GET
  if (event.httpMethod !== 'GET') {
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
    await client.connect();
    const collection = client.db(dbName).collection('Livraison');
    const livraisons = await collection.find({}).toArray();

    // Transformation des données pour correspondre au format attendu par le frontend
    const formattedLivraisons = livraisons.map((livraison) => ({
      codeID: livraison.colisID,
      colis: {
        type: livraison.type,
        photos: livraison.photos || [],
      },
      expediteur: {
        nom: livraison.sender || 'Inconnu',
        telephone: livraison.phone1 || 'Non fourni',
        localisation: livraison.senderLocation || null,
      },
      destinataire: {
        nom: livraison.recipient || 'Inconnu',
        prenom: livraison.recipientPrenom || '',
        telephone: livraison.phone || 'Non fourni',
        adresse: livraison.address || 'Adresse non fournie',
        localisation: livraison.recipientLocation || null,
      },
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(formattedLivraisons),
    };
  } catch (error) {
    console.error('Erreur lors de la récupération des livraisons :', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur interne du serveur' }),
    };
  } finally {
    await client.close();
  }
};
