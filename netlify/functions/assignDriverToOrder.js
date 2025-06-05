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
            body: 'Method Not Allowed'
        };
    }

    let client;

    try {
        const data = JSON.parse(event.body);
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverPhone2, driverLocation } = data;

        // Validation des données
        if (!orderId || !serviceType || !driverId || !driverName || !driverPhone1) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Données requises manquantes' })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Vérifier si la commande est déjà dans cour_expedition
        const existingExpedition = await db.collection('cour_expedition').findOne({ 
            orderId: orderId,
            serviceType: 'packages'
        });

        if (existingExpedition) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: `Le livreur ${existingExpedition.driverName} est déjà en charge de cette commande`,
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

        // Convertir orderId en ObjectId ou chercher par codeID
        let query;
        try {
            query = { _id: new ObjectId(orderId) };
        } catch (e) {
            query = { codeID: orderId };
        }

        // Récupérer la commande originale
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
            orderId: originalOrder._id.toString() || originalOrder.codeID,
            serviceType: serviceType,
            driverId: driverId,
            driverName: driverName,
            driverPhone1: driverPhone1,
            driverPhone2: driverPhone2 || null,
            driverLocation: driverLocation,
            assignedAt: new Date(),
            status: 'en cours',
            originalCollection: collectionName
        };

        // Insérer dans cour_expedition
        const expeditionResult = await db.collection('cour_expedition').insertOne(expeditionData);

        // Mettre à jour la commande originale
        const updateResult = await db.collection(collectionName).updateOne(
            query,
            { 
                $set: { 
                    status: 'en cours',
                    driverId: driverId,
                    driverName: driverName,
                    driverPhone: driverPhone1,
                    driverPhone2: driverPhone2 || null,
                    driverLocation: driverLocation,
                    assignedAt: new Date()
                } 
            }
        );

        if (updateResult.modifiedCount === 0) {
            // Rollback si la mise à jour échoue
            await db.collection('cour_expedition').deleteOne({ _id: expeditionResult.insertedId });
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Échec de la mise à jour de la commande' })
            };
        }

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                message: 'Livreur assigné avec succès',
                orderId: orderId,
                expeditionId: expeditionResult.insertedId
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