const { MongoClient } = require('mongodb');

const uri = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority'; // Remplace par ton URI MongoDB
const dbName = 'FarmsConnect';
const client = new MongoClient(uri);

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Méthode non autorisée.' }),
      headers: {
        'Access-Control-Allow-Origin': '*', // Autoriser toutes les origines
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    };
  }

  const { codeID } = JSON.parse(event.body);

  try {
    await client.connect();
    const db = client.db(dbName);
    const colisCollection = db.collection('Colis');
    const clientCollection = db.collection('infoclient');
    const livraisonCollection = db.collection('Livraison');

    // 🔍 Récupération des infos colis
    const colis = await colisCollection.findOne({ colisID: codeID });
    if (!colis) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Colis introuvable.' }),
        headers: {
          'Access-Control-Allow-Origin': '*', // Autoriser toutes les origines
        },
      };
    }

    // 🔍 Récupération des infos client
    const clientInfo = await clientCollection.findOne({ code: codeID });
    if (!clientInfo) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Client introuvable.' }),
        headers: {
          'Access-Control-Allow-Origin': '*', // Autoriser toutes les origines
        },
      };
    }

    // 📝 Préparation de l'objet Livraison
    const livraisonData = {
      codeID: codeID,
      dateLivraison: new Date(),
      statut: 'en cours d\'expédition',
      colis: {
        type: colis.type,
        details: colis.details || '',
        photos: colis.photos || [],
        createdAt: colis.createdAt || null,
      },
      expediteur: {
        nom: colis.sender,
        telephone: colis.phone1,
        localisation: colis.location || null,
      },
      destinataire: {
        nom: clientInfo.nom,
        prenom: clientInfo.prenom,
        telephone: clientInfo.numero,
        adresse: '', // ou tu peux ne pas inclure ce champ s’il est inutile
        localisation: clientInfo.localisation || null,
      }
    };

    // 📦 Enregistrement dans Livraison
    await livraisonCollection.insertOne(livraisonData);

    // ✅ Réponse
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Bien reçu ! Votre commande est en cours d\'expédition !',
        livraison: livraisonData,
      }),
      headers: {
        'Access-Control-Allow-Origin': '*', // Autoriser toutes les origines
      },
    };
  } catch (error) {
    console.error('Erreur Livraison:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erreur serveur.' }),
      headers: {
        'Access-Control-Allow-Origin': '*', // Autoriser toutes les origines
      },
    };
  } finally {
    await client.close();
  }
};
