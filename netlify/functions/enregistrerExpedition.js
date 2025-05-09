const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const dbName = 'FarmsConnect';

exports.handler = async function(event, context) {
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    try {
        await client.connect();
        const db = client.db(dbName);
        const expeditionCollection = db.collection('cour_expedition');
        const livraisonsCollection = db.collection('livraisons');

        const { 
            codeID, 
            localisationLivreur, 
            telephoneLivreur1, 
            telephoneLivreur2, 
            idLivreur,
            distanceExpediteur,
            distanceDestinataire,
            distanceExpediteurDestinataire,
            prixLivraison
        } = JSON.parse(event.body);

        // Vérifier d'abord si le colis existe
        const colisExistant = await livraisonsCollection.findOne({ codeID });
        if (!colisExistant) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Colis non trouvé' }),
                headers: { 'Access-Control-Allow-Origin': '*' },
            };
        }

        // Enregistrer les informations d'expédition
        const expeditionData = {
            codeID,
            localisationLivreur,
            telephoneLivreur1,
            telephoneLivreur2,
            idLivreur,
            dateDebut: new Date(),
            statut: 'En cours',
            distanceExpediteur,
            distanceDestinataire,
            distanceExpediteurDestinataire,
            prixLivraison,
            detailsColis: {
                type: colisExistant.colis?.type,
                details: colisExistant.colis?.details,
                expediteur: colisExistant.expediteur,
                destinataire: colisExistant.destinataire
            }
        };

        const expeditionResult = await expeditionCollection.insertOne(expeditionData);

        if (!expeditionResult.acknowledged) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Erreur lors de l\'enregistrement de l\'expédition' }),
                headers: { 'Access-Control-Allow-Origin': '*' },
            };
        }

        // Mettre à jour le statut dans la collection livraisons
        await livraisonsCollection.updateOne(
            { codeID },
            { $set: { 
                estExpedie: true,
                idLivreurEnCharge: idLivreur,
                dateExpedition: new Date(),
                statut: 'En cours de livraison'
            }}
        );

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: 'Expédition enregistrée avec succès',
                expeditionId: expeditionResult.insertedId
            }),
            headers: { 'Access-Control-Allow-Origin': '*' },
        };

    } catch (error) {
        console.error('Erreur lors de l\'enregistrement de l\'expédition :', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Erreur serveur lors de l\'enregistrement de l\'expédition' }),
            headers: { 'Access-Control-Allow-Origin': '*' },
        };
    } finally {
        await client.close();
    }
};