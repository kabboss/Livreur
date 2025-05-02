const { MongoClient } = require('mongodb');

const mongoURI = "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(mongoURI, {
});

exports.handler = async function (event, context) {
  // Autoriser CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Méthode non autorisée' }),
    };
  }

  try {
    const body = JSON.parse(event.body);

    // Connexion à MongoDB
    if (!client.isConnected?.()) {
        await client.connect();
      }

    const db = client.db('FarmsConnect'); // nom de la base
    const collection = db.collection('Colis'); // nom de la collection

    const document = {
      colisID: body.colisID,
      recipient: body.recipient,
      phone: body.phone,
      address: body.address,
      type: body.type,
      details: body.details,
      location: body.location,
      photos: body.photos,
      createdAt: new Date()
    };

    await collection.insertOne(document);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Colis enregistré avec succès', id: body.colisID }),
    };
  } catch (error) {
    console.error('Erreur Lambda:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Erreur serveur', error: error.message }),
    };
  }
};
