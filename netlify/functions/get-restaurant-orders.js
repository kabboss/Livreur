const { MongoClient, ObjectId } = require('mongodb');
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

exports.handler = async (event) => {
    const { restaurantId } = event.queryStringParameters;
    if (!restaurantId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'ID du restaurant manquant' }) };
    }

    const client = new MongoClient(MONGODB_URI);
    try {
        await client.connect();
        const collection = client.db(DB_NAME).collection('Commandes');
        
        const orders = await collection.find({
            "restaurant.id": restaurantId,
            "status": "pending_restaurant_confirmation"
        }).sort({ dateCreation: -1 }).toArray();

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ orders })
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Erreur serveur' }) };
    } finally {
        await client.close();
    }
};
