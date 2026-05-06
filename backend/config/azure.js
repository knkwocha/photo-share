const { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');
const ComputerVisionClient = require('@azure/cognitiveservices-computervision');
const msRest = require('@azure/ms-rest-js');

// ─── Blob Storage ─────────────────────────────────────────────────────────────

let blobServiceClient;

function getBlobServiceClient() {
  if (!blobServiceClient) {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    if (!accountName || !accountKey) {
      throw new Error('Azure Storage credentials not configured');
    }
    const credential = new StorageSharedKeyCredential(accountName, accountKey);
    blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      credential
    );
  }
  return blobServiceClient;
}

async function uploadImageToBlob(buffer, blobName, contentType) {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(
    process.env.AZURE_STORAGE_CONTAINER_NAME || 'photos'
  );
  await containerClient.createIfNotExists({ access: 'blob' });

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  return blockBlobClient.url;
}

async function deleteImageFromBlob(blobName) {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(
    process.env.AZURE_STORAGE_CONTAINER_NAME || 'photos'
  );
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
}

// ─── Cognitive Services ───────────────────────────────────────────────────────

let visionClient;

function getVisionClient() {
  if (!visionClient) {
    const key = process.env.AZURE_VISION_KEY;
    const endpoint = process.env.AZURE_VISION_ENDPOINT;
    if (!key || !endpoint) return null;
    const credentials = new msRest.ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': key } });
    visionClient = new ComputerVisionClient.ComputerVisionClient(credentials, endpoint);
  }
  return visionClient;
}

async function analyzeImage(imageUrl) {
  const client = getVisionClient();
  if (!client) return { tags: [], description: '', isAdultContent: false };

  try {
    const result = await client.analyzeImage(imageUrl, {
      visualFeatures: ['Tags', 'Description', 'Adult', 'Color'],
    });

    return {
      tags: result.tags ? result.tags.map(t => t.name) : [],
      description: result.description?.captions?.[0]?.text || '',
      isAdultContent: result.adult?.isAdultContent || false,
      dominantColors: result.color?.dominantColors || [],
    };
  } catch (err) {
    console.error('Cognitive Services error:', err.message);
    return { tags: [], description: '', isAdultContent: false };
  }
}

module.exports = { uploadImageToBlob, deleteImageFromBlob, analyzeImage };
