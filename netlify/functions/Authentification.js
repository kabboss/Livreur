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
        const validationError = validateRegistrationData(data);
        if (validationError) {
            return createResponse(400, { 
                success: false, 
                message: validationError 
            });
        }

        const { type } = data;
        if (type === 'livreur') {
            return await registerDeliveryDriver(db, data);
        } else if (type === 'admin') {
            return await registerAdmin(db, data);
        } else {
            return createResponse(400, { 
                success: false, 
                message: 'Invalid account type' 
            });
        }

    } catch (error) {
        console.error('Registration error:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Error during registration' 
        });
    }
}

async function registerDeliveryDriver(db, data) {
    const { username, whatsapp, secondNumber, identificationCode, password } = data;

    // Nettoyer et normaliser le code
    const cleanCode = identificationCode.trim().toUpperCase();
    
    console.log('Recherche livreur avec code:', cleanCode); // Log pour débogage

    const livreur = await db.collection('Res_livreur').findOne({
        $or: [
            { id_livreur: cleanCode },
            { morceau: cleanCode }
        ],
        statut: "actif"
    });

    console.log('Résultat recherche:', livreur); // Log pour débogage

    if (!livreur) {
        return createResponse(404, { 
            success: false, 
            message: `Code d'identification invalide ou compte inactif. Code utilisé: ${cleanCode}` 
        });
    }

    const existingAccount = await db.collection('compte_livreur').findOne({
        $or: [
            { id_livreur: livreur.id_livreur },
            { whatsapp: cleanPhoneNumber(whatsapp) },
            { username: username.toLowerCase().trim() }
        ]
    });

    if (existingAccount) {
        let conflictMessage = 'An account already exists for ';
        if (existingAccount.id_livreur === livreur.id_livreur) {
            conflictMessage += 'this driver';
        } else if (existingAccount.whatsapp === cleanPhoneNumber(whatsapp)) {
            conflictMessage += 'this WhatsApp number';
        } else {
            conflictMessage += 'this username';
        }
        
        return createResponse(409, { 
            success: false, 
            message: conflictMessage 
        });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const nouveauCompte = {
        id_livreur: livreur.id_livreur,
        username: username.toLowerCase().trim(),
        nom: livreur.nom,
        prenom: livreur.prénom || livreur.prenom,
        whatsapp: cleanPhoneNumber(whatsapp),
        secondNumber: secondNumber ? cleanPhoneNumber(secondNumber) : null,
        telephone: livreur.téléphone || livreur.telephone,
        quartier: livreur.quartier,
        morceau: livreur.morceau,
        contact_urgence: livreur.contact_urgence,
        date_inscription: new Date(),
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

    const result = await db.collection('compte_livreur').insertOne(nouveauCompte);

    await logActivity(db, {
        type: 'registration',
        user_type: 'livreur',
        user_id: result.insertedId,
        details: {
            id_livreur: nouveauCompte.id_livreur,
            username: nouveauCompte.username
        }
    });

    return createResponse(201, { 
        success: true,
        message: 'Delivery driver account created successfully',
        data: {
            id: result.insertedId,
            id_livreur: nouveauCompte.id_livreur,
            username: nouveauCompte.username,
            nom: nouveauCompte.nom,
            prenom: nouveauCompte.prenom
        }
    });
}

async function registerAdmin(db, data) {
    const { username, identificationCode, password } = data;

    if (!identificationCode || identificationCode !== ADMIN_CODE) {
        return createResponse(403, { 
            success: false, 
            message: 'Invalid administrator code' 
        });
    }

    const existingAdmin = await db.collection('compte_admin').findOne({
        username: username.toLowerCase().trim()
    });

    if (existingAdmin) {
        return createResponse(409, { 
            success: false, 
            message: 'Admin username already exists' 
        });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const nouvelAdmin = {
        username: username.toLowerCase().trim(),
        password: hashedPassword,
        role: "admin",
        permissions: ["full_access"],
        statut: "actif",
        derniere_connexion: null,
        created_at: new Date(),
        updated_at: new Date()
    };

    const result = await db.collection('compte_admin').insertOne(nouvelAdmin);

    await logActivity(db, {
        type: 'registration',
        user_type: 'admin',
        user_id: result.insertedId,
        details: {
            username: nouvelAdmin.username
        }
    });

    return createResponse(201, { 
        success: true,
        message: 'Admin account created successfully',
        data: {
            id: result.insertedId,
            username: nouvelAdmin.username,
            role: nouvelAdmin.role
        }
    });
}

async function handleLogin(db, data) {
    try {
        const { username, type, password } = data;

        if (!username || !type || !password) {
            return createResponse(400, { 
                success: false, 
                message: 'All fields are required' 
            });
        }

        if (type === 'livreur') {
            return await loginDeliveryDriver(db, data);
        } else if (type === 'admin') {
            return await loginAdmin(db, data);
        } else {
            return createResponse(400, { 
                success: false, 
                message: 'Invalid account type' 
            });
        }

    } catch (error) {
        console.error('Login error:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Error during login' 
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
            message: 'Invalid credentials' 
        });
    }

    const passwordValid = await bcrypt.compare(password, compte.password);
    if (!passwordValid) {
        return createResponse(401, { 
            success: false, 
            message: 'Invalid credentials' 
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

    await logActivity(db, {
        type: 'login',
        user_type: 'livreur',
        user_id: compte._id,
        details: {
            id_livreur: compte.id_livreur,
            username: compte.username
        }
    });

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
        message: 'Login successful',
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
            message: 'Invalid credentials' 
        });
    }

    const passwordValid = await bcrypt.compare(password, compte.password);
    if (!passwordValid) {
        return createResponse(401, { 
            success: false, 
            message: 'Invalid credentials' 
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

    await logActivity(db, {
        type: 'login',
        user_type: 'admin',
        user_id: compte._id,
        details: {
            username: compte.username
        }
    });

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
        message: 'Admin login successful',
        user: userData,
        token: generateSimpleToken(compte._id, 'admin')
    });
}

function validateRegistrationData(data) {
    const { username, whatsapp, type, password, identificationCode } = data;

    if (!username || username.length < 3) {
        return 'Username must be at least 3 characters';
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return 'Username can only contain letters, numbers and underscores';
    }

    if (!whatsapp || !isValidPhoneNumber(whatsapp)) {
        return 'Invalid WhatsApp number';
    }

    if (!type || !['livreur', 'admin'].includes(type)) {
        return 'Invalid account type';
    }

    if (!password || password.length < 8) {
        return 'Password must be at least 8 characters';
    }

    if ((type === 'livreur' || type === 'admin') && !identificationCode) {
        return 'Identification code required';
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

async function logActivity(db, activity) {
    try {
        const logEntry = {
            ...activity,
            timestamp: new Date(),
            ip_address: null,
            user_agent: null
        };
        
        await db.collection('activity_logs').insertOne(logEntry);
    } catch (error) {
        console.error('Activity log error:', error);
    }
}

function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: corsHeaders,
        body: JSON.stringify(body)
    };
}