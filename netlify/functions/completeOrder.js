const { MongoClient, ObjectId } = require('mongodb');

// --- Configuration MongoDB ---
// URI de connexion à votre cluster MongoDB Atlas
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
// Nom de la base de données à utiliser
const DB_NAME = 'FarmsConnect';

// Client MongoDB initialisé avec des timeouts pour une connexion robuste
const mongoClient = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,       // Délai maximal pour établir la connexion
    serverSelectionTimeoutMS: 5000 // Délai maximal pour la sélection du serveur
});

// --- En-têtes HTTP communs pour la gestion des CORS ---
const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',             // Autorise les requêtes de toutes les origines (à revoir pour la production)
    'Access-Control-Allow-Headers': 'Content-Type', // Autorise l'en-tête Content-Type
    'Access-Control-Allow-Methods': 'POST, OPTIONS',// Méthodes HTTP autorisées
    'Content-Type': 'application/json'              // Type de contenu de la réponse
};

// --- Gestionnaire principal de la fonction Netlify ---
exports.handler = async (event) => {
    // Traitement des requêtes OPTIONS (pré-vérification CORS)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,                // Réponse OK
            headers: COMMON_HEADERS,        // Inclus les en-têtes CORS
            body: JSON.stringify({})        // Corps de réponse vide
        };
    }

    // Restriction aux requêtes POST pour la logique métier
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,                // Méthode non autorisée
            headers: COMMON_HEADERS,
            body: 'Method Not Allowed'
        };
    }

    let client; // Déclaré ici pour assurer la fermeture de la connexion dans le bloc 'finally'

    try {
        // Parse le corps de la requête HTTP (qui est une chaîne JSON) en un objet JavaScript
        const data = JSON.parse(event.body);

        // Extraction des données essentielles de la commande reçues du frontend
        // Note : Les champs de preuve de livraison (images) ne sont plus attendus ici.
        const { orderId, serviceType, driverId, driverName, notes } = data;

        // --- Connexion à la base de données MongoDB ---
        client = await mongoClient.connect();
        const db = client.db(DB_NAME);

        // --- Détermination dynamique de la collection MongoDB ---
        let collectionName;
        if (serviceType === 'food') {
            collectionName = 'Commandes';        // Pour les commandes de nourriture
        } else if (serviceType === 'courses') {
            collectionName = 'shopping_orders';  // Pour les commandes de courses
        } else if (serviceType === 'pharmacy') {
            collectionName = 'pharmacyOrders';   // Pour les commandes de pharmacie
        } else {
            // Renvoie une erreur si le type de service est inconnu ou non pris en charge
            return {
                statusCode: 400, // Requête invalide
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: `Type de service inconnu ou non pris en charge : ${serviceType}` })
            };
        }

        // --- 1. Vérification de la commande ---
        // Recherche la commande par son ID ET s'assure qu'elle est bien assignée au livreur actuel.
        const order = await db.collection(collectionName).findOne({
            _id: new ObjectId(orderId), // Convertit l'ID de la commande en ObjectId MongoDB
            driverId: driverId          // Vérifie l'assignation au livreur actuel
        });

        // Si la commande n'est pas trouvée ou n'est pas assignée à ce livreur
        if (!order) {
            return {
                statusCode: 404, // Non trouvé
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande introuvable ou non assignée à ce livreur.' })
            };
        }

        // Si la commande a déjà le statut 'livrée'
        if (order.status === 'livrée') {
            return {
                statusCode: 400, // Requête invalide
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande déjà marquée comme livrée.' })
            };
        }

        // --- 2. Préparation des données de mise à jour ---
        const updateData = {
            status: 'livrée',                 // Nouveau statut de la commande
            deliveryNotes: notes || null,     // Notes de livraison (si fournies, sinon null)
            deliveredAt: new Date()           // Horodatage de la livraison
        };

        // --- 3. Mise à jour de la commande dans la base de données ---
        await db.collection(collectionName).updateOne(
            { _id: new ObjectId(orderId) }, // Cible la commande par son ID
            { $set: updateData }            // Applique les modifications aux champs spécifiés
        );

        // --- Réponse de succès ---
        return {
            statusCode: 200, // OK
            headers: COMMON_HEADERS,
            body: JSON.stringify({ message: 'Livraison terminée avec succès !' })
        };

    } catch (error) {
        // --- Gestion des erreurs ---
        // Journalise l'erreur complète dans les logs pour le débogage
        console.error('Erreur lors de la finalisation de la livraison :', error);
        return {
            statusCode: 500, // Erreur interne du serveur
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message || 'Une erreur interne est survenue lors de l\'opération.' })
        };
    } finally {
        // --- Fermeture de la connexion MongoDB ---
        // Assure que la connexion à la base de données est fermée dans tous les cas
        if (client) {
            await client.close();
        }
    }
};