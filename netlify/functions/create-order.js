// Nom du fichier : create-order.js

const { MongoClient } = require('mongodb');

// --- CONFIGURATION CORS ---
// Remplacez '*' par l'URL de votre site en production pour plus de sécurité
const ALLOWED_ORIGIN = process.env.NODE_ENV === 'development' ? '*' : 'https://send20.netlify.app';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// --- CONNEXION À MONGODB ---
// La chaîne de connexion est maintenant récupérée depuis les variables d'environnement de Netlify
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Commandes';

// --- FONCTION PRINCIPALE (HANDLER ) ---
exports.handler = async (event) => {
    // 1. Gérer la requête "pre-flight" OPTIONS pour CORS
    if (event.httpMethod === 'OPTIONS' ) {
        return {
            statusCode: 204, // No Content
            headers: CORS_HEADERS,
            body: ''
        };
    }

    // 2. Vérifier si la variable d'environnement est bien chargée
    if (!MONGODB_URI) {
        console.error("Erreur critique: La variable d'environnement MONGODB_URI n'est pas définie.");
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, message: "Erreur de configuration du serveur." })
        };
    }

    // 3. Vérifier que la méthode est bien POST
    if (event.httpMethod !== 'POST' ) {
        return {
            statusCode: 405, // Method Not Allowed
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, message: 'Méthode non autorisée. Seul POST est accepté.' })
        };
    }

    const client = new MongoClient(MONGODB_URI);

    try {
        // 4. Parser et valider les données de la commande
        const orderData = JSON.parse(event.body || '{}');

        if (!orderData.currentRestaurant?._id || !orderData.items?.length || !orderData.client?.phone) {
            return {
                statusCode: 400, // Bad Request
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: false, message: 'Données de commande invalides ou incomplètes.' })
            };
        }

        // 5. Connexion à la base de données
        await client.connect();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // 6. Préparation du document à insérer
        const now = new Date();
        const orderDocument = {
            type: "food",
            restaurant: {
                id: orderData.currentRestaurant._id,
                name: orderData.currentRestaurant.nom || 'Restaurant Inconnu',
            },
            client: {
                name: orderData.client.name,
                phone: orderData.client.phone,
                address: orderData.client.address,
                position: orderData.client.position || null
            },
            items: orderData.items,
            subtotal: orderData.subtotal,
            deliveryFee: orderData.deliveryFee,
            total: orderData.total,
            notes: orderData.notes || '',
            payment_method: orderData.payment_method || 'on_delivery',
            payment_status: orderData.payment_status || 'pending',
            status: 'pending_restaurant_confirmation',
            orderDate: new Date(orderData.orderDate || now),
            codeCommande: generateOrderCode(),
            // ... autres champs
        };

        // 7. Insertion de la commande
        const result = await collection.insertOne(orderDocument);

        // 8. Réponse de succès
        return {
            statusCode: 201, // Created
            headers: CORS_HEADERS,
            body: JSON.stringify({
                success: true,
                orderId: result.insertedId,
                codeCommande: orderDocument.codeCommande,
                message: 'Commande créée avec succès'
            })
        };

    } catch (error) {
        console.error('Erreur dans la fonction create-order:', error);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, message: "Une erreur interne est survenue.", error: error.message })
        };
    } finally {
        // 9. Fermer la connexion dans tous les cas
        await client.close();
    }
};

// --- FONCTION UTILITAIRE ---
function generateOrderCode() {
    const prefix = 'CMD';
    const date = new Date();
    const random = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${date.getFullYear().toString().slice(-2)}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}-${random}`;
}
