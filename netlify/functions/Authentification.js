const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

// Configuration MongoDB
const MONGODB_URI = "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = "FarmsConnect";

// Configuration CORS: Allowing all origins for demonstration/development purposes.
// BE AWARE OF SECURITY IMPLICATIONS IN PRODUCTION ENVIRONMENTS.
const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Allows all origins
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', // Added GET as a common method
    'Content-Type': 'application/json'
};

// Secured administrator code
const ADMIN_CODE = "ka23bo23re23";

/**
 * Main serverless function to handle authentication
 */
exports.handler = async (event, context) => {
    // Handle CORS preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    // Ensure only POST requests are allowed for main operations
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
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

/**
 * Handles user registration
 */
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

/**
 * Registers a delivery driver
 */
async function registerDeliveryDriver(db, data) {
    const { username, whatsapp, secondNumber, identificationCode, password } = data;

    try {
        const livreur = await db.collection('Res_livreur').findOne({
            $or: [
                { id_livreur: identificationCode },
                { morceau: identificationCode }
            ],
            statut: "actif"
        });

        if (!livreur) {
            return createResponse(404, { 
                success: false, 
                message: 'Invalid identification code or inactive driver. Please contact your supervisor.' 
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
            message: 'Delivery driver account created successfully! You can now log in.',
            data: {
                id: result.insertedId,
                id_livreur: nouveauCompte.id_livreur,
                username: nouveauCompte.username,
                nom: nouveauCompte.nom,
                prenom: nouveauCompte.prenom
            }
        });

    } catch (error) {
        console.error('Delivery driver registration error:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Error creating delivery driver account' 
        });
    }
}

/**
 * Registers an administrator
 */
async function registerAdmin(db, data) {
    const { username, identificationCode, password } = data;

    try {
        if (!identificationCode || identificationCode !== ADMIN_CODE) {
            return createResponse(403, { 
                success: false, 
                message: 'Invalid administrator code. Please contact your supervisor.' 
            });
        }

        const existingAdmin = await db.collection('compte_admin').findOne({
            username: username.toLowerCase().trim()
        });

        if (existingAdmin) {
            return createResponse(409, { 
                success: false, 
                message: 'An administrator account with this username already exists' 
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
            message: 'Administrator account created successfully! You can now log in.',
            data: {
                id: result.insertedId,
                username: nouvelAdmin.username,
                role: nouvelAdmin.role
            }
        });

    } catch (error) {
        console.error('Admin registration error:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Error creating administrator account' 
        });
    }
}

/**
 * Handles user login
 */
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

/**
 * Logs in a delivery driver
 */
async function loginDeliveryDriver(db, data) {
    const { username, password } = data;

    try {
        const compte = await db.collection('compte_livreur').findOne({
            username: username.toLowerCase().trim(),
            statut: "actif"
        });

        if (!compte) {
            return createResponse(401, { 
                success: false, 
                message: 'Incorrect username or inactive account' 
            });
        }

        const passwordValid = await bcrypt.compare(password, compte.password);
        if (!passwordValid) {
            return createResponse(401, { 
                success: false, 
                message: 'Incorrect password' 
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
            message: 'Login successful! Welcome ' + compte.prenom,
            user: userData,
            token: generateSimpleToken(compte._id, 'livreur')
        });

    } catch (error) {
        console.error('Delivery driver login error:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Error during delivery driver login' 
        });
    }
}

/**
 * Logs in an administrator
 */
async function loginAdmin(db, data) {
    const { username, password } = data;

    try {
        const compte = await db.collection('compte_admin').findOne({
            username: username.toLowerCase().trim(),
            statut: "actif"
        });

        if (!compte) {
            return createResponse(401, { 
                success: false, 
                message: 'Incorrect username or inactive account' 
            });
        }

        const passwordValid = await bcrypt.compare(password, compte.password);
        if (!passwordValid) {
            return createResponse(401, { 
                success: false, 
                message: 'Incorrect password' 
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
            message: 'Administrator login successful! Welcome',
            user: userData,
            token: generateSimpleToken(compte._id, 'admin')
        });

    } catch (error) {
        console.error('Admin login error:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Error during administrator login' 
        });
    }
}

/**
 * Validates registration data
 */
function validateRegistrationData(data) {
    const { username, whatsapp, type, password, identificationCode } = data;

    if (!username || username.length < 3) {
        return 'Username must be at least 3 characters long';
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return 'Username can only contain letters, numbers, and underscores';
    }

    if (!whatsapp || !isValidPhoneNumber(whatsapp)) {
        return 'Invalid WhatsApp number (format: +226XXXXXXXX or 0XXXXXXXX)';
    }

    if (!type || !['livreur', 'admin'].includes(type)) {
        return 'Invalid account type';
    }

    if (!password || password.length < 8) {
        return 'Password must be at least 8 characters long';
    }

    if ((type === 'livreur' || type === 'admin') && !identificationCode) {
        return 'Identification code is required for this account type';
    }

    return null;
}

/**
 * Validates phone number format
 */
function isValidPhoneNumber(phone) {
    const cleanPhone = phone.replace(/\s/g, '');
    return /^(\+226|0)[0-9]{8}$/.test(cleanPhone);
}

/**
 * Cleans phone number by removing spaces
 */
function cleanPhoneNumber(phone) {
    return phone ? phone.replace(/\s/g, '') : null;
}

/**
 * Generates a simple token (for demonstration, use JWT in production)
 */
function generateSimpleToken(userId, userType) {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2);
    return Buffer.from(`${userId}:${userType}:${timestamp}:${randomString}`).toString('base64');
}

/**
 * Logs activity to the database
 */
async function logActivity(db, activity) {
    try {
        const logEntry = {
            ...activity,
            timestamp: new Date(),
            ip_address: null, // Can be added from the event object
            user_agent: null  // Can be added from the event object
        };
        
        await db.collection('activity_logs').insertOne(logEntry);
    } catch (error) {
        console.error('Activity log error:', error);
        // Do not fail the main request due to a logging issue
    }
}

/**
 * Creates a standardized response object with CORS headers
 */
function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: corsHeaders, // Apply CORS headers to all responses
        body: JSON.stringify(body)
    };
}