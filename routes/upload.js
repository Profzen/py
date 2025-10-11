// routes/upload.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const CLOUDINARY_ENABLED = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

let cloudinary = null;
if (CLOUDINARY_ENABLED) {
  // require lazily
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// Multer config (memory storage to easily forward to cloudinary or write to disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// ensure local upload dir exists if needed
const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!CLOUDINARY_ENABLED) {
  try { fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

/**
 * POST /admin/upload
 * - Header Authorization Bearer <token> optional (we forward or check in middleware if needed)
 * - Form field: file
 */
router.post('/admin/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier reçu (champ "file")' });
    }

    // If Cloudinary configured, upload there
    if (CLOUDINARY_ENABLED) {
      // upload buffer via upload_stream
      const streamifier = require('streamifier');
      const publicFolder = process.env.CLOUDINARY_FOLDER || 'py_news';

      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: publicFolder },
        (err, result) => {
          if (err) {
            console.error('Cloudinary upload err:', err);
            return res.status(500).json({ success: false, message: 'Upload failed', error: err.message || String(err) });
          }
          return res.json({ success: true, message: 'Upload OK', url: result.secure_url, public_id: result.public_id });
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
      return;
    }

    // Fallback: write to local filesystem (public/uploads)
    const safeName = Date.now() + '-' + (req.file.originalname || 'upload.bin').replace(/\s+/g, '-');
    const outPath = path.join(LOCAL_UPLOAD_DIR, safeName);
    fs.writeFile(outPath, req.file.buffer, (err) => {
      if (err) {
        console.error('Local write failed:', err);
        return res.status(500).json({ success: false, message: 'Upload failed', error: err.message || String(err) });
      }
      // URL accessible via /uploads/...
      const urlPath = '/uploads/' + safeName;
      return res.json({ success: true, message: 'Upload OK (local)', url: urlPath, public_id: null });
    });

  } catch (err) {
    console.error('POST /admin/upload error:', err && err.stack ? err.stack : err);
    // Always return clear JSON text, not object printing
    return res.status(500).json({ success: false, message: 'Upload failed', error: err.message || String(err) });
  }
});

module.exports = router;
