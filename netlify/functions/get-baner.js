exports.handler = async (event, context) => {
  // Autoriser toutes les origines (CORS)
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  // Répondre aux pré-vérifications CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight' }),
    };
  }

  // Logique pour déterminer le contenu de la bannière
  const bannerData = {
    active: true, // Activer/désactiver la bannière
    message: "🚀 Nouvelle version disponible ! Découvrez les améliorations.",
    downloadUrl: "www.send20.netlify.app", // Lien de téléchargement
    // Optionnel: configuration avancée
    priority: "high", // 'high', 'medium', 'low'
    backgroundColor: "#f0f8ff", // Couleur de fond personnalisable
    textColor: "#333", // Couleur du texte
    expires: "2025-06-30", // Date d'expiration
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(bannerData),
  };
};