const { MongoClient } = require('mongodb');
const Busboy = require('busboy');
const sharp = require('sharp'); // Pour la compression d'images

const MONGODB_URI = 'mongodb+srv://kabboss:ka23bo23re23@cluster0.uy2xz.mongodb.net/FarmsConnect?retryWrites=true&w=majority';
const DB_NAME = 'FarmsConnect';

const COMMON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Configuration de compression
const COMPRESSION_OPTIONS = {
  quality: 60, // Qualité réduite à 60%
  maxWidth: 800, // Largeur maximale
  maxHeight: 800, // Hauteur maximale
  format: 'jpeg' // Convertir en JPEG qui est plus léger
};

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: COMMON_HEADERS,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    };
  }

  let client;
  try {
    client = new MongoClient(MONGODB_URI, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
    });
    await client.connect();

    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    let orderData = {};
    let compressedImageBase64 = null;

    if (contentType.includes('multipart/form-data')) {
      const busboy = Busboy({ headers: { 'content-type': contentType } });
      const parts = {};

      await new Promise((resolve, reject) => {
        busboy.on('field', (name, val) => {
          if (name === 'data') {
            try {
              parts[name] = JSON.parse(val);
            } catch (e) {
              parts[name] = val;
            }
          } else {
            parts[name] = val;
          }
        });

        busboy.on('file', async (name, file, info) => {
          if (name === 'ordonnance') {
            const { filename, mimeType } = info;
            const chunks = [];
            
            file.on('data', (chunk) => chunks.push(chunk));
            file.on('end', async () => {
              try {
                const originalBuffer = Buffer.concat(chunks);
                
                // Compression optimisée avec sharp
                const compressedBuffer = await sharp(originalBuffer)
                  .resize({
                    width: COMPRESSION_OPTIONS.maxWidth,
                    height: COMPRESSION_OPTIONS.maxHeight,
                    fit: 'inside',
                    withoutEnlargement: true
                  })
                  .jpeg({ 
                    quality: COMPRESSION_OPTIONS.quality,
                    mozjpeg: true // Compression optimale
                  })
                  .toBuffer();
                
                // Conversion en base64
                compressedImageBase64 = compressedBuffer.toString('base64');
                
                parts[name] = {
                  filename,
                  mimeType: 'image/jpeg', // Forcé en JPEG après conversion
                  size: compressedBuffer.length,
                  width: (await sharp(compressedBuffer).metadata()).width,
                  height: (await sharp(compressedBuffer).metadata()).height
                };
              } catch (error) {
                console.error('Erreur compression image:', error);
                // On garde l'original si la compression échoue
                compressedImageBase64 = Buffer.concat(chunks).toString('base64');
                parts[name] = {
                  filename,
                  mimeType,
                  size: chunks.reduce((acc, chunk) => acc + chunk.length, 0)
                };
              }
            });
          }
        });

        busboy.on('finish', resolve);
        busboy.on('error', reject);

        busboy.write(Buffer.from(event.body, 'binary'));
        busboy.end();
      });

      orderData = parts.data || {};
    } else {
      orderData = JSON.parse(event.body);
    }

    // Validation
    const errors = [];
    if (!orderData.medicaments?.length) {
      errors.push('Au moins un médicament est requis');
    }
    if (!orderData.phoneNumber || !/^\d{8,15}$/.test(orderData.phoneNumber)) {
      errors.push('Numéro de téléphone invalide');
    }
    if (!orderData.clientPosition?.lat || !orderData.clientPosition?.lng) {
      errors.push('Position client requise');
    }

    if (errors.length) {
      return {
        statusCode: 400,
        headers: COMMON_HEADERS,
        body: JSON.stringify({ message: errors.join(', ') }),
      };
    }

    const db = client.db(DB_NAME);
    const collection = db.collection('pharmacyOrders');

    // Préparation de la commande
    const newOrder = {
      serviceType: 'pharmacy',
      medicaments: orderData.medicaments.map(med => ({
        name: med.name?.trim() || 'Sans nom',
        quantity: Math.max(1, parseInt(med.quantity) || 1),
        notes: med.notes?.trim() || ''
      })),
      notes: orderData.notes?.trim() || '',
      phoneNumber: orderData.phoneNumber.trim(),
      secondaryPhone: orderData.secondaryPhone?.trim() || '',
      clientPosition: {
        lat: parseFloat(orderData.clientPosition.lat),
        lng: parseFloat(orderData.clientPosition.lng)
      },
      orderDate: orderData.orderDate || new Date().toISOString(),
      status: 'pending',
      deliveryFee: 1000,
      createdAt: new Date()
    };

    // Ajout de l'ordonnance compressée si disponible
    if (compressedImageBase64) {
      newOrder.ordonnance = {
        data: compressedImageBase64,
        ...(orderData.ordonnance || {
          filename: 'ordonnance.jpg',
          mimeType: 'image/jpeg'
        }),
        compressed: true,
        sizeKB: Math.round(Buffer.from(compressedImageBase64, 'base64').length / 1024)
      };
    }

    const result = await collection.insertOne(newOrder);

    return {
      statusCode: 201,
      headers: COMMON_HEADERS,
      body: JSON.stringify({
        message: 'Commande enregistrée avec succès',
        orderId: result.insertedId,
        hasOrdonnance: !!compressedImageBase64,
        ordonnanceSizeKB: newOrder.ordonnance?.sizeKB
      }),
    };
  } catch (error) {
    console.error('Erreur create-pharmacy-order:', error);
    return {
      statusCode: 500,
      headers: COMMON_HEADERS,
      body: JSON.stringify({ 
        message: 'Erreur serveur interne',
        ...(process.env.NODE_ENV === 'development' && { 
          details: error.message,
          stack: error.stack 
        })
      }),
    };
  } finally {
    if (client) {
      await client.close();
    }
  }
};