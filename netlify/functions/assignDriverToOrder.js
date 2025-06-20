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
        const { orderId, serviceType, driverId, driverName, driverPhone1, driverPhone2, driverLocation } = data;

        if (!orderId || !serviceType || !driverId || !driverName || !driverPhone1 || !driverLocation) {
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

        // Vérifier si la commande est déjà assignée
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
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: `Cette commande est déjà prise en charge par un livreur: ${existingAssignment.driverName || existingAssignment.nomLivreur}`,
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

        // Trouver la commande originale avec une recherche plus flexible
        let query;
        let originalOrder = null;

        if (serviceType === 'packages') {
            query = { colisID: orderId };
            originalOrder = await db.collection(collectionName).findOne(query);
        } else if (serviceType === 'food') {
            // Essayer d'abord avec identifiant
            query = { identifiant: orderId };
            originalOrder = await db.collection(collectionName).findOne(query);
            
            // Si pas trouvé, essayer avec _id
            if (!originalOrder) {
                try {
                    query = { _id: new ObjectId(orderId) };
                    originalOrder = await db.collection(collectionName).findOne(query);
                } catch (e) {
                    query = { _id: orderId };
                    originalOrder = await db.collection(collectionName).findOne(query);
                }
            }
        } else {
            // Pour shopping et pharmacy
            try {
                query = { _id: new ObjectId(orderId) };
                originalOrder = await db.collection(collectionName).findOne(query);
            } catch (e) {
                query = { _id: orderId };
                originalOrder = await db.collection(collectionName).findOne(query);
            }
            
            // Si pas trouvé, essayer avec id
            if (!originalOrder) {
                query = { id: orderId };
                originalOrder = await db.collection(collectionName).findOne(query);
            }
        }

        if (!originalOrder) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Commande non trouvée',
                    collection: collectionName,
                    orderId: orderId,
                    serviceType: serviceType
                })
            };
        }

        // Extraire la localisation client selon le type de service
        const extractClientLocation = (order, serviceType) => {
            switch(serviceType) {
                case 'packages':
                    return order.destinataire?.location;
                case 'food':
                    return order.clientLocation || order.location || order.adresseLivraison?.location;
                case 'shopping':
                    return order.deliveryLocation || order.location || order.adresse?.location;
                case 'pharmacy':
                    return order.deliveryLocation || order.location || order.adresse?.location;
                default:
                    return null;
            }
        };

        const clientLocation = extractClientLocation(originalOrder, serviceType);

        // Créer l'objet expedition
        const expeditionData = {
            ...originalOrder,
            orderId: orderId,
            serviceType: serviceType,
            driverId: driverId,
            driverName: driverName,
            driverPhone1: driverPhone1,
            driverPhone2: driverPhone2,
            driverLocation: driverLocation,
            clientLocation: clientLocation, // Ajout de la localisation client
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

        // Insérer dans cour_expedition
        await db.collection('cour_expedition').insertOne(expeditionData);

        // Mettre à jour la commande originale (SANS LA SUPPRIMER)
        const updateData = {
            status: 'en_cours',
            statut: 'en_cours_de_livraison',
            driverId: driverId,
            driverName: driverName,
            driverPhone: driverPhone1,
            assignedAt: new Date(),
            driverLocation: driverLocation,
            lastUpdated: new Date()
        };

        // Champs spécifiques par service
        switch(serviceType) {
            case 'packages':
                updateData.idLivreurEnCharge = driverId;
                updateData.estExpedie = true;
                updateData.processusDéclenche = true;
                updateData['mis à jour à'] = new Date();
                break;
            case 'food':
                updateData.livreur = driverName;
                updateData.dateAcceptation = new Date();
                updateData.statutLivraison = 'en_cours';
                break;
            case 'shopping':
                updateData.livreur = driverName;
                updateData.telephoneLivreur = driverPhone1;
                updateData.statut = 'en_livraison';
                break;
            case 'pharmacy':
                updateData.livreur = driverName;
                updateData.telephoneLivreur = driverPhone1;
                updateData.statut = 'en_livraison';
                break;
        }

        await db.collection(collectionName).updateOne(query, { $set: updateData });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                success: true,
                message: 'Commande acceptée avec succès !',
                orderId: orderId,
                driverName: driverName,
                serviceType: serviceType,
                assignedAt: new Date().toISOString(),
                hasClientLocation: !!clientLocation
            })
        };

    } catch (error) {
        console.error('Erreur assignation livreur:', error);
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