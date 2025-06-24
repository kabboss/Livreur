const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const MONGODB_URI = "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = "FarmsConnect";
const ADMIN_CODE = "ka23bo23re23";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return createResponse(405, { 
            success: false, 
            message: 'Method Not Allowed' 
        });
    }

    let client;
    
    try {
        const body = JSON.parse(event.body || '{}');
        const { action } = body;

        if (!action || !['register', 'login'].includes(action)) {
            return createResponse(400, { 
                success: false, 
                message: 'Invalid action specified' 
            });
        }

        client = new MongoClient(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            connectTimeoutMS: 5000,
            socketTimeoutMS: 30000
        });
        
        await client.connect();
        const db = client.db(DB_NAME);

        if (action === 'register') {
            return await handleRegistration(db, body);
        } else if (action === 'login') {
            return await handleLogin(db, body);
        }

    } catch (error) {
        console.error('Server error:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Internal Server Error',
            error: error.message
        });
    } finally {
        if (client) {
            try {
                await client.close();
            } catch (closeError) {
                console.error('MongoDB close error:', closeError);
            }
        }
    }
};

async function handleRegistration(db, data) {
    try {
        const { username, whatsapp, secondNumber, type, identificationCode, password } = data;
        
        // Validation des données
        if (!username || !whatsapp || !type || !password) {
            return createResponse(400, { 
                success: false, 
                message: 'Tous les champs requis doivent être remplis' 
            });
        }

        if (type === 'livreur') {
            // Vérification du code d'identification
            const cleanCode = identificationCode?.trim().toUpperCase();
            if (!cleanCode) {
                return createResponse(400, { 
                    success: false, 
                    message: 'Code d\'identification requis' 
                });
            }

            // Nettoie le code pour gérer les espaces
            const livreur = await db.collection('Res_livreur').findOne({
                $or: [
                    { id_livreur: cleanCode },
                    { morceau: cleanCode }
                ],
                statut: "actif"
            });

            if (!livreur) {
                return createResponse(404, { 
                    success: false, 
                    message: `Code d'identification invalide. Contactez-nous : 56 66 36 38 | 61 22 97 66 | kaboreabwa2020@gmail.com` 
                });
            }

            // Vérification des doublons
            const existing = await db.collection('compte_livreur').findOne({
                $or: [
                    { id_livreur: livreur.id_livreur },
                    { username: username.toLowerCase().trim() },
                    { whatsapp: cleanPhoneNumber(whatsapp) }
                ]
            });

            if (existing) {
                return createResponse(409, { 
                    success: false, 
                    message: 'Un compte existe déjà pour ces identifiants' 
                });
            }

            // Création du compte
            const hashedPassword = await bcrypt.hash(password, 12);
            const compte = {
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

            await db.collection('compte_livreur').insertOne(compte);
            return createResponse(201, { 
                success: true,
                message: 'Inscription réussie ! Redirection vers la connexion...' 
            });

        } else if (type === 'admin') {
            if (identificationCode !== ADMIN_CODE) {
                return createResponse(403, { 
                    success: false, 
                    message: 'Code administrateur invalide' 
                });
            }

            // Vérification des doublons admin
            const existing = await db.collection('compte_admin').findOne({
                username: username.toLowerCase().trim()
            });

            if (existing) {
                return createResponse(409, { 
                    success: false, 
                    message: 'Nom d\'utilisateur admin déjà utilisé' 
                });
            }

            // Création du compte admin
            const hashedPassword = await bcrypt.hash(password, 12);
            await db.collection('compte_admin').insertOne({
                username: username.toLowerCase().trim(),
                password: hashedPassword,
                role: "admin",
                permissions: ["full_access"],
                statut: "actif",
                derniere_connexion: null,
                created_at: new Date(),
                updated_at: new Date()
            });

            return createResponse(201, { 
                success: true,
                message: 'Compte admin créé avec succès' 
            });

        } else {
            return createResponse(400, { 
                success: false, 
                message: 'Type de compte invalide' 
            });
        }

    } catch (error) {
        console.error('Registration error:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de l\'inscription' 
        });
    }
}

async function handleLogin(db, data) {
    try {
        const { username, type, password } = data;

        if (!username || !type || !password) {
            return createResponse(400, { 
                success: false, 
                message: 'Tous les champs sont requis' 
            });
        }

        if (type === 'livreur') {
            return await loginDeliveryDriver(db, data);
        } else if (type === 'admin') {
            return await loginAdmin(db, data);
        } else {
            return createResponse(400, { 
                success: false, 
                message: 'Type de compte invalide' 
            });
        }

    } catch (error) {
        console.error('Login error:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur lors de la connexion' 
        });
    }
}

async function loginDeliveryDriver(db, data) {
    const { username, password } = data;

    const compte = await db.collection('compte_livreur').findOne({
        username: username.toLowerCase().trim(),
        statut: "actif"
    });

    if (!compte) {
        return createResponse(401, { 
            success: false, 
            message: 'Identifiants invalides' 
        });
    }

    const passwordValid = await bcrypt.compare(password, compte.password);
    if (!passwordValid) {
        return createResponse(401, { 
            success: false, 
            message: 'Identifiants invalides' 
        });
    }

    await db.collection('compte_livreur').updateOne(
        { _id: compte._id },
        { 
            $set: { 
                derniere_connexion: new Date(),
                updated_at: new Date()
            } 
        }
    );

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

    return createResponse(200, { 
        success: true,
        message: 'Connexion réussie',
        user: userData,
        token: generateSimpleToken(compte._id, 'livreur')
    });
}

async function loginAdmin(db, data) {
    const { username, password } = data;

    const compte = await db.collection('compte_admin').findOne({
        username: username.toLowerCase().trim(),
        statut: "actif"
    });

    if (!compte) {
        return createResponse(401, { 
            success: false, 
            message: 'Identifiants invalides' 
        });
    }

    const passwordValid = await bcrypt.compare(password, compte.password);
    if (!passwordValid) {
        return createResponse(401, { 
            success: false, 
            message: 'Identifiants invalides' 
        });
    }

    await db.collection('compte_admin').updateOne(
        { _id: compte._id },
        { 
            $set: { 
                derniere_connexion: new Date(),
                updated_at: new Date()
            } 
        }
    );

    const userData = {
        id: compte._id,
        username: compte.username,
        role: compte.role,
        permissions: compte.permissions,
        type_compte: 'admin',
        statut: compte.statut
    };

    return createResponse(200, { 
        success: true,
        message: 'Connexion admin réussie',
        user: userData,
        token: generateSimpleToken(compte._id, 'admin')
    });
}

function validateRegistrationData(data) {
    const { username, whatsapp, type, password, identificationCode } = data;

    if (!username || username.length < 3) {
        return 'Nom d\'utilisateur doit comporter au moins 3 caractères';
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return 'Le nom d\'utilisateur ne peut contenir que des lettres, des chiffres et des tirets bas';
    }

    if (!whatsapp || !isValidPhoneNumber(whatsapp)) {
        return 'Numéro WhatsApp invalide';
    }

    if (!type || !['livreur', 'admin'].includes(type)) {
        return 'Type de compte invalide';
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