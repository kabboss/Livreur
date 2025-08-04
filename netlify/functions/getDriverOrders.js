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
        const { driverId } = data;

        if (!driverId) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'ID du livreur requis' })
            };
        }

        client = await MongoClient.connect(MONGODB_URI);
        const db = client.db(DB_NAME);

        // Collections à vérifier
        const collections = [
            { name: 'Livraison', serviceType: 'packages' },
            { name: 'Commandes', serviceType: 'food' },
            { name: 'shopping_orders', serviceType: 'shopping' },
            { name: 'pharmacyOrders', serviceType: 'pharmacy' }
        ];

        const allOrders = [];

        // Recherche dans chaque collection
        for (const { name, serviceType } of collections) {
            try {
                const collection = db.collection(name);
                
                // Recherche par driverId ou idLivreurEnCharge
                const orders = await collection.find({
                    $or: [
                        { driverId: driverId },
                        { idLivreurEnCharge: driverId }
                    ],
                    $and: [
                        {
                            $or: [
                                { status: { $in: ['assigned', 'en_cours', 'en_cours_de_livraison'] } },
                                { statut: { $in: ['assigné', 'en_cours', 'en_cours_de_livraison'] } }
                            ]
                        }
                    ]
                }).toArray();

                // Ajouter le type de service à chaque commande
                orders.forEach(order => {
                    order.serviceType = serviceType;
                    order.collectionName = name;
                });

                allOrders.push(...orders);
            } catch (collectionError) {
                console.error(`Erreur dans la collection ${name}:`, collectionError);
                // Continue avec les autres collections même si une échoue
            }
        }

        // Recherche aussi dans cour_expedition pour les commandes en cours
        try {
            const expeditionOrders = await db.collection('cour_expedition').find({
                driverId: driverId,
                status: { $in: ['en_cours', 'assigned', 'en_cours_de_livraison'] }
            }).toArray();

            expeditionOrders.forEach(order => {
                order.collectionName = 'cour_expedition';
                // Le serviceType devrait déjà être présent
            });

            allOrders.push(...expeditionOrders);
        } catch (expeditionError) {
            console.error('Erreur dans cour_expedition:', expeditionError);
        }

        // Tri par date d'assignation (plus récentes en premier)
        allOrders.sort((a, b) => {
            const aDate = new Date(a.assignedAt || a.dateAcceptation || a.createdAt || 0);
            const bDate = new Date(b.assignedAt || b.dateAcceptation || b.createdAt || 0);
            return bDate - aDate;
        });

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                driverId,
                totalOrders: allOrders.length,
                orders: allOrders,
                message: `${allOrders.length} commande(s) trouvée(s) pour le livreur ${driverId}`
            })
        };

    } catch (error) {
        console.error('Erreur lors de la recherche des commandes du livreur:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ 
                error: 'Erreur serveur lors de la recherche des commandes',
                details: error.message 
            })
        };
    } finally {
        if (client) await client.close();
    }
};