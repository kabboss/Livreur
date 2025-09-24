const { MongoClient, ObjectId } = require('mongodb');
const uri = process.env.MONGODB_URI;

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS' ) {
        return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
    }

    if (event.httpMethod !== 'POST' ) {
        return { statusCode: 405, headers: COMMON_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    if (!uri) {
        return { statusCode: 500, headers: COMMON_HEADERS, body: JSON.stringify({ error: 'Configuration serveur incorrecte.' }) };
    }

    const client = new MongoClient(uri);

    try {
        const { orderId, newStatus } = JSON.parse(event.body);
        if (!orderId || !newStatus) {
            return { statusCode: 400, headers: COMMON_HEADERS, body: JSON.stringify({ error: 'orderId et newStatus sont requis.' }) };
        }

        await client.connect();
        const db = client.db('FarmsConnect');
        const collection = db.collection('Commandes');

        const result = await collection.updateOne(
            { _id: new ObjectId(orderId) },
            { $set: { status: newStatus, lastUpdate: new Date() } }
        );

        if (result.modifiedCount === 0) {
            return { statusCode: 404, headers: COMMON_HEADERS, body: JSON.stringify({ error: 'Commande non trouvée ou statut déjà à jour.' }) };
        }

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ success: true, message: 'Statut mis à jour.' })
        };
    } catch (error) {
        console.error("Erreur dans updateOrderStatus:", error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message })
        };
    } finally {
        await client.close();
    }
};
