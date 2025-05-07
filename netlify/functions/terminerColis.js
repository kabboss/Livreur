// netlify/functions/deleteLivraison.js

const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';
const suppressionsCollectionName = 'suppressions_colis'; // Nom de la nouvelle collection

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const { codeID, nomLivreur, prenomLivreur, idLivreur } = JSON.parse(event.body);

    if (!codeID || !nomLivreur || !prenomLivreur || !idLivreur) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Le codeID, le nom, le prénom et l\'identifiant du livreur sont requis' }),
      };
    }

    await client.connect();
    const db = client.db(dbName);

    // Suppression du colis des collections principales
    const colisCollection = db.collection('Colis');
    const livraisonCollection = db.collection('Livraison');
    const expeditionCollection = db.collection('cour_expedition');
    const suppressionsCollection = db.collection(suppressionsCollectionName);

    const deleteColisResult = await colisCollection.deleteOne({ codeID });
    const deleteLivraisonResult = await livraisonCollection.deleteOne({ codeID });
    const deleteExpeditionResult = await expeditionCollection.deleteOne({ codeID });

    if (deleteLivraisonResult.deletedCount === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Aucun colis ou livraison trouvé avec ce codeID' }),
      };
    }

    // Enregistrement de la suppression
    const suppressionRecord = {
      codeID: codeID,
      nomLivreur: nomLivreur,
      prenomLivreur: prenomLivreur,
      idLivreur: idLivreur,
      dateSuppression: new Date(),
    };
    await suppressionsCollection.insertOne(suppressionRecord);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: 'Colis terminé et supprimé avec succès des collections.',
        deletedCounts: {
          Colis: deleteColisResult.deletedCount,
          Livraison: deleteLivraisonResult.deletedCount,
          cour_expedition: deleteExpeditionResult.deletedCount,
        },
        suppressionEnregistree: true,
      }),
    };

  } catch (error) {
    console.error('Erreur serveur:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur interne du serveur' }),
    };
  } finally {
    await client.close();
  }
};