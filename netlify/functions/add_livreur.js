const { MongoClient } = require('mongodb');

exports.handler = async (event, context) => {
  const data = JSON.parse(event.body);
  
  try {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('FarmsConnect');
    
    // Vérifier si le livreur existe déjà
    const existingLivreur = await db.collection('Res_livreur').findOne({
      $or: [
        { whatsapp: data.whatsapp },
        { id_livreur: data.id_livreur }
      ]
    });
    
    if (existingLivreur) {
      await client.close();
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, message: 'Un livreur avec ce numéro ou ID existe déjà' })
      };
    }
    
    // Insérer le nouveau livreur
    const result = await db.collection('Res_livreur').insertOne(data);
    
    await client.close();
    
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, id: result.insertedId })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message })
    };
  }
};