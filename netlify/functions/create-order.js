// Nom du fichier : create-order.js

const { MongoClient } = require('mongodb');

const admin = require('firebase-admin');

// --- CONFIGURATION CORS PERMISSIVE ---
const PERMISSIVE_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
};

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Commandes';

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
    // Gérer la requête pre-flight OPTIONS de manière très permissive
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: PERMISSIVE_HEADERS,
            body: ''
        };
    }

    // Préparer la réponse avec les en-têtes CORS permissifs
    let response = {
        statusCode: 200,
        headers: PERMISSIVE_HEADERS,
        body: JSON.stringify({ success: true })
    };

    const client = new MongoClient(MONGODB_URI);

    try {
        // Vérifier que c'est une méthode POST
        if (event.httpMethod !== 'POST') {
            response.statusCode = 405;
            response.body = JSON.stringify({ 
                success: false, 
                error: 'Method Not Allowed',
                message: 'Seules les requêtes POST sont autorisées'
            });
            return response;
        }

        // Parser le corps de la requête
        let orderData;
        try {
            orderData = JSON.parse(event.body || '{}');
        } catch (parseError) {
            response.statusCode = 400;
            response.body = JSON.stringify({ 
                success: false, 
                error: 'Invalid JSON',
                message: 'Le corps de la requête contient du JSON invalide'
            });
            return response;
        }

        // Validation des données requises
        if (!orderData.currentRestaurant?._id) {
            response.statusCode = 400;
            response.body = JSON.stringify({ 
                success: false, 
                error: 'Missing Restaurant ID',
                message: 'L\'ID du restaurant est requis'
            });
            return response;
        }

        if (!orderData.items || !Array.isArray(orderData.items) || orderData.items.length === 0) {
            response.statusCode = 400;
            response.body = JSON.stringify({ 
                success: false, 
                error: 'Missing Items',
                message: 'La commande doit contenir au moins un article'
            });
            return response;
        }

        if (!orderData.client || !orderData.client.name || !orderData.client.phone) {
            response.statusCode = 400;
            response.body = JSON.stringify({ 
                success: false, 
                error: 'Missing Client Information',
                message: 'Les informations du client (nom et téléphone) sont requises'
            });
            return response;
        }

        // Connexion à la base de données
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        const now = new Date();
        const initialStatus = orderData.type === 'food' ? 'pending_restaurant_confirmation' : 'pending';

        // Construction du document de commande
        const orderDocument = {
            type: "food",
            restaurant: {
                id: orderData.currentRestaurant._id,
                name: orderData.currentRestaurant.nomCommercial || orderData.currentRestaurant.nom || 'Restaurant Inconnu',
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
            items: orderData.items.map(item => ({
                name: item.name || 'Article sans nom',
                quantity: item.quantity || 1,
                price: item.price || 0,
                total: (item.quantity || 1) * (item.price || 0)
            })),
            subtotal: orderData.subtotal || orderData.items.reduce((sum, item) => sum + ((item.quantity || 1) * (item.price || 0)), 0),
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

        // Calcul du total si non fourni
        if (!orderData.total) {
            orderDocument.total = orderDocument.subtotal + orderDocument.deliveryFee;
        }

        // Insertion dans la base de données
        const result = await collection.insertOne(orderDocument);

        if (!result.insertedId) {
            throw new Error('Échec de la création de la commande en base de données.');
        }

        // Envoi de notification si nécessaire
        if (orderDocument.status === 'pending_restaurant_confirmation') {
            try {
                await sendPushNotification(db, orderDocument);
            } catch (notifError) {
                console.error('Erreur lors de l\'envoi de la notification:', notifError);
                // Ne pas bloquer la commande si la notification échoue
            }
        }

        // Réponse de succès
        response.statusCode = 201;
        response.body = JSON.stringify({
            success: true,
            orderId: result.insertedId,
            codeCommande: orderDocument.codeCommande,
            message: 'Commande créée avec succès'
        });

    } catch (error) {
        console.error('Erreur dans la fonction create-order:', error);
        
        response.statusCode = 500;
        response.body = JSON.stringify({ 
            success: false, 
            error: 'Internal Server Error', 
            message: error.message 
        });
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
                body: `Commande de ${order.client.name} pour un total de ${order.total.toLocaleString('fr-FR')} FCFA.`,
            },
            webpush: {
                notification: {
                    icon: 'https://cdn-icons-png.flaticon.com/512/1827/1827370.png',
                    tag: `new-order-${restaurantId}`
                }
            },
            tokens: tokens,
        };

        const response = await admin.messaging().sendMulticast(message);
        console.log(`${response.successCount} notifications envoyées avec succès sur ${tokens.length} tentatives.`);

        if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    console.error(`Échec de l'envoi au token ${tokens[idx]}:`, resp.error);
                }
            });
        }

    } catch (error) {
        console.error('Erreur lors de l\'envoi de la notification push:', error);
        throw error; // Propager l'erreur pour la gestion en amont
    }
}

// --- FONCTION UTILITAIRE ---
function generateOrderCode() {
    const date = new Date();
    const prefix = 'CMD';
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${date.getFullYear().toString().slice(-2)}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}${random}`;
}