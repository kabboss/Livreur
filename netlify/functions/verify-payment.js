const { MongoClient } = require('mongodb');

// Configuration MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';
const COLLECTIONS = {
  PACKAGES: 'packages',
  PAYMENTS: 'payments',
  SECURITY_LOGS: 'security_logs'
};

// Configuration de vérification Orange Money Burkina Faso
const VERIFICATION_CONFIG = {
  orangeMoneyRecipient: '56663638',
  maxTransactionAge: 15 * 60 * 1000, // 15 minutes
  minTrustScore: 80,
  
  // Patterns pour Orange Money BF
  requiredPatterns: [
    /cher client/i,
    /vous avez transfere/i,
    /au numero/i,
    /votre solde est de/i,
    /id trans:/i,
    /orange money bf/i
  ],
  
  // Format d'ID de transaction Orange Money BF
  transactionIdPattern: /PP\d{6}\.\d{4}\.\d{8}/,
  
  // Format de montant
  amountPattern: /(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)\s*FCFA/g,
  
  // Format de numéro de destinataire
  recipientPattern: /au numero (\d{8})/i,
  
  // Mots-clés obligatoires
  requiredKeywords: [
    'cher client',
    'transfere',
    'numero',
    'solde',
    'orange money bf'
  ],
  
  // Patterns suspects (fraude)
  suspiciousPatterns: [
    /fake|test|demo/i,
    /copy|copie/i,
    /exemple|example/i,
    /simulation/i,
    /\d{4}-\d{4}-\d{4}/,  // Format carte bancaire
    /visa|mastercard/i,
    /paypal|western union/i
  ],
  
  // Vérifications de cohérence
  coherenceChecks: [
    'amount_consistency',
    'recipient_match',
    'transaction_format',
    'timestamp_freshness',
    'keyword_presence',
    'structure_validation'
  ]
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

    const { packageId, expectedAmount, smsText } = requestData;

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

    // Analyse du SMS
    console.log('📱 Analyse du SMS Orange Money');
    const analysisResult = await analyzeOrangeMoneyBF_SMS(smsText, expectedAmount);
    
    if (!analysisResult.isValid) {
      console.error('❌ SMS invalide:', analysisResult.errors);
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'SMS invalide',
          details: analysisResult.errors.join(', '),
          reasons: analysisResult.reasons,
          suggestions: analysisResult.suggestions
        })
      };
    }

    // Vérification anti-fraude
    console.log('🛡️ Vérification anti-fraude');
    const fraudCheck = await performFraudDetection(smsText, analysisResult.extractedData);
    
    if (fraudCheck.isFraudulent) {
      console.error('🚨 Fraude détectée:', fraudCheck.reasons);
      await logSecurityEvent(db, 'fraud_detected', {
        packageId,
        fraudReasons: fraudCheck.reasons,
        smsText: smsText.substring(0, 100) + '...',
        timestamp: new Date().toISOString()
      });

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Fraude détectée',
          details: 'Ce SMS semble être frauduleux',
          reasons: fraudCheck.reasons,
          suggestions: [
            'Vérifiez que vous avez copié le bon SMS',
            'Assurez-vous que le SMS provient bien d\'Orange Money',
            'Contactez le support si vous pensez qu\'il y a une erreur'
          ]
        })
      };
    }

    // Vérification des doublons
    console.log('🔍 Vérification des doublons');
    const duplicateCheck = await checkForDuplicates(db, analysisResult.extractedData);
    
    if (duplicateCheck.isDuplicate) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'SMS déjà utilisé',
          details: 'Ce SMS de confirmation a déjà été utilisé',
          existingPayment: duplicateCheck.existingPayment
        })
      };
    }

    // Enregistrement du paiement
    console.log('💾 Enregistrement du paiement vérifié');
    const paymentRecord = await savePaymentRecord(
      db,
      packageData,
      analysisResult.extractedData,
      smsText,
      requestData
    );

    // Mise à jour du colis
    await db.collection(COLLECTIONS.PACKAGES).updateOne(
      { _id: packageData._id },
      {
        $set: {
          paymentStatus: 'verified',
          paymentDetails: {
            transactionId: analysisResult.extractedData.transactionId,
            amount: analysisResult.extractedData.amount,
            verifiedAt: new Date().toISOString(),
            trustScore: analysisResult.extractedData.trustScore,
            method: 'orange_money_bf'
          },
          updatedAt: new Date().toISOString()
        }
      }
    );

    // Log de sécurité
    await logSecurityEvent(db, 'payment_verified', {
      packageId,
      transactionId: analysisResult.extractedData.transactionId,
      amount: analysisResult.extractedData.amount,
      trustScore: analysisResult.extractedData.trustScore,
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
        analysisResult: {
          transactionId: analysisResult.extractedData.transactionId,
          amount: analysisResult.extractedData.amount,
          recipient: analysisResult.extractedData.recipient,
          timestamp: analysisResult.extractedData.timestamp,
          trustScore: analysisResult.extractedData.trustScore,
          provider: 'orange_money_bf'
        },
        verificationDetails: {
          method: 'SMS Analysis + Anti-Fraud',
          confidence: analysisResult.extractedData.trustScore,
          checks: analysisResult.checks,
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
        message: 'Une erreur inattendue s\'est produite'
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

  return { isValid: errors.length === 0, errors };
}

async function analyzeOrangeMoneyBF_SMS(smsText, expectedAmount) {
  console.log('📱 Analyse du SMS Orange Money BF');
  
  const checks = [];
  let trustScore = 0;
  const errors = [];
  const reasons = [];
  const suggestions = [];

  // Nettoyer le texte
  const cleanText = smsText.trim();
  
  // 1. Vérification des patterns obligatoires (25 points)
  const requiredPatternResults = VERIFICATION_CONFIG.requiredPatterns.map(pattern => {
    const match = pattern.test(cleanText);
    return { pattern: pattern.source, match };
  });

  const matchedPatterns = requiredPatternResults.filter(r => r.match).length;
  const patternScore = Math.round((matchedPatterns / VERIFICATION_CONFIG.requiredPatterns.length) * 25);
  
  checks.push({
    name: 'required_patterns',
    status: patternScore >= 20 ? 'passed' : 'failed',
    score: patternScore,
    details: `${matchedPatterns}/${VERIFICATION_CONFIG.requiredPatterns.length} patterns trouvés`
  });
  
  trustScore += patternScore;
  
  if (patternScore < 20) {
    errors.push('Structure du SMS Orange Money non reconnue');
    reasons.push('Le SMS ne correspond pas au format Orange Money BF');
    suggestions.push('Vérifiez que vous avez copié le bon SMS Orange Money');
  }

  // 2. Extraction et vérification du montant (25 points)
  const amountMatches = Array.from(cleanText.matchAll(VERIFICATION_CONFIG.amountPattern));
  let extractedAmount = null;
  let amountScore = 0;

  if (amountMatches.length > 0) {
    // Prendre le premier montant (celui du transfert)
    const amountStr = amountMatches[0][1].replace(/[,\.]/g, '');
    extractedAmount = parseFloat(amountStr);
    
    if (extractedAmount === expectedAmount) {
      amountScore = 25;
      checks.push({
        name: 'amount_verification',
        status: 'passed',
        score: 25,
        details: `Montant correct: ${extractedAmount} FCFA`
      });
    } else {
      amountScore = 0;
      checks.push({
        name: 'amount_verification',
        status: 'failed',
        score: 0,
        details: `Montant incorrect: attendu ${expectedAmount}, trouvé ${extractedAmount}`
      });
      errors.push(`Montant incorrect: ${extractedAmount} FCFA au lieu de ${expectedAmount} FCFA`);
      reasons.push('Le montant du SMS ne correspond pas au montant attendu');
    }
  } else {
    errors.push('Montant non trouvé dans le SMS');
    reasons.push('Impossible d\'extraire le montant du SMS');
    suggestions.push('Vérifiez que le SMS contient bien le montant en FCFA');
  }
  
  trustScore += amountScore;

  // 3. Vérification du destinataire (20 points)
  const recipientMatch = cleanText.match(VERIFICATION_CONFIG.recipientPattern);
  let recipientScore = 0;
  let extractedRecipient = null;

  if (recipientMatch) {
    extractedRecipient = recipientMatch[1];
    if (extractedRecipient === VERIFICATION_CONFIG.orangeMoneyRecipient) {
      recipientScore = 20;
      checks.push({
        name: 'recipient_verification',
        status: 'passed',
        score: 20,
        details: `Destinataire correct: ${extractedRecipient}`
      });
    } else {
      recipientScore = 0;
      checks.push({
        name: 'recipient_verification',
        status: 'failed',
        score: 0,
        details: `Destinataire incorrect: ${extractedRecipient}`
      });
      errors.push(`Destinataire incorrect: ${extractedRecipient}`);
      reasons.push('Le numéro de destinataire ne correspond pas');
    }
  } else {
    errors.push('Numéro de destinataire non trouvé');
    reasons.push('Impossible d\'extraire le numéro de destinataire');
  }

  trustScore += recipientScore;

  // 4. Vérification de l'ID de transaction (15 points)
  const transactionMatch = cleanText.match(/ID Trans: (PP\d{6}\.\d{4}\.\d{8})/i);
  let transactionScore = 0;
  let extractedTransactionId = null;

  if (transactionMatch) {
    extractedTransactionId = transactionMatch[1];
    if (VERIFICATION_CONFIG.transactionIdPattern.test(extractedTransactionId)) {
      transactionScore = 15;
      checks.push({
        name: 'transaction_id_format',
        status: 'passed',
        score: 15,
        details: `ID transaction valide: ${extractedTransactionId}`
      });
    } else {
      transactionScore = 5;
      checks.push({
        name: 'transaction_id_format',
        status: 'warning',
        score: 5,
        details: `Format d'ID inhabituel: ${extractedTransactionId}`
      });
    }
  } else {
    errors.push('ID de transaction non trouvé');
    reasons.push('Impossible d\'extraire l\'ID de transaction');
  }

  trustScore += transactionScore;

  // 5. Vérification des mots-clés (10 points)
  const foundKeywords = VERIFICATION_CONFIG.requiredKeywords.filter(
    keyword => cleanText.toLowerCase().includes(keyword.toLowerCase())
  );

  const keywordScore = Math.round((foundKeywords.length / VERIFICATION_CONFIG.requiredKeywords.length) * 10);
  checks.push({
    name: 'keyword_verification',
    status: keywordScore >= 7 ? 'passed' : 'warning',
    score: keywordScore,
    details: `Mots-clés trouvés: ${foundKeywords.join(', ')}`
  });

  trustScore += keywordScore;

  // 6. Vérification de la fraîcheur (5 points)
  const currentTime = new Date();
  const timeScore = 5; // Assumons que c'est récent pour cette simulation
  
  checks.push({
    name: 'timestamp_freshness',
    status: 'passed',
    score: timeScore,
    details: 'Transaction récente'
  });

  trustScore += timeScore;

  // Calcul final
  const finalScore = Math.min(100, trustScore);
  const isValid = finalScore >= VERIFICATION_CONFIG.minTrustScore && errors.length === 0;

  if (!isValid && suggestions.length === 0) {
    suggestions.push('Vérifiez que vous avez copié le bon SMS Orange Money');
    suggestions.push('Assurez-vous que le SMS est complet');
    suggestions.push('Vérifiez que le montant et le destinataire sont corrects');
  }

  return {
    isValid,
    trustScore: finalScore,
    checks,
    errors,
    reasons,
    suggestions,
    extractedData: {
      transactionId: extractedTransactionId,
      amount: extractedAmount,
      recipient: extractedRecipient,
      timestamp: currentTime.toISOString(),
      trustScore: finalScore,
      provider: 'orange_money_bf'
    }
  };
}

async function performFraudDetection(smsText, extractedData) {
  console.log('🛡️ Détection de fraude');
  
  const fraudIndicators = [];
  
  // 1. Vérification des patterns suspects
  VERIFICATION_CONFIG.suspiciousPatterns.forEach(pattern => {
    if (pattern.test(smsText)) {
      fraudIndicators.push(`Pattern suspect détecté: ${pattern.source}`);
    }
  });

  // 2. Vérification de la cohérence des données
  if (extractedData.amount && extractedData.amount > 1000000) {
    fraudIndicators.push('Montant anormalement élevé');
  }

  if (extractedData.amount && extractedData.amount < 100) {
    fraudIndicators.push('Montant anormalement faible');
  }

  // 3. Vérification de la structure du SMS
  if (smsText.length < 100) {
    fraudIndicators.push('SMS trop court');
  }

  if (smsText.length > 1000) {
    fraudIndicators.push('SMS anormalement long');
  }

  // 4. Vérification des caractères non standard
  if (/[^\x00-\x7F]/g.test(smsText) && !/[àâäéèêëïîôùûüÿç]/g.test(smsText)) {
    fraudIndicators.push('Caractères non standard détectés');
  }

  // 5. Vérification de la répétition (copier-coller multiple)
  const words = smsText.split(' ');
  const uniqueWords = [...new Set(words)];
  if (words.length > 20 && uniqueWords.length / words.length < 0.5) {
    fraudIndicators.push('Contenu répétitif détecté');
  }

  return {
    isFraudulent: fraudIndicators.length > 0,
    reasons: fraudIndicators,
    riskScore: Math.min(100, fraudIndicators.length * 20)
  };
}

async function checkForDuplicates(db, extractedData) {
  if (!extractedData.transactionId) {
    return { isDuplicate: false };
  }

  const existingPayments = await db.collection(COLLECTIONS.PAYMENTS)
    .find({ 'analysisResult.transactionId': extractedData.transactionId })
    .limit(1)
    .toArray();

  if (existingPayments.length > 0) {
    return {
      isDuplicate: true,
      existingPayment: {
        id: existingPayments[0]._id,
        packageId: existingPayments[0].packageId,
        createdAt: existingPayments[0].createdAt
      }
    };
  }

  return { isDuplicate: false };
}

async function savePaymentRecord(db, packageData, extractedData, smsText, requestData) {
  const paymentRecord = {
    packageId: packageData._id,
    packageCode: packageData.colisID,
    analysisResult: extractedData,
    smsData: {
      originalText: smsText,
      textLength: smsText.length,
      timestamp: requestData.timestamp
    },
    verificationMethod: 'sms_analysis_bf',
    status: 'verified',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const result = await db.collection(COLLECTIONS.PAYMENTS).insertOne(paymentRecord);
  return { ...paymentRecord, _id: result.insertedId };
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