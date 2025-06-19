const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'shopping_orders';

const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
    retryWrites: true
});

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

// Input validation functions
const validateShoppingData = (data) => {
    const errors = [];

    if (!data.shoppingList || typeof data.shoppingList !== 'string' || data.shoppingList.trim().length < 10) {
        errors.push('Liste de courses requise (minimum 10 caractères)');
    }

    if (!data.phone1 || typeof data.phone1 !== 'string' || !/^\+?[\d\s-()]{8,15}$/.test(data.phone1.trim())) {
        errors.push('Numéro de téléphone principal valide requis');
    }

    if (data.phone2 && !/^\+?[\d\s-()]{8,15}$/.test(data.phone2.trim())) {
        errors.push('Numéro de téléphone secondaire invalide');
    }

    if (data.budgetMin && (!Number.isFinite(parseFloat(data.budgetMin)) || parseFloat(data.budgetMin) < 0)) {
        errors.push('Budget minimum doit être un nombre positif');
    }

    if (data.budgetMax && (!Number.isFinite(parseFloat(data.budgetMax)) || parseFloat(data.budgetMax) < 0)) {
        errors.push('Budget maximum doit être un nombre positif');
    }

    if (data.budgetMin && data.budgetMax && parseFloat(data.budgetMin) > parseFloat(data.budgetMax)) {
        errors.push('Budget minimum ne peut pas être supérieur au budget maximum');
    }

    if (!data.clientPosition || typeof data.clientPosition.lat !== 'number' || typeof data.clientPosition.lng !== 'number') {
        errors.push('Position GPS requise');
    }

    return errors;
};

const sanitizeShoppingData = (data) => {
    return {
        serviceType: 'shopping',
        shoppingList: data.shoppingList.trim(),
        budgetMin: data.budgetMin ? parseFloat(data.budgetMin) : null,
        budgetMax: data.budgetMax ? parseFloat(data.budgetMax) : null,
        specialInstructions: data.specialInstructions ? data.specialInstructions.trim() : '',
        deliveryTime: data.deliveryTime ? data.deliveryTime.trim() : null,
        phone1: data.phone1.trim(),
        phone2: data.phone2 ? data.phone2.trim() : '',
        deliveryFee: 1000,
        clientPosition: {
            lat: parseFloat(data.clientPosition.lat),
            lng: parseFloat(data.clientPosition.lng)
        },
        orderDate: new Date(),
        status: 'en attente',
        priority: 'normal',
        metadata: {
            estimatedItems: data.shoppingList.split('\n').filter(line => line.trim()).length,
            hasBudgetRange: !!(data.budgetMin || data.budgetMax),
            hasSpecialInstructions: !!data.specialInstructions,
            hasPreferredTime: !!data.deliveryTime,
            timestamp: Date.now()
        }
    };
};

exports.handler = async (event, context) => {
    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: ''
        };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: CORS_HEADERS,
            body: JSON.stringify({ 
                error: 'Method Not Allowed',
                message: 'Only POST requests are allowed'
            })
        };
    }

    let connection = null;

    try {
        // Parse and validate request body
        let shoppingData;
        try {
            shoppingData = JSON.parse(event.body);
        } catch (parseError) {
            return {
                statusCode: 400,
                headers: CORS_HEADERS,
                body: JSON.stringify({
                    error: 'Invalid JSON',
                    message: 'Request body must be valid JSON'
                })
            };
        }

        // Validate shopping data
        const validationErrors = validateShoppingData(shoppingData);
        if (validationErrors.length > 0) {
            return {
                statusCode: 400,
                headers: CORS_HEADERS,
                body: JSON.stringify({
                    error: 'Validation Error',
                    message: 'Données de commande invalides',
                    details: validationErrors
                })
            };
        }

        // Sanitize data
        const sanitizedOrder = sanitizeShoppingData(shoppingData);

        // Connect to MongoDB
        connection = await Promise.race([
            client.connect(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Connection timeout')), 8000)
            )
        ]);

        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);

        // Create indexes for better performance
        await Promise.all([
            collection.createIndex({ orderDate: -1 }),
            collection.createIndex({ status: 1 }),
            collection.createIndex({ phone1: 1 }),
            collection.createIndex({ 'clientPosition.lat': 1, 'clientPosition.lng': 1 })
        ]);

        // Insert order with transaction
        const session = client.startSession();
        let result;

        try {
            await session.withTransaction(async () => {
                result = await collection.insertOne(sanitizedOrder, { session });
            });
        } finally {
            await session.endSession();
        }

        // Generate order confirmation
        const orderConfirmation = {
            success: true,
            orderId: result.insertedId,
            orderNumber: `SHOP-${Date.now()}-${result.insertedId.toString().slice(-6).toUpperCase()}`,
            estimatedCompletionTime: sanitizedOrder.deliveryTime || 
                new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours default
            deliveryFee: sanitizedOrder.deliveryFee,
            budgetRange: sanitizedOrder.budgetMin || sanitizedOrder.budgetMax ? {
                min: sanitizedOrder.budgetMin,
                max: sanitizedOrder.budgetMax
            } : null,
            message: 'Demande de courses enregistrée avec succès. Notre coursier vous contactera bientôt.',
            nextSteps: [
                'Notre équipe analysera votre liste',
                'Vous recevrez un appel pour confirmer les prix',
                'Préparation et livraison de vos courses',
                'Paiement à la livraison (courses + 1000 FCFA de frais)'
            ]
        };

        return {
            statusCode: 201,
            headers: CORS_HEADERS,
            body: JSON.stringify(orderConfirmation)
        };

    } catch (error) {
        console.error('Shopping order creation error:', error);

        // Determine error type and appropriate response
        let statusCode = 500;
        let errorMessage = 'Erreur interne du serveur';

        if (error.name === 'MongoNetworkError' || error.message.includes('timeout')) {
            statusCode = 503;
            errorMessage = 'Service temporairement indisponible';
        } else if (error.name === 'MongoWriteError') {
            statusCode = 409;
            errorMessage = 'Conflit lors de la création de la commande';
        }

        return {
            statusCode,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                error: 'Shopping Order Creation Failed',
                message: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };

    } finally {
        // Ensure connection is closed
        if (connection) {
            try {
                await client.close();
            } catch (closeError) {
                console.error('Error closing connection:', closeError);
            }
        }
    }
};