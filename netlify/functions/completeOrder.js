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
        const { orderId, serviceType, driverId, driverName, notes } = data;

        // Validation des données requises
        if (!orderId || !serviceType || !driverId) {
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

        // Vérification de l'existence de la commande et qu'elle est bien assignée au livreur
        const order = await collection.findOne({ 
            _id: new ObjectId(orderId),
            driverId: driverId,
            status: 'en cours'
        });

        if (!order) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Commande non trouvée ou non assignée à ce livreur',
                    suggestion: 'Vérifiez que vous êtes bien le livreur assigné à cette commande'
                })
            };
        }

        // Préparation des données de mise à jour
        const updateData = {
            status: 'livrée',
            deliveryNotes: notes || null,
            deliveredAt: new Date(),
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
                message: 'Livraison marquée comme terminée avec succès',
                orderId,
                deliveredAt: updateData.deliveredAt
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