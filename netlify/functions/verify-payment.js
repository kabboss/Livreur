const { MongoClient } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTIONS = {
  PACKAGES: 'Colis',
  PAYMENTS: 'payments',
  SECURITY_LOGS: 'security_logs'
};

// Configuration spécifique pour Orange Money BF
const ORANGE_MONEY_CONFIG = {
  recipientNumber: '56663638',
  recipientName: 'ABDOUL WAHABOU KABORE',
  maxTransactionAge: 10 * 60 * 1000, // 10 minutes maximum
  contactNumbers: {
    call: '127',
    whatsapp: '07000121'
  },
  smsTemplate: {
    prefix: 'Cher client, vous avez transféré',
    amountSuffix: 'FCFA',
    recipientPrefix: 'au numero',
    balancePrefix: 'Votre solde est de',
    transactionPrefix: 'ID Trans:',
    contactPrefix: 'Pour toute reclamation contactez par appel le',
    orWhatsapp: 'ou whatsapp',
    provider: 'Orange Money BF'
  }
};

// Headers CORS
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json'
};

// Fonction principale
exports.handler = async (event, context) => {
  // Gestion CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  let client;
  try {
    console.log('🔍 Début de la vérification SMS Orange Money BF');
    
    // Validation des données de requête
    let requestData;
    try {
      requestData = JSON.parse(event.body);
    } catch (e) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Format JSON invalide' })
      };
    }

    // Validation des champs requis
    const validation = validateRequestData(requestData);
    if (!validation.isValid) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Données invalides',
          details: validation.errors.join(', ')
        })
      };
    }

    const { packageId, expectedAmount, smsText, orangeNumber } = requestData;

    // Connexion MongoDB
    client = await connectToMongo();
    const db = client.db(DB_NAME);

    // Vérifier l'existence du colis
    const packageData = await db.collection(COLLECTIONS.PACKAGES)
      .findOne({ colisID: packageId });

    if (!packageData) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Colis non trouvé',
          details: 'Vérifiez le code de suivi'
        })
      };
    }

    // Analyse stricte du SMS selon le format exact
    console.log('📱 Analyse stricte du SMS Orange Money BF');
    const analysisResult = analyzeStrictOrangeMoneySMS(smsText, expectedAmount);
    
    if (!analysisResult.isValid) {
      console.error('❌ SMS invalide:', analysisResult.errors);
      await logSecurityEvent(db, 'invalid_sms_format', {
        packageId,
        errors: analysisResult.errors,
        smsText: smsText.substring(0, 100) + '...',
        orangeNumber,
        timestamp: new Date().toISOString()
      });

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Format SMS invalide',
          details: analysisResult.errors.join(', '),
          reasons: analysisResult.reasons,
          suggestions: analysisResult.suggestions
        })
      };
    }

    // Vérification de la fraîcheur de la transaction
    const transactionDate = extractDateFromTransactionId(analysisResult.transactionId);
    const now = new Date();
    const diffMinutes = Math.floor((now - transactionDate) / (1000 * 60));
    
    if (diffMinutes > 10) {
      const errorMsg = `Transaction trop ancienne (${diffMinutes} minutes). Maximum 10 minutes autorisées.`;
      console.error('❌', errorMsg);
      await logSecurityEvent(db, 'old_transaction', {
        packageId,
        transactionId: analysisResult.transactionId,
        orangeNumber,
        transactionDate,
        diffMinutes,
        timestamp: now.toISOString()
      });

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Transaction expirée',
          details: errorMsg,
          suggestions: [
            'Effectuez un nouveau paiement',
            'Assurez-vous que le SMS est récent'
          ]
        })
      };
    }

    // Vérification des doublons
    console.log('🔍 Vérification des doublons');
    const duplicateCheck = await checkForDuplicates(db, analysisResult.transactionId);
    
    if (duplicateCheck.isDuplicate) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'SMS déjà utilisé',
          details: 'Ce SMS de confirmation a déjà été utilisé',
          existingPayment: duplicateCheck.existingPayment,
          suggestions: [
            'Vérifiez que vous n\'avez pas déjà validé ce paiement',
            'Contactez le support si nécessaire'
          ]
        })
      };
    }

    // Enregistrement du paiement
    console.log('💾 Enregistrement du paiement vérifié');
    const paymentRecord = {
      packageId: packageData.colisID,
      packageCode: packageData.colisID,
      transactionDetails: {
        transactionId: analysisResult.transactionId,
        amount: analysisResult.amount,
        senderNumber: orangeNumber, // Numéro de l'expéditeur
        recipient: ORANGE_MONEY_CONFIG.recipientNumber,
        transactionDate: transactionDate.toISOString(),
        verificationMethod: 'strict_sms_analysis_bf'
      },
      smsData: {
        originalText: smsText,
        textLength: smsText.length
      },
      status: 'verified',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const paymentResult = await db.collection(COLLECTIONS.PAYMENTS).insertOne(paymentRecord);

    // Mise à jour du colis
    await db.collection(COLLECTIONS.PACKAGES).updateOne(
      { colisID: packageData.colisID },
      {
        $set: {
          paymentStatus: 'verified',
          paymentDetails: {
            transactionId: analysisResult.transactionId,
            amount: analysisResult.amount,
            senderNumber: orangeNumber, // Numéro de l'expéditeur
            verifiedAt: new Date().toISOString(),
            method: 'orange_money_bf'
          },
          updatedAt: new Date().toISOString()
        }
      }
    );

    // Log de sécurité
    await logSecurityEvent(db, 'payment_verified', {
      packageId,
      transactionId: analysisResult.transactionId,
      senderNumber: orangeNumber,
      amount: analysisResult.amount,
      timestamp: new Date().toISOString()
    });

    console.log('✅ Vérification terminée avec succès');

    // Réponse de succès
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Paiement vérifié avec succès',
        packageId,
        verificationDetails: {
          transactionId: analysisResult.transactionId,
          amount: analysisResult.amount,
          senderNumber: orangeNumber,
          transactionDate: transactionDate.toISOString(),
          verificationMethod: 'Strict SMS Analysis',
          verifiedAt: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('❌ Erreur critique:', error);
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Erreur interne du serveur',
        message: error.message || 'Une erreur inattendue s\'est produite'
      })
    };
  } finally {
    if (client) {
      await client.close();
    }
  }
};

// Fonctions utilitaires

async function connectToMongo() {
  const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000
  });

  try {
    await client.connect();
    return client;
  } catch (error) {
    console.error('❌ Erreur de connexion MongoDB:', error);
    throw new Error('Erreur de connexion à la base de données');
  }
}

function validateRequestData(data) {
  const errors = [];

  if (!data.packageId || typeof data.packageId !== 'string') {
    errors.push('ID du colis manquant ou invalide');
  }

  if (!data.expectedAmount || typeof data.expectedAmount !== 'number' || data.expectedAmount <= 0) {
    errors.push('Montant attendu invalide');
  }

  if (!data.smsText || typeof data.smsText !== 'string' || data.smsText.trim().length < 50) {
    errors.push('SMS manquant ou trop court');
  }

  if (!data.orangeNumber || typeof data.orangeNumber !== 'string' || !validateOrangeNumber(data.orangeNumber)) {
    errors.push('Numéro Orange Money manquant ou invalide');
  }

  return { isValid: errors.length === 0, errors };
}

function validateOrangeNumber(number) {
  // Validation pour numéro Orange BF (commence par 5, 6 ou 7 et a 8 chiffres)
  const cleaned = number.replace(/\D/g, '');
  return cleaned.length === 8 && /^[567]/.test(cleaned);
}

function analyzeStrictOrangeMoneySMS(smsText, expectedAmount) {
  const errors = [];
  const reasons = [];
  const suggestions = [];
  
// 1. Vérification du format exact avec flexibilité
const expectedPattern = new RegExp(
  `^${ORANGE_MONEY_CONFIG.smsTemplate.prefix}\\s+(\\d+(?:\\.\\d+)?)\\s+${ORANGE_MONEY_CONFIG.smsTemplate.amountSuffix}\\s+` +
  `${ORANGE_MONEY_CONFIG.smsTemplate.recipientPrefix}\\s+${ORANGE_MONEY_CONFIG.recipientNumber},\\s*(?:ABDOUL[\\s-]?WAHAB[OU]*[\\s-]?KABORE)\\.\\s+` +
  `${ORANGE_MONEY_CONFIG.smsTemplate.balancePrefix}\\s+(\\d+(?:\\.\\d+)?)\\s+${ORANGE_MONEY_CONFIG.smsTemplate.amountSuffix}\\.\\s+` +
  `${ORANGE_MONEY_CONFIG.smsTemplate.transactionPrefix}\\s+(PP\\d{6}\\.\\d{4}\\.\\d{8})\\.\\s+` +
  `${ORANGE_MONEY_CONFIG.smsTemplate.contactPrefix}\\s+${ORANGE_MONEY_CONFIG.contactNumbers.call}\\s+` +
  `${ORANGE_MONEY_CONFIG.smsTemplate.orWhatsapp}\\s+${ORANGE_MONEY_CONFIG.contactNumbers.whatsapp}\\.\\s+` +
  `${ORANGE_MONEY_CONFIG.smsTemplate.provider}\\.?$`,
  'i'
);

  const match = smsText.match(expectedPattern);
  
  if (!match) {
    errors.push('Le SMS ne correspond pas au format Orange Money BF attendu');
    reasons.push('Structure du SMS incorrecte');
    suggestions.push('Copiez exactement le SMS reçu sans modification');
    return { isValid: false, errors, reasons, suggestions };
  }

  const amount = parseInt(match[1]);
  const transactionId = match[3];

  // 2. Vérification du montant
  if (amount !== expectedAmount) {
    errors.push(`Montant incorrect: ${amount} FCFA au lieu de ${expectedAmount} FCFA attendu`);
    reasons.push('Le montant ne correspond pas');
    suggestions.push('Vérifiez que vous avez effectué le bon montant');
  }

  // 3. Vérification de l'ID de transaction
  if (!/^PP\d{6}\.\d{4}\.\d{8}$/.test(transactionId)) {
    errors.push('Format de l\'ID de transaction invalide');
    reasons.push('L\'ID de transaction ne correspond pas au format attendu');
    suggestions.push('Assurez-vous que le SMS provient bien d\'Orange Money');
  }

  return {
    isValid: errors.length === 0,
    amount,
    transactionId,
    errors,
    reasons,
    suggestions
  };
}

function extractDateFromTransactionId(transactionId) {
  // Format: PPddmmyy.hhmm.xxxxxx
  const parts = transactionId.split('.');
  if (parts.length !== 3) {
    throw new Error('Format d\'ID de transaction invalide');
  }

  const datePart = parts[0].substring(2); // PP + ddmmyy
  const timePart = parts[1]; // hhmm

  const day = parseInt(datePart.substring(0, 2));
  const month = parseInt(datePart.substring(2, 4)) - 1; // Les mois sont 0-indexés
  const year = 2000 + parseInt(datePart.substring(4, 6));
  
  const hours = parseInt(timePart.substring(0, 2));
  const minutes = parseInt(timePart.substring(2, 4));

  return new Date(year, month, day, hours, minutes);
}

async function checkForDuplicates(db, transactionId) {
  const existingPayment = await db.collection(COLLECTIONS.PAYMENTS)
    .findOne({ 'transactionDetails.transactionId': transactionId });

  if (existingPayment) {
    return {
      isDuplicate: true,
      existingPayment: {
        id: existingPayment._id,
        packageId: existingPayment.packageId,
        createdAt: existingPayment.createdAt
      }
    };
  }

  return { isDuplicate: false };
}

async function logSecurityEvent(db, eventType, eventData) {
  try {
    const logEntry = {
      eventType,
      eventData,
      timestamp: new Date().toISOString(),
      source: 'verify-payment-sms'
    };

    await db.collection(COLLECTIONS.SECURITY_LOGS).insertOne(logEntry);
  } catch (error) {
    console.error('❌ Erreur lors de la journalisation:', error);
  }
}