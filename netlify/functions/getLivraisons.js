const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  // Gérer les requêtes CORS préalables
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: '',
    };
  }

  // Refuser toute méthode autre que GET
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

    const formattedLivraisons = livraisons.map((livraison) => ({
      codeID: livraison.codeID || 'Code ID manquant',
      colis: {
        type: livraison.colis?.type || 'Type non précisé',
        details: livraison.colis?.details || '',
        photos: livraison.colis?.photos || [],
      },
      expediteur: {
        nom: livraison.expediteur?.nom || 'Inconnu',
        telephone: livraison.expediteur?.telephone || 'Non fourni',
        localisation: livraison.expediteur?.localisation || null,
      },
      destinataire: {
        nom: livraison.destinataire?.nom || 'Inconnu',
        prenom: livraison.destinataire?.prenom || '',
        telephone: livraison.destinataire?.telephone || 'Non fourni',
        localisation: livraison.destinataire?.localisation || null,
      },
      statut: livraison.statut || 'Statut inconnu',
      dateLivraison: livraison.dateLivraison || null,
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
