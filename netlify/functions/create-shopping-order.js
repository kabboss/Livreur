const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI; // Utiliser une variable d'environnement
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Courses';

const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000
});

const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
    try {
        // Gestion de la méthode OPTIONS pour CORS
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ message: 'Preflight request successful' })
            };
        }

        // Vérification de la méthode POST
        if (event.httpMethod !== 'POST') {
            return {
                statusCode: 405,
                headers: { ...COMMON_HEADERS, 'Allow': 'POST, OPTIONS' },
                body: JSON.stringify({ message: 'Méthode non autorisée' })
            };
        }

        // Connexion à MongoDB
        await client.connect();
        const db = client.db(DB_NAME);
        const coursesCollection = db.collection(COLLECTION_NAME);

        // Parsing du corps de la requête
        const body = JSON.parse(event.body);

        // Validation des données
        const {
            serviceType,
            shoppingList,
            budgetMin,
            budgetMax,
            specialInstructions,
            deliveryTime,
            deliveryFee,
            clientPosition,
            orderDate,
            status
        } = body;

        if (!shoppingList || !clientPosition || !clientPosition.lat || !clientPosition.lng) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ message: 'La liste de courses et la localisation du client sont obligatoires.' })
            };
        }

        // Création du nouvel objet Course
        const newCourse = {
            serviceType: serviceType || 'shopping',
            shoppingList: shoppingList,
            budgetMin: parseFloat(budgetMin) || 0,
            budgetMax: parseFloat(budgetMax) || 0,
            specialInstructions: specialInstructions || '',
            deliveryTime: deliveryTime || null,
            deliveryFee: parseFloat(deliveryFee) || 0,
            clientPosition: {
                type: 'Point',
                coordinates: [clientPosition.lng, clientPosition.lat] // MongoDB utilise [longitude, latitude]
            },
            orderDate: orderDate || new Date().toISOString(),
            status: status || 'en attente',
            createdAt: new Date()
        };

        // Insertion dans la base de données
        const result = await coursesCollection.insertOne(newCourse);

        if (result.insertedId) {
            return {
                statusCode: 201,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ message: 'Demande de courses enregistrée avec succès', orderId: result.insertedId })
            };
        } else {
            // Erreur spécifique lors de l'insertion
            return {
                statusCode: 500,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ message: 'Erreur: Échec de l\'insertion dans la base de données.' })
            };
        }

    } catch (error) {
        // Gestion globale des erreurs
        console.error('Erreur lors de l\'exécution de la fonction serverless:', error);
        let errorMessage = 'Erreur serveur inconnue.';
        let statusCode = 500;

        if (error instanceof SyntaxError) {
            statusCode = 400;
            errorMessage = 'Erreur: Données JSON invalides.';
        } else if (error instanceof Error && error.message.includes('E11000')) { // MongoDB Duplicate Key Error
            statusCode = 409; // Conflict
            errorMessage = 'Erreur: Cette demande de courses existe déjà.';
        } else if (error instanceof Error && error.message.includes('ENOTFOUND')) {
            statusCode = 503;  // Service Unavailable
            errorMessage = 'Erreur: Impossible de se connecter à la base de données.';
        }

        return {
            statusCode: statusCode,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ message: errorMessage, error: error.message })
        };
    } finally {
        // Fermeture de la connexion MongoDB
        try {
            if (client.isConnected()) {
                await client.close();
            }
        } catch (closeError) {
            console.error("Erreur lors de la fermeture de la connexion MongoDB:", closeError);
        }
    }
};