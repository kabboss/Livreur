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

// Fonction pour générer un token simple
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
        // 1. Recherche du compte livreur
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

        // 2. Vérification du mot de passe
        const passwordValid = await bcrypt.compare(password, compte.password);
        if (!passwordValid) {
            return createResponse(401, { 
                success: false, 
                message: 'Identifiants incorrects' 
            });
        }

        // 3. Mise à jour de la dernière connexion
        await db.collection('compte_livreur').updateOne(
            { _id: compte._id },
            { $set: { derniere_connexion: new Date() } }
        );

        // 4. Préparation des données utilisateur
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

        // 5. Réponse avec token
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
    const ADMIN_PASSWORD = "ka23bo23re23"; // Votre mot de passe admin fixe
    
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

        // Vérifier que le type est bien 'livreur'
        if (type !== 'livreur') {
            return createResponse(400, {
                success: false,
                message: 'Type de demande invalide'
            });
        }

        // Vérifier que le code existe et est approuvé
        const demande = await db.collection('demande_livreur').findOne({
            codeAutorisation: code.toUpperCase(),
            statut: 'approuvee' // Notez que c'est 'approuvee' et non 'autorisee'
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

        // Validation du nom d'utilisateur
        if (username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) {
            return createResponse(400, {
                success: false,
                message: 'Nom d\'utilisateur invalide (3+ caractères, lettres/chiffres/_)'
            });
        }

        // Vérifier que la demande existe et est approuvée
        const demande = await db.collection('demande_livreur').findOne({
            codeAutorisation: code.toUpperCase(),
            statut: 'approuvee' // Changé de 'autorisee' à 'approuvee'
        });

        if (!demande) {
            console.log('Demande non trouvée:', code);
            return createResponse(404, {
                success: false,
                message: 'Code non trouvé ou demande non approuvée'
            });
        }

        // Vérifier si le code a déjà été utilisé
        const existingLivreur = await db.collection('Res_livreur').findOne({
            codeAutorisation: code.toUpperCase()
        });

        if (existingLivreur) {
            return createResponse(409, {
                success: false,
                message: 'Ce code a déjà été utilisé'
            });
        }

        // Vérifier l'unicité du username
        const existingUser = await db.collection('compte_livreur').findOne({
            username: username.toLowerCase().trim()
        });

        if (existingUser) {
            return createResponse(409, {
                success: false,
                message: 'Ce nom d\'utilisateur est déjà utilisé'
            });
        }

        // Hasher le mot de passe
        const hashedPassword = await bcrypt.hash(password, 12);

        // Générer un ID livreur unique
        const id_livreur = generateUniqueCode('livreur', 8);

        // Créer le document dans Res_livreur
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

        // Créer le compte de connexion
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

        // Mettre à jour la demande
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

// ===== SYSTÈME RESTAURANTS AVEC PHOTOS DE PLATS =====
async function handleDemandePartenariat(db, data, event) {
    try {
        console.log('🏪 Nouvelle demande de partenariat restaurant avec menu et photos');
        
        // Validation des champs requis
        const requiredFields = ['nom', 'telephone', 'adresse', 'location'];
        const missingFields = requiredFields.filter(field => !data[field] || (typeof data[field] === 'string' && data[field].trim() === ''));
        
        if (missingFields.length > 0) {
            return createResponse(400, {
                success: false,
                message: `Champs obligatoires manquants: ${missingFields.join(', ')}`,
                missingFields
            });
        }

        // Validation des coordonnées GPS
        if (!data.location || !data.location.latitude || !data.location.longitude) {
            return createResponse(400, {
                success: false,
                message: 'Coordonnées GPS requises'
            });
        }

        // Validation du menu avec photos
        if (!data.menu || !Array.isArray(data.menu) || data.menu.length === 0) {
            return createResponse(400, {
                success: false,
                message: 'Au moins un plat avec photo est requis dans le menu'
            });
        }

        // Vérifier que chaque plat a une photo
        const platsNonValides = data.menu.filter((plat, index) => {
            return !plat.nom || !plat.prix || !plat.photo || !plat.photo.base64;
        });

        if (platsNonValides.length > 0) {
            return createResponse(400, {
                success: false,
                message: 'Chaque plat doit avoir un nom, un prix et une photo'
            });
        }

        // Vérifier les doublons
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

        // Traiter les photos de plats avec validation
        const processedMenu = data.menu.map((plat, index) => {
            const processedPlat = {
                id: plat.id || `item_${Date.now()}_${index}`,
                nom: plat.nom.trim(),
                prix: parseInt(plat.prix),
                description: plat.description?.trim() || ''
            };

            // Traiter la photo du plat
            if (plat.photo && plat.photo.base64) {
                // Validation de la taille de l'image (max 2MB en base64)
                if (plat.photo.base64.length > 2.7 * 1024 * 1024) { // ~2MB en base64
                    throw new Error(`Photo du plat "${plat.nom}" trop volumineuse (max 2MB)`);
                }

                processedPlat.photo = {
                    name: plat.photo.name || `photo_${plat.nom.replace(/\s+/g, '_')}.jpg`,
                    type: plat.photo.type || 'image/jpeg',
                    size: plat.photo.size || 0,
                    data: plat.photo.base64 // Stockage des données de l'image
                };
            }

            return processedPlat;
        });

        // Créer la demande restaurant avec menu et photos
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
            location: data.location,
            signature: data.signature || null,
            menu: processedMenu, // Menu avec photos des plats
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
                hasPhotos: !!data.photos,
                photosCount: data.photos?.length || 0,
                menuItemsCount: processedMenu.length,
                menuItemsWithPhotos: processedMenu.filter(item => item.photo).length,
                userAgent: event.headers['user-agent'] || 'unknown'
            }
        };

        // Si logo est fourni
        if (data.logo && data.logo.base64) {
            demandeDocument.logo = {
                name: data.logo.name,
                type: data.logo.type,
                size: data.logo.size,
                data: data.logo.base64
            };
        }

        // Si photos du restaurant sont fournies
        if (data.photos && data.photos.length > 0) {
            demandeDocument.photos = data.photos.map(photo => ({
                name: photo.name,
                type: photo.type,
                size: photo.size,
                data: photo.base64
            }));
        }

        const result = await db.collection('demande_restau').insertOne(demandeDocument);

        console.log(`✅ Demande de partenariat créée avec ${processedMenu.length} plats: ${result.insertedId}`);

        return createResponse(201, {
            success: true,
            message: 'Demande de partenariat envoyée avec succès. Notre équipe vous contactera sous 24-48h.',
            demandeId: result.insertedId,
            menuItemsCount: processedMenu.length,
            menuItemsWithPhotos: processedMenu.filter(item => item.photo).length,
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

        // Vérifier que le code existe et est autorisé
        const demande = await db.collection('demande_restau').findOne({
            codeAutorisation: code.toUpperCase(),
            statut: 'approuvee'
        });

        if (!demande) {
            return createResponse(404, {
                success: false,
                message: 'Code non trouvé ou demande non autorisée'
            });
        }

        // Vérifier que le code n'a pas déjà été utilisé
        const existingRestaurant = await db.collection('Restau').findOne({
            codeAutorisation: code.toUpperCase()
        });

        if (existingRestaurant) {
            return createResponse(409, {
                success: false,
                message: 'Ce code a déjà été utilisé'
            });
        }

        // Générer un identifiant unique pour le restaurant
        const restaurantId = generateUniqueCode('restaurant', 8);

        // Préparer le menu avec photos pour la collection finale
        const finalMenu = demande.menu.map(item => ({
            id: item.id,
            nom: item.nom,
            prix: item.prix,
            description: item.description,
            photo: item.photo ? {
                type: item.photo.type,
                data: item.photo.data // Données de l'image directement stockées
            } : null,
            disponible: true,
            dateAjout: new Date()
        }));

        // Créer le document restaurant final
        const restaurantDocument = {
            restaurantId: restaurantId,
            nom: demande.nom,
            nomCommercial: demande.nomCommercial,
            telephone: demande.telephone,
            email: demande.email,
            adresse: demande.adresse,
            quartier: demande.quartier,
            location: demande.location,
            hasValidLocation: true,
            cuisine: demande.cuisine,
            specialites: demande.specialites,
            horairesDetails: demande.horairesDetails,
            responsableNom: demande.responsableNom,
            responsableTel: demande.responsableTel,
            description: demande.description,
            signature: demande.signature,
            menu: finalMenu, // Menu avec photos des plats
            codeAutorisation: code.toUpperCase(),
            statut: 'actif',
            dateCreation: new Date(),
            dateAutorisation: new Date(),
            ouvert: true,
            note: 0,
            nombreCommandes: 0,
            metadata: {
                hasLogo: demande.metadata.hasLogo,
                hasPhotos: demande.metadata.hasPhotos,
                photosCount: demande.metadata.photosCount,
                menuItemsCount: finalMenu.length,
                menuItemsWithPhotos: finalMenu.filter(item => item.photo).length
            }
        };

        // Si logo existe
        if (demande.logo) {
            restaurantDocument.logo = {
                type: demande.logo.type,
                data: demande.logo.data
            };
        }

        // Si photos du restaurant existent
        if (demande.photos && demande.photos.length > 0) {
            restaurantDocument.photos = demande.photos.map(photo => ({
                type: photo.type,
                data: photo.data
            }));
        }

        // Insérer dans la collection Restau
        const restaurantResult = await db.collection('Restau').insertOne(restaurantDocument);

        // Mettre à jour la demande comme finalisée
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

        console.log(`✅ Restaurant ${restaurantId} créé avec ${finalMenu.length} plats (${finalMenu.filter(item => item.photo).length} avec photos)`);

        return createResponse(201, {
            success: true,
            message: 'Partenariat finalisé avec succès',
            restaurant: {
                restaurantId: restaurantId,
                nom: demande.nom,
                telephone: demande.telephone,
                menuItemsCount: finalMenu.length,
                menuItemsWithPhotos: finalMenu.filter(item => item.photo).length
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