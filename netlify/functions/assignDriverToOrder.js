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
        return { statusCode: 200, headers: COMMON_HEADERS, body: JSON.stringify({}) };
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
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverPhone2, driverLocation } = data;

        const requiredFields = [orderId, serviceType, driverId, driverName, driverPhone1, driverLocation];
        if (requiredFields.some(v => !v)) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    error: 'Données requises manquantes',
                    required: ['orderId', 'serviceType', 'driverId', 'driverName', 'driverPhone1', 'driverLocation']
                })
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
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Type de service invalide' })
            };
        }

        // Vérifie d'abord si la commande est déjà assignée dans cour_expedition
        const existingAssignment = await db.collection('cour_expedition').findOne({
            $or: [
                { orderId: orderId },
                { colisID: orderId },
                { identifiant: orderId },
                { id: orderId },
                { _id: orderId }
            ],
            serviceType: serviceType
        });

        if (existingAssignment) {
            return {
                statusCode: 409,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    error: `Cette commande est déjà prise en charge par un livreur: ${existingAssignment.driverName || existingAssignment.nomLivreur || 'Inconnu'}`,
                    isAlreadyAssigned: true
                })
            };
        }

        // Recherche intelligente de la commande originale
        const collection = db.collection(collectionName);
        let originalOrder = null;
        let query;

        const tryObjectId = (id) => {
            try {
                return new ObjectId(id);
            } catch {
                return id;
            }
        };

        if (serviceType === 'packages') {
            query = { colisID: orderId };
        } else if (serviceType === 'food') {
            query = { identifiant: orderId };
        } else {
            query = { _id: tryObjectId(orderId) };
        }

        originalOrder = await collection.findOne(query);

        // Fallback recherche par d'autres champs
        if (!originalOrder) {
            const fallbackQueries = [
                { _id: tryObjectId(orderId) },
                { id: orderId },
                { identifiant: orderId },
                { colisID: orderId }
            ];

            for (const q of fallbackQueries) {
                originalOrder = await collection.findOne(q);
                if (originalOrder) {
                    query = q;
                    break;
                }
            }
        }

        if (!originalOrder) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande non trouvée', collection: collectionName, orderId })
            };
        }

        // Crée une copie dans cour_expedition
        const expeditionData = {
            ...originalOrder,
            orderId: orderId,
            serviceType: serviceType,
            driverId,
            driverName,
            driverPhone1,
            driverPhone2,
            driverLocation,
            assignedAt: new Date(),
            status: 'en_cours',
            statut: 'en_cours_de_livraison',
            originalCollection: collectionName,
            lastPositionUpdate: new Date(),
            positionHistory: [{
                location: driverLocation,
                timestamp: new Date()
            }]
        };

        await db.collection('cour_expedition').insertOne(expeditionData);

        // Prépare les données de mise à jour dans la collection d'origine
        const updateData = {
            assignedAt: new Date(),
            driverId,
            driverName,
            driverPhone: driverPhone1,
            driverPhone2,
            driverLocation,
            lastUpdated: new Date()
        };

        if (serviceType === 'packages') {
            Object.assign(updateData, {
                status: 'en_cours',
                statut: 'en_cours_de_livraison',
                nomLivreur: driverName,
                idLivreurEnCharge: driverId,
                dateAcceptation: new Date(),
                estExpedie: true,
                processusDéclenche: true
            });
        } else {
            Object.assign(updateData, {
                status: 'assigned',
                statut: 'assigné'
            });
        }

        await collection.updateOne(query, { $set: updateData });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                message: 'Commande acceptée avec succès !',
                orderId,
                driverName,
                serviceType,
                assignedAt: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur assignation livreur:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: error.message })
        };
    } finally {
        if (client) await client.close();
    }
};