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

        // Dans completeOrder.js, avant de traiter la requête
if (expedition.driverId !== driverId) {
    return {
        statusCode: 403,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ 
            error: 'Vous n\'êtes pas autorisé à finaliser cette livraison'
        })
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
        const { orderId, serviceType, driverName, driverId, notes } = data;

        if (!orderId || !serviceType || !driverName || !driverId) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Données requises manquantes',
                    requiredFields: ['orderId', 'serviceType', 'driverName', 'driverId']
                })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Vérifier l'assignation dans cour_expedition
        const expedition = await db.collection('cour_expedition').findOne({ 
            $or: [
                { orderId: orderId },
                { colisID: orderId }
            ],
            serviceType: serviceType,
            driverId: driverId
        });

        if (!expedition) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Expédition non trouvée ou non assignée à ce livreur',
                    details: `Order: ${orderId}, Driver: ${driverId}`
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
                body: JSON.stringify({ 
                    error: 'Type de service invalide',
                    validTypes: Object.keys(collectionMap)
                })
            };
        }

        // Trouver la commande originale
        let query;
        if (serviceType === 'packages') {
            query = { colisID: orderId };
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
                body: JSON.stringify({ 
                    error: 'Commande originale non trouvée',
                    collection: collectionName,
                    query: query
                })
            };
        }

        // Données de finalisation
        const completionData = {
            status: 'livré',
            statut: 'livré',
            driverName: driverName,
            driverId: driverId,
            deliveredAt: new Date(),
            deliveryNotes: notes || null,
            lastUpdated: new Date(),
            completedBy: {
                driverId: driverId,
                driverName: driverName,
                completedAt: new Date()
            }
        };

        // Archiver dans LivraisonsEffectuees
        const archiveData = {
            ...originalOrder,
            ...completionData,
            serviceType: serviceType,
            originalCollection: collectionName,
            expeditionData: expedition,
            archivedAt: new Date()
        };

        await db.collection('LivraisonsEffectuees').insertOne(archiveData);

        // Mettre à jour la commande originale avec le statut livré
        await db.collection(collectionName).updateOne(
            query,
            { $set: completionData }
        );

        // Pour les colis, supprimer complètement après archivage
        if (serviceType === 'packages') {
            // Supprimer de la collection Livraison
            await db.collection('Livraison').deleteOne(query);
        }

        // Supprimer de cour_expedition
        await db.collection('cour_expedition').deleteOne({ 
            _id: expedition._id 
        });


        // Supprimer des autres collections si nécessaire
const collectionsToClean = ['Livraison', 'Commandes', 'pharmacyOrders', 'shopping_orders'];
for (const collection of collectionsToClean) {
    try {
        await db.collection(collection).deleteOne(query);
    } catch (e) {
        console.log(`Pas de suppression nécessaire dans ${collection}`);
    }
}

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                message: 'Livraison enregistrée avec succès',
                orderId: orderId,
                serviceType: serviceType,
                deliveredAt: new Date().toISOString(),
                archived: serviceType === 'packages'
            })
        };

    } catch (error) {
        console.error('Erreur complète:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
                eventBody: event.body
            })
        };
    } finally {
        if (client) await client.close();
    }
};