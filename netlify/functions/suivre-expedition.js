const { MongoClient } = require('mongodb');

// Configuration de la base de données
const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

// Configuration du cache et de la performance
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
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
function validateTrackingCode(codeID) {
    if (!codeID || typeof codeID !== 'string') {
        return { valid: false, error: 'Code de suivi manquant ou invalide' };
    }
    
    const trimmedCode = codeID.trim();
    if (trimmedCode.length < 8 || trimmedCode.length > 20) {
        return { valid: false, error: 'Le code de suivi doit contenir entre 8 et 20 caractères' };
    }
    
    if (!/^[A-Z0-9]+$/i.test(trimmedCode)) {
        return { valid: false, error: 'Le code de suivi ne peut contenir que des lettres et des chiffres' };
    }
    
    return { valid: true, code: trimmedCode.toUpperCase() };
}

// Fonction d'enrichissement des données avec informations livreur
async function enrichTrackingData(expeditionData, livreurCollection) {
    const enrichedData = { ...expeditionData };
    
    // Calculer la durée depuis la création
    if (enrichedData.dateCreation) {
        const creationDate = new Date(enrichedData.dateCreation);
        const now = new Date();
        enrichedData.dureeDepuisCreation = Math.floor((now - creationDate) / (1000 * 60 * 60 * 24)); // en jours
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
            `±${enrichedData.driverLocation.accuracy}m` : 'Non spécifiée';
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
                        prénom: 1,
                        WhatsApp: 1,
                        téléphone: 1,
                        quartier: 1,
                        contact_urgence: 1,
                        date_inscription: 1,
                        photo_nom: 1,
                        phototype: 1,
                        photo_taille: 1,
                        données_photo: 1
                    }
                }
            );
            
            if (livreurInfo) {
                logger.info('Informations du livreur trouvées', { livreurId });
                
                enrichedData.livreurInfo = {
                    id: livreurInfo.id_livreur,
                    nom: `${livreurInfo.prénom || ''} ${livreurInfo.nom || ''}`.trim(),
                    prenom: livreurInfo.prénom,
                    nomFamille: livreurInfo.nom,
                    whatsapp: livreurInfo.WhatsApp,
                    telephone: livreurInfo.téléphone,
                    quartier: livreurInfo.quartier,
                    contactUrgence: livreurInfo.contact_urgence,
                    dateInscription: livreurInfo.date_inscription,
                    photoNom: livreurInfo.photo_nom,
                    photoType: livreurInfo.phototype,
                    photoTaille: livreurInfo.photo_taille,
                    photoBase64: livreurInfo.données_photo,
                    telephones: [
                        livreurInfo.téléphone,
                        livreurInfo.WhatsApp,
                        livreurInfo.contact_urgence,
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
                    hasPhoto: !!enrichedData.livreurInfo.photoBase64
                });
            } else {
                logger.warn('Aucune information de livreur trouvée', { livreurId });
            }
        } catch (error) {
            logger.error('Erreur lors de la récupération des informations du livreur', error);
        }
    }
    
    // Enrichir les informations de contact (fallback si pas de livreurInfo)
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
    
    // Enrichir les informations de photos
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
    
    return enrichedData;
}

// Fonctions utilitaires pour l'enrichissement
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
        vitesseMoyenne: null,
        estimationLivraison: null
    };
    
    const now = new Date();
    
    if (data.dateCreation) {
        const creation = new Date(data.dateCreation);
        metrics.tempsDepuisCreation = Math.floor((now - creation) / (1000 * 60 * 60)); // en heures
    }
    
    if (data.dateAcceptation) {
        const acceptance = new Date(data.dateAcceptation);
        metrics.tempsDepuisAcceptation = Math.floor((now - acceptance) / (1000 * 60 * 60)); // en heures
    }
    
    // Estimation basée sur le statut et les données historiques
    if (data.statut === 'en_cours_de_livraison') {
        metrics.estimationLivraison = 'Dans les 2-4 heures';
    } else if (data.statut === 'en_cours') {
        metrics.estimationLivraison = 'Dans les 4-8 heures';
    } else if (data.statut === 'en_attente') {
        metrics.estimationLivraison = 'Dans les 8-24 heures';
    }
    
    return metrics;
}

// Fonction de gestion du cache
function getCacheKey(codeID) {
    return `tracking_enhanced_${codeID}`;
}

function getCachedData(codeID) {
    const key = getCacheKey(codeID);
    const cached = cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        logger.info('Données récupérées depuis le cache', { codeID });
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
    
    // Nettoyer le cache périodiquement
    if (cache.size > 1000) {
        const oldestKeys = Array.from(cache.keys()).slice(0, 100);
        oldestKeys.forEach(key => cache.delete(key));
    }
}

// Fonction principale du handler
exports.handler = async (event, context) => {
    // Gestion CORS
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
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

        // Validation du code de suivi
        const validation = validateTrackingCode(requestData.codeID);
        if (!validation.valid) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    error: validation.error,
                    code: 'INVALID_TRACKING_CODE'
                })
            };
        }

        const codeID = validation.code;
        logger.info('Recherche de suivi initiée', { codeID });

        // Vérifier le cache
        const cachedData = getCachedData(codeID);
        if (cachedData) {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    expedition: cachedData,
                    message: 'Informations de suivi récupérées avec succès (cache)',
                    cached: true,
                    responseTime: Date.now() - startTime
                })
            };
        }

        // Connexion à MongoDB avec options avancées
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
        const livraisonCollection = db.collection('Livraison');
        const livreurCollection = db.collection('Res_livreur');

        // Recherche dans cour_expedition avec projection optimisée
        const expeditionInfo = await expeditionCollection.findOne(
            { colisID: codeID },
            {
                projection: {
                    // Inclure tous les champs nécessaires
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
                    estExpedie: 1
                }
            }
        );

        if (expeditionInfo) {
            logger.info('Expédition trouvée', { codeID, statut: expeditionInfo.statut });
            
            // Enrichir les données avec les informations du livreur
            const enrichedData = await enrichTrackingData(expeditionInfo, livreurCollection);
            
            // Mettre en cache
            setCachedData(codeID, enrichedData);
            
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    expedition: enrichedData,
                    message: 'Informations de suivi récupérées avec succès',
                    cached: false,
                    responseTime: Date.now() - startTime
                })
            };
        }

        // Recherche dans Livraison si non trouvé dans cour_expedition
        logger.info('Recherche dans la collection Livraison', { codeID });
        const colisEnregistre = await livraisonCollection.findOne(
            { colisID: codeID },
            { projection: { colisID: 1, dateCreation: 1, statut: 1 } }
        );

        if (colisEnregistre) {
            logger.info('Colis trouvé en attente', { codeID });
            
            const pendingData = {
                colisID: codeID,
                statut: 'en_attente',
                dateCreation: colisEnregistre.dateCreation,
                statutDetaille: {
                    code: 'en_attente',
                    libelle: 'En attente de prise en charge',
                    pourcentageCompletion: 10,
                    couleur: '#6B7280'
                }
            };
            
            // Mettre en cache avec une durée plus courte pour les colis en attente
            setCachedData(codeID, pendingData);
            
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Le processus d\'expédition pour ce colis n\'a pas encore démarré. Veuillez réessayer dans quelques minutes.',
                    expedition: pendingData,
                    responseTime: Date.now() - startTime
                })
            };
        }

        // Aucun résultat trouvé
        logger.warn('Aucun colis trouvé', { codeID });
        return {
            statusCode: 404,
            headers: corsHeaders,
            body: JSON.stringify({
                error: 'Code de colis invalide ou inexistant. Veuillez vérifier le code de suivi.',
                code: 'PACKAGE_NOT_FOUND',
                suggestions: [
                    'Vérifiez l\'orthographe du code de suivi',
                    'Assurez-vous que le code est complet',
                    'Contactez l\'expéditeur si le problème persiste'
                ],
                responseTime: Date.now() - startTime
            })
        };

    } catch (error) {
        logger.error('Erreur lors de la récupération des informations d\'expédition', error);
        
        // Gestion des erreurs spécifiques
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