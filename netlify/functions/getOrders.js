const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event) => {
    // Gestion des pré-vols OPTIONS
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: COMMON_HEADERS, body: JSON.stringify({}) };
    }

    if (event.httpMethod !== 'GET') {
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

        const collectionMap = {
            packages: 'Livraison',
            food: 'Commandes',
            shopping: 'shopping_orders',
            pharmacy: 'pharmacyOrders'
        };

        // Si driverId est fourni, récupérer les commandes assignées à ce livreur UNIQUEMENT
        if (driverId) {
            return await getDriverAssignedOrders(db, driverId);
        }

        // Sinon récupérer selon le serviceType (EXCLURE les commandes terminées/archivées)
        if (!serviceType || !collectionMap[serviceType]) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Type de service invalide' })
            };
        }

        const collection = db.collection(collectionMap[serviceType]);
        
        // Construction de la requête pour EXCLURE les commandes terminées/archivées
        let query = {};
        
        if (serviceType === 'packages') {
            query = {
                $and: [
                    {
                        $or: [
                            { statut: { $in: ['en_attente_assignation', 'assigned', 'assigné'] } },
                            { status: { $in: ['pending', 'assigned', 'en_cours'] } },
                            { driverId: { $exists: true } },
                            { idLivreurEnCharge: { $exists: true } }
                        ]
                    },
                    // EXCLURE les statuts de completion
                    {
                        status: { $nin: ['completed', 'delivered'] },
                        statut: { $nin: ['livré', 'terminé', 'completed'] },
                        isCompleted: { $ne: true }
                    }
                ]
            };
        } else {
            // Pour les autres services
            query = {
                $and: [
                    {
                        $or: [
                            { status: { $in: ['pending', 'assigned'] } },
                            { statut: { $in: ['en attente', 'assigné', 'en_cours'] } },
                            { driverId: { $exists: true } },
                            { idLivreurEnCharge: { $exists: true } }
                        ]
                    },
                    // EXCLURE les statuts de completion
                    {
                        status: { $nin: ['completed', 'delivered'] },
                        statut: { $nin: ['livré', 'terminé', 'completed'] },
                        isCompleted: { $ne: true }
                    }
                ]
            };
        }

        // Récupérer uniquement les commandes NON terminées
        const orders = await collection.find(query)
            .sort({ createdAt: -1 })
            .limit(200)
            .toArray();
        
        console.log(`Service ${serviceType}: ${orders.length} commandes actives récupérées (archivées exclues)`);

        // Enrichir les données avec des informations d'assignation
        const enrichedOrders = orders.map(order => {
            const isAssigned = !!(order.driverId || order.idLivreurEnCharge || order.driverName || 
                               order.nomLivreur || 
                               (order.status && ['assigned', 'assigné'].includes(order.status.toLowerCase())) ||
                               (order.statut && ['assigned', 'assigné', 'en_cours_de_livraison'].includes(order.statut.toLowerCase())));

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
                availableCount: enrichedOrders.filter(o => !o.isAssigned).length,
                excludedCompleted: true // Indique que les commandes terminées sont exclues
            })
        };

    } catch (error) {
        console.error('Erreur GET getOrders:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: 'Erreur serveur lors de la récupération des commandes',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    } finally {
        if (client) {
            try {
                await client.close();
            } catch (closeError) {
                console.error('Erreur fermeture connexion:', closeError);
            }
        }
    }
};

async function getDriverAssignedOrders(db, driverId) {
    try {
        const collectionsToSearch = [
            { name: 'Livraison', serviceType: 'packages' },
            { name: 'Commandes', serviceType: 'food' },
            { name: 'shopping_orders', serviceType: 'shopping' },
            { name: 'pharmacyOrders', serviceType: 'pharmacy' }
        ];
        
        const assignedOrders = [];
        
        for (const { name, serviceType } of collectionsToSearch) {
            try {
                const collection = db.collection(name);
                
                // RECHERCHER uniquement les commandes assignées ET NON terminées
                const orders = await collection.find({
                    $and: [
                        {
                            $or: [
                                { driverId },
                                { idLivreurEnCharge: driverId }
                            ]
                        },
                        // EXCLURE les commandes terminées
                        {
                            status: { $nin: ['completed', 'delivered'] },
                            statut: { $nin: ['livré', 'terminé', 'completed'] },
                            isCompleted: { $ne: true }
                        }
                    ]
                }).toArray();
                
                assignedOrders.push(...orders.map(order => ({
                    ...order,
                    serviceType,
                    originalCollection: name,
                    isAssigned: true,
                    assignedDriver: order.driverName || order.nomLivreur || 'Livreur',
                    assignedDriverId: driverId
                })));
            } catch (collectionError) {
                console.error(`Erreur collection ${name}:`, collectionError);
            }
        }

        // Tri par date d'assignation
        assignedOrders.sort((a, b) => {
            const aDate = new Date(a.assignedAt || a.dateAcceptation || a.createdAt || 0);
            const bDate = new Date(b.assignedAt || b.dateAcceptation || b.createdAt || 0);
            return bDate - aDate;
        });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                orders: assignedOrders,
                driverId,
                count: assignedOrders.length,
                excludedCompleted: true, // Indique que les commandes terminées sont exclues
                message: `${assignedOrders.length} commande(s) active(s) assignée(s) à ${driverId}`
            })
        };
    } catch (error) {
        throw error;
    }
}