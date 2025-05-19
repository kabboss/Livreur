const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Courses';

const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000
});

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: COMMON_HEADERS
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { ...COMMON_HEADERS, 'Allow': 'POST, OPTIONS' },
            body: JSON.stringify({ message: 'Méthode non autorisée' })
        };
    }

    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const coursesCollection = db.collection(COLLECTION_NAME);

        const body = JSON.parse(event.body);

        const {
            serviceType,
            shoppingList,
            budgetMin,
            budgetMax,
            specialInstructions,
            deliveryTime,
            deliveryFee,
            clientPosition,
            orderDate,
            status
        } = body;

        if (!shoppingList || !clientPosition || !clientPosition.lat || !clientPosition.lng) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ message: 'La liste de courses et la localisation du client sont obligatoires.' })
            };
        }

        const newCourse = {
            serviceType: serviceType || 'shopping',
            shoppingList: shoppingList,
            budgetMin: parseFloat(budgetMin) || 0,
            budgetMax: parseFloat(budgetMax) || 0,
            specialInstructions: specialInstructions || '',
            deliveryTime: deliveryTime || null,
            deliveryFee: parseFloat(deliveryFee) || 0,
            clientPosition: {
                type: 'Point',
                coordinates: [clientPosition.lng, clientPosition.lat] // MongoDB utilise [longitude, latitude]
            },
            orderDate: orderDate || new Date().toISOString(),
            status: status || 'en attente',
            createdAt: new Date()
        };

        const result = await coursesCollection.insertOne(newCourse);

        if (result.insertedId) {
            return {
                statusCode: 201,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ message: 'Demande de courses enregistrée avec succès', orderId: result.insertedId })
            };
        } else {
            return {
                statusCode: 500,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ message: 'Erreur lors de l\'enregistrement de la demande de courses.' })
            };
        }

    } catch (error) {
        console.error('Erreur lors de la connexion à MongoDB ou de l\'enregistrement:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ message: 'Erreur serveur lors de l\'enregistrement de la demande de courses.', error: error.message })
        };
    } finally {
        if (client.isConnected()) {
            await client.close();
        }
    }
};