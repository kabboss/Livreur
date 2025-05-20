// netlify/functions/update-message.js
exports.handler = async (event, context) => {
    // Définir les en-têtes CORS pour autoriser les requêtes depuis n'importe quelle origine
    const headers = {
        'Access-Control-Allow-Origin': '*', // Autorise toutes les origines
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' // Ajouter d'autres méthodes que vous pourriez utiliser
    };

    // Gérer les requêtes de pré-vérification (preflight requests)
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204, // No Content
            headers: headers
        };
    }

    try {
        // --- Section de configuration ---
        // Vous pouvez modifier ces valeurs dynamiquement selon vos besoins
        const message = "Une nouvelle mise à jour a ete fait le 20 mai 2025 ! Téléchargez la pour profiter des dernières fonctionnalités.";
        const downloadLink = "www.send20.netlify.app"; // Remplacez par votre lien de téléchargement réel
        const showBanner = true; // Définir à 'false' pour masquer la bannière dynamiquement

        // Vous pourriez également récupérer ces valeurs depuis une base de données, un système de gestion de contenu (CMS),
        // ou des variables d'environnement pour un contrôle dynamique plus avancé.
        // Exemple : const data = await fetch('https://your-cms-api.com/updates').then(res => res.json());

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