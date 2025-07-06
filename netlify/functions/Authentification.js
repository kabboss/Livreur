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

function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify(body)
    };
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

// ===== FONCTIONS POUR LE SYSTÈME DE RECRUTEMENT =====

async function handleDemandeRecrutement(db, data, event) {
    try {
        console.log('👤 Nouvelle demande de recrutement livreur');

        // Validation des données requises
        const requiredFields = ['nom', 'prenom', 'whatsapp', 'quartier', 'vehicule', 'immatriculation'];
        const missingFields = requiredFields.filter(field => 
            !data[field] || data[field].toString().trim() === ''
        );
        
        if (missingFields.length > 0) {
            return createResponse(400, {
                success: false,
                message: `Champs obligatoires manquants: ${missingFields.join(', ')}`
            });
        }

        // Vérification du numéro WhatsApp
        const whatsapp = data.whatsapp.replace(/\D/g, '');
        if (whatsapp.length !== 8) {
            return createResponse(400, {
                success: false,
                message: 'Numéro WhatsApp invalide (doit contenir 8 chiffres)'
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

        // Vérification des documents obligatoires
        if (!data.documents?.photoIdentite || !data.documents?.documentVehicule) {
            return createResponse(400, {
                success: false,
                message: 'Les deux documents (photo et carte grise/permis) sont obligatoires'
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
                photoIdentite: data.documents.photoIdentite,
                documentVehicule: data.documents.documentVehicule
            },
            statut: 'en_attente',
            dateCreation: new Date(),
            dateTraitement: null,
            traiteePar: null,
            identifiantGenere: null,
            notificationEnvoyee: false,
            ip: event.headers['x-forwarded-for'] || 'unknown',
            metadata: {
                documentSizes: {
                    photoIdentite: data.documents.photoIdentite?.size || 0,
                    documentVehicule: data.documents.documentVehicule?.size || 0
                },
                totalSize: (data.documents.photoIdentite?.size || 0) + 
                          (data.documents.documentVehicule?.size || 0)
            }
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

        // Ajouter les documents
        if (demande.documents?.photoIdentite) {
            livreurDocument.photo = {
                name: 'photo_identite.jpg',
                type: 'image/jpeg',
                size: demande.metadata?.documentSizes?.photoIdentite || 0,
                data: demande.documents.photoIdentite.data
            };
        }

        if (demande.documents?.documentVehicule) {
            livreurDocument.documentVehicule = {
                name: 'document_vehicule.jpg',
                type: 'image/jpeg',
                size: demande.metadata?.documentSizes?.documentVehicule || 0,
                data: demande.documents.documentVehicule.data
            };
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

// ===== FONCTIONS D'AUTHENTIFICATION CLASSIQUES =====

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

function validateRegistrationData(data) {
    const { username, whatsapp, type, password, identificationCode } = data;

    if (!username || username.length < 3) {
        return 'Le nom d\'utilisateur doit comporter au moins 3 caractères';
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return 'Le nom d\'utilisateur ne peut contenir que des lettres, des chiffres et des tirets bas';
    }

    if (!whatsapp || !/^\+226\d{8}$/.test(whatsapp)) {
        return 'Numéro WhatsApp invalide. Format attendu: +226XXXXXXXX';
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
                { whatsapp: whatsapp }
            ]
        });

        if (existingAccount) {
            let message = 'Un compte existe déjà';
            if (existingAccount.id_livreur === livreur.id_livreur) {
                message = 'Un compte existe déjà pour ce livreur';
            } else if (existingAccount.username === username.toLowerCase().trim()) {
                message = 'Ce nom d\'utilisateur est déjà utilisé';
            } else if (existingAccount.whatsapp === whatsapp) {
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
            prenom: livreur.prenom || livreur['prénom'],
            whatsapp: whatsapp,
            secondNumber: secondNumber || null,
            telephone: livreur.telephone || livreur.téléphone,
            quartier: livreur.quartier,
            morceau: livreur.morceau,
            contact_urgence: livreur.contact_urgence,
            date_inscription: livreur.date_inscription || new Date(),
            statut: "actif",
            type_compte: "livreur",
            password: hashedPassword,
            photo: livreur.photo || null,
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

function generateSimpleToken(userId, userType) {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2);
    return Buffer.from(`${userId}:${userType}:${timestamp}:${randomString}`).toString('base64');
}