/**
 * Uploads base64 image to cloud storage and returns a public URL.
 *
 * Currently a STUB — replace with your preferred provider:
 *
 * Option A: Cloudinary (easiest, free tier available)
 *   npm install cloudinary
 *
 * Option B: AWS S3
 *   npm install @aws-sdk/client-s3
 *
 * Option C: Firebase Storage
 *   npm install firebase-admin
 *
 * See comments below for each implementation.
 */

async function uploadToStorage(base64Data, mimeType, ticketId) {
  // ── OPTION A: Cloudinary (recommended for quick setup) ───────────────────
  // const cloudinary = require('cloudinary').v2;
  // cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  //   api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
  // const result = await cloudinary.uploader.upload(
  //   `data:${mimeType};base64,${base64Data}`,
  //   { folder: 'cleanalert', public_id: ticketId }
  // );
  // return result.secure_url;

  // ── OPTION B: AWS S3 ──────────────────────────────────────────────────────
  // const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  // const s3 = new S3Client({ region: process.env.AWS_REGION });
  // const buffer = Buffer.from(base64Data, 'base64');
  // const key = `waste-reports/${ticketId}.jpg`;
  // await s3.send(new PutObjectCommand({
  //   Bucket: process.env.S3_BUCKET, Key: key,
  //   Body: buffer, ContentType: mimeType, ACL: 'public-read'
  // }));
  // return `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`;

  // ── DEFAULT STUB: Return placeholder (works for dev/testing) ─────────────
  console.warn('[Storage] No cloud storage configured. Using placeholder URL.');
  throw new Error('No storage configured');
}

module.exports = { uploadToStorage };
