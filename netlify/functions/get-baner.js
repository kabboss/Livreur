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
        const updateMessage = "Veuillez cliquer sur télécharger pour une mise à jour de l'application si vous l'avez téléchargée avant le 20 mai 2025 !";
        const infoMessage = "Merci d'utiliser notre application ! Elle est le fruit du travail passionné d’un jeune Burkinabè, votre petit frère KABORÉ. Cette application a pour but de créer de vraies opportunités pour de nombreuses personnes, ici même au Burkina Faso. 💡🇧🇫\n\nSi vous aimez ce projet, n’hésitez pas à nous soutenir et à en parler autour de vous !\n\n📞 Pour nous contacter :\n- Appelez le 56 66 36 38\n- Écrivez-nous sur WhatsApp au 61 22 97 66\n- Ou par e-mail : kaboreabwa2020@gmail.com\n\nMerci pour votre confiance et votre soutien.\n\n© Tous droits réservés.";

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