const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

// Configuration MongoDB
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = "SEND2_0_Pro";

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

function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify(body)
    };
}

function generateUniqueCode(type, length = 6) {
    const prefix = type === 'livreur' ? 'LIV' : 'REST';
    const timestamp = Date.now().toString().slice(-4);
    const random = Math.random().toString(36).substring(2, length - 3).toUpperCase();
    return `${prefix}${timestamp}${random}`;
}

function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
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
            case 'login':
                return await handleLogin(db, body);
            
            case 'demandeRecrutement':
                return await handleDemandeRecrutement(db, body, event);
            
            case 'demandePartenariat':
                return await handleDemandePartenariat(db, body, event);
            
            case 'verifyCode':
                return await verifyCode(db, body);
            
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

// ===== SYSTÈME DE CONNEXION =====
async function handleLogin(db, data) {
    try {
        const { username, type, password } = data;

        console.log(`🔐 Tentative de connexion: ${username} (${type})`);

        // Validation des données
        if (!username || !type || !password) {
            return createResponse(400, { 
                success: false, 
                message: 'Nom d\'utilisateur, type de compte et mot de passe requis' 
            });
        }

        if (type === 'livreur') {
            return await loginLivreur(db, data);
        } else if (type === 'admin') {
            return await loginAdmin(db, data);
        } else {
            return createResponse(400, { 
                success: false, 
                message: 'Type de compte invalide. Choisissez "livreur" ou "admin"' 
            });
        }

    } catch (error) {
        console.error('❌ Erreur handleLogin:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de la connexion' 
        });
    }
}

async function loginLivreur(db, data) {
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
            type_compte: compte.type_compte,
            statut: compte.statut,
            photo: compte.photo
        };

        console.log('✅ Connexion livreur réussie:', username);

        return createResponse(200, { 
            success: true,
            message: 'Connexion réussie',
            user: userData,
            token: generateSimpleToken(compte._id, 'livreur')
        });

    } catch (error) {
        console.error('❌ Erreur loginLivreur:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de la connexion du livreur' 
        });
    }
}

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

        console.log('✅ Connexion admin réussie:', username);

        return createResponse(200, { 
            success: true,
            message: 'Connexion administrateur réussie',
            user: userData,
            token: generateSimpleToken(compte._id, 'admin')
        });

    } catch (error) {
        console.error('❌ Erreur loginAdmin:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de la connexion administrateur' 
        });
    }
}

// ===== SYSTÈME LIVREURS =====
async function handleDemandeRecrutement(db, data, event) {
    try {
        console.log('📝 Nouvelle demande de recrutement livreur');

        // Validation des champs requis
        const requiredFields = ['nom', 'prenom', 'whatsapp', 'quartier', 'vehicule', 'immatriculation'];
        const missingFields = requiredFields.filter(field => {
            const value = data[field];
            return !value || (typeof value === 'string' && value.trim() === '');
        });

        if (missingFields.length > 0) {
            return createResponse(400, {
                success: false,
                message: `Champs obligatoires manquants: ${missingFields.join(', ')}`,
                missingFields
            });
        }


        // Validation du quartier
        if (!/^[A-Za-zÀ-ÿ\s\-']{2,}$/.test(data.quartier.trim())) {
            return createResponse(400, {
                success: false,
                message: 'Nom de quartier invalide'
            });
        }

        // Vérifier les doublons
        const existingDemande = await db.collection('demande_livreur').findOne({
            $or: [
                { whatsapp: data.whatsapp },
                { immatriculation: data.immatriculation.trim() }
            ]
        });

        if (existingDemande) {
            return createResponse(409, {
                success: false,
                message: 'Une demande existe déjà avec ce numéro WhatsApp ou cette immatriculation'
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
            documents: {
                photoIdentite: data.documents?.photoIdentite || null,
                documentVehicule: data.documents?.documentVehicule || null
            },
            signature: data.signature || null,
            statut: 'en_attente',
            codeAutorisation: null,
            dateCreation: new Date(),
            dateTraitement: null,
            traiteePar: null,
            ip: event.headers['x-forwarded-for'] || 'unknown',
            metadata: {
                hasDocuments: !!(data.documents?.photoIdentite && data.documents?.documentVehicule),
                hasSignature: !!data.signature,
                userAgent: event.headers['user-agent'] || 'unknown'
            }
        };

        const result = await db.collection('demande_livreur').insertOne(demandeDocument);

        console.log(`✅ Demande de recrutement créée: ${result.insertedId}`);

        return createResponse(201, {
            success: true,
            message: 'Demande de recrutement envoyée avec succès',
            demandeId: result.insertedId,
            numeroReference: result.insertedId.toString().substring(18),
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

async function verifyCode(db, data) {
    try {
        console.log(`🔍 Vérification code: ${data.code} (${data.type})`);

        const { code, type } = data;

        if (!code || !type) {
            return createResponse(400, {
                success: false,
                message: 'Code et type requis'
            });
        }

        let collectionName;
        
        if (type === 'livreur') {
            collectionName = 'demande_livreur';
        } else if (type === 'restaurant') {
            collectionName = 'demande_restau';
        } else {
            return createResponse(400, {
                success: false,
                message: 'Type invalide'
            });
        }

        // Vérifier que le code existe et est autorisé
        const demande = await db.collection(collectionName).findOne({
            codeAutorisation: code.toUpperCase(),
            statut: 'autorisee'
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Code non trouvé ou demande non autorisée'
            });
        }

        // Vérifier que le code n'a pas déjà été utilisé
        let targetCollection = type === 'livreur' ? 'Res_livreur' : 'Restau';
        const existing = await db.collection(targetCollection).findOne({
            codeAutorisation: code.toUpperCase()
        });

        if (existing) {
            return createResponse(409, {
                success: false,
                message: 'Ce code a déjà été utilisé'
            });
        }

        console.log(`✅ Code ${code} vérifié avec succès`);

        return createResponse(200, {
            success: true,
            message: 'Code valide',
            demandeInfo: {
                nom: demande.nom,
                dateCreation: demande.dateCreation
            }
        });

    } catch (error) {
        console.error('❌ Erreur verifyCode:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la vérification'
        });
    }
}

async function finalizeInscription(db, data) {
    try {
        console.log(`✅ Finalisation inscription livreur: ${data.code}`);

        const { code, username, email, password } = data;

        if (!code || !username || !password) {
            return createResponse(400, {
                success: false,
                message: 'Code, nom d\'utilisateur et mot de passe requis'
            });
        }

        // Validation du nom d'utilisateur
        if (username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) {
            return createResponse(400, {
                success: false,
                message: 'Nom d\'utilisateur invalide (3+ caractères, lettres/chiffres/_)'
            });
        }

        // Validation de l'email si fourni
        if (email && !validateEmail(email)) {
            return createResponse(400, {
                success: false,
                message: 'Adresse email invalide'
            });
        }

        // Validation du mot de passe
        if (password.length < 8) {
            return createResponse(400, {
                success: false,
                message: 'Le mot de passe doit contenir au moins 8 caractères'
            });
        }

        // Récupérer la demande autorisée
        const demande = await db.collection('demande_livreur').findOne({
            codeAutorisation: code.toUpperCase(),
            statut: 'autorisee'
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Code non trouvé ou demande non autorisée'
            });
        }

        // Vérifier que le code n'est pas déjà utilisé
        const existingRes = await db.collection('Res_livreur').findOne({
            codeAutorisation: code.toUpperCase()
        });

        if (existingRes) {
            return createResponse(409, {
                success: false,
                message: 'Ce code a déjà été utilisé'
            });
        }

        // Vérifier unicité du nom d'utilisateur
        const existingUser = await db.collection('compte_livreur').findOne({
            username: username.toLowerCase().trim()
        });

        if (existingUser) {
            return createResponse(409, {
                success: false,
                message: 'Ce nom d\'utilisateur est déjà utilisé'
            });
        }

        // Créer l'identifiant livreur unique
        const id_livreur = generateUniqueCode('livreur', 8);

        // Hasher le mot de passe
        const hashedPassword = await bcrypt.hash(password, 12);

        // Transférer vers Res_livreur
        const resLivreurDocument = {
            id_livreur: id_livreur,
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
            documents: demande.documents,
            signature: demande.signature,
            codeAutorisation: code.toUpperCase(),
            status: 'actif',
            dateAutorisation: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const resResult = await db.collection('Res_livreur').insertOne(resLivreurDocument);

        // Créer le compte de connexion
        const compteDocument = {
            id_livreur: id_livreur,
            username: username.toLowerCase().trim(),
            email: email || null,
            password: hashedPassword,
            nom: demande.nom,
            prenom: demande.prenom,
            whatsapp: demande.whatsapp,
            telephone: demande.telephone,
            quartier: demande.quartier,
            statut: 'actif',
            type_compte: 'livreur',
            derniere_connexion: null,
            resLivreurId: resResult.insertedId,
            created_at: new Date(),
            updated_at: new Date()
        };

        const compteResult = await db.collection('compte_livreur').insertOne(compteDocument);

        // Marquer la demande comme finalisée
        await db.collection('demande_livreur').updateOne(
            { _id: demande._id },
            { 
                $set: { 
                    statut: 'finalisee',
                    dateFinalization: new Date(),
                    resLivreurId: resResult.insertedId,
                    compteId: compteResult.insertedId
                } 
            }
        );

        console.log(`✅ Livreur ${id_livreur} créé avec succès`);

        return createResponse(201, {
            success: true,
            message: 'Inscription finalisée avec succès',
            livreur: {
                id_livreur: id_livreur,
                username: username.toLowerCase().trim(),
                nom: demande.nom,
                prenom: demande.prenom
            }
        });

    } catch (error) {
        console.error('❌ Erreur finalizeInscription:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la finalisation de l\'inscription'
        });
    }
}

// ===== SYSTÈME RESTAURANTS =====
async function handleDemandePartenariat(db, data, event) {
    try {
        console.log('🏪 Nouvelle demande de partenariat restaurant');

        // Validation des champs requis
        const requiredFields = ['nom', 'telephone', 'adresse'];
        const missingFields = requiredFields.filter(field => {
            const value = data[field];
            return !value || (typeof value === 'string' && value.trim() === '');
        });

        if (missingFields.length > 0) {
            return createResponse(400, {
                success: false,
                message: `Champs obligatoires manquants: ${missingFields.join(', ')}`,
                missingFields
            });
        }

        // Validation de l'email si fourni
        if (data.email && !validateEmail(data.email)) {
            return createResponse(400, {
                success: false,
                message: 'Adresse email invalide'
            });
        }

        // Validation des coordonnées GPS
        if (!data.coordinates || !data.coordinates.latitude || !data.coordinates.longitude) {
            return createResponse(400, {
                success: false,
                message: 'Coordonnées GPS requises'
            });
        }

        // Vérifier les doublons
        const existingDemande = await db.collection('demande_restau').findOne({
            $or: [
                { telephone: data.telephone },
                { email: data.email && data.email.trim() },
                { 
                    nom: data.nom.trim(),
                    adresse: data.adresse.trim()
                }
            ].filter(Boolean)
        });

        if (existingDemande) {
            return createResponse(409, {
                success: false,
                message: 'Une demande existe déjà avec ces informations'
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
            coordinates: data.coordinates,
            location: data.location,
            signature: data.signature || null,
            hasLogo: data.hasLogo || false,
            hasPhotos: data.hasPhotos || false,
            hasMenu: data.hasMenu || false,
            photosInfo: data.photosInfo || [],
            menuInfo: data.menuInfo || [],
            statut: 'en_attente',
            codeAutorisation: null,
            dateCreation: new Date(),
            dateTraitement: null,
            traiteePar: null,
            ip: event.headers['x-forwarded-for'] || 'unknown',
            metadata: {
                hasSignature: !!data.signature,
                hasGPS: !!(data.coordinates?.latitude && data.coordinates?.longitude),
                userAgent: event.headers['user-agent'] || 'unknown'
            }
        };

        const result = await db.collection('demande_restau').insertOne(demandeDocument);

        console.log(`✅ Demande de partenariat créée: ${result.insertedId}`);

        return createResponse(201, {
            success: true,
            message: 'Demande de partenariat envoyée avec succès',
            demandeId: result.insertedId,
            numeroReference: result.insertedId.toString().substring(18),
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

async function finalizePartenariat(db, data) {
    try {
        console.log(`🤝 Finalisation partenariat restaurant: ${data.code}`);

        const { code } = data;

        if (!code) {
            return createResponse(400, {
                success: false,
                message: 'Code d\'autorisation requis'
            });
        }

        // Récupérer la demande autorisée
        const demande = await db.collection('demande_restau').findOne({
            codeAutorisation: code.toUpperCase(),
            statut: 'autorisee'
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Code non trouvé ou demande non autorisée'
            });
        }

        // Vérifier que le code n'est pas déjà utilisé
        const existingRestau = await db.collection('Restau').findOne({
            codeAutorisation: code.toUpperCase()
        });

        if (existingRestau) {
            return createResponse(409, {
                success: false,
                message: 'Ce code a déjà été utilisé'
            });
        }

        // Créer l'identifiant restaurant unique
        const restaurant_id = generateUniqueCode('restaurant', 8);

        // Transférer vers Restau
        const restaurantDocument = {
            _id: new ObjectId(),
            restaurant_id: restaurant_id,
            nom: demande.nom,
            nomCommercial: demande.nomCommercial,
            adresse: demande.adresse,
            quartier: demande.quartier,
            telephone: demande.telephone,
            email: demande.email,
            cuisine: demande.cuisine,
            specialites: demande.specialites,
            horaires: {
                ouverture: demande.heureOuverture,
                fermeture: demande.heureFermeture,
                details: demande.horairesDetails
            },
            responsable: {
                nom: demande.responsableNom,
                telephone: demande.responsableTel
            },
            description: demande.description,
            latitude: demande.coordinates.latitude,
            longitude: demande.coordinates.longitude,
            location: demande.location,
            signature: demande.signature,
            logo: demande.hasLogo ? { placeholder: true } : null,
            photos: demande.hasPhotos ? demande.photosInfo : [],
            menu: demande.hasMenu ? demande.menuInfo : [],
            codeAutorisation: code.toUpperCase(),
            statut: 'actif',
            dateCreation: new Date(),
            dateAutorisation: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
        };

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

        console.log(`✅ Restaurant ${restaurant_id} créé avec succès`);

        return createResponse(201, {
            success: true,
            message: 'Partenariat finalisé avec succès',
            restaurant: {
                restaurant_id: restaurant_id,
                nom: demande.nom,
                adresse: demande.adresse
            }
        });

    } catch (error) {
        console.error('❌ Erreur finalizePartenariat:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la finalisation du partenariat'
        });
    }
}

// ===== UTILITAIRES =====
function generateSimpleToken(userId, userType) {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2);
    return Buffer.from(`${userId}:${userType}:${timestamp}:${randomString}`).toString('base64');
}

// Export des fonctions pour les tests (optionnel)
module.exports = {
    handler: exports.handler,
    connectToMongoDB,
    generateUniqueCode,
    validateEmail
};