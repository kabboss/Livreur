const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

const uri = process.env.MONGODB_URI || 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const client = new MongoClient(uri);

exports.handler = async function (event, context) {
    // Gestion des CORS
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
            },
            body: "",
        };
    }

    const headers = {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
    };

    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ message: "Méthode non autorisée" }),
        };
    }

    try {
        const data = JSON.parse(event.body);
        let { whatsapp, secondNumber, type, password, username, code } = data;

        // Validation des champs obligatoires
        if (!whatsapp || !type || !password || !username) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: "Tous les champs marqués d'un * sont requis." }),
            };
        }

        // Nettoyage des données
        whatsapp = whatsapp.trim().replace(/\s+/g, '');
        secondNumber = secondNumber ? secondNumber.trim().replace(/\s+/g, '') : null;
        username = username.trim();
        type = type.trim().toLowerCase();

        // Vérification du numéro WhatsApp
        if (!/^\d+$/.test(whatsapp)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: "Le numéro WhatsApp doit contenir uniquement des chiffres." }),
            };
        }

        await client.connect();
        const db = client.db("FarmsConnect");
        const usersCollection = db.collection("utilisateurs");
        const livreursCollection = db.collection("Res_livreur");

        // Vérifier si l'utilisateur existe déjà
        const existingUser = await usersCollection.findOne({ 
            $or: [
                { whatsapp },
                { username }
            ] 
        });

        if (existingUser) {
            return {
                statusCode: 409,
                headers,
                body: JSON.stringify({ 
                    message: existingUser.whatsapp === whatsapp 
                        ? "Ce numéro WhatsApp est déjà utilisé." 
                        : "Ce nom d'utilisateur est déjà pris."
                }),
            };
        }

        // Validation spécifique selon le type de compte
        let errorMessage = null;
        
        if (type === "livreur") {
            if (!code) {
                errorMessage = "Le code d'identification est requis pour les livreurs.";
            } else {
                const livreurCode = await livreursCollection.findOne({ code });
                if (!livreurCode) {
                    errorMessage = "Code livreur invalide. Contactez l'entreprise au 56663638 ou 61229766.";
                }
            }
        } 
        else if (type === "admin") {
            if (code !== "ka23bo23re23") {
                errorMessage = "Code administrateur invalide.";
            }
        }

        if (errorMessage) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ message: errorMessage }),
            };
        }

        // Hash du mot de passe
        const hashedPassword = await bcrypt.hash(password, 10);

        // Création de l'utilisateur
        const newUser = {
            whatsapp,
            secondNumber,
            username,
            type,
            password: hashedPassword,
            createdAt: new Date(),
            ...(code && { registrationCode: code }) // Stocker le code si fourni
        };

        await usersCollection.insertOne(newUser);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                message: "Inscription réussie!",
                redirect: "/Connection.html"
            }),
        };

    } catch (error) {
        console.error("Erreur:", error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: "Une erreur est survenue lors de l'inscription." }),
        };
    } finally {
        await client.close();
    }
};