const { MongoClient } = require('mongodb');

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTION_NAME = 'pharmacy_orders';

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
const validatePharmacyData = (data) => {
    const errors = [];

    if (!Array.isArray(data.medicaments) || data.medicaments.length === 0) {
        errors.push('Au moins un médicament requis');
    }

    if (data.medicaments && data.medicaments.length > 20) {
        errors.push('Maximum 20 médicaments par commande');
    }

    // Validate each medicament
    data.medicaments?.forEach((med, index) => {
        if (!med.name || typeof med.name !== 'string' || med.name.trim().length < 2) {
            errors.push(`Nom du médicament ${index + 1} requis (minimum 2 caractères)`);
        }
        
        if (!med.quantity || !Number.isInteger(med.quantity) || med.quantity < 1 || med.quantity > 100) {
            errors.push(`Quantité du médicament ${index + 1} doit être entre 1 et 100`);
        }
    });

    if (!data.phoneNumber || typeof data.phoneNumber !== 'string' || !/^\+?[\d\s-()]{8,15}$/.test(data.phoneNumber.trim())) {
        errors.push('Numéro de téléphone principal valide requis');
    }

    if (data.secondaryPhone && !/^\+?[\d\s-()]{8,15}$/.test(data.secondaryPhone.trim())) {
        errors.push('Numéro de téléphone secondaire invalide');
    }

    if (!data.clientPosition || typeof data.clientPosition.lat !== 'number' || typeof data.clientPosition.lng !== 'number') {
        errors.push('Position GPS requise');
    }

    return errors;
};

const sanitizePharmacyData = (data) => {
    return {
        serviceType: 'pharmacy',
        medicaments: data.medicaments.map((med, index) => ({
            id: `med_${index + 1}_${Date.now()}`,
            name: med.name.trim(),
            quantity: parseInt(med.quantity),
            status: 'pending_price_confirmation',
            estimatedPrice: null,
            confirmedPrice: null
        })),
        notes: data.notes ? data.notes.trim() : '',
        phoneNumber: data.phoneNumber.trim(),
        secondaryPhone: data.secondaryPhone ? data.secondaryPhone.trim() : '',
        clientPosition: {
            lat: parseFloat(data.clientPosition.lat),
            lng: parseFloat(data.clientPosition.lng)
        },
        deliveryFee: 1000,
        orderDate: new Date(),
        status: 'en attente',
        priority: 'high', // Pharmacy orders are high priority
        priceConfirmationStatus: 'pending',
        deliveryStatus: 'not_started',
        metadata: {
            totalMedicaments: data.medicaments.length,
            hasNotes: !!data.notes,
            hasSecondaryPhone: !!data.secondaryPhone,
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
        let pharmacyData;
        try {
            pharmacyData = JSON.parse(event.body);
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

        // Validate pharmacy data
        const validationErrors = validatePharmacyData(pharmacyData);
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
        const sanitizedOrder = sanitizePharmacyData(pharmacyData);

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
            collection.createIndex({ priority: 1 }),
            collection.createIndex({ phoneNumber: 1 }),
            collection.createIndex({ priceConfirmationStatus: 1 }),
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
            orderNumber: `PHARMA-${Date.now()}-${result.insertedId.toString().slice(-6).toUpperCase()}`,
            estimatedCallTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 minutes
            deliveryFee: sanitizedOrder.deliveryFee,
            medicaments: sanitizedOrder.medicaments.map(med => ({
                name: med.name,
                quantity: med.quantity,
                status: med.status
            })),
            message: 'Commande pharmaceutique enregistrée avec succès. Notre pharmacien vous contactera rapidement.',
            urgentContact: sanitizedOrder.phoneNumber,
            nextSteps: [
                'Notre pharmacien analysera votre liste',
                'Vous recevrez un appel pour confirmer les prix et la disponibilité',
                'Préparation et vérification des médicaments',
                'Livraison express avec facture détaillée',
                'Paiement à la livraison (médicaments + 1000 FCFA de frais)'
            ],
            importantNotes: [
                '⚠️ Vérification des prix avant achat',
                '📞 Gardez votre téléphone accessible',
                '🏥 Service prioritaire pour médicaments urgents',
                '🆔 Pièce d\'identité éventuellement requise'
            ]
        };

        return {
            statusCode: 201,
            headers: CORS_HEADERS,
            body: JSON.stringify(orderConfirmation)
        };

    } catch (error) {
        console.error('Pharmacy order creation error:', error);

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
                error: 'Pharmacy Order Creation Failed',
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