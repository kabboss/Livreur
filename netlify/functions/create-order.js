const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Commandes';

const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 30000
});

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS'  ) {
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({})
        };
    }

    if (event.httpMethod !== 'POST'  ) {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const orderData = JSON.parse(event.body);

        if (!orderData.restaurant || !orderData.items || !orderData.client) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Données de commande incomplètes' })
            };
        }

        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        const now = new Date();
        const orderDate = orderData.orderDate ? new Date(orderData.orderDate) : now;

        // --- MODIFICATION CLÉ ---
        // Si le type est 'food', le statut est en attente de confirmation du restaurant.
        // Sinon, le statut est 'pending' (disponible pour les livreurs).
        const initialStatus = orderData.type === 'food' ? 'pending_restaurant_confirmation' : 'pending';

        const orderDocument = {
            type: orderData.type || "food",
            restaurant: {
                id: orderData.currentRestaurant?._id, // Assurez-vous que l'ID est bien passé
                name: orderData.restaurant.name,
                position: {
                    latitude: orderData.restaurant.position?.latitude ?? null,
                    longitude: orderData.restaurant.position?.longitude ?? null
                }
            },
            client: {
                name: orderData.client.name,
                phone: orderData.client.phone,
                address: orderData.client.address || null,
                position: orderData.client.position || {}
            },
            items: orderData.items || [],
            subtotal: orderData.subtotal || 0,
            deliveryFee: orderData.deliveryFee || 0,
            total: orderData.total || 0,
            notes: orderData.notes || '',
            payment_method: orderData.payment_method || 'cash',
            payment_status: orderData.payment_status || 'pending',
            payment_reference: orderData.payment_reference || null,
            status: initialStatus, // Utilisation du statut conditionnel
            orderDate: orderDate,
            dateCreation: now,
            lastUpdate: now,
            codeCommande: generateOrderCode(),
            metadata: orderData.metadata || {
                appVersion: '1.0',
                source: 'web'
            }
        };

        const result = await collection.insertOne(orderDocument);

        if (!result.insertedId) {
            throw new Error('Échec de la création de la commande');
        }

        return {
            statusCode: 201,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                orderId: result.insertedId,
                codeCommande: orderDocument.codeCommande,
                timestamp: orderDocument.dateCreation
            })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: false,
                error: 'Internal Server Error',
                message: error.message
            })
        };
    } finally {
        await client.close();
    }
};

function generateOrderCode() {
    const date = new Date();
    const prefix = 'CMD';
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${date.getFullYear().toString().slice(-2)}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}${random}`;
}
