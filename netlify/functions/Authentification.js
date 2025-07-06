const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

// Configuration MongoDB
const MONGODB_URI = "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = "FarmsConnect";
const ADMIN_CODE = "ka23bo23re23";

// Headers CORS
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
};

// Instance MongoDB réutilisable
let mongoClient = null;

async function connectToMongoDB() {
    try {
        if (!mongoClient) {
            mongoClient = new MongoClient(MONGODB_URI, {
                connectTimeoutMS: 30000,
                serverSelectionTimeoutMS: 30000,
                maxPoolSize: 10,
                retryWrites: true,
                w: 'majority'
            });
            await mongoClient.connect();
            console.log('✅ Connexion MongoDB établie');
        }
        return mongoClient.db(DB_NAME);
    } catch (error) {
        console.error('❌ Erreur de connexion MongoDB:', error);
        throw error;
    }

    
}

// Function principale
exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

    // Gestion des requêtes OPTIONS (preflight CORS)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    // Vérification de la méthode HTTP
    if (event.httpMethod !== 'POST') {
        return createResponse(405, { 
            success: false, 
            message: 'Méthode non autorisée' 
        });
    }

    let db;
    
    try {
        // Parse du body de la requête
        const body = JSON.parse(event.body || '{}');
        const { action } = body;

        console.log(`🚀 Action reçue: ${action}`);

        // Connexion à MongoDB
        db = await connectToMongoDB();

        // Router vers la fonction appropriée
        switch (action) {
            case 'register':
                return await handleClassicRegistration(db, body);
            
            case 'login':
                return await handleLogin(db, body);
            
            case 'demandeRecrutement':
                return await handleDemandeRecrutement(db, body, event);
            
            case 'demandePartenariat':
                return await handleDemandePartenariat(db, body);
            
            case 'verifyIdentifiant':
                return await verifyIdentifiant(db, body);
            
            case 'finalizeInscription':
                return await finalizeInscription(db, body);
            
            case 'finalizePartenariat':
                return await finalizePartenariat(db, body);
            
            default:
                return createResponse(400, { 
                    success: false, 
                    message: 'Action non supportée' 
                });
        }

    } catch (error) {
        console.error('💥 Erreur serveur:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur interne du serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ===== NOUVELLES FONCTIONS POUR LE SYSTÈME DE RECRUTEMENT =====

// Gestion des demandes de recrutement (livreurs)
async function handleDemandeRecrutement(db, data, event) {
        try {
        console.log('👤 Nouvelle demande de recrutement livreur');

        // Validation des données requises
        const requiredFields = ['nom', 'prenom', 'whatsapp', 'quartier', 'vehicule', 'immatriculation'];
        const validation = validateRequiredFields(data, requiredFields);
        
        if (!validation.isValid) {
            return createResponse(400, {
                success: false,
                message: `Champs obligatoires manquants: ${validation.missingFields.join(', ')}`
            });
        }

        // Vérifier les doublons par WhatsApp
        const existingDemande = await db.collection('demande_livreur').findOne({
            whatsapp: data.whatsapp
        });

        if (existingDemande) {
            return createResponse(409, {
                success: false,
                message: 'Une demande existe déjà avec ce numéro WhatsApp'
            });
        }

        // Vérifier si déjà un livreur actif
        const existingLivreur = await db.collection('Res_livreur').findOne({
            whatsapp: data.whatsapp,
            status: 'actif'
        });

        if (existingLivreur) {
            return createResponse(409, {
                success: false,
                message: 'Vous êtes déjà enregistré comme livreur actif'
            });
        }

        // Créer la demande
        const demandeDocument = {
            nom: data.nom.trim(),
            prenom: data.prenom.trim(),
            whatsapp: data.whatsapp,
            telephone: data.telephone || '',
            quartier: data.quartier.trim(),
            dateNaissance: data.dateNaissance || null,
            vehicule: data.vehicule,
            immatriculation: data.immatriculation.trim(),
            experience: data.experience || '',
            contactUrgence: data.contactUrgence || {},
            hasPhoto: data.hasPhoto || false,
            photoInfo: data.hasPhoto ? {
                name: data.photoName,
                size: data.photoSize,
                type: data.photoType
            } : null,
            statut: 'en_attente',
            dateCreation: new Date(),
            dateTraitement: null,
            traiteePar: null,
            identifiantGenere: null,
            notificationEnvoyee: false,
            ip: event.headers['x-forwarded-for'] || 'unknown'
        };

        const result = await db.collection('demande_livreur').insertOne(demandeDocument);

        console.log(`✅ Demande de recrutement créée: ${result.insertedId}`);

        return createResponse(201, {
            success: true,
            message: 'Demande de recrutement envoyée avec succès',
            demandeId: result.insertedId,
            estimatedProcessingTime: '24-48 heures'
        });

    } catch (error) {
        console.error('❌ Erreur handleDemandeRecrutement:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de l\'enregistrement de la demande'
        });
    }
}

// Gestion des demandes de partenariat (restaurants)
async function handleDemandePartenariat(db, data) {
    try {
        console.log('🏪 Nouvelle demande de partenariat restaurant');

        // Validation des données requises
        const requiredFields = ['nom', 'telephone', 'adresse'];
        const validation = validateRequiredFields(data, requiredFields);
        
        if (!validation.isValid) {
            return createResponse(400, {
                success: false,
                message: `Champs obligatoires manquants: ${validation.missingFields.join(', ')}`
            });
        }

        // Vérifier la présence des coordonnées GPS
        if (!data.coordinates || !data.coordinates.latitude || !data.coordinates.longitude) {
            return createResponse(400, {
                success: false,
                message: 'Coordonnées GPS requises pour la localisation du restaurant'
            });
        }

        // Vérifier les doublons par nom ou téléphone
        const existingDemande = await db.collection('demande_restau').findOne({
            $or: [
                { nom: data.nom.trim() },
                { telephone: data.telephone }
            ]
        });

        if (existingDemande) {
            return createResponse(409, {
                success: false,
                message: 'Une demande existe déjà avec ce nom ou ce numéro de téléphone'
            });
        }

        // Vérifier si déjà un restaurant actif
        const existingRestaurant = await db.collection('Restau').findOne({
            $or: [
                { nom: data.nom.trim() },
                { telephone: data.telephone }
            ],
            statut: 'actif'
        });

        if (existingRestaurant) {
            return createResponse(409, {
                success: false,
                message: 'Ce restaurant est déjà enregistré et actif'
            });
        }

        // Créer la demande
        const demandeDocument = {
            nom: data.nom.trim(),
            nomCommercial: data.nomCommercial?.trim() || '',
            telephone: data.telephone,
            email: data.email?.trim() || '',
            adresse: data.adresse.trim(),
            quartier: data.quartier?.trim() || '',
            cuisine: data.cuisine || '',
            specialites: data.specialites?.trim() || '',
            heureOuverture: data.heureOuverture || '',
            heureFermeture: data.heureFermeture || '',
            horairesDetails: data.horairesDetails?.trim() || '',
            responsableNom: data.responsableNom?.trim() || '',
            responsableTel: data.responsableTel || '',
            description: data.description?.trim() || '',
            coordinates: {
                latitude: data.coordinates.latitude,
                longitude: data.coordinates.longitude,
                accuracy: data.coordinates.accuracy
            },
            hasLogo: data.hasLogo || false,
            logoInfo: data.hasLogo ? {
                name: data.logoName,
                size: data.logoSize,
                type: data.logoType
            } : null,
            hasPhotos: data.hasPhotos || false,
            photosInfo: data.hasPhotos ? data.photosInfo : null,
            statut: 'en_attente',
            dateCreation: new Date(),
            dateTraitement: null,
            traiteePar: null,
            identifiantGenere: null,
            notificationEnvoyee: false,
            ip: event.headers['x-forwarded-for'] || 'unknown'
        };

        const result = await db.collection('demande_restau').insertOne(demandeDocument);

        console.log(`✅ Demande de partenariat créée: ${result.insertedId}`);

        return createResponse(201, {
            success: true,
            message: 'Demande de partenariat envoyée avec succès',
            demandeId: result.insertedId,
            estimatedProcessingTime: '24-48 heures'
        });

    } catch (error) {
        console.error('❌ Erreur handleDemandePartenariat:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de l\'enregistrement de la demande'
        });
    }
}

// Vérification d'identifiant pour finalisation
async function verifyIdentifiant(db, data) {
    try {
        console.log(`🔍 Vérification identifiant: ${data.identifiant} (${data.type})`);

        const { identifiant, type } = data;

        if (!identifiant || !type) {
            return createResponse(400, {
                success: false,
                message: 'Identifiant et type requis'
            });
        }

        let collectionName, collectionDemande;
        
        if (type === 'livreur') {
            collectionName = 'Res_livreur';
            collectionDemande = 'demande_livreur';
        } else if (type === 'restaurant') {
            collectionName = 'Restau';
            collectionDemande = 'demande_restau';
        } else {
            return createResponse(400, {
                success: false,
                message: 'Type invalide. Utilisez "livreur" ou "restaurant"'
            });
        }

        // Vérifier que l'identifiant existe dans les demandes traitées
        const demande = await db.collection(collectionDemande).findOne({
            identifiantGenere: identifiant,
            statut: 'approuvee'
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Identifiant non trouvé ou demande non approuvée'
            });
        }

        // Vérifier que l'identifiant n'a pas déjà été utilisé
        const existing = await db.collection(collectionName).findOne({
            [type === 'livreur' ? 'id_livreur' : 'restaurant_id']: identifiant
        });

        if (existing) {
            return createResponse(409, {
                success: false,
                message: 'Cet identifiant a déjà été utilisé'
            });
        }

        console.log(`✅ Identifiant ${identifiant} vérifié avec succès`);

        return createResponse(200, {
            success: true,
            message: 'Identifiant valide',
            demandeInfo: {
                nom: demande.nom,
                dateCreation: demande.dateCreation
            }
        });

    } catch (error) {
        console.error('❌ Erreur verifyIdentifiant:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la vérification'
        });
    }
}

// Finalisation inscription livreur
async function finalizeInscription(db, data) {
    try {
        console.log(`✅ Finalisation inscription livreur: ${data.identifiant}`);

        const { identifiant, password } = data;

        if (!identifiant || !password) {
            return createResponse(400, {
                success: false,
                message: 'Identifiant et mot de passe requis'
            });
        }

        // Récupérer la demande approuvée
        const demande = await db.collection('demande_livreur').findOne({
            identifiantGenere: identifiant,
            statut: 'approuvee'
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Demande non trouvée ou non approuvée'
            });
        }

        // Vérifier que l'identifiant n'est pas déjà utilisé
        const existingLivreur = await db.collection('Res_livreur').findOne({
            id_livreur: identifiant
        });

        if (existingLivreur) {
            return createResponse(409, {
                success: false,
                message: 'Cet identifiant a déjà été utilisé'
            });
        }

        // Créer le livreur dans la collection finale
        const hashedPassword = await bcrypt.hash(password, 12);
        
        const livreurDocument = {
            id_livreur: identifiant,
            nom: demande.nom,
            prenom: demande.prenom,
            whatsapp: demande.whatsapp,
            telephone: demande.telephone,
            quartier: demande.quartier,
            dateNaissance: demande.dateNaissance,
            vehicule: demande.vehicule,
            immatriculation: demande.immatriculation,
            experience: demande.experience,
            contactUrgence: demande.contactUrgence,
            password: hashedPassword,
            status: 'actif',
            date_inscription: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            metadata: {
                createdBy: 'auto-inscription',
                source: 'demande_recrutement',
                demandeId: demande._id,
                version: 1
            }
        };

        // Ajouter la photo si disponible
        if (demande.hasPhoto && demande.photoInfo) {
            livreurDocument.photo = demande.photoInfo;
        }

        const result = await db.collection('Res_livreur').insertOne(livreurDocument);

        // Marquer la demande comme finalisée
        await db.collection('demande_livreur').updateOne(
            { _id: demande._id },
            { 
                $set: { 
                    statut: 'finalisee',
                    dateFinalization: new Date(),
                    livreurId: result.insertedId
                } 
            }
        );

        console.log(`✅ Livreur ${identifiant} créé avec succès`);

        return createResponse(201, {
            success: true,
            message: 'Inscription finalisée avec succès',
            livreurId: result.insertedId,
            id_livreur: identifiant
        });

    } catch (error) {
        console.error('❌ Erreur finalizeInscription:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la finalisation de l\'inscription'
        });
    }
}

// Finalisation partenariat restaurant
async function finalizePartenariat(db, data) {
    try {
        console.log(`✅ Finalisation partenariat restaurant: ${data.identifiant}`);

        const { identifiant, password } = data;

        if (!identifiant || !password) {
            return createResponse(400, {
                success: false,
                message: 'Identifiant et mot de passe requis'
            });
        }

        // Récupérer la demande approuvée
        const demande = await db.collection('demande_restau').findOne({
            identifiantGenere: identifiant,
            statut: 'approuvee'
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Demande non trouvée ou non approuvée'
            });
        }

        // Vérifier que l'identifiant n'est pas déjà utilisé
        const existingRestaurant = await db.collection('Restau').findOne({
            restaurant_id: identifiant
        });

        if (existingRestaurant) {
            return createResponse(409, {
                success: false,
                message: 'Cet identifiant a déjà été utilisé'
            });
        }

        // Créer le restaurant dans la collection finale
        const hashedPassword = await bcrypt.hash(password, 12);
        
        const restaurantDocument = {
            restaurant_id: identifiant,
            nom: demande.nom,
            nomCommercial: demande.nomCommercial,
            telephone: demande.telephone,
            email: demande.email,
            adresse: demande.adresse,
            quartier: demande.quartier,
            cuisine: demande.cuisine,
            specialites: demande.specialites,
            heureOuverture: demande.heureOuverture,
            heureFermeture: demande.heureFermeture,
            horairesDetails: demande.horairesDetails,
            responsableNom: demande.responsableNom,
            responsableTel: demande.responsableTel,
            description: demande.description,
            latitude: demande.coordinates.latitude,
            longitude: demande.coordinates.longitude,
            coordinates: {
                type: "Point",
                coordinates: [demande.coordinates.longitude, demande.coordinates.latitude]
            },
            password: hashedPassword,
            statut: 'actif',
            date_creation: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            metadata: {
                createdBy: 'auto-partenariat',
                source: 'demande_partenariat',
                demandeId: demande._id,
                version: 1,
                gpsAccuracy: demande.coordinates.accuracy
            }
        };

        // Ajouter les fichiers si disponibles
        if (demande.hasLogo && demande.logoInfo) {
            restaurantDocument.logo = demande.logoInfo;
        }

        if (demande.hasPhotos && demande.photosInfo) {
            restaurantDocument.photos = demande.photosInfo;
        }

        const result = await db.collection('Restau').insertOne(restaurantDocument);

        // Marquer la demande comme finalisée
        await db.collection('demande_restau').updateOne(
            { _id: demande._id },
            { 
                $set: { 
                    statut: 'finalisee',
                    dateFinalization: new Date(),
                    restaurantId: result.insertedId
                } 
            }
        );

        console.log(`✅ Restaurant ${identifiant} créé avec succès`);

        return createResponse(201, {
            success: true,
            message: 'Partenariat finalisé avec succès',
            restaurantId: result.insertedId,
            restaurant_id: identifiant
        });

    } catch (error) {
        console.error('❌ Erreur finalizePartenariat:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la finalisation du partenariat'
        });
    }
}

// ===== FONCTIONS D'AUTHENTIFICATION CLASSIQUES (INCHANGÉES) =====

// Gestion de l'inscription classique (conservée pour compatibilité)
async function handleClassicRegistration(db, data) {
    try {
        const { username, whatsapp, secondNumber, type, identificationCode, password } = data;
        
        console.log('Tentative d\'inscription classique:', { username, type, whatsapp });

        // Validation des données de base
        const validationError = validateRegistrationData(data);
        if (validationError) {
            return createResponse(400, { 
                success: false, 
                message: validationError 
            });
        }

        if (type === 'livreur') {
            return await registerDeliveryDriver(db, data);
        } else if (type === 'admin') {
            return await registerAdmin(db, data);
        } else {
            return createResponse(400, { 
                success: false, 
                message: 'Type de compte invalide. Choisissez "livreur" ou "admin"' 
            });
        }

    } catch (error) {
        console.error('Erreur lors de l\'inscription classique:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de l\'inscription' 
        });
    }
}

// Inscription d'un livreur classique
async function registerDeliveryDriver(db, data) {
    const { username, whatsapp, secondNumber, identificationCode, password } = data;
    
    try {
        // Nettoyer et vérifier le code d'identification
        const cleanCode = identificationCode?.trim().toUpperCase();
        if (!cleanCode) {
            return createResponse(400, { 
                success: false, 
                message: 'Code d\'identification requis pour les livreurs' 
            });
        }

        console.log('Recherche du livreur avec le code:', cleanCode);

        // Rechercher le livreur dans la collection Res_livreur
        const livreur = await db.collection('Res_livreur').findOne({
            $or: [
                { id_livreur: { $regex: new RegExp(`^${cleanCode}$`, 'i') } },
                { morceau: { $regex: new RegExp(`^${cleanCode}$`, 'i') } }
            ],
            status: "actif"
        });

        if (!livreur) {
            console.log('Code d\'identification non trouvé:', cleanCode);
            return createResponse(404, { 
                success: false, 
                message: `Code d'identification invalide ou livreur non autorisé. Pour rejoindre SEND2.0, vous devez d'abord être recruté par notre entreprise. Contactez-nous : 📞 56 66 36 38 | 61 22 97 66 | 📧 kaboreabwa2020@gmail.com` 
            });
        }

        console.log('Livreur trouvé:', livreur.id_livreur);

        // Vérifier les doublons
        const existingAccount = await db.collection('compte_livreur').findOne({
            $or: [
                { id_livreur: livreur.id_livreur },
                { username: username.toLowerCase().trim() },
                { whatsapp: cleanPhoneNumber(whatsapp) }
            ]
        });

        if (existingAccount) {
            let message = 'Un compte existe déjà';
            if (existingAccount.id_livreur === livreur.id_livreur) {
                message = 'Un compte existe déjà pour ce livreur';
            } else if (existingAccount.username === username.toLowerCase().trim()) {
                message = 'Ce nom d\'utilisateur est déjà utilisé';
            } else if (existingAccount.whatsapp === cleanPhoneNumber(whatsapp)) {
                message = 'Ce numéro WhatsApp est déjà utilisé';
            }
            
            return createResponse(409, { 
                success: false, 
                message: message 
            });
        }

        // Créer le compte livreur
        const hashedPassword = await bcrypt.hash(password, 12);
        const newAccount = {
            id_livreur: livreur.id_livreur,
            username: username.toLowerCase().trim(),
            nom: livreur.nom,
            prenom: livreur['prénom'] || livreur.prenom,
            whatsapp: cleanPhoneNumber(whatsapp),
            secondNumber: secondNumber ? cleanPhoneNumber(secondNumber) : null,
            telephone: livreur.téléphone || livreur.telephone,
            quartier: livreur.quartier,
            morceau: livreur.morceau,
            contact_urgence: livreur.contact_urgence,
            date_inscription: livreur.date_inscription || new Date(),
            statut: "actif",
            type_compte: "livreur",
            password: hashedPassword,
            photo: livreur.données_photo ? {
                nom: livreur.photo_nom,
                type: livreur.phototype,
                taille: livreur.photo_taille,
                données: livreur.données_photo
            } : null,
            derniere_connexion: null,
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await db.collection('compte_livreur').insertOne(newAccount);
        console.log('Compte livreur créé:', result.insertedId);

        return createResponse(201, { 
            success: true,
            message: 'Inscription réussie ! Votre compte livreur a été créé avec succès.',
            data: {
                id: result.insertedId,
                username: newAccount.username,
                type: 'livreur'
            }
        });

    } catch (error) {
        console.error('Erreur inscription livreur:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de la création du compte livreur' 
        });
    }
}

// Inscription d'un admin
async function registerAdmin(db, data) {
    const { username, identificationCode, password } = data;
    
    try {
        // Vérifier le code admin
        if (identificationCode !== ADMIN_CODE) {
            return createResponse(403, { 
                success: false, 
                message: 'Code administrateur invalide. Accès refusé.' 
            });
        }

        // Vérifier les doublons
        const existingAdmin = await db.collection('compte_admin').findOne({
            username: username.toLowerCase().trim()
        });

        if (existingAdmin) {
            return createResponse(409, { 
                success: false, 
                message: 'Ce nom d\'utilisateur administrateur est déjà utilisé' 
            });
        }

        // Créer le compte admin
        const hashedPassword = await bcrypt.hash(password, 12);
        const newAdmin = {
            username: username.toLowerCase().trim(),
            password: hashedPassword,
            role: "admin",
            permissions: ["full_access"],
            statut: "actif",
            derniere_connexion: null,
            created_at: new Date(),
            updated_at: new Date()
        };

        const result = await db.collection('compte_admin').insertOne(newAdmin);
        console.log('Compte admin créé:', result.insertedId);

        return createResponse(201, { 
            success: true,
            message: 'Compte administrateur créé avec succès',
            data: {
                id: result.insertedId,
                username: newAdmin.username,
                type: 'admin'
            }
        });

    } catch (error) {
        console.error('Erreur inscription admin:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de la création du compte administrateur' 
        });
    }
}

// Gestion de la connexion
async function handleLogin(db, data) {
    try {
        const { username, type, password } = data;

        console.log('Tentative de connexion:', { username, type });

        // Validation des données
        if (!username || !type || !password) {
            return createResponse(400, { 
                success: false, 
                message: 'Nom d\'utilisateur, type de compte et mot de passe requis' 
            });
        }

        if (type === 'livreur') {
            return await loginDeliveryDriver(db, data);
        } else if (type === 'admin') {
            return await loginAdmin(db, data);
        } else {
            return createResponse(400, { 
                success: false, 
                message: 'Type de compte invalide. Choisissez "livreur" ou "admin"' 
            });
        }

    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de la connexion' 
        });
    }
}

// Connexion d'un livreur
async function loginDeliveryDriver(db, data) {
    const { username, password } = data;

    try {
        // Rechercher le compte livreur
        const compte = await db.collection('compte_livreur').findOne({
            username: username.toLowerCase().trim(),
            statut: "actif"
        });

        if (!compte) {
            console.log('Compte livreur non trouvé:', username);
            return createResponse(401, { 
                success: false, 
                message: 'Nom d\'utilisateur ou mot de passe incorrect' 
            });
        }

        // Vérifier le mot de passe
        const passwordValid = await bcrypt.compare(password, compte.password);
        if (!passwordValid) {
            console.log('Mot de passe incorrect pour:', username);
            return createResponse(401, { 
                success: false, 
                message: 'Nom d\'utilisateur ou mot de passe incorrect' 
            });
        }

        // Mettre à jour la dernière connexion
        await db.collection('compte_livreur').updateOne(
            { _id: compte._id },
            { 
                $set: { 
                    derniere_connexion: new Date(),
                    updated_at: new Date()
                } 
            }
        );

        // Préparer les données utilisateur (sans le mot de passe)
        const userData = {
            id: compte._id,
            id_livreur: compte.id_livreur,
            username: compte.username,
            nom: compte.nom,
            prenom: compte.prenom,
            whatsapp: compte.whatsapp,
            telephone: compte.telephone,
            quartier: compte.quartier,
            morceau: compte.morceau,
            type_compte: compte.type_compte,
            statut: compte.statut,
            photo: compte.photo
        };

        console.log('Connexion livreur réussie:', username);

        return createResponse(200, { 
            success: true,
            message: 'Connexion réussie',
            user: userData,
            token: generateSimpleToken(compte._id, 'livreur')
        });

    } catch (error) {
        console.error('Erreur connexion livreur:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de la connexion du livreur' 
        });
    }
}

// Connexion d'un admin
async function loginAdmin(db, data) {
    const { username, password } = data;

    try {
        // Rechercher le compte admin
        const compte = await db.collection('compte_admin').findOne({
            username: username.toLowerCase().trim(),
            statut: "actif"
        });

        if (!compte) {
            console.log('Compte admin non trouvé:', username);
            return createResponse(401, { 
                success: false, 
                message: 'Nom d\'utilisateur ou mot de passe incorrect' 
            });
        }

        // Vérifier le mot de passe
        const passwordValid = await bcrypt.compare(password, compte.password);
        if (!passwordValid) {
            console.log('Mot de passe incorrect pour admin:', username);
            return createResponse(401, { 
                success: false, 
                message: 'Nom d\'utilisateur ou mot de passe incorrect' 
            });
        }

        // Mettre à jour la dernière connexion
        await db.collection('compte_admin').updateOne(
            { _id: compte._id },
            { 
                $set: { 
                    derniere_connexion: new Date(),
                    updated_at: new Date()
                } 
            }
        );

        // Préparer les données utilisateur (sans le mot de passe)
        const userData = {
            id: compte._id,
            username: compte.username,
            role: compte.role,
            permissions: compte.permissions,
            type_compte: 'admin',
            statut: compte.statut
        };

        console.log('Connexion admin réussie:', username);

        return createResponse(200, { 
            success: true,
            message: 'Connexion administrateur réussie',
            user: userData,
            token: generateSimpleToken(compte._id, 'admin')
        });

    } catch (error) {
        console.error('Erreur connexion admin:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de la connexion administrateur' 
        });
    }
}

// ===== FONCTIONS UTILITAIRES =====

function validateRequiredFields(data, requiredFields) {
    const missingFields = requiredFields.filter(field => 
        !data[field] || data[field].toString().trim() === ''
    );
    
    return {
        isValid: missingFields.length === 0,
        missingFields: missingFields
    };
}

function validateRegistrationData(data) {
    const { username, whatsapp, type, password, identificationCode } = data;

    if (!username || username.length < 3) {
        return 'Le nom d\'utilisateur doit comporter au moins 3 caractères';
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return 'Le nom d\'utilisateur ne peut contenir que des lettres, des chiffres et des tirets bas';
    }

    if (!whatsapp || !isValidPhoneNumber(whatsapp)) {
        return 'Numéro WhatsApp invalide. Format attendu: +226 XX XX XX XX ou 0X XX XX XX';
    }

    if (!type || !['livreur', 'admin'].includes(type)) {
        return 'Type de compte invalide. Choisissez "livreur" ou "admin"';
    }

    if (!password || password.length < 8) {
        return 'Le mot de passe doit comporter au moins 8 caractères';
    }

    if ((type === 'livreur' || type === 'admin') && !identificationCode) {
        return 'Code d\'identification requis';
    }

    return null;
}

function isValidPhoneNumber(phone) {
    const cleanPhone = phone.replace(/\s/g, '');
    return /^(\+226|0)[0-9]{8}$/.test(cleanPhone);
}

function cleanPhoneNumber(phone) {
    return phone ? phone.replace(/\s/g, '') : null;
}

function generateSimpleToken(userId, userType) {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2);
    return Buffer.from(`${userId}:${userType}:${timestamp}:${randomString}`).toString('base64');
}

function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify(body)
    };
}


