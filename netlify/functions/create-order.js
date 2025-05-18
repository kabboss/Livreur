const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Commandes';

const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000
});

const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({})
    };
  }
    
    try {
        const orderData = JSON.parse(event.body);
        
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        
        // Ajouter la date et le statut
        orderData.date_creation = new Date();
        orderData.statut = 'en attente';
        
        const result = await collection.insertOne(orderData);
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                insertedId: result.insertedId
            })
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    } finally {
        await client.close();
    }
};