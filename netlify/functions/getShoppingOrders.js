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

    const client = new MongoClient(uri, {
        connectTimeoutMS: 5000,
        socketTimeoutMS: 30000
    });
    
    try {
        await client.connect();
        const collection = client.db('FarmsConnect').collection('shopping_orders');
        
        // Filtrer seulement les commandes non terminées
        const orders = await collection.find({ 
            status: { $ne: 'livrée' } 
        }).sort({ orderDate: -1 }).toArray();
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ orders })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to fetch shopping orders',
                details: error.message 
            })
        };
    } finally {
        await client.close();
    }
};