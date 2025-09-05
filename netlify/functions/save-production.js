const { MongoClient } = require("mongodb");

// Configuration MongoDB optimisée
const MONGODB_URI =
  "mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority&maxPoolSize=10&serverSelectionTimeoutMS=5000&connectTimeoutMS=10000";
const DB_NAME = "FarmsConnect";
const COLLECTION_NAME = "productions_delices_capoue";

const mongoClient = new MongoClient(MONGODB_URI, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  maxIdleTimeMS: 30000,
  bufferMaxEntries: 0,
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const COMMON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  // Gérer les requêtes OPTIONS (CORS preflight)
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: COMMON_HEADERS, body: "" };
  }

  // Vérifier que c'est une requête POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        error: "Method not allowed",
        allowedMethods: ["POST", "OPTIONS"],
      }),
    };
  }

  let productionData;

  // Parsing JSON
  try {
    productionData = JSON.parse(event.body);
  } catch (parseError) {
    console.error("❌ Erreur parsing JSON:", parseError);
    return {
      statusCode: 400,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        error: "Format JSON invalide",
        message: parseError.message,
      }),
    };
  }

  // Validation stricte des données obligatoires
  const requiredFields = [
    "productionId",
    "date",
    "milkQuantity",
    "supervisor",
    "producer",
  ];
  const missingFields = requiredFields.filter((f) => !productionData[f]);

  if (missingFields.length > 0) {
    return {
      statusCode: 400,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        error: "Données de production incomplètes",
        missingFields,
        required: requiredFields,
      }),
    };
  }

  // Validation numérique
  if (
    isNaN(parseFloat(productionData.milkQuantity)) ||
    parseFloat(productionData.milkQuantity) <= 0
  ) {
    return {
      statusCode: 400,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        error: "Quantité de lait invalide",
        received: productionData.milkQuantity,
      }),
    };
  }

  // Enrichissement des données
  const enrichedData = {
    ...productionData,
    savedAt: new Date().toISOString(),
    dataVersion: "2.0",
    platform: "android",
    qualityMetrics: calculateQualityMetrics(productionData),
    performanceAnalysis: analyzePerformance(productionData),
    dataHash: generateDataHash(productionData),
    location: {
      facility: "Les Délices de Capoue - Site Principal",
      coordinates: null,
    },
    traceability: {
      ingredients: extractIngredientTraceability(productionData),
      equipment: "Standard Production Line",
      environment: { recordedAt: new Date().toISOString() },
    },
  };

  console.log(`🔄 Sauvegarde production: ${productionData.productionId}`);
  console.log(`📊 Quantité: ${productionData.milkQuantity}L`);
  console.log(`👥 Équipe: ${productionData.supervisor}/${productionData.producer}`);

  // Connexion et sauvegarde MongoDB
  try {
    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Vérification unicité
    const existing = await collection.findOne({
      productionId: productionData.productionId,
    });
    if (existing) {
      return {
        statusCode: 409,
        headers: COMMON_HEADERS,
        body: JSON.stringify({
          error: "Production déjà existante",
          productionId: productionData.productionId,
          existingSince: existing.savedAt,
        }),
      };
    }

    // Insertion
    const result = await collection.insertOne(enrichedData);
    await createOptimizedIndexes(collection);
    await cleanupOldProductions(collection);

    console.log(`✅ Production sauvegardée: ${result.insertedId}`);
    console.log(
      `📈 Efficacité calculée: ${enrichedData.qualityMetrics.overallEfficiency}%`
    );

    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        success: true,
        message: "Production sauvegardée avec succès",
        data: {
          insertedId: result.insertedId,
          productionId: productionData.productionId,
          qualityScore: enrichedData.qualityMetrics.qualityScore,
          efficiency: enrichedData.qualityMetrics.overallEfficiency,
          estimatedRevenue: enrichedData.costAnalysis?.expectedRevenue || "N/A",
          savedAt: enrichedData.savedAt,
        },
      }),
    };
  } catch (error) {
    console.error("❌ Erreur MongoDB:", error);
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        error: "Erreur serveur lors de la sauvegarde",
        message: error.message,
        productionId: productionData?.productionId || "unknown",
        timestamp: new Date().toISOString(),
      }),
    };
  } finally {
    try {
      await mongoClient.close();
    } catch (closeError) {
      console.error("⚠️ Erreur fermeture connexion:", closeError);
    }
  }
};

// -------------------------
// Fonctions utilitaires
// -------------------------

function calculateQualityMetrics(productionData) {
  const metrics = {
    qualityScore: 85,
    overallEfficiency: 90,
    timeCompliance: 95,
    temperatureAccuracy: 98,
    ingredientAccuracy: 100,
    documentationCompleteness: 0,
  };

  if (productionData.timeMetrics) {
    metrics.overallEfficiency = Math.max(
      60,
      Math.min(100, productionData.timeMetrics.efficiency)
    );
    metrics.timeCompliance = metrics.overallEfficiency > 85 ? 95 : 80;
  }

  let docScore = 0;
  if (productionData.weighingPhotos) docScore += 30;
  if (productionData.photos) docScore += 25;
  if (productionData.finalPhotos) docScore += 25;
  if (productionData.supervisorValidation) docScore += 20;
  metrics.documentationCompleteness = docScore;

  metrics.qualityScore = Math.round(
    metrics.overallEfficiency * 0.3 +
      metrics.timeCompliance * 0.2 +
      metrics.temperatureAccuracy * 0.2 +
      metrics.ingredientAccuracy * 0.15 +
      metrics.documentationCompleteness * 0.15
  );

  return metrics;
}

function analyzePerformance(productionData) {
  const analysis = {
    category: "standard",
    recommendations: [],
    riskFactors: [],
    optimizationOpportunities: [],
  };

  const quantity = parseFloat(productionData.milkQuantity || 0);

  if (quantity < 50) {
    analysis.category = "small-batch";
    analysis.recommendations.push(
      "Optimiser les coûts fixes pour les petites productions"
    );
  } else if (quantity > 200) {
    analysis.category = "large-batch";
    analysis.recommendations.push(
      "Surveiller la température de manière continue"
    );
    analysis.riskFactors.push(
      "Risque de variation de température sur gros volume"
    );
  }

  if (productionData.incubationHours < 6) {
    analysis.riskFactors.push(
      "Temps d'incubation court - surveiller la fermentation"
    );
  } else if (productionData.incubationHours > 8) {
    analysis.recommendations.push(
      "Surveiller l'acidité - temps d'incubation élevé"
    );
  }

  if (productionData.costAnalysis) {
    const margin = parseFloat(productionData.costAnalysis.expectedMargin || 0);
    if (margin < 30) {
      analysis.optimizationOpportunities.push("Revoir les coûts fournisseurs");
    }
  }

  return analysis;
}

function generateDataHash(productionData) {
  const dataString = JSON.stringify({
    id: productionData.productionId,
    quantity: productionData.milkQuantity,
    date: productionData.date,
  });

  let hash = 0;
  for (let i = 0; i < dataString.length; i++) {
    const char = dataString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function extractIngredientTraceability(productionData) {
  return {
    milkPowder: {
      brand: productionData.milkBrand,
      quantity: productionData.milkPowder,
      unit: "kg",
    },
    sugar: {
      brandPre: productionData.sugarBrandPre,
      brandPost: productionData.sugarBrandPost || productionData.sugarBrandPre,
      quantityPre: productionData.sugarQuantityPre,
      quantityPost: productionData.sugarQuantityPost,
      unit: "kg",
    },
    ferment: {
      brand: productionData.fermentBrand,
      quantity: 1,
      unit: "sachet",
    },
    vanilla: {
      brand: productionData.vanillaBrand,
      quantity: productionData.vanillaSachets,
      unit: "sachets",
    },
  };
}

async function createOptimizedIndexes(collection) {
  try {
    await collection.createIndex({ productionId: 1 }, { unique: true });
    await collection.createIndex({ date: 1 });
    await collection.createIndex({ supervisor: 1 });
    await collection.createIndex({ "qualityMetrics.qualityScore": -1 });
    await collection.createIndex({ savedAt: 1 });
  } catch (indexError) {
    console.warn("⚠️ Erreur création indexes:", indexError.message);
  }
}

async function cleanupOldProductions(collection) {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const result = await collection.deleteMany({
      savedAt: { $lt: oneYearAgo.toISOString() },
    });

    if (result.deletedCount > 0) {
      console.log(
        `🧹 Nettoyage: ${result.deletedCount} anciennes productions supprimées`
      );
    }
  } catch (cleanupError) {
    console.warn("⚠️ Erreur nettoyage:", cleanupError.message);
  }
}
