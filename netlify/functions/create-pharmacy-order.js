const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

exports.handler = async function(event) {
    // Configuration CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers,
            body: JSON.stringify({ error: 'Méthode non autorisée' }) 
        };
    }

    let client;
    try {
        // Parser les données
        const data = JSON.parse(event.body);
        
        // Validation
        if (!data.medicaments || !data.phoneNumber || !data.clientPosition) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Données manquantes' })
            };
        }

        // Vérifier la taille de l'image
        if (data.ordonnance?.data && data.ordonnance.data.length > MAX_IMAGE_SIZE) {
            return {
                statusCode: 413,
                headers,
                body: JSON.stringify({ error: 'L\'image est trop volumineuse (max 2MB)' })
            };
        }

        // Connexion MongoDB
        client = new MongoClient(MONGODB_URI, { 
            connectTimeoutMS: 5000,
            serverSelectionTimeoutMS: 5000 
        });
        await client.connect();
        const db = client.db(DB_NAME);

        // Structure de la commande
        const order = {
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            status: 'pending'
        };

        // Insertion
        const result = await db.collection('pharmacyOrders').insertOne(order);

        return {
            statusCode: 201,
            headers,
            body: JSON.stringify({ 
                success: true,
                orderId: result.insertedId 
            })
        };

    } catch (error) {
        console.error('Erreur:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Erreur serveur',
                details: error.message 
            })
        };
    } finally {
        if (client) await client.close();
    }
};