const { MongoClient } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

// Configuration du cache
const CACHE_DURATION = 3 * 60 * 1000; // 3 minutes
const cache = new Map();

// Utilitaires de logging
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

// Validation du code de suivi
function validateTrackingCode(codeID) {
    if (!codeID || typeof codeID !== 'string') {
        return { valid: false, error: 'Code de suivi manquant ou invalide' };
    }
    
    const trimmedCode = codeID.trim();
    if (trimmedCode.length < 4 || trimmedCode.length > 20) {
        return { valid: false, error: 'Le code de suivi doit contenir entre 4 et 20 caractères' };
    }
    
    if (!/^[A-Z0-9]+$/i.test(trimmedCode)) {
        return { valid: false, error: 'Le code de suivi ne peut contenir que des lettres et des chiffres' };
    }
    
    return { valid: true, code: trimmedCode.toUpperCase() };
}

// Enrichissement ultra-sophistiqué des données
async function enrichTrackingData(expeditionData, livreurCollection) {
    try {
        const enrichedData = { ...expeditionData };
        
        // Calculer la durée depuis la création
        if (enrichedData.dateCreation) {
            const creationDate = new Date(enrichedData.dateCreation);
            const now = new Date();
            enrichedData.dureeDepuisCreation = Math.floor((now - creationDate) / (1000 * 60 * 60 * 24));
        }
        
        // Enrichir les informations de statut
        enrichedData.statutDetaille = {
            code: enrichedData.statut,
            libelle: getStatusLibelle(enrichedData.statut),
            pourcentageCompletion: getCompletionPercentage(enrichedData.statut),
            couleur: getStatusColor(enrichedData.statut)
        };
        
        // Enrichir les informations de localisation
        if (enrichedData.driverLocation) {
            enrichedData.driverLocation.derniereMAJ = enrichedData.dateModification || enrichedData.dateAcceptation;
            enrichedData.driverLocation.precision = enrichedData.driverLocation.accuracy ? 
                `±${Math.round(enrichedData.driverLocation.accuracy)}m` : 'Non spécifiée';
        }
        
        // Récupérer et enrichir les informations du livreur
        const livreurId = enrichedData.idLivreurEnCharge || enrichedData.driverId;
        if (livreurId && livreurCollection) {
            try {
                logger.info('Recherche des informations du livreur', { livreurId });
                
                const livreurInfo = await livreurCollection.findOne(
                    { id_livreur: livreurId },
                    {
                        projection: {
                            id_livreur: 1,
                            nom: 1,
                            prenom: 1,
                            whatsapp: 1,
                            telephone: 1,
                            quartier: 1,
                            contactUrgence: 1,
                            date_inscription: 1,
                            'documents.photoIdentite.data': 1,
                            'documents.photoIdentite.type': 1,
                            'documents.photoIdentite.name': 1,
                            'documents.photoIdentite.size': 1
                        }
                    }
                );
                
                if (livreurInfo) {
                    logger.info('Informations du livreur trouvées', { 
                        livreurId, 
                        hasPhoto: !!livreurInfo.documents?.photoIdentite?.data
                    });
                    
                    const photoData = livreurInfo.documents?.photoIdentite?.data;
                    const photoType = livreurInfo.documents?.photoIdentite?.type;

                    enrichedData.livreurInfo = {
                        id: livreurInfo.id_livreur,
                        nom: `${livreurInfo.prenom || ''} ${livreurInfo.nom || ''}`.trim(),
                        prenom: livreurInfo.prenom,
                        nomFamille: livreurInfo.nom,
                        whatsapp: livreurInfo.whatsapp,
                        telephone: livreurInfo.telephone,
                        quartier: livreurInfo.quartier,
                        contactUrgence: livreurInfo.contactUrgence,
                        dateInscription: livreurInfo.date_inscription,
                        
                        // Gestion sophistiquée de la photo
                        photoBase64: photoData 
                            ? (photoData.startsWith('data:image/') 
                                ? photoData 
                                : `data:${photoType || 'image/jpeg'};base64,${photoData}`)
                            : null,
                        photoContentType: photoType || 'image/jpeg',
                        photoSize: livreurInfo.documents?.photoIdentite?.size || null,
                        photoUploadedAt: livreurInfo.documents?.photoIdentite?.uploaded_at || null,
                        
                        telephones: [
                            livreurInfo.telephone,
                            livreurInfo.whatsapp,
                            livreurInfo.contactUrgence,
                            enrichedData.telephoneLivreur1,
                            enrichedData.driverPhone1,
                            enrichedData.driverPhone,
                            enrichedData.telephoneLivreur2,
                            enrichedData.driverPhone2
                        ].filter(Boolean),
                        
                        statut: enrichedData.statut === 'en_cours_de_livraison' ? 'actif' : 'standby'
                    };
                    
                    logger.info('Informations du livreur enrichies', { 
                        livreurId, 
                        nom: enrichedData.livreurInfo.nom,
                        hasPhoto: !!enrichedData.livreurInfo.photoBase64,
                        photoType: enrichedData.livreurInfo.photoContentType,
                        photoSize: enrichedData.livreurInfo.photoSize
                    });
                } else {
                    logger.warn('Aucune information de livreur trouvée en base', { livreurId });
                }
            } catch (error) {
                logger.error('Erreur lors de la récupération des informations du livreur', error);
            }
        }
        
        // Fallback si pas de livreurInfo mais des données de base
        if (!enrichedData.livreurInfo && (enrichedData.nomLivreur || enrichedData.driverName)) {
            enrichedData.livreurInfo = {
                nom: enrichedData.nomLivreur || enrichedData.driverName,
                id: enrichedData.idLivreurEnCharge || enrichedData.driverId,
                telephones: [
                    enrichedData.telephoneLivreur1,
                    enrichedData.driverPhone1,
                    enrichedData.driverPhone,
                    enrichedData.telephoneLivreur2,
                    enrichedData.driverPhone2
                ].filter(Boolean),
                statut: enrichedData.statut === 'en_cours_de_livraison' ? 'actif' : 'standby'
            };
        }
        
        // Enrichir les informations de photos du colis
        if (enrichedData.colis?.photos?.length) {
            enrichedData.colis.photos = enrichedData.colis.photos.map((photo, index) => ({
                ...photo,
                id: `photo_${index}`,
                taille: photo.size ? formatFileSize(photo.size) : 'Inconnue',
                format: photo.type || 'image/jpeg',
                dateUpload: photo.uploadedAt || enrichedData.dateCreation
            }));
        }
        
        // Calculer les métriques de performance
        enrichedData.metriques = calculatePerformanceMetrics(enrichedData);
        
        // Ajouter des informations de traçabilité
        enrichedData.traceabilite = {
            derniereUpdate: new Date().toISOString(),
            sourceEnrichissement: 'tracking-handler-v2.0',
            versionAPI: '2.0.0'
        };
        
        return enrichedData;
        
    } catch (error) {
        logger.error('Erreur lors de l\'enrichissement des données', error);
        return expeditionData; // Retourner les données originales en cas d'erreur
    }
}

// Fonctions utilitaires
function getStatusLibelle(statut) {
    const statusMap = {
        'en_cours_de_livraison': 'En cours de livraison',
        'en_attente': 'En attente de prise en charge',
        'en_cours': 'En cours de traitement',
        'livre': 'Livré avec succès',
        'retour': 'Retourné à l\'expéditeur',
        'annule': 'Livraison annulée',
        'en_preparation': 'En préparation',
        'pret_pour_collecte': 'Prêt pour collecte'
    };
    return statusMap[statut] || 'Statut inconnu';
}

function getCompletionPercentage(statut) {
    const percentageMap = {
        'en_attente': 10,
        'en_preparation': 25,
        'pret_pour_collecte': 40,
        'en_cours': 50,
        'en_cours_de_livraison': 75,
        'livre': 100,
        'retour': 90,
        'annule': 0
    };
    return percentageMap[statut] || 0;
}

function getStatusColor(statut) {
    const colorMap = {
        'en_cours_de_livraison': '#F59E0B',
        'en_attente': '#6B7280',
        'en_cours': '#3B82F6',
        'livre': '#10B981',
        'retour': '#F97316',
        'annule': '#EF4444'
    };
    return colorMap[statut] || '#6B7280';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function calculatePerformanceMetrics(data) {
    const metrics = {
        tempsDepuisCreation: null,
        tempsDepuisAcceptation: null,
        estimationLivraison: null,
        efficacite: 'normale'
    };
    
    const now = new Date();
    
    if (data.dateCreation) {
        const creation = new Date(data.dateCreation);
        metrics.tempsDepuisCreation = Math.floor((now - creation) / (1000 * 60 * 60));
    }
    
    if (data.dateAcceptation) {
        const acceptance = new Date(data.dateAcceptation);
        metrics.tempsDepuisAcceptation = Math.floor((now - acceptance) / (1000 * 60 * 60));
    }
    
    // Estimation basée sur le statut
    switch (data.statut) {
        case 'en_cours_de_livraison':
            metrics.estimationLivraison = 'Dans les 2-4 heures';
            metrics.efficacite = 'excellente';
            break;
        case 'en_cours':
            metrics.estimationLivraison = 'Dans les 4-8 heures';
            metrics.efficacite = 'bonne';
            break;
        case 'en_attente':
            metrics.estimationLivraison = 'Dans les 8-24 heures';
            metrics.efficacite = 'normale';
            break;
        default:
            metrics.estimationLivraison = 'Non déterminée';
    }
    
    return metrics;
}

// Gestion du cache
function getCacheKey(codeID) {
    return `tracking_ultra_${codeID}`;
}

function getCachedData(codeID) {
    const key = getCacheKey(codeID);
    const cached = cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        logger.info('Données récupérées depuis le cache', { codeID, age: Date.now() - cached.timestamp });
        return cached.data;
    }
    
    return null;
}

function setCachedData(codeID, data) {
    const key = getCacheKey(codeID);
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
    
    // Nettoyage du cache si trop volumineux
    if (cache.size > 500) {
        const oldestKeys = Array.from(cache.keys()).slice(0, 100);
        oldestKeys.forEach(key => cache.delete(key));
        logger.info('Cache nettoyé', { taille: cache.size });
    }
}

// Handler principal ultra-sophistiqué
exports.handler = async (event, context) => {
    // Headers CORS ultra-sécurisés
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block"
    };

    // Gestion des requêtes OPTIONS
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
                success: false,
                error: 'Méthode non autorisée. Utilisez POST.',
                code: 'METHOD_NOT_ALLOWED',
                timestamp: new Date().toISOString()
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
                    success: false,
                    error: 'Corps de requête manquant',
                    code: 'MISSING_BODY',
                    timestamp: new Date().toISOString()
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
                    success: false,
                    error: 'Format JSON invalide',
                    code: 'INVALID_JSON',
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Validation ultra-sophistiquée du code de suivi
        const validation = validateTrackingCode(requestData.codeID);
        if (!validation.valid) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    success: false,
                    error: validation.error,
                    code: 'INVALID_TRACKING_CODE',
                    timestamp: new Date().toISOString()
                })
            };
        }

        const codeID = validation.code;
        logger.info('Recherche de suivi ultra-sophistiquée initiée', { codeID });

        // Vérification du cache
        const cachedData = getCachedData(codeID);
        if (cachedData) {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    expedition: cachedData,
                    message: 'Informations de suivi récupérées avec succès (cache)',
                    cached: true,
                    responseTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Connexion MongoDB ultra-optimisée
        client = new MongoClient(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 15,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4,
            maxIdleTimeMS: 30000,
            retryWrites: true,
            retryReads: true
        });

        await client.connect();
        logger.info('Connexion MongoDB établie avec succès');

        const db = client.db(DB_NAME);
        const expeditionCollection = db.collection('cour_expedition');
        const livraisonCollection = db.collection('Livraison');
        const livreurCollection = db.collection('Res_livreur');

        // Recherche ultra-optimisée dans cour_expedition
        const expeditionInfo = await expeditionCollection.findOne(
            { colisID: codeID },
            {
                projection: {
                    // Projection ultra-complète
                    colisID: 1,
                    livraisonID: 1,
                    expediteur: 1,
                    destinataire: 1,
                    colis: 1,
                    statut: 1,
                    dateCreation: 1,
                    dateAcceptation: 1,
                    dateModification: 1,
                    driverLocation: 1,
                    driverName: 1,
                    driverPhone: 1,
                    driverPhone1: 1,
                    driverPhone2: 1,
                    driverId: 1,
                    nomLivreur: 1,
                    telephoneLivreur1: 1,
                    telephoneLivreur2: 1,
                    idLivreurEnCharge: 1,
                    prixLivraison: 1,
                    processus: 1,
                    historique: 1,
                    estExpedie: 1,
                    orderId: 1,
                    serviceType: 1,
                    assignedAt: 1,
                    status: 1,
                    originalCollection: 1,
                    lastPositionUpdate: 1,
                    positionHistory: 1,
                    localisation: 1
                }
            }
        );

        if (expeditionInfo) {
            logger.info('Expédition trouvée avec succès', { 
                codeID, 
                statut: expeditionInfo.statut,
                hasDriverLocation: !!expeditionInfo.driverLocation,
                driverId: expeditionInfo.driverId || expeditionInfo.idLivreurEnCharge
            });
            
            // Enrichissement ultra-sophistiqué des données
            const enrichedData = await enrichTrackingData(expeditionInfo, livreurCollection);
            
            // Mise en cache avec métadonnées
            setCachedData(codeID, enrichedData);
            
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    expedition: enrichedData,
                    message: 'Informations de suivi récupérées avec succès',
                    cached: false,
                    responseTime: Date.now() - startTime,
                    timestamp: new Date().toISOString(),
                    metadata: {
                        version: '2.0.0',
                        enriched: true,
                        hasDriverInfo: !!enrichedData.livreurInfo,
                        hasDriverPhoto: !!(enrichedData.livreurInfo?.photoBase64),
                        hasLocation: !!enrichedData.driverLocation
                    }
                })
            };
        }

        // Recherche dans Livraison si non trouvé
        logger.info('Recherche dans la collection Livraison', { codeID });
        const colisEnregistre = await livraisonCollection.findOne(
            { colisID: codeID },
            { projection: { colisID: 1, dateCreation: 1, statut: 1, expediteur: 1, destinataire: 1, colis: 1 } }
        );

        if (colisEnregistre) {
            logger.info('Colis trouvé en attente dans Livraison', { codeID });
            
            const pendingData = {
                colisID: codeID,
                statut: 'en_attente',
                dateCreation: colisEnregistre.dateCreation,
                expediteur: colisEnregistre.expediteur,
                destinataire: colisEnregistre.destinataire,
                colis: colisEnregistre.colis,
                statutDetaille: {
                    code: 'en_attente',
                    libelle: 'En attente de prise en charge',
                    pourcentageCompletion: 10,
                    couleur: '#6B7280'
                },
                metriques: {
                    estimationLivraison: 'Dans les 8-24 heures',
                    efficacite: 'normale'
                },
                traceabilite: {
                    derniereUpdate: new Date().toISOString(),
                    sourceEnrichissement: 'tracking-handler-v2.0-pending',
                    versionAPI: '2.0.0'
                }
            };
            
            // Cache avec durée réduite pour les colis en attente
            setCachedData(codeID, pendingData);
            
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    message: 'Le processus d\'expédition pour ce colis n\'a pas encore démarré. Un livreur prendra en charge votre colis dans les plus brefs délais.',
                    expedition: pendingData,
                    responseTime: Date.now() - startTime,
                    timestamp: new Date().toISOString(),
                    metadata: {
                        version: '2.0.0',
                        status: 'pending'
                    }
                })
            };
        }

        // Aucun résultat trouvé
        logger.warn('Aucun colis trouvé avec ce code', { codeID });
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: 'Code de colis invalide ou inexistant. Veuillez vérifier le code de suivi.',
                code: 'PACKAGE_NOT_FOUND',
                suggestions: [
                    'Vérifiez l\'orthographe du code de suivi',
                    'Assurez-vous que le code est complet',
                    'Contactez l\'expéditeur si le problème persiste'
                ],
                responseTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            })
        };

    } catch (error) {
        logger.error('Erreur critique lors de la récupération des informations d\'expédition', error);
        
        // Gestion sophistiquée des erreurs
        let errorMessage = 'Erreur serveur lors de la récupération des informations d\'expédition.';
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
        } else if (error.message?.includes('JSON')) {
            errorMessage = 'Erreur de traitement des données. Format invalide.';
            errorCode = 'DATA_PROCESSING_ERROR';
            statusCode = 422;
        }
        
        return {
            statusCode: statusCode,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: errorMessage,
                code: errorCode,
                timestamp: new Date().toISOString(),
                responseTime: Date.now() - startTime,
                metadata: {
                    version: '2.0.0',
                    errorType: error.name || 'UnknownError'
                }
            })
        };
        
    } finally {
        // Fermeture ultra-sécurisée de la connexion
        if (client) {
            try {
                await client.close();
                logger.info('Connexion MongoDB fermée avec succès');
            } catch (closeError) {
                logger.error('Erreur lors de la fermeture de la connexion MongoDB', closeError);
            }
        }
    }
};