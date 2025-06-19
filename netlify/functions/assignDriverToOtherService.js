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
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverPhone2 } = data;

        if (!orderId || !serviceType || !driverId || !driverName || !driverPhone1) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Données requises manquantes',
                    required: ['orderId', 'serviceType', 'driverId', 'driverName', 'driverPhone1']
                })
            };
        }

        // Vérifier que le service est bien dans la liste des services simplifiés
        if (!['food', 'shopping', 'pharmacy'].includes(serviceType)) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Service non supporté par ce système' })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Vérifier si la commande est déjà assignée dans other_service_cour
        const existingAssignment = await db.collection('other_service_cour').findOne({ 
            $or: [
                { orderId: orderId },
                { identifiant: orderId },
                { id: orderId },
                { _id: orderId }
            ],
            serviceType: serviceType
        });

        if (existingAssignment) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: `Cette commande a déjà été acceptée par un autre livreur: ${existingAssignment.driverName}`,
                    isAlreadyAssigned: true
                })
            };
        }

        // Déterminer la collection source
        const collectionMap = {
            food: 'Commandes',
            shopping: 'shopping_orders',
            pharmacy: 'pharmacyOrders'
        };

        const collectionName = collectionMap[serviceType];

        // Trouver la commande originale
        let query;
        if (serviceType === 'food') {
            query = { identifiant: orderId };
        } else {
            try {
                query = { _id: new ObjectId(orderId) };
            } catch (e) {
                query = { _id: orderId };
            }
        }

        const originalOrder = await db.collection(collectionName).findOne(query);
        if (!originalOrder) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande non trouvée' })
            };
        }

        // Créer l'objet d'assignation dans other_service_cour
        const assignmentData = {
            ...originalOrder,
            orderId: orderId,
            serviceType: serviceType,
            driverId: driverId,
            driverName: driverName,
            driverPhone1: driverPhone1,
            driverPhone2: driverPhone2,
            assignedAt: new Date(),
            status: 'assigné',
            statut: 'assigné',
            originalCollection: collectionName
        };

        // Insérer dans other_service_cour
        await db.collection('other_service_cour').insertOne(assignmentData);

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                success: true,
                message: 'Commande acceptée avec succès !',
                orderId: orderId,
                driverName: driverName,
                serviceType: serviceType,
                assignedAt: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur assignation livreur autres services:', error);
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