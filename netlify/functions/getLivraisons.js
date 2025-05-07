const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';
const livraisonCollectionName = 'Livraison';
const expeditionCollectionName = 'cour_expedition'; // Utilisation du nom fourni

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    await client.connect();
    const db = client.db(dbName);
    const livraisonCollection = db.collection(livraisonCollectionName);
    const expeditionCollection = db.collection(expeditionCollectionName);

    const livraisons = await livraisonCollection.find({}).toArray();
    const expeditions = await expeditionCollection.find({}).toArray();
    const expeditionsMap = new Map(expeditions.map(exp => [exp.codeID, exp.idLivreur]));

    const formatted = livraisons.map(l => {
      const idLivreur = expeditionsMap.get(l.codeID);
      return {
        codeID: l.codeID || 'Code ID manquant',
        colis: { ...l.colis },
        expediteur: { ...l.expediteur },
        destinataire: { ...l.destinataire },
        statut: l.statut || 'Statut inconnu',
        dateLivraison: l.dateLivraison || null,
        estExpedie: expeditionsMap.has(l.codeID),
        idLivreurEnCharge: idLivreur || null,
      };
    });

    return { statusCode: 200, headers, body: JSON.stringify(formatted) };

  } catch (err) {
    console.error('Erreur de récupération des livraisons :', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erreur interne du serveur' }) };
  } finally {
    await client.close();
  }
};