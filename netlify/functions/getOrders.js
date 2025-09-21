const { MongoClient } = require('mongodb');

// --- Configuration ---
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
};

// --- Logique Principale ---
exports.handler = async (event) => {
    // Gère les requêtes OPTIONS (pré-vol) pour CORS
    if (event.httpMethod === 'OPTIONS' ) {
        return { statusCode: 200, headers: COMMON_HEADERS, body: JSON.stringify({}) };
    }

    if (event.httpMethod !== 'GET' ) {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: 'Méthode non autorisée' })
        };
    }

    let client;
    try {
        const { serviceType, driverId } = event.queryStringParameters || {};
        
        client = await MongoClient.connect(MONGODB_URI, {
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000
        });
        const db = client.db(DB_NAME);

        // Si un driverId est fourni, on retourne uniquement ses commandes assignées et actives
        if (driverId) {
            return await getDriverAssignedOrders(db, driverId);
        }

        // --- Logique pour récupérer toutes les commandes actives par service ---
        const collectionMap = {
            packages: 'Livraison',
            food: 'Commandes',
            shopping: 'shopping_orders',
            pharmacy: 'pharmacyOrders'
        };

        if (!serviceType || !collectionMap[serviceType]) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Le paramètre "serviceType" est manquant ou invalide.' })
            };
        }

        const collection = db.collection(collectionMap[serviceType]);
        
        // **CORRECTION PRINCIPALE : Requête simplifiée et robuste**
        // On récupère toutes les commandes qui ne sont PAS dans un état final.
        const excludedStatuses = ['livré', 'terminé', 'completed', 'delivered', 'annulé', 'cancelled'];
        const query = {
            $and: [
                { statut: { $nin: excludedStatuses } },
                { status: { $nin: excludedStatuses } },
                { isCompleted: { $ne: true } }
            ]
        };

        const orders = await collection.find(query)
            .sort({ dateCreation: -1, createdAt: -1 }) // Trier par date de création la plus récente
            .limit(200)
            .toArray();
        
        console.log(`[${serviceType}] ${orders.length} commande(s) active(s) récupérée(s).`);

        // Enrichir les données pour le frontend
        const enrichedOrders = orders.map(order => {
            const isAssigned = !!(
                order.driverId || 
                order.idLivreurEnCharge || 
                (order.statut && ['assigned', 'assigné', 'en_cours_de_livraison'].includes(order.statut.toLowerCase()))
            );

            return {
                ...order,
                isAssigned,
                assignedDriver: order.driverName || order.nomLivreur || null,
                assignedDriverId: order.driverId || order.idLivreurEnCharge || null
            };
        });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                orders: enrichedOrders,
                serviceType,
                count: enrichedOrders.length,
                assignedCount: enrichedOrders.filter(o => o.isAssigned).length,
                availableCount: enrichedOrders.filter(o => !o.isAssigned).length
            })
        };

    } catch (error) {
        console.error('Erreur dans la fonction getOrders:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: 'Erreur serveur lors de la récupération des commandes.',
                details: error.message
            })
        };
    } finally {
        if (client) {
            await client.close();
        }
    }
};

// --- Fonction Auxiliaire pour les commandes d'un livreur spécifique ---
async function getDriverAssignedOrders(db, driverId) {
    const collectionsToSearch = [
        { name: 'Livraison', serviceType: 'packages' },
        { name: 'Commandes', serviceType: 'food' },
        { name: 'shopping_orders', serviceType: 'shopping' },
        { name: 'pharmacyOrders', serviceType: 'pharmacy' }
    ];
    
    const assignedOrders = [];
    const excludedStatuses = ['livré', 'terminé', 'completed', 'delivered', 'annulé', 'cancelled'];

    for (const { name, serviceType } of collectionsToSearch) {
        try {
            const collection = db.collection(name);
            
            // Chercher les commandes assignées à ce livreur ET non terminées
            const orders = await collection.find({
                $and: [
                    { $or: [{ driverId }, { idLivreurEnCharge: driverId }] },
                    { statut: { $nin: excludedStatuses } },
                    { status: { $nin: excludedStatuses } },
                    { isCompleted: { $ne: true } }
                ]
            }).toArray();
            
            assignedOrders.push(...orders.map(order => ({
                ...order,
                serviceType,
                isAssigned: true,
                assignedDriverId: driverId
            })));
        } catch (collectionError) {
            console.error(`Erreur lors de la recherche dans la collection ${name}:`, collectionError);
        }
    }

    // Tri par date d'assignation ou de création
    assignedOrders.sort((a, b) => {
        const aDate = new Date(a.assignedAt || a.dateAcceptation || a.dateCreation || a.createdAt || 0);
        const bDate = new Date(b.assignedAt || b.dateAcceptation || b.dateCreation || b.createdAt || 0);
        return bDate - aDate;
    });

    console.log(`[driverId: ${driverId}] ${assignedOrders.length} commande(s) active(s) assignée(s) trouvée(s).`);

    return {
        statusCode: 200,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ 
            orders: assignedOrders,
            driverId,
            count: assignedOrders.length,
            message: `${assignedOrders.length} commande(s) active(s) assignée(s) à ${driverId}`
        })
    };
}
