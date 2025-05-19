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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    };
  }

  try {
    const orderData = JSON.parse(event.body);

    // Validation de base
    if (
      !Array.isArray(orderData.medicaments) ||
      orderData.medicaments.length === 0 ||
      !orderData.clientPosition ||
      !orderData.phoneNumber
    ) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ message: 'Données incomplètes ou invalides.' }),
      };
    }

    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);
    const collection = db.collection('pharmacyOrders');

    const newOrder = {
      serviceType: 'pharmacy',
      medicaments: orderData.medicaments,
      notes: orderData.notes || '',
      phoneNumber: orderData.phoneNumber,
      secondaryPhone: orderData.secondaryPhone || '',
      clientPosition: orderData.clientPosition,
      orderDate: orderData.orderDate || new Date().toISOString(),
      status: orderData.status || 'en attente',
      deliveryFee: 600
    };

    const result = await collection.insertOne(newOrder);

    return {
      statusCode: 201,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        message: 'Commande enregistrée avec succès',
        orderId: result.insertedId,
      }),
    };
  } catch (error) {
    console.error('Erreur create-pharmacy-order:', error);
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ message: 'Erreur serveur interne' }),
    };
  } finally {
    await mongoClient.close();
  }
};
