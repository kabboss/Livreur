const { MongoClient } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'productions';

const mongoClient = new MongoClient(MONGODB_URI, {
  connectTimeoutMS: 10000,
  serverSelectionTimeoutMS: 10000
});

const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  // Gérer les requêtes OPTIONS (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: ''
    };
  }

  // Vérifier que c'est une requête GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Récupérer les paramètres de la requête
    const { date, productionId } = event.queryStringParameters || {};
    
    if (!date) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ 
          error: 'Paramètre date requis',
          example: '?date=2024-12-01'
        })
      };
    }

    // Construire la requête MongoDB
    let query = {};
    
    // Filtrer par date (chercher toutes les productions du jour donné)
    const startDate = new Date(date + 'T00:00:00.000Z');
    const endDate = new Date(date + 'T23:59:59.999Z');
    
    query.date = {
      $gte: startDate.toISOString(),
      $lte: endDate.toISOString()
    };

    // Si un ID de production spécifique est demandé
    if (productionId) {
      query.productionId = productionId;
    }

    console.log('🔍 Recherche avec query:', JSON.stringify(query));

    // Connexion à MongoDB
    await mongoClient.connect();
    
    const db = mongoClient.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Rechercher les productions
    const productions = await collection
      .find(query)
      .sort({ startTime: -1 }) // Trier par heure de début, plus récent en premier
      .toArray();

    // Fermer la connexion
    await mongoClient.close();

    console.log(`✅ ${productions.length} production(s) trouvée(s) pour ${date}`);

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: true,
        date: date,
        productionId: productionId || null,
        count: productions.length,
        productions: productions
      })
    };

  } catch (error) {
    console.error('❌ Erreur lors de la recherche:', error);

    // Assurer la fermeture de la connexion en cas d'erreur
    try {
      await mongoClient.close();
    } catch (closeError) {
      console.error('Erreur fermeture connexion:', closeError);
    }

    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la recherche',
        details: error.message,
        searchParams: event.queryStringParameters
      })
    };
  }
};