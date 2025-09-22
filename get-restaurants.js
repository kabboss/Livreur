const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Restau';

const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
});

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({})
        };
    }

    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        
        // Projection pour optimiser le transfert de données
        const projection = {
            restaurantId: 1,
            nom: 1,
            nomCommercial: 1,
            telephone: 1,
            adresse: 1,
            quartier: 1,
            location: 1,
            cuisine: 1,
            specialites: 1,
            description: 1,
            menu: 1,
            logo: 1,
            photos: 1,
            statut: 1,
            horairesDetails: 1
        };

        // Récupération avec projection et filtre sur statut actif
        const restaurants = await collection.find(
            { statut: 'actif' },
            { projection }
        ).toArray();

        // Optimisation des données pour le frontend
const optimizedRestaurants = restaurants.map(resto => {
    // Vérification que la localisation existe
    const hasValidLocation = resto.location && 
                          typeof resto.location.latitude === 'number' && 
                          typeof resto.location.longitude === 'number';
    
    // Transformer le menu pour formater correctement les photos
    const optimizedMenu = (resto.menu || []).map(item => {
        if (item.photo) {
            return {
                ...item,
                photo: {
                    type: item.photo.type,
                    data: item.photo.base64, // Ici on renomme base64 en data
                    name: item.photo.name,
                    size: item.photo.size
                }
            };
        }
        return item;
    });
    
    return {
        _id: resto._id, // Vous utilisez restaurantId dans le front, mais _id dans la base
        restaurantId: resto.restaurantId,
        nom: resto.nomCommercial || resto.nom,
        adresse: `${resto.adresse}, ${resto.quartier}`,
        telephone: resto.telephone,
        location: hasValidLocation ? {
            latitude: resto.location.latitude,
            longitude: resto.location.longitude
        } : null,
        cuisine: resto.cuisine,
        specialites: resto.specialites,
        description: resto.description,
        menu: optimizedMenu, // Utiliser le menu transformé
        logo: resto.logo ? {
            data: resto.logo.base64,
            type: resto.logo.type
        } : null,
        photos: resto.photos?.map(photo => ({
            data: photo.base64,
            type: photo.type
        })) || [],
        horaires: resto.horairesDetails,
        hasValidLocation
    };
}).filter(resto => resto.menu.length > 0);

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify(optimizedRestaurants)
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: 'Internal Server Error',
                message: error.message 
            })
        };
    } finally {
        await client.close();
    }
};