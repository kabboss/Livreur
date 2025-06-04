const { MongoClient, ObjectId } = require('mongodb');

// Configuration de la base de données
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

// Configuration des en-têtes HTTP
const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event) => {
    // Gestion des requêtes OPTIONS (CORS)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({})
        };
    }

    // Vérification de la méthode HTTP
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: 'Method Not Allowed'
        };
    }

    let client;

    try {
        // Connexion à MongoDB
        client = await MongoClient.connect(MONGODB_URI, {
            connectTimeoutMS: 5000,
            serverSelectionTimeoutMS: 5000
        });
        const db = client.db(DB_NAME);

        // Parsing des données de la requête
        const data = JSON.parse(event.body);
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverPhone2, driverLocation } = data;

        // Validation des données requises
        if (!orderId || !serviceType || !driverId || !driverName || !driverPhone1 || !driverLocation) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Données requises manquantes' })
            };
        }

        // Détermination de la collection en fonction du type de service
        const collectionMap = {
            packages: 'Livraison',
            food: 'Commandes',
            shopping: 'shopping_orders',
            pharmacy: 'pharmacyOrders'
        };

        const collectionName = collectionMap[serviceType];
        if (!collectionName) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: `Type de service non valide: ${serviceType}` })
            };
        }

        const collection = db.collection(collectionName);

        // Vérification de l'existence de la commande
        const order = await collection.findOne({ _id: new ObjectId(orderId) });
        if (!order) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande non trouvée' })
            };
        }

        // Vérification que la commande n'est pas déjà assignée
        if (order.status === 'en cours' && order.driverId) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Commande déjà assignée',
                    currentDriver: order.driverName || order.driverId
                })
            };
        }

        // Préparation des données de mise à jour
        const updateData = {
            status: 'en cours',
            driverId,
            driverName,
            driverPhone: driverPhone1,
            driverPhone2: driverPhone2 || null,
            driverLocation,
            assignedAt: new Date(),
            lastUpdated: new Date()
        };

        // Mise à jour de la commande
        const result = await collection.updateOne(
            { _id: new ObjectId(orderId) },
            { $set: updateData }
        );

        if (result.modifiedCount === 0) {
            return {
                statusCode: 500,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Échec de la mise à jour de la commande' })
            };
        }

        // Réponse de succès
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                message: 'Livreur assigné avec succès',
                orderId,
                driverId,
                driverName
            })
        };

    } catch (error) {
        console.error('Erreur:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message || 'Erreur serveur' })
        };
    } finally {
        if (client) {
            await client.close();
        }
    }
};