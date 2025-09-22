const { MongoClient, ObjectId } = require('mongodb');
const uri = process.env.MONGODB_URI || 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS' ) {
        return { statusCode: 204, headers, body: '' };
    }
    if (event.httpMethod !== 'POST' ) {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const client = new MongoClient(uri);

    try {
        const { orderId, newStatus } = JSON.parse(event.body);
        if (!orderId || !newStatus) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'orderId et newStatus sont requis.' }) };
        }

        await client.connect();
        const db = client.db('FarmsConnect');
        const collection = db.collection('Commandes');

        const result = await collection.updateOne(
            { _id: new ObjectId(orderId) },
            { $set: { status: newStatus, lastUpdate: new Date() } }
        );

        if (result.modifiedCount === 0) {
            throw new Error('Commande non trouvée ou statut déjà à jour.');
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'Statut mis à jour.' })
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    } finally {
        await client.close();
    }
};
