const { MongoClient, ObjectId } = require('mongodb');

// Définissez vos en-têtes CORS pour autoriser toutes les origines
const COMMON_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // Autorise toutes les origines
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', // Autorise les méthodes HTTP nécessaires
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
        const { orderId, driverId, driverName, driverPhone, position } = JSON.parse(event.body);
        
        client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
        await client.connect();
        
        const db = client.db(DB_NAME);
        
        // Vérifier si la commande est déjà assignée par un autre livreur
        const existingOrder = await db.collection('Livraison').findOne({
            _id: new ObjectId(orderId), // Utilisez new ObjectId()
            'livreur.idLivreur': { $exists: true, $ne: driverId }
        });
        
        if (existingOrder) {
            return {
                statusCode: 409, // Code d'état pour conflit
                headers: COMMON_HEADERS,
                body: JSON.stringify({ 
                    error: 'Cette commande est déjà prise en charge par un autre livreur',
                    currentDriver: existingOrder.livreur.nomLivreur
                })
            };
        }
        
        // Mettre à jour la commande avec les informations du livreur
        const result = await db.collection('Livraison').updateOne(
            { _id: new ObjectId(orderId) }, // Utilisez new ObjectId()
            { 
                $set: { 
                    statut: 'En cours',
                    livreur: {
                        idLivreur: driverId,
                        nomLivreur: driverName,
                        telephone: driverPhone,
                        position: {
                            lat: position.latitude,
                            lng: position.longitude,
                            updatedAt: new Date()
                        }
                    },
                    dateDebutExpedition: new Date()
                } 
            }
        );
        
        // Vérifiez si la commande a été modifiée
        if (result.modifiedCount === 0) {
            // Si la commande n'a pas été trouvée ou modifiée, renvoyer une erreur
            return {
                statusCode: 404,
                headers: COMMON_HEADERS,
                body: JSON.stringify({ error: 'Commande non trouvée ou déjà à jour.' })
            };
        }

        return {
            statusCode: 200,
            headers: COMMON_HEADERS, // Assurez-vous d'utiliser COMMON_HEADERS ici
            body: JSON.stringify({ success: true, modifiedCount: result.modifiedCount })
        };
    } catch (error) {
        console.error('Erreur lors de l\'enregistrement de l\'expédition:', error); // Log l'erreur complète
        return {
            statusCode: 500,
            headers: COMMON_HEADERS, // Assurez-vous d'utiliser COMMON_HEADERS ici
            body: JSON.stringify({ error: error.message || 'Erreur interne du serveur.' })
        };
    } finally {
        // Assurez-vous de fermer la connexion à la base de données
        if (client) {
            await client.close();
        }
    }
};