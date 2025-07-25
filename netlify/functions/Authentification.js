const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

// Configuration MongoDB
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

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

function generateUniqueCode(type, length = 8) {
    const prefix = type === 'livreur' ? 'LIV' : 'REST';
    const timestamp = Date.now().toString().slice(-4);
    const random = Math.random().toString(36).substring(2, length - 3).toUpperCase();
    return `${prefix}${timestamp}${random}`;
}

function generateSimpleToken(userId, userType) {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    return Buffer.from(`${userId}|${userType}|${timestamp}|${randomString}`).toString('base64');
}

function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Function principale
exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

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
            message: 'Méthode non autorisée' 
        });
    }

    let db;
    
    try {
        const body = JSON.parse(event.body || '{}');
        const { action } = body;

        console.log(`🚀 Action reçue: ${action}`);

        db = await connectToMongoDB();

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

        if (!username || !type || !password) {
            return createResponse(400, { 
                success: false, 
                message: 'Nom d\'utilisateur, type de compte et mot de passe requis' 
            });
        }

        if (type === 'livreur') {
            return await loginLivreur(db, data);
        } else if (type === 'admin') {
         return await loginAdmin(password); 

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
        const compte = await db.collection('compte_livreur').findOne({
            username: username.toLowerCase().trim(),
            statut: "actif"
        });

        if (!compte) {
            return createResponse(401, { 
                success: false, 
                message: 'Identifiants incorrects' 
            });
        }

        const passwordValid = await bcrypt.compare(password, compte.password);
        if (!passwordValid) {
            return createResponse(401, { 
                success: false, 
                message: 'Identifiants incorrects' 
            });
        }

        await db.collection('compte_livreur').updateOne(
            { _id: compte._id },
            { $set: { derniere_connexion: new Date() } }
        );

        const userData = {
            id: compte._id,
            id_livreur: compte.id_livreur,
            username: compte.username,
            nom: compte.nom,
            prenom: compte.prenom,
            whatsapp: compte.whatsapp,
            quartier: compte.quartier,
            type_compte: 'livreur'
        };

        return createResponse(200, { 
            success: true,
            message: 'Connexion réussie',
            user: userData,
            token: generateSimpleToken(compte._id, 'livreur')
        });

    } catch (error) {
        console.error('Erreur loginLivreur:', error);
        return createResponse(500, { 
            success: false, 
            message: 'Erreur serveur' 
        });
    }
}

async function loginAdmin(password) {
    const ADMIN_PASSWORD = "ka23bo23re23";
    
    if (password !== ADMIN_PASSWORD) {
        return createResponse(401, { 
            success: false, 
            message: 'Mot de passe administrateur incorrect' 
        });
    }

    return createResponse(200, { 
        success: true,
        message: 'Connexion admin réussie',
        user: {
            id: "admin-root",
            username: "admin",
            type_compte: "admin"
        },
        token: generateSimpleToken("admin-root", 'admin')
    });
}

// ===== SYSTÈME LIVREURS =====
async function handleDemandeRecrutement(db, data, event) {
    try {
        console.log('📝 Nouvelle demande de recrutement livreur');

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

        if (!/^[A-Za-zÀ-ÿ\s\-']{2,}$/.test(data.quartier.trim())) {
            return createResponse(400, {
                success: false,
                message: 'Nom de quartier invalide'
            });
        }

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

        if (type !== 'livreur') {
            return createResponse(400, {
                success: false,
                message: 'Type de demande invalide'
            });
        }

        const demande = await db.collection('demande_livreur').findOne({
            codeAutorisation: code.toUpperCase(),
            statut: 'approuvee'
        });

        if (!demande) {
            console.log('Demande non trouvée ou non approuvée pour le code:', code);
            return createResponse(404, {
                success: false,
                message: 'Code non trouvé ou demande non approuvée'
            });
        }

        console.log(`✅ Code ${code} vérifié avec succès`);

        return createResponse(200, {
            success: true,
            message: 'Code valide',
            demandeInfo: {
                nom: demande.nom,
                prenom: demande.prenom,
                whatsapp: demande.whatsapp,
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

        if (username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) {
            return createResponse(400, {
                success: false,
                message: 'Nom d\'utilisateur invalide (3+ caractères, lettres/chiffres/_)'
            });
        }

        const demande = await db.collection('demande_livreur').findOne({
            codeAutorisation: code.toUpperCase(),
            statut: 'approuvee'
        });

        if (!demande) {
            console.log('Demande non trouvée:', code);
            return createResponse(404, {
                success: false,
                message: 'Code non trouvé ou demande non approuvée'
            });
        }

        const existingLivreur = await db.collection('Res_livreur').findOne({
            codeAutorisation: code.toUpperCase()
        });

        if (existingLivreur) {
            return createResponse(409, {
                success: false,
                message: 'Ce code a déjà été utilisé'
            });
        }

        const existingUser = await db.collection('compte_livreur').findOne({
            username: username.toLowerCase().trim()
        });

        if (existingUser) {
            return createResponse(409, {
                success: false,
                message: 'Ce nom d\'utilisateur est déjà utilisé'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const id_livreur = generateUniqueCode('livreur', 8);

        const resLivreurDoc = {
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
            statut: 'actif',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const resLivreurResult = await db.collection('Res_livreur').insertOne(resLivreurDoc);

        const compteDoc = {
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
            created_at: new Date(),
            updated_at: new Date(),
            resLivreurId: resLivreurResult.insertedId
        };

        const compteResult = await db.collection('compte_livreur').insertOne(compteDoc);

        await db.collection('demande_livreur').updateOne(
            { _id: demande._id },
            {
                $set: {
                    statut: 'finalisee',
                    dateFinalization: new Date(),
                    resLivreurId: resLivreurResult.insertedId,
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
                username: username,
                nom: demande.nom,
                prenom: demande.prenom
            }
        });

    } catch (error) {
        console.error('❌ Erreur finalizeInscription:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la finalisation'
        });
    }
}

// ===== SYSTÈME RESTAURANTS AVEC PHOTOS DE PLATS CORRIGÉ =====
async function handleDemandePartenariat(db, data, event) {
    try {
        console.log('🏪 Nouvelle demande de partenariat restaurant avec menu et photos');
        
        const requiredFields = ['nom', 'telephone', 'adresse', 'location'];
        const missingFields = requiredFields.filter(field => !data[field] || (typeof data[field] === 'string' && data[field].trim() === ''));
        
        if (missingFields.length > 0) {
            return createResponse(400, {
                success: false,
                message: `Champs obligatoires manquants: ${missingFields.join(', ')}`,
                missingFields
            });
        }

        if (!data.location || !data.location.latitude || !data.location.longitude) {
            return createResponse(400, {
                success: false,
                message: 'Coordonnées GPS requises'
            });
        }

        if (!data.menu || !Array.isArray(data.menu) || data.menu.length === 0) {
            return createResponse(400, {
                success: false,
                message: 'Au moins un plat avec photo est requis dans le menu'
            });
        }

        // Vérification détaillée de chaque plat avec photo
        const platsInvalides = [];
        for (let i = 0; i < data.menu.length; i++) {
            const plat = data.menu[i];
            
            if (!plat.nom || !plat.nom.trim()) {
                platsInvalides.push(`Plat ${i + 1}: nom manquant`);
            }
            
            if (!plat.prix || isNaN(parseFloat(plat.prix))) {
                platsInvalides.push(`Plat ${i + 1}: prix invalide`);
            }
            
            if (!plat.photo || !plat.photo.base64) {
                platsInvalides.push(`Plat ${i + 1}: photo manquante`);
            }
        }

        if (platsInvalides.length > 0) {
            return createResponse(400, {
                success: false,
                message: 'Erreurs dans le menu',
                errors: platsInvalides
            });
        }

        const existingDemande = await db.collection('demande_restau').findOne({
            $or: [
                { telephone: data.telephone },
                { 
                    nom: data.nom.trim(),
                    adresse: data.adresse.trim()
                }
            ]
        });

        if (existingDemande) {
            return createResponse(409, {
                success: false,
                message: 'Une demande existe déjà avec ces informations'
            });
        }

        // Traitement du menu avec validation stricte des photos
        const processedMenu = [];
        for (let i = 0; i < data.menu.length; i++) {
            const plat = data.menu[i];
            
            try {
                // Validation de la photo base64
                if (!plat.photo.base64 || plat.photo.base64.length < 100) {
                    throw new Error(`Photo invalide pour le plat "${plat.nom}"`);
                }
                
                // Vérification que c'est bien du base64 valide
                const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
                if (!base64Regex.test(plat.photo.base64)) {
                    throw new Error(`Format base64 invalide pour le plat "${plat.nom}"`);
                }
                
                // Vérification de la taille (approximativement 2MB en base64)
                if (plat.photo.base64.length > 2.8 * 1024 * 1024) {
                    throw new Error(`Photo trop volumineuse pour le plat "${plat.nom}" (max 2MB)`);
                }

                const processedPlat = {
                    id: plat.id || `item_${Date.now()}_${i}`,
                    nom: plat.nom.trim(),
                    prix: parseInt(plat.prix) || 0,
                    description: plat.description?.trim() || ''
                };

                // Stockage sécurisé de la photo
                processedPlat.photo = {
                    name: plat.photo.name || `photo_${plat.nom.replace(/\s+/g, '_')}.jpg`,
                    type: plat.photo.type || 'image/jpeg',
                    size: plat.photo.size || Math.floor(plat.photo.base64.length * 0.75), // Estimation taille décodée
                    base64: plat.photo.base64 // Stockage direct du base64
                };

                processedMenu.push(processedPlat);
                
            } catch (error) {
                console.error(`Erreur traitement plat ${i + 1}:`, error.message);
                return createResponse(400, {
                    success: false,
                    message: error.message
                });
            }
        }

        const demandeDocument = {
            nom: data.nom.trim(),
            nomCommercial: data.nomCommercial?.trim() || '',
            telephone: data.telephone,
            email: data.email?.trim() || '',
            adresse: data.adresse.trim(),
            quartier: data.quartier?.trim() || '',
            cuisine: data.cuisine || '',
            specialites: data.specialites?.trim() || '',
            horairesDetails: data.horairesDetails?.trim() || '',
            responsableNom: data.responsableNom?.trim() || '',
            responsableTel: data.responsableTel || '',
            description: data.description?.trim() || '',
            location: {
                latitude: parseFloat(data.location.latitude),
                longitude: parseFloat(data.location.longitude),
                accuracy: parseFloat(data.location.accuracy) || 0
            },
            signature: data.signature || null,
            menu: processedMenu,
            statut: 'en_attente',
            codeAutorisation: null,
            dateCreation: new Date(),
            dateTraitement: null,
            traiteePar: null,
            ip: event.headers['x-forwarded-for'] || 'unknown',
            metadata: {
                hasSignature: !!data.signature,
                hasGPS: true,
                hasLogo: !!data.logo,
                hasPhotos: !!data.photos && data.photos.length > 0,
                photosCount: data.photos?.length || 0,
                menuItemsCount: processedMenu.length,
                menuItemsWithPhotos: processedMenu.filter(item => item.photo && item.photo.base64).length,
                userAgent: event.headers['user-agent'] || 'unknown'
            }
        };

        // Traitement du logo si fourni
        if (data.logo && data.logo.base64) {
            try {
                if (data.logo.base64.length > 2.8 * 1024 * 1024) {
                    throw new Error('Logo trop volumineux (max 2MB)');
                }
                
                demandeDocument.logo = {
                    name: data.logo.name || 'logo.jpg',
                    type: data.logo.type || 'image/jpeg',
                    size: data.logo.size || Math.floor(data.logo.base64.length * 0.75),
                    base64: data.logo.base64
                };
            } catch (error) {
                return createResponse(400, {
                    success: false,
                    message: error.message
                });
            }
        }

        // Traitement des photos du restaurant si fournies
        if (data.photos && data.photos.length > 0) {
            try {
                const processedPhotos = [];
                for (let i = 0; i < data.photos.length; i++) {
                    const photo = data.photos[i];
                    
                    if (!photo.base64 || photo.base64.length > 2.8 * 1024 * 1024) {
                        throw new Error(`Photo restaurant ${i + 1} invalide ou trop volumineuse`);
                    }
                    
                    processedPhotos.push({
                        name: photo.name || `photo_restaurant_${i + 1}.jpg`,
                        type: photo.type || 'image/jpeg',
                        size: photo.size || Math.floor(photo.base64.length * 0.75),
                        base64: photo.base64
                    });
                }
                demandeDocument.photos = processedPhotos;
            } catch (error) {
                return createResponse(400, {
                    success: false,
                    message: error.message
                });
            }
        }

        const result = await db.collection('demande_restau').insertOne(demandeDocument);

        console.log(`✅ Demande de partenariat créée avec ${processedMenu.length} plats: ${result.insertedId}`);

        return createResponse(201, {
            success: true,
            message: 'Demande de partenariat envoyée avec succès. Notre équipe vous contactera sous 24-48h.',
            demandeId: result.insertedId,
            menuItemsCount: processedMenu.length,
            menuItemsWithPhotos: processedMenu.filter(item => item.photo && item.photo.base64).length,
            nextStep: 'attente_validation'
        });

    } catch (error) {
        console.error('❌ Erreur handleDemandePartenariat:', error);
        return createResponse(500, {
            success: false,
            message: error.message || 'Erreur lors de l\'enregistrement de la demande'
        });
    }
}

async function finalizePartenariat(db, data) {
    try {
        console.log(`✅ Finalisation partenariat restaurant: ${data.code}`);

        const { code } = data;

        if (!code) {
            return createResponse(400, {
                success: false,
                message: 'Code d\'autorisation requis'
            });
        }

        const demande = await db.collection('demande_restau').findOne({
            codeAutorisation: code.toUpperCase(),
            statut: 'approuvee'
        });

        if (!demande) {
            console.log('Demande non trouvée ou non approuvée pour le code:', code);
            return createResponse(404, {
                success: false,
                message: 'Code non trouvé ou demande non approuvée'
            });
        }

        const existingRestaurant = await db.collection('Restau').findOne({
            codeAutorisation: code.toUpperCase()
        });

        if (existingRestaurant) {
            return createResponse(409, {
                success: false,
                message: 'Ce code a déjà été utilisé'
            });
        }

        const requiredFields = ['nom', 'telephone', 'adresse', 'location'];
        const missingFields = requiredFields.filter(field => !demande[field]);

        if (missingFields.length > 0) {
            return createResponse(400, {
                success: false,
                message: `Champs obligatoires manquants dans la demande: ${missingFields.join(', ')}`
            });
        }

        // Préparation du menu final avec validation des photos
        const finalMenu = [];
        
        if (!demande.menu || demande.menu.length === 0) {
            return createResponse(400, {
                success: false,
                message: 'Aucun plat trouvé dans la demande'
            });
        }

        for (let i = 0; i < demande.menu.length; i++) {
            const item = demande.menu[i];
            
            try {
                // Validation des données essentielles
                if (!item.nom || !item.prix) {
                    throw new Error(`Données manquantes pour le plat ${i + 1}`);
                }
                
                // Validation de la photo
                if (!item.photo || !item.photo.base64) {
                    throw new Error(`Photo manquante pour le plat "${item.nom}"`);
                }
                
                // Vérification de l'intégrité du base64
                const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
                if (!base64Regex.test(item.photo.base64)) {
                    throw new Error(`Format de photo invalide pour le plat "${item.nom}"`);
                }

                const menuItem = {
                    id: item.id || `menu_${Date.now()}_${i}`,
                    nom: item.nom.trim(),
                    prix: parseInt(item.prix) || 0,
                    description: item.description?.trim() || '',
                    photo: {
                        type: item.photo.type || 'image/jpeg',
                        name: item.photo.name || `photo_${item.nom.replace(/\s+/g, '_')}.jpg`,
                        size: item.photo.size || 0,
                        base64: item.photo.base64 // Stockage direct du base64 validé
                    },
                    disponible: true,
                    dateAjout: new Date(),
                    categorie: item.categorie || 'Principaux'
                };

                finalMenu.push(menuItem);
                
            } catch (error) {
                console.error(`Erreur validation plat ${i + 1}:`, error.message);
                return createResponse(400, {
                    success: false,
                    message: error.message
                });
            }
        }

        // Création du document restaurant final
        const restaurantDocument = {
            restaurantId: generateUniqueCode('restaurant', 8),
            nom: demande.nom.trim(),
            nomCommercial: demande.nomCommercial?.trim() || '',
            telephone: demande.telephone,
            email: demande.email?.trim() || '',
            adresse: demande.adresse.trim(),
            quartier: demande.quartier?.trim() || '',
            location: {
                latitude: parseFloat(demande.location.latitude),
                longitude: parseFloat(demande.location.longitude),
                accuracy: parseFloat(demande.location.accuracy) || 0
            },
            hasValidLocation: !!(demande.location && demande.location.latitude && demande.location.longitude),
            cuisine: demande.cuisine || '',
            specialites: demande.specialites?.trim() || '',
            horairesDetails: demande.horairesDetails?.trim() || '',
            responsableNom: demande.responsableNom?.trim() || '',
            responsableTel: demande.responsableTel || '',
            description: demande.description?.trim() || '',
            signature: demande.signature || null,
            menu: finalMenu,
            codeAutorisation: code.toUpperCase(),
            statut: 'actif',
            dateCreation: new Date(),
            dateAutorisation: new Date(),
            ouvert: true,
            note: 0,
            nombreCommandes: 0,
            metadata: {
                hasLogo: !!(demande.logo && demande.logo.base64),
                hasPhotos: !!(demande.photos && demande.photos.length > 0),
                photosCount: demande.photos ? demande.photos.length : 0,
                menuItemsCount: finalMenu.length,
                menuItemsWithPhotos: finalMenu.filter(item => item.photo && item.photo.base64).length
            }
        };

        // Ajout du logo si présent
        if (demande.logo && demande.logo.base64) {
            restaurantDocument.logo = {
                type: demande.logo.type || 'image/jpeg',
                name: demande.logo.name || 'logo.jpg',
                size: demande.logo.size || 0,
                base64: demande.logo.base64
            };
        }

        // Ajout des photos du restaurant si présentes
        if (demande.photos && demande.photos.length > 0) {
            restaurantDocument.photos = demande.photos.map((photo, index) => ({
                type: photo.type || 'image/jpeg',
                name: photo.name || `photo_restaurant_${index + 1}.jpg`,
                size: photo.size || 0,
                base64: photo.base64
            }));
        }

        // Insertion dans la base de données
        const restaurantResult = await db.collection('Restau').insertOne(restaurantDocument);

        // Mise à jour de la demande
        await db.collection('demande_restau').updateOne(
            { _id: demande._id },
            { 
                $set: { 
                    statut: 'finalisee',
                    dateFinalization: new Date(),
                    restaurantId: restaurantResult.insertedId
                } 
            }
        );

        console.log(`✅ Restaurant ${restaurantDocument.restaurantId} créé avec ${finalMenu.length} plats`);

        return createResponse(201, {
            success: true,
            message: 'Partenariat finalisé avec succès',
            restaurant: {
                restaurantId: restaurantDocument.restaurantId,
                nom: restaurantDocument.nom,
                telephone: restaurantDocument.telephone,
                menuItemsCount: finalMenu.length,
                menuItemsWithPhotos: finalMenu.filter(item => item.photo && item.photo.base64).length
            }
        });

    } catch (error) {
        console.error('❌ Erreur finalizePartenariat:', error);
        return createResponse(500, {
            success: false,
            message: 'Erreur lors de la finalisation du partenariat',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}