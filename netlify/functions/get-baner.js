// netlify/functions/getUpdateInfo.js

exports.handler = async (event, context) => {
  // Ici, tu peux définir les informations de mise à jour.
  // Tu peux les modifier directement ici, ou les récupérer depuis
  // une base de données, un fichier de configuration, ou une API externe.

  const currentAppVersion = "2.0.0"; // La version de l'APK actuellement sur le serveur

  // *** CONFIGURATION DE LA MISE À JOUR ***
  // Modifie ces valeurs pour contrôler le message et le lien
  const latestVersionAvailable = "2.1.0"; // La dernière version de ton app
  const updateMessageText = "⚡ Nouvelle mise à jour (v2.1) disponible ! Optimisations de performance et corrections de bugs. Téléchargez-la maintenant !";
  const downloadLinkURL = "wwww.send20.netlify.app"; // REMPLACE PAR LE LIEN RÉEL DE TON APK

  // Logique pour déterminer si une mise à jour est disponible
  // Pour cet exemple simple, on compare les versions en tant que chaînes.
  // Pour une comparaison plus robuste (ex: 2.1.0 vs 2.0.10), tu devrais utiliser
  // une librairie de comparaison de versions (ex: 'semver' sur Node.js)
  const hasNewUpdate = latestVersionAvailable > currentAppVersion;

  // Si tu veux désactiver la bannière de mise à jour temporairement,
  // tu peux mettre hasNewUpdate à false, même si une nouvelle version est techniquement là.
  // Ou tu peux avoir un flag "active" dans ta configuration.
  // hasNewUpdate = false; // Décommenter pour forcer le masquage de la bannière

  try {
    return {
      statusCode: 200, // Code de succès HTTP
      headers: {
        "Content-Type": "application/json",
        // CORS: Indispensable pour que ton frontend puisse appeler cette fonction
        // Remplace '*' par l'URL de ton frontend en production pour plus de sécurité
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({
        hasUpdate: hasNewUpdate, // true si une mise à jour est dispo, false sinon
        message: updateMessageText, // Le message à afficher
        downloadLink: downloadLinkURL, // Le lien de téléchargement de l'APK
        latestVersion: latestVersionAvailable, // La version annoncée
        // Tu peux ajouter d'autres champs si nécessaire, par exemple:
        // isMandatory: true,
        // releaseNotes: "Amélioration de l'UI, ajout du mode sombre...",
      }),
    };
  } catch (error) {
    console.error("Erreur dans la fonction serverless:", error);
    return {
      statusCode: 500, // Code d'erreur interne du serveur
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // CORS pour les erreurs aussi
      },
      body: JSON.stringify({
        hasUpdate: false, // Ne pas afficher de mise à jour en cas d'erreur
        message: "Erreur lors de la récupération des informations de mise à jour.",
        error: error.message,
      }),
    };
  }
};