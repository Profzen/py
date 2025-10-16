// routes/uploadProof.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const streamifier = require('streamifier');
const { v2: cloudinary } = require('cloudinary');

// configure cloudinary via env in server.js / admin.js already present
// cloudinary.config({ cloud_name: ..., api_key: ..., api_secret: ... });

const upload = multer({ storage: multer.memoryStorage() });

// POST /api/upload-proof
router.post('/upload-proof', upload.single('proof'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, message: 'Fichier manquant' });

    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype || '';
    const filename = req.file.originalname || 'proof';

    // stream upload to Cloudinary
    const streamUpload = () => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: process.env.CLOUDINARY_PROOFS_FOLDER || 'tx_proofs', resource_type: 'auto' },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );
        streamifier.createReadStream(fileBuffer).pipe(stream);
      });
    };

    const result = await streamUpload();
    // result contains secure_url, public_id, format, bytes, resource_type, etc.
    return res.json({
      ok: true,
      url: result.secure_url || result.url,
      public_id: result.public_id || '',
      mimeType,
      filename: filename,
      raw: { result }
    });
  } catch (err) {
    console.error('upload-proof err', err);
    return res.status(500).json({ ok: false, message: 'Erreur upload', error: String(err) });
  }
});

module.exports = router;
