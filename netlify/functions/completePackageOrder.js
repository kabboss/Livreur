const { MongoClient, ObjectId } = require('mongodb');

// Définissez vos en-têtes CORS pour autoriser toutes les origines
const COMMON_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // Autorise toutes les origines
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', // Assurez-vous d'inclure les méthodes nécessaires (POST pour cette fonction)
    'Access-Control-Allow-Headers': 'Content-Type, Authorization' // Autorise les en-têtes spécifiques
};

// Remplacez ces valeurs par vos véritables URI et nom de base de données
const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

exports.handler = async (event) => {
    // Gère les requêtes OPTIONS (pré-vol CORS)
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: COMMON_HEADERS };
    }

    let client; // Déclarez client en dehors du try pour qu'il soit accessible dans finally
    try {
        const { orderId, driverId } = JSON.parse(event.body);
        
        client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
        await client.connect();
        
        const db = client.db(DB_NAME);
        
        // Mettre à jour la commande pour la marquer comme 'Livré'
        const result = await db.collection('Livraison').updateOne(
            { 
                _id: new ObjectId(orderId), // Utilisez new ObjectId() pour la conversion
                'livreur.idLivreur': driverId 
            },
            { 
                $set: { 
                    statut: 'Livré',
                    dateLivraison: new Date() // Enregistre la date de livraison
                } 
            }
        );
        
        // Vérifier si la commande a été trouvée et modifiée
        if (result.matchedCount === 0) {
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande non trouvée ou ce livreur n\'est pas assigné à cette commande.' })
            };
        }
        
        return {
            statusCode: 200,
            headers: COMMON_HEADERS, // Assurez-vous d'utiliser COMMON_HEADERS ici
            body: JSON.stringify({ success: true, modifiedCount: result.modifiedCount }) // modifiedCount peut être utile pour le débogage
        };
    } catch (error) {
        console.error('Erreur lors de la finalisation de la commande:', error); // Log l'erreur complète
        return {
            statusCode: 500,
            headers: COMMON_HEADERS, // Assurez-vous d'utiliser COMMON_HEADERS ici
            body: JSON.stringify({ error: error.message || 'Erreur interne du serveur lors de la finalisation.' })
        };
    } finally {
        // Assurez-vous de fermer la connexion à la base de données
        if (client) {
            await client.close();
        }
    }
};