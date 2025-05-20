// netlify/functions/update-message.js
exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: headers
        };
    }

    try {
        const message = "Une mise à jour importante est disponible !"; // Message plus court
        const downloadLink = "https://send20.netlify.app/";
        const showBanner = true; // Définir à 'false' pour masquer la bannière dynamiquement

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                message: message,
                downloadLink: downloadLink,
                showBanner: showBanner
            }),
        };
    } catch (error) {
        console.error("Erreur lors de la récupération du message de mise à jour :", error);
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ error: "Échec de la récupération du message de mise à jour." }),
        };
    }
};