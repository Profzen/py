// routes/upload.js
// Unified upload endpoints (admin upload + public upload-proof for receipts)
// Uses multer (memory storage) and Cloudinary if configured, otherwise saves locally to /public/uploads

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const CLOUDINARY_ENABLED = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

let cloudinary = null;
if (CLOUDINARY_ENABLED) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

// Multer memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Local upload dir (fallback)
const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!CLOUDINARY_ENABLED) {
  try { fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

/**
 * Helper to respond with proof object
 * { url, public_id, mimeType }
 */
function successProofResponse(res, { url, public_id = null, mimeType = null }) {
  return res.json({ success: true, proof: { url, public_id, mimeType } });
}

/**
 * POST /api/upload-proof
 * - public endpoint to upload a proof image/document (receipt, screenshot, pdf, docx)
 * - form field: file
 * - returns: { success: true, proof: { url, public_id, mimeType } }
 *
 * NOTE: This route is mounted under /api in server.js (app.use('/api', uploadRoutes))
 */
router.post('/upload-proof', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier reçu (champ "file")' });

    // validate mimetype (allow images, pdf, doc/docx)
    const allow = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
      'application/pdf',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
    ];
    const mime = req.file.mimetype || '';
    if (!allow.includes(mime)) {
      return res.status(400).json({ success: false, message: 'Type de fichier non supporté', mime });
    }

    // If Cloudinary configured -> upload to cloudinary
    if (CLOUDINARY_ENABLED) {
      const streamifier = require('streamifier');
      // Put proofs in a dedicated folder if desired
      const folder = process.env.CLOUDINARY_PROOFS_FOLDER || 'py_proofs';

      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'auto' }, // resource_type auto to accept pdf/docx/images
        (err, result) => {
          if (err) {
            console.error('Cloudinary upload err:', err);
            return res.status(500).json({ success: false, message: 'Upload Cloudinary échoué', error: err.message || String(err) });
          }
          return successProofResponse(res, { url: result.secure_url, public_id: result.public_id, mimeType: result.resource_type || mime });
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
      return;
    }

    // Local fallback: write file to public/uploads
    const original = (req.file.originalname || 'upload').replace(/\s+/g, '-');
    const safeName = `${Date.now()}-${Math.round(Math.random()*10000)}-${original}`;
    const outPath = path.join(LOCAL_UPLOAD_DIR, safeName);

    fs.writeFile(outPath, req.file.buffer, (err) => {
      if (err) {
        console.error('Local write failed:', err);
        return res.status(500).json({ success: false, message: 'Écriture locale échouée', error: err.message || String(err) });
      }
      // URL accessible at /uploads/<safeName>
      const urlPath = `/uploads/${safeName}`;
      return successProofResponse(res, { url: urlPath, public_id: null, mimeType: mime });
    });

  } catch (err) {
    console.error('POST /upload-proof error:', err && (err.stack || err));
    return res.status(500).json({ success: false, message: 'Upload échoué', error: String(err) });
  }
});

/**
 * Keep legacy/admin upload endpoint (used by admin news upload)
 * POST /admin/upload (field 'file')
 * returns: { success: true, url, public_id }
 *
 * If you prefer to change path to /api/admin/upload, adapt client accordingly.
 */
router.post('/admin/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'Aucun fichier reçu (champ "file")' });

    const mime = req.file.mimetype || '';

    if (CLOUDINARY_ENABLED) {
      const streamifier = require('streamifier');
      const folder = process.env.CLOUDINARY_FOLDER || 'py_news';
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'auto' },
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

    // local fallback
    try {
      fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
    } catch (e) { /* ignore */ }
    const safeName = `${Date.now()}-${(req.file.originalname || 'upload').replace(/\s+/g, '-')}`;
    const outPath = path.join(LOCAL_UPLOAD_DIR, safeName);
    fs.writeFile(outPath, req.file.buffer, (err) => {
      if (err) {
        console.error('Local write failed:', err);
        return res.status(500).json({ success: false, message: 'Upload failed', error: err.message || String(err) });
      }
      const urlPath = '/uploads/' + safeName;
      return res.json({ success: true, message: 'Upload OK (local)', url: urlPath, public_id: null });
    });

  } catch (err) {
    console.error('POST /admin/upload error:', err && (err.stack || err));
    return res.status(500).json({ success: false, message: 'Upload failed', error: String(err) });
  }
});

module.exports = router;
