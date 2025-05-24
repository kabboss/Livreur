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
        const formData = JSON.parse(event.body);
        const client = new MongoClient(uri, { connectTimeoutMS: 5000 });
        await client.connect();

        const updateData = {
            status: 'livrée',
            completedAt: new Date(),
            deliveryNotes: formData.notes
        };

        if (formData.proof) {
            updateData.deliveryProof = formData.proof;
        }

        const result = await client.db('FarmsConnect').collection('Commandes').updateOne(
            { _id: formData.orderId },
            { $set: updateData }
        );

        if (result.modifiedCount === 0) {
            throw new Error('Commande non trouvée ou déjà livrée');
        }

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