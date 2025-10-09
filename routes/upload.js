// routes/upload.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'py_crypto_news',
    format: async (req, file) => 'png',
    allowed_formats: ['jpg','png','jpeg','webp']
  }
});
const upload = multer({ storage });

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';
function adminAuth(req,res,next){
  const auth = req.headers['authorization'];
  if(!auth) return res.status(401).json({ message:'Token manquant' });
  const token = auth.split(' ')[1];
  if(!token) return res.status(401).json({ message:'Token manquant' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if(decoded.role !== 'admin') return res.status(403).json({ message:'Accès interdit' });
    req.admin = decoded;
    next();
  } catch(err){
    return res.status(401).json({ message:'Token invalide' });
  }
}

// POST /admin/upload
router.post('/admin/upload', adminAuth, upload.single('file'), (req,res) => {
  try {
    // multer-storage-cloudinary returns req.file with path
    const imageUrl = req.file.path || req.file?.location || req.file?.url || null;
    if(!imageUrl) return res.status(500).json({ success:false, message:'Upload failed' });
    res.json({ success:true, url: imageUrl });
  } catch(err){
    console.error('upload error', err);
    res.status(500).json({ success:false, message:'Erreur upload' });
  }
});

module.exports = router;
