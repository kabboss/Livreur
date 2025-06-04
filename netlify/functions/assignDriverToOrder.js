const { MongoClient, ObjectId } = require('mongodb');

// --- Configuration de la base de données ---
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect'; // Nom de votre base de données

const mongoClient = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,       // Délai maximum pour établir la connexion
    serverSelectionTimeoutMS: 5000 // Délai maximum pour la sélection du serveur
});

// --- En-têtes HTTP communs pour la sécurité (CORS) ---
const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*', // Autorise les requêtes de n'importe quel domaine (à ajuster en production)
    'Access-Control-Allow-Headers': 'Content-Type', // Autorise l'envoi du type de contenu JSON
    'Access-Control-Allow-Methods': 'POST, OPTIONS', // Autorise les méthodes POST et OPTIONS
    'Content-Type': 'application/json' // Indique que la réponse sera en JSON
};

// --- Le gestionnaire principal de la fonction Netlify ---
exports.handler = async (event) => {
    // Gère les requêtes OPTIONS (pré-vérification CORS)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({}) // Réponse vide, juste pour valider les CORS
        };
    }

    // N'accepte que les requêtes POST pour la logique métier
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405, // Méthode non autorisée
            headers: COMMON_HEADERS,
            body: 'Method Not Allowed'
        };
    }

    let client; // Variable pour stocker la connexion MongoDB, accessible dans le 'finally'

    try {
        // --- Connexion à la base de données ---
        client = await mongoClient.connect();
        const db = client.db(DB_NAME);

        // --- Récupération des données envoyées par le frontend ---
        const data = JSON.parse(event.body);
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverPhone2, driverLocation } = data;

        // --- Détermination de la collection MongoDB en fonction du type de service ---
        let collectionName;
        if (serviceType === 'food') {
            collectionName = 'Commandes'; // Collection pour les commandes de nourriture
        } else if (serviceType === 'courses') {
            collectionName = 'shopping_orders'; // Collection pour les commandes de courses
        } else if (serviceType === 'pharmacy') {
            collectionName = 'pharmacyOrders'; // Collection pour les commandes de pharmacie
        } else {
            // Renvoie une erreur si le type de service est inconnu ou non géré
            return {
                statusCode: 400, // Requête invalide
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: `Type de service inconnu ou non pris en charge : ${serviceType}` })
            };
        }

        // --- 1. Vérification de l'existence et du statut de la commande ---
        // Recherche la commande par son ID unique dans la collection appropriée
        const order = await db.collection(collectionName).findOne({ _id: new ObjectId(orderId) });

        if (!order) {
            // Si la commande n'est pas trouvée
            return {
                statusCode: 404, // Non trouvé
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande introuvable dans la collection spécifiée.' })
            };
        }

        if (order.status === 'en cours') {
            // Si la commande est déjà assignée et en cours
            return {
                statusCode: 400, // Requête invalide
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande déjà assignée à un livreur.' })
            };
        }

        // --- 2. Préparation des données de mise à jour ---
        const updateData = {
            status: 'en cours', // Le statut de la commande devient 'en cours'
            driverId,
            driverName,
            driverPhone: driverPhone1,
            driverPhone2: driverPhone2 || null, // Utilise driverPhone2 s'il existe, sinon null
            driverLocation,
            assignedAt: new Date() // Date et heure de l'assignation
        };

        // --- 3. Mise à jour de la commande dans la base de données ---
        await db.collection(collectionName).updateOne(
            { _id: new ObjectId(orderId) },
            { $set: updateData } // Met à jour les champs spécifiés avec les nouvelles valeurs
        );

        // --- Réponse de succès ---
        return {
            statusCode: 200, // OK
            headers: COMMON_HEADERS,
            body: JSON.stringify({ message: 'Livreur assigné avec succès à la commande.' })
        };

    } catch (error) {
        // --- Gestion des erreurs ---
        console.error('Erreur lors de l\'assignation du livreur :', error); // Journalise l'erreur complète pour le débogage
        return {
            statusCode: 500, // Erreur interne du serveur
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message || 'Erreur interne du serveur lors de l\'opération.' })
        };
    } finally {
        // --- Fermeture de la connexion MongoDB ---
        if (client) {
            await client.close(); // S'assure que la connexion est toujours fermée
        }
    }
};