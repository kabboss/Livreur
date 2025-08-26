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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  // Vérifier que c'est une requête POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parser les données de production
    const productionData = JSON.parse(event.body);
    
    // Validation basique des données obligatoires
    if (!productionData.productionId || !productionData.date || !productionData.milkQuantity) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ 
          error: 'Données de production incomplètes',
          required: ['productionId', 'date', 'milkQuantity']
        })
      };
    }

    // Ajouter des métadonnées
    const enrichedData = {
      ...productionData,
      savedAt: new Date().toISOString(),
      dataVersion: '1.0'
    };

    // Connexion à MongoDB
    console.log('🔄 Connexion à MongoDB...');
    await mongoClient.connect();
    
    const db = mongoClient.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Sauvegarder la production
    console.log('💾 Sauvegarde de la production:', productionData.productionId);
    const result = await collection.insertOne(enrichedData);

    // Fermer la connexion
    await mongoClient.close();

    console.log('✅ Production sauvegardée avec succès:', result.insertedId);

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: true,
        message: 'Production sauvegardée avec succès',
        insertedId: result.insertedId,
        productionId: productionData.productionId
      })
    };

  } catch (error) {
    console.error('❌ Erreur lors de la sauvegarde:', error);

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
        error: 'Erreur serveur lors de la sauvegarde',
        details: error.message,
        productionId: event.body ? JSON.parse(event.body).productionId : 'unknown'
      })
    };
  }
};