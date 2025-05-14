const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

const uri = process.env.MONGODB_URI || 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const client = new MongoClient(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

exports.handler = async function (event, context) {
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
        "Access-Control-Allow-Headers": "Content-Type",
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
        let { whatsapp, secondNumber, type, password, confirmPassword, username, identificationCode } = data;

        // Normalisation des champs
        whatsapp = whatsapp.trim().replace(/\s+/g, '');
        secondNumber = secondNumber ? secondNumber.trim().replace(/\s+/g, '') : null;
        type = type.trim().toLowerCase();
        username = username.trim();
        identificationCode = identificationCode ? identificationCode.trim() : null;

        // Vérification des champs de base
        if (!whatsapp || !type || !password || !confirmPassword || !username) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: "Tous les champs marqués d'un * sont requis." }),
            };
        }

        if (password !== confirmPassword) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ message: "Le mot de passe et sa confirmation ne correspondent pas." }),
            };
        }

        await client.connect();
        const db = client.db("FarmsConnect");
        const usersCollection = db.collection("utilisateurs");
        const livreursCollection = db.collection("Res_livreur");

        const existingUser = await usersCollection.findOne({ $or: [{ whatsapp, type }, { username }] });
        if (existingUser) {
            return {
                statusCode: 409,
                headers,
                body: JSON.stringify({ message: "Un utilisateur avec ce numéro WhatsApp/type ou ce nom d'utilisateur existe déjà." }),
            };
        }

        let registrationAllowed = true;
        let registrationMessage = "Inscription réussie !";

        if (type === 'livreur') {
            if (!identificationCode) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ message: "Le code d'identification est requis pour l'inscription en tant que livreur." }),
                };
            }
            const livreurCode = await livreursCollection.findOne({ code: identificationCode });
            if (!livreurCode) {
                registrationAllowed = false;
                registrationMessage = 'Code d\'identification invalide. Veuillez contacter l\'entreprise au 56663638 ou 61229766 ou kaboreabwa2020@gmail.com pour suivre la procédure de recrutement.';
            }
        } else if (type === 'admin') {
            if (identificationCode !== 'ka23bo23re23') {
                registrationAllowed = false;
                registrationMessage = 'Code d\'administration invalide.';
            }
        }

        if (registrationAllowed) {
            const hashedPassword = await bcrypt.hash(password, 10);
            await usersCollection.insertOne({
                whatsapp,
                secondNumber,
                type,
                username,
                password: hashedPassword,
                createdAt: new Date(),
                ...(type === 'livreur' && { livreurCode: identificationCode }), // Enregistrer le code livreur
                ...(type === 'admin' && { adminCode: identificationCode }),   // Enregistrer le code admin (pour référence future)
            });

            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    "Content-Type": "application/json", // S'assurer que le Content-Type est correct pour la redirection côté client
                },
                body: JSON.stringify({ message: registrationMessage, redirect: "/login.html" }), // Ajouter une indication de redirection
            };
        } else {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ message: registrationMessage }),
            };
        }

    } catch (err) {
        console.error("Erreur serveur :", err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ message: "Erreur serveur : " + err.message }),
        };
    } finally {
        await client.close();
    }
};