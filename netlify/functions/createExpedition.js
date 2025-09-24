const { MongoClient } = require('mongodb');

// Configuration sécurisée
const uri = process.env.MONGO_URI || "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority";
const dbName = process.env.DB_NAME || 'FarmsConnect';
const expeditionCollection = process.env.EXPEDITION_COLLECTION || 'Colis';

exports.handler = async (event) => {
  // En-têtes CORS avec Authorization
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  // Gestion des requêtes OPTIONS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Vérification de la méthode
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // Parse du corps de la requête
    const data = JSON.parse(event.body);
    
    // Validation des données requises
    if (!data.sender || !data.recipient || !data.phone || !data.address || !data.type) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Connexion à MongoDB
    const client = new MongoClient(uri, {
      connectTimeoutMS: 5000
    });

    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(expeditionCollection);

    // Ajout de la date et du statut
    const expeditionData = {
      ...data,
      codeID: data.colisID 
    };

    // Insertion dans la base de données
    const result = await collection.insertOne(expeditionData);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        expeditionId: result.insertedId,
        codeID: expeditionData.codeID
      })
    };

  } catch (error) {
    console.error('Erreur:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal Server Error',
        details: error.message 
      })
    };
  }
};

