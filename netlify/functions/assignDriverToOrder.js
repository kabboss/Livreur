const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({})
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: 'Méthode non autorisée' })
        };
    }

    let client;

    try {
        const data = JSON.parse(event.body);
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverLocation } = data;

        if (!orderId || !serviceType || !driverId || !driverName || !driverPhone1 || !driverLocation) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Données requises manquantes' })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Vérifier si la commande est déjà assignée
        const existingAssignment = await db.collection('cour_expedition').findOne({ 
            $or: [
                { orderId: orderId },
                { codeID: orderId }
            ],
            serviceType: serviceType
        });

        if (existingAssignment) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: `Cette commande est déjà assignée à ${existingAssignment.driverName || existingAssignment.nomLivreur}`,
                    isAlreadyAssigned: true
                })
            };
        }

        // Déterminer la collection source
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
                body: JSON.stringify({ error: 'Type de service invalide' })
            };
        }

        // Trouver la commande originale
        let query;
        try {
            query = { _id: new ObjectId(orderId) };
        } catch (e) {
            query = { codeID: orderId };
        }

        const originalOrder = await db.collection(collectionName).findOne(query);
        if (!originalOrder) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande non trouvée' })
            };
        }

        // Créer l'objet expedition
        const expeditionData = {
            ...originalOrder,
            orderId: orderId,
            serviceType: serviceType,
            driverId: driverId,
            driverName: driverName,
            driverPhone1: driverPhone1,
            driverLocation: driverLocation,
            assignedAt: new Date(),
            status: 'en cours',
            originalCollection: collectionName
        };

        // Insérer dans cour_expedition
        await db.collection('cour_expedition').insertOne(expeditionData);

        // Mettre à jour la commande originale
const updateData = {
    status: 'en cours',
    driverId: driverId,
    driverName: driverName,
    nomLivreur: driverName, // Ajout de cette ligne pour les colis
    driverPhone: driverPhone1,
    assignedAt: new Date()
};
        // Pour les colis, on utilise des champs spécifiques
if (serviceType === 'packages') {
    updateData.idLivreurEnCharge = driverId;
    updateData.nomLivreur = driverName; // Assurez-vous que ce champ est bien sauvegardé
    updateData.estExpedie = true;
}
        await db.collection(collectionName).updateOne(query, { $set: updateData });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                message: 'Livreur assigné avec succès',
                orderId: orderId
            })
        };

    } catch (error) {
        console.error('Erreur:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    } finally {
        if (client) await client.close();
    }
};