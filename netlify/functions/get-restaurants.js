const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Restau';

const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    retryWrites: true
});

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300'
};

exports.handler = async (event, context) => {
    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: ''
        };
    }

    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: CORS_HEADERS,
            body: JSON.stringify({ 
                error: 'Method Not Allowed',
                message: 'Only GET requests are allowed'
            })
        };
    }

    let connection = null;

    try {
        // Connect to MongoDB with timeout
        connection = await Promise.race([
            client.connect(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Connection timeout')), 8000)
            )
        ]);

        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        
        // Create index for better performance
        await collection.createIndex({ statut: 1 });
        
        // Query with projection to limit data transfer
        const restaurants = await collection.find(
            { statut: 'actif' },
            {
                projection: {
                    nom: 1,
                    adresse: 1,
                    latitude: 1,
                    longitude: 1,
                    cuisine: 1,
                    logo_data: 1,
                    menu: 1,
                    statut: 1
                }
            }
        ).limit(50).toArray();

        // Transform data for frontend
        const transformedRestaurants = restaurants.map(restaurant => ({
            _id: restaurant._id,
            nom: restaurant.nom || 'Restaurant',
            adresse: restaurant.adresse || 'Adresse non disponible',
            latitude: parseFloat(restaurant.latitude) || 0,
            longitude: parseFloat(restaurant.longitude) || 0,
            cuisine: restaurant.cuisine || 'Cuisine variée',
            logo_data: restaurant.logo_data || null,
            menu: Array.isArray(restaurant.menu) ? restaurant.menu.map(item => ({
                id: item.id || Math.random().toString(36).substr(2, 9),
                nom: item.nom || 'Plat',
                description: item.description || '',
                prix: parseFloat(item.prix) || 0
            })) : []
        }));

        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify(transformedRestaurants)
        };

    } catch (error) {
        console.error('Database error:', error);
        
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ 
                error: 'Internal Server Error',
                message: 'Unable to fetch restaurants. Please try again later.',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };

    } finally {
        // Ensure connection is closed
        if (connection) {
            try {
                await client.close();
            } catch (closeError) {
                console.error('Error closing connection:', closeError);
            }
        }
    }
};