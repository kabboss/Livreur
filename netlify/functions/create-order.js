// Nom du fichier : create-order.js

const { MongoClient } = require('mongodb');
const admin = require('firebase-admin');

// --- CONFIGURATION ---
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Commandes';

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

// --- INITIALISATION SÉCURISÉE DE FIREBASE ADMIN ---
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (e) {
        console.error('Erreur critique : Impossible d\'initialiser Firebase Admin SDK.', e);
    }
}

// --- FONCTION PRINCIPALE (HANDLER) ---
exports.handler = async (event) => {
    // Gérer la requête pre-flight OPTIONS
    if (event.httpMethod === 'OPTIONS' ) {
        return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
    }

    // CORRECTION CORS : On prépare une réponse de base avec les en-têtes.
    // Toutes les réponses, y compris les erreurs, utiliseront ces en-têtes.
    let response = {
        statusCode: 500,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ error: 'Erreur interne du serveur.' })
    };

    if (event.httpMethod !== 'POST' ) {
        response.statusCode = 405;
        response.body = JSON.stringify({ error: 'Method Not Allowed' });
        return response;
    }

    const client = new MongoClient(MONGODB_URI);

    try {
        const orderData = JSON.parse(event.body);

        if (!orderData.currentRestaurant?._id || !orderData.items || !orderData.client) {
            response.statusCode = 400;
            response.body = JSON.stringify({ error: 'Données de commande incomplètes ou ID du restaurant manquant.' });
            return response;
        }

        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        const now = new Date();
        const initialStatus = orderData.type === 'food' ? 'pending_restaurant_confirmation' : 'pending';

        const orderDocument = {
            type: "food",
            restaurant: {
                id: orderData.currentRestaurant._id,
                name: orderData.currentRestaurant.nomCommercial || orderData.currentRestaurant.nom,
                position: {
                    latitude: orderData.currentRestaurant.location?.latitude ?? null,
                    longitude: orderData.currentRestaurant.location?.longitude ?? null
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
            status: initialStatus,
            orderDate: new Date(orderData.orderDate || now),
            dateCreation: now,
            lastUpdate: now,
            codeCommande: generateOrderCode(),
            isCompleted: false,
            metadata: orderData.metadata || {}
        };

        const result = await collection.insertOne(orderDocument);

        if (!result.insertedId) {
            throw new Error('Échec de la création de la commande en base de données.');
        }

        if (orderDocument.status === 'pending_restaurant_confirmation') {
            sendPushNotification(db, orderDocument).catch(console.error);
        }

        response.statusCode = 201;
        response.body = JSON.stringify({
            success: true,
            orderId: result.insertedId,
            codeCommande: orderDocument.codeCommande
        });

    } catch (error) {
        console.error('Erreur dans la fonction create-order:', error);
        // La réponse d'erreur utilisera les en-têtes CORS définis au début.
        response.body = JSON.stringify({ success: false, error: 'Internal Server Error', message: error.message });
    } finally {
        await client.close();
    }

    return response;
};

// --- FONCTION D'ENVOI DE NOTIFICATION ---
async function sendPushNotification(db, order) {
    if (!admin.apps.length) {
        console.error('Firebase Admin n\'est pas initialisé.');
        return;
    }
    try {
        const restaurantId = order.restaurant.id;
        const tokensCollection = db.collection('NotificationTokens');
        const subscriptions = await tokensCollection.find({ restaurantId: restaurantId }).toArray();
        const tokens = subscriptions.map(sub => sub.token).filter(Boolean);

        if (tokens.length === 0) {
            console.log(`Aucun jeton de notification trouvé pour le restaurant ${restaurantId}`);
            return;
        }

        const message = {
            notification: {
                title: 'Nouvelle Commande Reçue !',
                body: `Commande de ${order.client.name} pour un total de ${order.subtotal.toLocaleString('fr-FR')} FCFA.`,
            },
            webpush: {
                notification: {
                    icon: 'https://cdn-icons-png.flaticon.com/512/1827/1827370.png',
                    tag: `new-order-${restaurantId}`
                }
            },
            tokens: tokens,
        };

        // CORRECTION : Suppression de l'espace superflue
        const response = await admin.messaging( ).sendMulticast(message);
        console.log(`${response.successCount} notifications envoyées avec succès.`);

    } catch (error) {
        console.error('Erreur lors de l\'envoi de la notification push:', error);
    }
}

// --- FONCTION UTILITAIRE ---
function generateOrderCode() {
    const date = new Date();
    const prefix = 'CMD';
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${date.getFullYear().toString().slice(-2)}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}${random}`;
}
