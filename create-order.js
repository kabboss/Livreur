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
// On initialise Firebase Admin une seule fois pour éviter les erreurs et optimiser les performances.
if (!admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('Firebase Admin SDK initialisé avec succès.');
    } catch (e) {
        console.error('Erreur critique : Impossible d\'initialiser Firebase Admin SDK. Vérifiez la variable d\'environnement FIREBASE_SERVICE_ACCOUNT.', e);
    }
}

// --- FONCTION PRINCIPALE (HANDLER) ---
exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS' ) {
        return { statusCode: 200, headers: COMMON_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST' ) {
        return { statusCode: 405, headers: COMMON_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const client = new MongoClient(MONGODB_URI);

    try {
        const orderData = JSON.parse(event.body);

        // Validation des données reçues
        if (!orderData.currentRestaurant?._id || !orderData.items || !orderData.client) {
            return { statusCode: 400, headers: COMMON_HEADERS, body: JSON.stringify({ error: 'Données de commande incomplètes ou ID du restaurant manquant.' }) };
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
            isCompleted: false, // Important pour le filtrage futur
            metadata: orderData.metadata || {}
        };

        const result = await collection.insertOne(orderDocument);

        if (!result.insertedId) {
            throw new Error('Échec de la création de la commande en base de données.');
        }

        // === DÉCLENCHEMENT DE LA NOTIFICATION PUSH ===
        if (orderDocument.status === 'pending_restaurant_confirmation') {
            // On n'attend pas la fin de l'envoi pour répondre au client,
            // cela rend l'application plus rapide.
            sendPushNotification(db, orderDocument).catch(console.error);
        }
        // ============================================

        return {
            statusCode: 201,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                orderId: result.insertedId,
                codeCommande: orderDocument.codeCommande
            })
        };
    } catch (error) {
        console.error('Erreur dans la fonction create-order:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ success: false, error: 'Internal Server Error', message: error.message })
        };
    } finally {
        await client.close();
    }
};

// --- FONCTION D'ENVOI DE NOTIFICATION ---
async function sendPushNotification(db, order) {
    if (!admin.apps.length) {
        console.error('Firebase Admin n\'est pas initialisé. Impossible d\'envoyer la notification.');
        return;
    }

    try {
        const restaurantId = order.restaurant.id;
        const tokensCollection = db.collection('NotificationTokens');
        
        const subscriptions = await tokensCollection.find({ restaurantId: restaurantId }).toArray();
        const tokens = subscriptions.map(sub => sub.token).filter(Boolean); // Filtre les jetons vides ou nuls

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
                    icon: 'https://cdn-icons-png.flaticon.com/512/1827/1827370.png', // IMPORTANT: URL publique complète de votre logo
                    tag: `new-order-${restaurantId}` // Regroupe les notifications pour un même restaurant
                }
            },
            tokens: tokens,
        };

        const response = await admin.messaging( ).sendMulticast(message);
        console.log(`${response.successCount} notifications envoyées avec succès pour la commande ${order.codeCommande}.`);

        if (response.failureCount > 0) {
            console.warn(`${response.failureCount} jetons de notification ont échoué.`);
            // Logique optionnelle pour nettoyer les jetons invalides de la base de données
        }

    } catch (error) {
        console.error('Erreur détaillée lors de l\'envoi de la notification push:', error);
    }
}

// --- FONCTION UTILITAIRE ---
function generateOrderCode() {
    const date = new Date();
    const prefix = 'CMD';
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${date.getFullYear().toString().slice(-2)}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}${random}`;
}
