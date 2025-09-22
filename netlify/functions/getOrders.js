const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS' ) {
        return { statusCode: 200, headers: COMMON_HEADERS, body: '' };
    }

    if (event.httpMethod !== 'GET' ) {
        return { statusCode: 405, headers: COMMON_HEADERS, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
    }

    let client;
    try {
        const { serviceType, driverId, restaurantId } = event.queryStringParameters || {};
        
        client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000 // Timeout de connexion plus robuste
        });
        await client.connect();
        const db = client.db(DB_NAME);

        // --- CAS 1 : Un restaurant demande ses commandes à confirmer ---
        if (restaurantId) {
            const collection = db.collection('Commandes'); // Les commandes de nourriture sont dans "Commandes"
            const query = {
                'restaurant.id': restaurantId,
                'status': 'pending_restaurant_confirmation' // On ne cherche QUE ce statut
            };
            const orders = await collection.find(query).sort({ orderDate: -1 }).toArray();
            
            return {
                statusCode: 200,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ orders })
            };
        }

        // --- CAS 2 : Un livreur demande TOUTES ses commandes assignées (tous services confondus) ---
        if (driverId && !serviceType) {
            const allAssignedOrders = await getDriverAssignedOrders(db, driverId);
            return {
                statusCode: 200,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ orders: allAssignedOrders })
            };
        }

        // --- CAS 3 : Un livreur consulte les commandes disponibles pour un service spécifique ---
        const collectionMap = {
            packages: 'Livraison',
            food: 'Commandes',
            shopping: 'shopping_orders',
            pharmacy: 'pharmacyOrders'
        };

        if (!serviceType || !collectionMap[serviceType]) {
            return { statusCode: 400, headers: COMMON_HEADERS, body: JSON.stringify({ error: 'Type de service invalide' }) };
        }

        const collection = db.collection(collectionMap[serviceType]);
        
        // La requête de base pour un livreur :
        // - Statut 'pending' (disponible pour tous)
        // - OU la commande lui est assignée (driverId)
        const query = {
            $or: [
                { status: 'pending' },
                { driverId: driverId }
            ],
            // Exclure les commandes terminées de manière fiable
            isCompleted: { $ne: true } 
        };

        const orders = await collection.find(query).sort({ orderDate: -1 }).limit(200).toArray();

        const enrichedOrders = orders.map(order => ({
            ...order,
            isAssigned: !!order.driverId
        }));

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ orders: enrichedOrders })
        };

    } catch (error) {
        console.error('Erreur GET getOrders:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: 'Erreur serveur lors de la récupération des commandes.' })
        };
    } finally {
        if (client) await client.close();
    }
};

// Fonction utilitaire pour récupérer toutes les commandes assignées à un livreur
async function getDriverAssignedOrders(db, driverId) {
    const collectionsToSearch = ['Livraison', 'Commandes', 'shopping_orders', 'pharmacyOrders'];
    let allAssignedOrders = [];

    for (const collectionName of collectionsToSearch) {
        const collection = db.collection(collectionName);
        const orders = await collection.find({
            driverId: driverId,
            isCompleted: { $ne: true } // Condition simple et efficace
        }).toArray();
        allAssignedOrders.push(...orders);
    }

    // Trier par la date la plus récente
    allAssignedOrders.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
    
    return allAssignedOrders;
}
