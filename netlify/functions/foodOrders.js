const { MongoClient } = require('mongodb');
const uri = process.env.MONGODB_URI || 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    const client = new MongoClient(uri);
    
    try {
        await client.connect();
        const orders = await client.db('FarmsConnect')
                                .collection('Commandes')
                                .find({})
                                .toArray();
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ orders })
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