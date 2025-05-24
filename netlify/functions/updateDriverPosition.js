const { MongoClient } = require('mongodb');
const uri = process.env.MONGODB_URI || 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    try {
        const { orderId, driverId, location } = JSON.parse(event.body);
        const client = new MongoClient(uri, { connectTimeoutMS: 5000 });
        await client.connect();

        await client.db('FarmsConnect').collection('DriverPositions').updateOne(
            { orderId, driverId },
            { $set: { location, updatedAt: new Date() } },
            { upsert: true }
        );

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true })
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};