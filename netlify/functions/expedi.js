const { MongoClient } = require('mongodb');

// Configuration sécurisée avec variables d'environnement
const uri = process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority";
const dbName = process.env.DB_NAME || 'FarmsConnect';
const livraisonCollection = process.env.LIVRAISON_COLLECTION || 'Livraison';
const expeditionCollection = process.env.EXPEDITION_COLLECTION || 'cour_expedition';

// Champs minimaux à récupérer (inchangé)
const LIVRAISON_PROJECTION = {
  codeID: 1,
  'colis.type': 1,
  'colis.photos': { $slice: 1 },
  'expediteur.nom': 1,
  'expediteur.telephone': 1,
  'expediteur.localisation': 1,
  'destinataire.nom': 1,
  'destinataire.prenom': 1,
  'destinataire.telephone': 1,
  'destinataire.localisation': 1,
  statut: 1,
  dateLivraison: 1,
  _id: 0
};

const EXPEDITION_PROJECTION = {
  codeID: 1,
  idLivreur: 1,
  statut: 1,
  _id: 0
};

exports.handler = async (event) => {
  // En-têtes CORS (inchangé)
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };

  // Gestion des requêtes OPTIONS (inchangé)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Paramètres de pagination (inchangé)
  const query = event.queryStringParameters || {};
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;

  // Configuration améliorée de la connexion
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 30000,
    maxPoolSize: 50,
    wtimeoutMS: 2500,
    retryWrites: true,
    retryReads: true
  });

  try {
    await client.connect();
    const db = client.db(dbName);

    // Requêtes (inchangé)
    const [livraisons, expeditions, total] = await Promise.all([
      db.collection(livraisonCollection)
        .find({})
        .project(LIVRAISON_PROJECTION)
        .skip(skip)
        .limit(limit)
        .toArray(),

      db.collection(expeditionCollection)
        .find({})
        .project(EXPEDITION_PROJECTION)
        .toArray(),

      db.collection(livraisonCollection)
        .countDocuments()
    ]);

    // Traitement des données (inchangé)
    const expMap = new Map();
    expeditions.forEach(exp => expMap.set(exp.codeID, exp.idLivreur));

    const data = livraisons.map(liv => ({
      c: liv.codeID,
      t: liv.colis?.type,
      p: liv.colis?.photos?.[0]?.data,
      e: {
        n: liv.expediteur?.nom,
        t: liv.expediteur?.telephone,
        l: liv.expediteur?.localisation
      },
      d: {
        n: liv.destinataire?.nom,
        p: liv.destinataire?.prenom,
        t: liv.destinataire?.telephone,
        l: liv.destinataire?.localisation
      },
      s: liv.statut,
      dl: liv.dateLivraison,
      ex: expMap.has(liv.codeID),
      id: expMap.get(liv.codeID)
    }));

    // Réponse (inchangé)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        d: data,
        p: {
          t: total,
          pg: page,
          l: limit,
          tp: Math.ceil(total / limit)
        }
      })
    };

  } catch (error) {
    console.error('Erreur:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        e: 'Internal Server Error',
        m: error.message
      })
    };
  } finally {
    await client.close().catch(console.error);
  }
};