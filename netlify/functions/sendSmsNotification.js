// Nouvelle fonction pour gérer l'envoi de SMS (optionnel - pour intégration future)
const COMMON_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: COMMON_HEADERS, body: JSON.stringify({}) };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: COMMON_HEADERS,
            body: JSON.stringify({ error: 'Méthode non autorisée' })
        };
    }

    try {
        const { phoneNumber, message, type } = JSON.parse(event.body);

        if (!phoneNumber || !message) {
            return {
                statusCode: 400,
                headers: COMMON_HEADERS,
                body: JSON.stringify({
                    error: 'Numéro de téléphone et message requis'
                })
            };
        }

        // Ici vous pouvez intégrer un service SMS réel comme:
        // - Twilio
        // - AWS SNS
        // - Orange SMS API (pour l'Afrique)
        // - Etc.

        // Pour l'instant, nous simulons l'envoi
        console.log(`SMS à envoyer à ${phoneNumber}: ${message}`);

        // Simulation d'un délai d'envoi
        await new Promise(resolve => setTimeout(resolve, 1000));

        return {
            statusCode: 200,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                success: true,
                message: 'SMS envoyé avec succès',
                phoneNumber,
                type,
                sentAt: new Date().toISOString()
            })
        };

    } catch (error) {
        console.error('Erreur envoi SMS:', error);
        return {
            statusCode: 500,
            headers: COMMON_HEADERS,
            body: JSON.stringify({
                error: 'Erreur lors de l\'envoi du SMS',
                details: error.message
            })
        };
    }
};