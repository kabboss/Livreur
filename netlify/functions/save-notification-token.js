const { MongoClient } = require('mongodb');
const MONGODB_URI = process.env.MONGODB_URI;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST' ) return { statusCode: 405 };

    try {
        const { restaurantId, token } = JSON.parse(event.body);
        if (!restaurantId || !token) return { statusCode: 400, body: 'Données manquantes.' };

        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        const collection = client.db('FarmsConnect').collection('NotificationTokens');

        await collection.updateOne(
            { token: token },
            { $set: { restaurantId: restaurantId, updatedAt: new Date() } },
            { upsert: true }
        );

        await client.close();
        return { statusCode: 200, body: JSON.stringify({ success: true }) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
