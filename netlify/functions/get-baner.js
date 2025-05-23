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
        // --- Vos messages à afficher dans la bannière ---
        const updateMessage = "Mise a jour du 23 mai 2025 !";
        const infoMessage = "Merci d’utiliser notre application. Ce service est le fruit de l’engagement d’un jeune entrepreneur burkinabè, à travers une initiative visant à promouvoir l’innovation locale et à créer des opportunités durables pour les populations du Burkina Faso. 🇧🇫\n\nNotre objectif est de vous offrir une solution fiable, accessible et conçue pour répondre aux besoins réels de notre communauté.\n\n🔹 Pour toute demande d'information, de partenariat ou de collaboration, veuillez nous contacter :\n- Téléphone : 56 66 36 38\n- WhatsApp : 61 22 97 66\n- Email : kaboreabwa2020@gmail.com\n\nNous vous remercions pour votre confiance et restons à votre disposition.\n\n© Tous droits réservés.";

        const downloadLink = "https://send20.netlify.app/"; // Votre lien de téléchargement
        const showBanner = true; // Définir à 'false' pour masquer la bannière dynamiquement

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify({
                updateMessage: updateMessage, // Le message lié à la mise à jour
                infoMessage: infoMessage,     // Le message d'information générale
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