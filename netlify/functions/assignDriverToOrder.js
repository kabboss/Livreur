// Fichier : functions/assignDriverToOrder.js

const { MongoClient, ObjectId } = require('mongodb');

// --- Configuration (inchangée) ---
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

// --- Logique de la fonction ---
exports.handler = async (event) => {
    // Gestion de la requête OPTIONS (inchangée)
    if (event.httpMethod === 'OPTIONS' ) {
        return { statusCode: 200, headers: COMMON_HEADERS, body: JSON.stringify({}) };
    }

    // Vérification de la méthode POST (inchangée)
    if (event.httpMethod !== 'POST' ) {
        return { statusCode: 405, headers: COMMON_HEADERS, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
    }

    let client;

    try {
        const data = JSON.parse(event.body);
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverPhone2, driverLocation } = data;

        // Validation des données d'entrée (inchangée)
        if (!orderId || !serviceType || !driverId || !driverName || !driverPhone1 || !driverLocation) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Données requises manquantes' })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        const collectionMap = {
            packages: 'Livraison',
            food: 'Commandes',
            shopping: 'shopping_orders',
            pharmacy: 'pharmacyOrders'
        };
        const collectionName = collectionMap[serviceType];
        if (!collectionName) {
            return { statusCode: 400, headers: COMMON_HEADERS, body: JSON.stringify({ error: 'Type de service invalide' }) };
        }

        const collection = db.collection(collectionName);
        
        // **AMÉLIORATION 1 : Requête de recherche atomique**
        // On cherche une commande qui correspond à l'ID ET qui n'est PAS déjà assignée.
        const query = {
            $or: [ 
                { _id: ObjectId.isValid(orderId) ? new ObjectId(orderId) : orderId }, 
                { colisID: orderId }, 
                { identifiant: orderId } 
            ],
            // Condition cruciale pour éviter les conflits
            status: { $nin: ['assigned', 'en_cours', 'en_cours_de_livraison', 'completed', 'livré'] }
        };

        // **AMÉLIORATION 2 : Données de mise à jour unifiées**
        const updateData = {
            $set: {
                status: 'assigned', // Statut standardisé
                statut: 'en_cours_de_livraison', // Pour la compatibilité avec l'ancien code
                assignedAt: new Date(),
                driverId,
                driverName,
                driverPhone: driverPhone1,
                driverPhone2,
                driverLocation,
                lastUpdated: new Date()
            }
        };

        // **AMÉLIORATION 3 : Opération atomique `findOneAndUpdate`**
        // Trouve la commande correspondant à `query` et la met à jour avec `updateData`.
        // Renvoie la version de la commande APRES la mise à jour.
        const result = await collection.findOneAndUpdate(query, updateData, { returnDocument: 'after' });

        // Si `result.value` est null, la commande n'a pas été trouvée (car déjà prise ou inexistante)
        if (!result.value) {
            return {
                statusCode: 409, // 409 Conflict : indique une compétition pour la ressource
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    error: 'Cette commande n\'est plus disponible ou a déjà été assignée par un autre livreur.',
                    isAlreadyAssigned: true
                })
            };
        }
        
        // **AMÉLIORATION 4 : Création de la copie APRES avoir sécurisé la commande**
        // On utilise `result.value` qui contient la commande mise à jour.
        const expeditionData = { ...result.value, originalCollection: collectionName };
        await db.collection('cour_expedition').insertOne(expeditionData);

        // Succès !
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                success: true, 
                message: 'Commande acceptée avec succès !',
                order: result.value // On peut renvoyer la commande mise à jour si besoin
            })
        };

    } catch (error) {
        console.error('Erreur assignation livreur:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: 'Une erreur interne est survenue.', details: error.message })
        };
    } finally {
        if (client) await client.close();
    }
};
