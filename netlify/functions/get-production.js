const { MongoClient } = require('mongodb');

// Configuration MongoDB optimisée
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority&maxPoolSize=10&serverSelectionTimeoutMS=5000&connectTimeoutMS=10000';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'productions_delices_capoue';

const mongoClient = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    maxIdleTimeMS: 30000,
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Headers CORS complets pour autoriser toutes les origines
const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
    // Optimisation AWS Lambda
    context.callbackWaitsForEmptyEventLoop = false;

    // Gérer les requêtes OPTIONS (CORS preflight) de manière plus complète
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: ''
        };
    }

    // Vérifier que c'est une requête GET
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                error: 'Method not allowed',
                allowedMethods: ['GET', 'OPTIONS']
            })
        };
    }

    try {
        // Récupérer et valider les paramètres de recherche
        const params = event.queryStringParameters || {};
        const { date, productionId, supervisor, limit, offset, sortBy, qualityScore } = params;

        if (!date && !productionId && !supervisor) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Au moins un paramètre de recherche requis',
                    availableParams: ['date', 'productionId', 'supervisor', 'limit', 'offset', 'sortBy', 'qualityScore'],
                    examples: {
                        byDate: '?date=2024-12-01',
                        byId: '?productionId=DC-20241201-1430-ABC',
                        bySupervisor: '?supervisor=Jean%20Dupont',
                        withPagination: '?date=2024-12-01&limit=10&offset=0'
                    }
                })
            };
        }

        // Construire la requête MongoDB avancée
        let query = {};
        let options = {
            sort: {},
            limit: parseInt(limit) || 50,
            skip: parseInt(offset) || 0
        };

        // Filtrage par date avec plage étendue
        if (date) {
            const searchDate = new Date(date);
            if (isNaN(searchDate.getTime())) {
                return {
                    statusCode: 400,
                    headers: COMMON_HEADERS,
                    body: JSON.stringify({ 
                        error: 'Format de date invalide',
                        expected: 'YYYY-MM-DD',
                        received: date
                    })
                };
            }

            const startDate = new Date(searchDate);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(searchDate);
            endDate.setHours(23, 59, 59, 999);

            query.date = {
                $gte: startDate.toISOString(),
                $lte: endDate.toISOString()
            };
        }

        // Filtrage par ID de production (recherche exacte ou partielle)
        if (productionId) {
            if (productionId.length < 3) {
                return {
                    statusCode: 400,
                    headers: COMMON_HEADERS,
                    body: JSON.stringify({ 
                        error: 'ID production trop court (minimum 3 caractères)'
                    })
                };
            }
            
            // Recherche exacte ou par préfixe
            query.productionId = productionId.includes('*') 
                ? { $regex: productionId.replace(/\*/g, '.*'), $options: 'i' }
                : { $regex: `^${productionId}`, $options: 'i' };
        }

        // Filtrage par superviseur
        if (supervisor) {
            query.supervisor = { $regex: supervisor, $options: 'i' };
        }

        // Filtrage par score de qualité
        if (qualityScore) {
            const score = parseInt(qualityScore);
            if (!isNaN(score) && score >= 0 && score <= 100) {
                query['qualityMetrics.qualityScore'] = { $gte: score };
            }
        }

        // Options de tri
        const sortOptions = {
            'date-desc': { date: -1 },
            'date-asc': { date: 1 },
            'quality-desc': { 'qualityMetrics.qualityScore': -1 },
            'efficiency-desc': { 'qualityMetrics.overallEfficiency': -1 },
            'quantity-desc': { milkQuantity: -1 },
            'recent': { savedAt: -1 }
        };

        options.sort = sortOptions[sortBy] || sortOptions['recent'];

        console.log(`🔍 Recherche avec query:`, JSON.stringify(query, null, 2));
        console.log(`📋 Options:`, JSON.stringify(options, null, 2));

        // Connexion à MongoDB avec gestion d'erreur
        let connectionAttempts = 0;
        const maxAttempts = 3;

        while (connectionAttempts < maxAttempts) {
            try {
                await mongoClient.connect();
                break;
            } catch (connectionError) {
                connectionAttempts++;
                if (connectionAttempts >= maxAttempts) {
                    console.error('❌ Échec connexion MongoDB après', maxAttempts, 'tentatives');
                    return {
                        statusCode: 503,
                        headers: COMMON_HEADERS,
                        body: JSON.stringify({
                            error: 'Service temporairement indisponible',
                            message: 'Impossible de se connecter à la base de données',
                            retryAfter: 60
                        })
                    };
                }
                console.warn(`⚠️ Tentative ${connectionAttempts} échouée, nouvelle tentative...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        const db = mongoClient.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // Exécution des requêtes en parallèle pour optimiser les performances
        const [productions, totalCount, aggregatedStats] = await Promise.all([
            // Recherche principale avec projection pour optimiser le transfert
            collection
                .find(query, {
                    projection: {
                        // Exclure les données binaires lourdes pour la liste
                        'weighingPhotos': 0,
                        'photos': 0,
                        'finalPhotos': 0
                    }
                })
                .sort(options.sort)
                .limit(options.limit)
                .skip(options.skip)
                .toArray(),
            
            // Comptage total pour la pagination
            collection.countDocuments(query),
            
            // Statistiques agrégées pour le dashboard
            collection.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: null,
                        totalQuantity: { $sum: { $toDouble: '$milkQuantity' } },
                        avgQuality: { $avg: '$qualityMetrics.qualityScore' },
                        avgEfficiency: { $avg: '$qualityMetrics.overallEfficiency' },
                        productionsByStatus: {
                            $push: '$status'
                        }
                    }
                }
            ]).toArray()
        ]);

        console.log(`✅ ${productions.length} production(s) trouvée(s) sur ${totalCount} total`);

        // Enrichissement des données avec calculs avancés
        const enrichedProductions = productions.map(production => {
            // Ajouter des métriques calculées
            return {
                ...production,
                calculatedMetrics: {
                    productionAge: calculateProductionAge(production.date),
                    estimatedCompletionTime: production.timeMetrics ? 
                        formatDuration(production.timeMetrics.totalActualTime) : 'N/A',
                    qualityGrade: getQualityGrade(production.qualityMetrics?.qualityScore)
                }
            };
        });

        // Préparer les statistiques
        const stats = aggregatedStats[0] || {};
        const statusDistribution = {};
        (stats.productionsByStatus || []).forEach(status => {
            statusDistribution[status] = (statusDistribution[status] || 0) + 1;
        });

        const response = {
            success: true,
            searchCriteria: {
                date: date || null,
                productionId: productionId || null,
                supervisor: supervisor || null,
                qualityScore: qualityScore || null
            },
            pagination: {
                total: totalCount,
                count: productions.length,
                limit: options.limit,
                offset: options.skip,
                hasMore: (options.skip + productions.length) < totalCount
            },
            aggregatedStats: {
                totalProductions: totalCount,
                totalQuantity: Math.round(stats.totalQuantity || 0),
                averageQuality: Math.round(stats.avgQuality || 0),
                averageEfficiency: Math.round(stats.avgEfficiency || 0),
                statusDistribution
            },
            productions: enrichedProductions,
            queryExecutedAt: new Date().toISOString(),
            executionTime: Date.now() // Sera complété à la fin
        };

        response.executionTime = Date.now() - response.executionTime;

        return {
            statusCode: 200,
            headers: {
                ...COMMON_HEADERS,
                'Cache-Control': 'no-cache, must-revalidate',
                'X-Total-Count': totalCount.toString(),
                'X-Response-Time': response.executionTime + 'ms'
            },
            body: JSON.stringify(response)
        };
    } catch (error) {
        console.error('❌ Erreur lors de la recherche:', error);
        console.error('Stack trace:', error.stack);

        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                error: 'Erreur serveur lors de la recherche',
                message: error.message,
                timestamp: new Date().toISOString(),
                searchParams: event.queryStringParameters
            })
        };
    } finally {
        // Assurer la fermeture propre de la connexion
        try {
            await mongoClient.close();
        } catch (closeError) {
            console.error('⚠️ Erreur fermeture connexion:', closeError);
        }
    }
};

// Fonctions utilitaires avancées
function calculateProductionAge(dateString) {
    const productionDate = new Date(dateString);
    const now = new Date();
    const ageMs = now.getTime() - productionDate.getTime();

    const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) {
        return `${days}j ${hours}h`;
    } else if (hours > 0) {
        return `${hours}h`;
    } else {
        const minutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
        return `${minutes}min`;
    }
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

function getQualityGrade(score) {
    if (!score) return 'N/A';

    if (score >= 95) return 'A+ (Excellence)';
    if (score >= 90) return 'A (Très Bien)';
    if (score >= 85) return 'B+ (Bien)';
    if (score >= 80) return 'B (Correct)';
    if (score >= 70) return 'C (Passable)';
    return 'D (À améliorer)';
}