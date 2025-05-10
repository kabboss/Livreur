const { MongoClient } = require('mongodb');

exports.handler = async (event, context) => {
  const { collection } = event.queryStringParameters;
  
  try {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('FarmsConnect');
    
    const data = await db.collection(collection).find({}).toArray();
    
    await client.close();
    
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, data })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message })
    };
  }
};