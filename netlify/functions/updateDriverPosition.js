const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  let client;

  try {
    const data = JSON.parse(event.body);
    const { orderId, driverId, location } = data;

    if (
      !orderId || !driverId || !location ||
      typeof location.latitude === 'undefined' ||
      typeof location.longitude === 'undefined'
    ) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          error: 'Données manquantes ou invalides',
          expected: {
            orderId: 'string',
            driverId: 'string',
            location: {
              latitude: 'number',
              longitude: 'number',
              accuracy: 'number (facultatif)'
            }
          },
          received: data
        })
      };
    }

    client = await MongoClient.connect(MONGODB_URI);
    const db = client.db(DB_NAME);

    const positionData = {
      latitude: parseFloat(location.latitude),
      longitude: parseFloat(location.longitude),
      accuracy: location.accuracy ? parseFloat(location.accuracy) : null,
      timestamp: new Date()
    };

    // Filtrage correct combiné avec $and et $or
    const expeditionFilter = {
      $and: [
        {
          $or: [
            { orderId },
            { colisID: orderId },
            { identifiant: orderId },
            { id: orderId },
            { _id: orderId }
          ]
        },
        {
          $or: [
            { driverId },
            { idLivreurEnCharge: driverId },
            { 'identifiant du conducteur': driverId }
          ]
        }
      ]
    };

    const expeditionUpdate = await db.collection('cour_expedition').updateOne(
      expeditionFilter,
      {
        $set: {
          driverLocation: positionData,
          lastPositionUpdate: new Date()
        },
        $push: {
          positionHistory: {
            $each: [positionData],
            $slice: -100
          }
        }
      }
    );

    if (expeditionUpdate.matchedCount === 0) {
      return {
        statusCode: 404,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          error: 'Commande non trouvée ou livreur non assigné',
          orderId,
          driverId
        })
      };
    }

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: true,
        message: 'Position mise à jour avec succès dans cour_expedition',
        orderId,
        driverId,
        location: positionData,
        updatedAt: new Date().toISOString(),
        expeditionUpdated: expeditionUpdate.modifiedCount > 0
      })
    };

  } catch (error) {
    console.error('Erreur serveur:', error);
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        error: 'Erreur serveur lors de la mise à jour',
        details: error.message
      })
    };
  } finally {
    if (client) await client.close();
  }
};
