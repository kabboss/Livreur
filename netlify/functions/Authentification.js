const { MongoClient } = require('mongodb');
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

// Function principale
exports.handler = async (event, context) => {
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

    let client;
    
    try {
        // Parse du body de la requête
        const body = JSON.parse(event.body || '{}');
        const { action } = body;

        // Validation de l'action
        if (!action || !['register', 'login'].includes(action)) {
            return createResponse(400, { 
                success: false, 
                message: 'Action invalide. Utilisez "register" ou "login"' 
            });
        }

        // Connexion à MongoDB
        client = new MongoClient(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            family: 4
        });
        
        await client.connect();
        console.log('Connexion MongoDB établie');
        
        const db = client.db(DB_NAME);

        // Router vers la fonction appropriée
        if (action === 'register') {
            return await handleRegistration(db, body);
        } else if (action === 'login') {
            return await handleLogin(db, body);
        }

    } catch (error) {
        console.error('Erreur serveur:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur interne du serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    } finally {
        // Fermeture de la connexion MongoDB
        if (client) {
            try {
                await client.close();
                console.log('Connexion MongoDB fermée');
            } catch (closeError) {
                console.error('Erreur fermeture MongoDB:', closeError);
            }
        }
    }
};

// Gestion de l'inscription
async function handleRegistration(db, data) {
    try {
        const { username, whatsapp, secondNumber, type, identificationCode, password } = data;
        
        console.log('Tentative d\'inscription:', { username, type, whatsapp });

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
        console.error('Erreur lors de l\'inscription:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de l\'inscription' 
        });
    }
}

// Inscription d'un livreur
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
                { id_livreur: cleanCode },
                { morceau: cleanCode }
            ],
            statut: "actif"
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

// Fonctions utilitaires
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