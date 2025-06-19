const { MongoClient, ObjectId } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'Commandes';

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
const validateOrderData = (data) => {
    const errors = [];

    if (!data.clientName || typeof data.clientName !== 'string' || data.clientName.trim().length < 2) {
        errors.push('Nom client requis (minimum 2 caractères)');
    }

    if (!data.clientPhone || typeof data.clientPhone !== 'string' || !/^\+?[\d\s-()]{8,15}$/.test(data.clientPhone.trim())) {
        errors.push('Numéro de téléphone valide requis');
    }

    if (!data.item || !data.item.nom || !data.item.prix) {
        errors.push('Informations produit incomplètes');
    }

    if (!data.quantity || !Number.isInteger(data.quantity) || data.quantity < 1 || data.quantity > 50) {
        errors.push('Quantité doit être entre 1 et 50');
    }

    if (!data.position || typeof data.position.lat !== 'number' || typeof data.position.lng !== 'number') {
        errors.push('Position GPS requise');
    }

    if (!data.restaurantId || !ObjectId.isValid(data.restaurantId)) {
        errors.push('ID restaurant invalide');
    }

    return errors;
};

const sanitizeOrderData = (data) => {
    return {
        clientName: data.clientName.trim(),
        clientPhone: data.clientPhone.trim(),
        restaurantId: new ObjectId(data.restaurantId),
        restaurantName: data.restaurantName ? data.restaurantName.trim() : '',
        item: {
            id: data.item.id,
            nom: data.item.nom.trim(),
            description: data.item.description ? data.item.description.trim() : '',
            prix: parseFloat(data.item.prix)
        },
        quantity: parseInt(data.quantity),
        specialNotes: data.specialNotes ? data.specialNotes.trim() : '',
        position: {
            lat: parseFloat(data.position.lat),
            lng: parseFloat(data.position.lng)
        },
        totalPrice: parseFloat(data.item.prix) * parseInt(data.quantity),
        orderDate: new Date(),
        status: 'en attente',
        serviceType: 'food',
        metadata: {
            userAgent: data.userAgent || '',
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
        let orderData;
        try {
            orderData = JSON.parse(event.body);
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

        // Validate order data
        const validationErrors = validateOrderData(orderData);
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
        const sanitizedOrder = sanitizeOrderData(orderData);

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
            collection.createIndex({ clientPhone: 1 })
        ]);

        // Insert order with transaction for data integrity
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
            orderNumber: `ORD-${Date.now()}-${result.insertedId.toString().slice(-6).toUpperCase()}`,
            estimatedDelivery: new Date(Date.now() + 45 * 60 * 1000).toISOString(), // 45 minutes
            totalAmount: sanitizedOrder.totalPrice,
            message: 'Commande créée avec succès'
        };

        return {
            statusCode: 201,
            headers: CORS_HEADERS,
            body: JSON.stringify(orderConfirmation)
        };

    } catch (error) {
        console.error('Order creation error:', error);

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
                error: 'Order Creation Failed',
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