const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

const mongoClient = new MongoClient(MONGODB_URI, {
  connectTimeoutMS: 5000,
  serverSelectionTimeoutMS: 5000,
});

const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event, context) {
  console.log("Méthode HTTP reçue:", event.httpMethod);

  // Toujours répondre aux requêtes OPTIONS (pré-vol CORS)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: '',
    };
  }

  // 🔴 SUPPRESSION de la vérification stricte de POST
  // if (event.httpMethod !== 'POST') {
  //   return {
  //     statusCode: 405,
  //     headers: COMMON_HEADERS,
  //     body: JSON.stringify({ message: 'Méthode non autorisée' }),
  //   };
  // }

  try {
    const orderData = JSON.parse(event.body);

    if (
      !orderData.phone1 ||
      !orderData.phone2 ||
      !orderData.clientPosition ||
      !orderData.gasType ||
      !orderData.quantity
    ) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ message: 'Données manquantes dans la commande.' }),
      };
    }

    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);
    const collection = db.collection('gasOrders');

    const newOrder = {
      serviceType: 'gas',
      gasType: orderData.gasType,
      quantity: orderData.quantity,
      phone1: orderData.phone1,
      phone2: orderData.phone2,
      notes: orderData.notes || '',
      clientPosition: orderData.clientPosition,
      orderDate: orderData.orderDate || new Date().toISOString(),
      status: orderData.status || 'en attente',
      deliveryFee: 700,
      estimatedGasPriceMargin: 1000,
    };

    const result = await collection.insertOne(newOrder);

    return {
      statusCode: 201,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        message: 'Commande gaz enregistrée avec succès',
        orderId: result.insertedId,
      }),
    };
  } catch (error) {
    console.error('Erreur create-gas-order:', error);
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ message: 'Erreur serveur interne' }),
    };
  } finally {
    await mongoClient.close();
  }
};
