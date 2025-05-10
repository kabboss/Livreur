const { MongoClient } = require('mongodb');

exports.handler = async (event, context) => {
  const { collection } = JSON.parse(event.body);
  
  try {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('FarmsConnect');
    
    // Supprimer tous les documents de la collection
    const result = await db.collection(collection).deleteMany({});
    
    await client.close();
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: `${result.deletedCount} documents supprimés de la collection ${collection}`
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message })
    };
  }
};