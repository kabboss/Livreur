// netlify/functions/get-baner.js (note le nom du fichier pour correspondre à l'URL)

exports.handler = async (event, context) => {
  const currentAppVersion = "2.0.0"; 
  const latestVersionAvailable = "2.1.0"; 
  const updateMessageText = "⚡ Nouvelle mise à jour (v2.1) disponible ! Optimisations de performance et corrections de bugs. Téléchargez-la maintenant !";
  
  // CORRECTION CRUCIALE : Le lien de téléchargement doit être une URL valide vers un fichier !
  const downloadLinkURL = "https://send20.netlify.app/downloads/SEND_2.1.apk"; // Exemple, REMPLACE PAR TON VRAI LIEN

  const hasNewUpdate = latestVersionAvailable > currentAppVersion; // Attention à la comparaison de chaînes

  try {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // À changer pour ton domaine de prod si possible
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({
        hasUpdate: hasNewUpdate,
        message: updateMessageText,
        downloadLink: downloadLinkURL,
        latestVersion: latestVersionAvailable,
      }),
    };
  } catch (error) {
    console.error("Erreur dans la fonction serverless:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        hasUpdate: false,
        message: "Erreur lors de la récupération des informations de mise à jour.",
        error: error.message,
      }),
    };
  }
};