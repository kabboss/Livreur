// Dans votre fonction saveProductionToDatabase()
async function saveProductionToDatabase() {
    try {
        console.log("📤 Envoi des données:", JSON.stringify(currentProduction, null, 2));
        
        const response = await fetch('https://send20.netlify.app/.netlify/functions/save-production', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(currentProduction)
        });

        console.log("📥 Réponse reçue:", response.status, response.statusText);
        
        const result = await response.json();
        console.log("📋 Contenu de la réponse:", result);
        
        if (response.ok) {
            console.log('✅ Production sauvegardée:', result.insertedId);
            showNotification('✅ Rapport sauvegardé en base !', '#10B981');
            return true;
        } else {
            console.error('❌ Erreur sauvegarde:', result.error);
            showNotification('❌ Erreur sauvegarde: ' + (result.error || 'Erreur inconnue'), '#DC2626');
            return false;
        }
    } catch (error) {
        console.error('❌ Erreur réseau:', error);
        showNotification('❌ Erreur réseau: ' + error.message, '#DC2626');
        return false;
    }
}