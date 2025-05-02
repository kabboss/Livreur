const { MongoClient } = require('mongodb');

exports.handler = async function(event, context) {
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  try {
    const { codeID } = JSON.parse(event.body);
    await client.connect();
    const collection = client.db('FarmsConnect').collection('Livraison');

    const result = await collection.updateOne(
      { codeID },
      { $set: { statut: 'en cours d\'expédition' } }
    );

    if (result.modifiedCount === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Colis non trouvé.' }),
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Statut mis à jour.' }),
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erreur lors de la mise à jour du statut.' }),
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    };
  } finally {
    await client.close();
  }
};
