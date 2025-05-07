const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';
const livraisonCollectionName = 'Livraison'; // Correction du nom de la collection
const expeditionCollectionName = 'cour_expedition';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  // ✅ Gérer les pré-requêtes CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: '',
    };
  }

  // ❌ Méthode non autorisée
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
    const db = client.db(dbName);
    const livraisonCollection = db.collection(livraisonCollectionName);
    const expeditionCollection = db.collection(expeditionCollectionName);

    // 🔍 Récupération des livraisons
    const livraisons = await livraisonCollection.find({}).toArray();

    // 🚚 Récupération de tous les enregistrements d'expédition pour une vérification rapide
    const expeditions = await expeditionCollection.find({}).toArray();
    const expeditionsMap = new Map(expeditions.map(exp => [exp.codeID, true]));

    // 🔧 Formatage propre et ajout de l'état d'expédition
    const formatted = livraisons.map(l => ({
      codeID: l.codeID || 'Code ID manquant',
      colis: {
        type: l.colis?.type || 'Type non précisé',
        details: l.colis?.details || '',
        photos: l.colis?.photos || [],
      },
      expediteur: {
        nom: l.expediteur?.nom || 'Inconnu',
        telephone: l.expediteur?.telephone || 'Non fourni',
        localisation: l.expediteur?.localisation || null,
      },
      destinataire: {
        nom: l.destinataire?.nom || 'Inconnu',
        prenom: l.destinataire?.prenom || '',
        telephone: l.destinataire?.telephone || 'Non fourni',
        localisation: l.destinataire?.localisation || null,
      },
      statut: l.statut || 'Statut inconnu',
      dateLivraison: l.dateLivraison || null,
      estExpedie: expeditionsMap.has(l.codeID), // Vérifie si un enregistrement d'expédition existe pour ce codeID
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(formatted),
    };

  } catch (err) {
    console.error('Erreur de récupération des livraisons :', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur interne du serveur' }),
    };
  } finally {
    await client.close();
  }
};