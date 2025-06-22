const { MongoClient } = require('mongodb');

// Configuration de la base de données
const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

// Configuration du cache et de la performance
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes
const cache = new Map();

// Utilitaires de logging avancés
const logger = {
    info: (message, data = {}) => {
        console.log(`[INFO] ${new Date().toISOString()} - ${message}`, data);
    },
    error: (message, error = null) => {
        console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error);
    },
    warn: (message, data = {}) => {
        console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, data);
    }
};

// Fonction de validation des données
function validateDriverData(data) {
    const errors = [];
    
    if (!data.driverId || typeof data.driverId !== 'string') {
        errors.push('ID du livreur manquant ou invalide');
    }
    
    if (!data.location || typeof data.location !== 'object') {
        errors.push('Données de localisation manquantes');
    } else {
        const { latitude, longitude, accuracy } = data.location;
        
        if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
            errors.push('Latitude invalide');
        }
        
        if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
            errors.push('Longitude invalide');
        }
        
        if (accuracy !== undefined && (typeof accuracy !== 'number' || accuracy < 0)) {
            errors.push('Précision invalide');
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

// Fonction de nettoyage des coordonnées
function cleanCoordinate(coord) {
    if (!coord && coord !== 0) return null;
    if (typeof coord === 'string') {
        return parseFloat(coord.replace(',', '.'));
    }
    return parseFloat(coord);
}

// Fonction de validation des coordonnées
function isValidCoordinate(lat, lng) {
    const latitude = cleanCoordinate(lat);
    const longitude = cleanCoordinate(lng);
    return latitude !== null && longitude !== null && 
           !isNaN(latitude) && !isNaN(longitude) &&
           latitude >= -90 && latitude <= 90 &&
           longitude >= -180 && longitude <= 180;
}

// Fonction de calcul de distance
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Fonction de gestion du cache
function getCacheKey(driverId, orderId = null) {
    return orderId ? `driver_${driverId}_order_${orderId}` : `driver_${driverId}`;
}

function getCachedData(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    return null;
}

function setCachedData(key, data) {
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
    
    // Nettoyer le cache périodiquement
    if (cache.size > 500) {
        const oldestKeys = Array.from(cache.keys()).slice(0, 100);
        oldestKeys.forEach(key => cache.delete(key));
    }
}

// Fonction principale du handler
exports.handler = async (event, context) => {
    // Gestion CORS
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400"
    };

    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ""
        };
    }

    // Validation de la méthode HTTP
    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ 
                error: 'Méthode non autorisée. Utilisez POST.',
                code: 'METHOD_NOT_ALLOWED'
            })
        };
    }

    const startTime = Date.now();
    let client;

    try {
        // Validation du body
        if (!event.body) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: 'Corps de requête manquant',
                    code: 'MISSING_BODY'
                })
            };
        }

        let requestData;
        try {
            requestData = JSON.parse(event.body);
        } catch (parseError) {
            logger.error('Erreur de parsing JSON', parseError);
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: 'Format JSON invalide',
                    code: 'INVALID_JSON'
                })
            };
        }

        // Validation des données
        const validation = validateDriverData(requestData);
        if (!validation.isValid) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: 'Données invalides',
                    details: validation.errors,
                    code: 'INVALID_DATA'
                })
            };
        }

        const { driverId, location, orderId, isBackground = false } = requestData;
        
        logger.info('Mise à jour de position initiée', { 
            driverId, 
            orderId, 
            isBackground,
            accuracy: location.accuracy 
        });

        // Vérifier le cache pour éviter les mises à jour trop fréquentes
        const cacheKey = getCacheKey(driverId, orderId);
        const cachedData = getCachedData(cacheKey);
        
        if (cachedData && !orderId) {
            // Si pas de commande spécifique et données récentes, ignorer
            const timeDiff = Date.now() - new Date(cachedData.timestamp).getTime();
            if (timeDiff < 60000) { // Moins d'1 minute
                logger.info('Position récente ignorée (cache)', { driverId, timeDiff });
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        success: true,
                        message: 'Position récente, mise à jour ignorée',
                        cached: true,
                        responseTime: Date.now() - startTime
                    })
                };
            }
        }

        // Connexion à MongoDB
        client = new MongoClient(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4
        });

        await client.connect();
        logger.info('Connexion MongoDB établie');

        const db = client.db(dbName);
        const expeditionCollection = db.collection('cour_expedition');
        const driverLocationCollection = db.collection('driver_locations');

        // Préparer les données de localisation
        const locationData = {
            driverId,
            location: {
                latitude: cleanCoordinate(location.latitude),
                longitude: cleanCoordinate(location.longitude),
                accuracy: location.accuracy || null,
                speed: location.speed || null,
                heading: location.heading || null,
                timestamp: location.timestamp || new Date().toISOString()
            },
            isBackground,
            updatedAt: new Date(),
            metadata: {
                userAgent: event.headers['user-agent'] || 'Unknown',
                ip: event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'Unknown'
            }
        };

        // Valider les coordonnées nettoyées
        if (!isValidCoordinate(locationData.location.latitude, locationData.location.longitude)) {
            throw new Error('Coordonnées GPS invalides après nettoyage');
        }

        let expeditionUpdated = false;
        let expeditionInfo = null;

        // Si un orderId est fourni, mettre à jour la commande spécifique
        if (orderId) {
            logger.info('Mise à jour de commande spécifique', { orderId, driverId });
            
            // Rechercher la commande
            expeditionInfo = await expeditionCollection.findOne({
                $or: [
                    { colisID: orderId },
                    { _id: orderId }
                ]
            });

            if (expeditionInfo) {
                // Vérifier que le livreur est bien assigné à cette commande
                const isAssigned = expeditionInfo.driverId === driverId || 
                                 expeditionInfo.idLivreurEnCharge === driverId;

                if (isAssigned) {
                    // Mettre à jour la position du livreur dans la commande
                    const updateResult = await expeditionCollection.updateOne(
                        { _id: expeditionInfo._id },
                        {
                            $set: {
                                driverLocation: locationData.location,
                                lastLocationUpdate: new Date(),
                                'processus.derniereMiseAJourPosition': new Date()
                            },
                            $push: {
                                'processus.historiquePositions': {
                                    position: locationData.location,
                                    timestamp: new Date(),
                                    accuracy: location.accuracy,
                                    isBackground
                                }
                            }
                        }
                    );

                    expeditionUpdated = updateResult.modifiedCount > 0;
                    logger.info('Commande mise à jour', { 
                        orderId, 
                        driverId, 
                        updated: expeditionUpdated 
                    });
                } else {
                    logger.warn('Livreur non autorisé pour cette commande', { 
                        orderId, 
                        driverId,
                        assignedDriver: expeditionInfo.driverId || expeditionInfo.idLivreurEnCharge
                    });
                }
            } else {
                logger.warn('Commande non trouvée', { orderId });
            }
        } else {
            // Mise à jour générale - chercher toutes les commandes assignées au livreur
            const assignedOrders = await expeditionCollection.find({
                $or: [
                    { driverId: driverId },
                    { idLivreurEnCharge: driverId }
                ],
                statut: { $in: ['en_cours_de_livraison', 'accepte_par_destinataire'] }
            }).toArray();

            if (assignedOrders.length > 0) {
                logger.info(`Mise à jour de ${assignedOrders.length} commandes assignées`, { driverId });
                
                // Mettre à jour toutes les commandes assignées
                const bulkOps = assignedOrders.map(order => ({
                    updateOne: {
                        filter: { _id: order._id },
                        update: {
                            $set: {
                                driverLocation: locationData.location,
                                lastLocationUpdate: new Date(),
                                'processus.derniereMiseAJourPosition': new Date()
                            },
                            $push: {
                                'processus.historiquePositions': {
                                    $each: [{
                                        position: locationData.location,
                                        timestamp: new Date(),
                                        accuracy: location.accuracy,
                                        isBackground
                                    }],
                                    $slice: -50 // Garder seulement les 50 dernières positions
                                }
                            }
                        }
                    }
                }));

                const bulkResult = await expeditionCollection.bulkWrite(bulkOps);
                expeditionUpdated = bulkResult.modifiedCount > 0;
                
                logger.info('Commandes mises à jour en lot', { 
                    driverId, 
                    modified: bulkResult.modifiedCount 
                });
            }
        }

        // Enregistrer/mettre à jour la position générale du livreur
        await driverLocationCollection.replaceOne(
            { driverId },
            locationData,
            { upsert: true }
        );

        // Mettre en cache
        setCachedData(cacheKey, {
            location: locationData.location,
            timestamp: new Date().toISOString(),
            expeditionUpdated
        });

        // Calculer des métriques si possible
        let metrics = {};
        if (expeditionInfo && expeditionInfo.destinataire?.location) {
            const destLat = cleanCoordinate(expeditionInfo.destinataire.location.latitude);
            const destLng = cleanCoordinate(expeditionInfo.destinataire.location.longitude);
            
            if (isValidCoordinate(destLat, destLng)) {
                const distanceToDestination = calculateDistance(
                    locationData.location.latitude,
                    locationData.location.longitude,
                    destLat,
                    destLng
                );
                
                metrics.distanceToDestination = Math.round(distanceToDestination * 100) / 100;
                metrics.estimatedArrival = distanceToDestination < 1 ? 
                    'Moins de 5 minutes' : 
                    `Environ ${Math.ceil(distanceToDestination * 3)} minutes`;
            }
        }

        const response = {
            success: true,
            message: 'Position mise à jour avec succès',
            data: {
                driverId,
                location: locationData.location,
                expeditionUpdated,
                ordersUpdated: expeditionUpdated ? (orderId ? 1 : assignedOrders?.length || 0) : 0,
                metrics,
                isBackground
            },
            responseTime: Date.now() - startTime
        };

        logger.info('Position mise à jour avec succès', {
            driverId,
            orderId,
            expeditionUpdated,
            responseTime: response.responseTime
        });

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(response)
        };

    } catch (error) {
        logger.error('Erreur lors de la mise à jour de position', error);
        
        // Gestion des erreurs spécifiques
        let errorMessage = 'Erreur serveur lors de la mise à jour de position.';
        let errorCode = 'SERVER_ERROR';
        let statusCode = 500;
        
        if (error.name === 'MongoNetworkError' || error.name === 'MongoServerSelectionError') {
            errorMessage = 'Problème de connexion à la base de données. Veuillez réessayer.';
            errorCode = 'DATABASE_CONNECTION_ERROR';
            statusCode = 503;
        } else if (error.name === 'MongoTimeoutError') {
            errorMessage = 'Timeout de la base de données. Veuillez réessayer.';
            errorCode = 'DATABASE_TIMEOUT';
            statusCode = 504;
        } else if (error.message.includes('Coordonnées GPS invalides')) {
            errorMessage = 'Coordonnées GPS invalides fournies.';
            errorCode = 'INVALID_COORDINATES';
            statusCode = 400;
        }
        
        return {
            statusCode: statusCode,
            headers: corsHeaders,
            body: JSON.stringify({
                error: errorMessage,
                code: errorCode,
                timestamp: new Date().toISOString(),
                responseTime: Date.now() - startTime
            })
        };
        
    } finally {
        // Fermeture sécurisée de la connexion
        if (client) {
            try {
                await client.close();
                logger.info('Connexion MongoDB fermée');
            } catch (closeError) {
                logger.error('Erreur lors de la fermeture de la connexion MongoDB', closeError);
            }
        }
    }
};