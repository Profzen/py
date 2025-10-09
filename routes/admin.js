// routes/admin.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const News = require('../models/News');
const Rate = require('../models/Rate');
const Transaction = require('../models/Transaction');
const User = require('../models/user');

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
  } catch(err){ return res.status(401).json({ message:'Token invalide' }); }
}

// admin transactions list
router.get('/admin/transactions', adminAuth, async (req,res) => {
  try { const txs = await Transaction.find().populate('user').sort({ createdAt: -1 }); res.json(txs); } catch(err){ console.error(err); res.status(500).json({ error:'Impossible' }); }
});

// update status
router.post('/admin/transactions/:id/status', adminAuth, async (req,res) => {
  try {
    const id = req.params.id; const { status } = req.body;
    if(!['approved','rejected'].includes(status)) return res.status(400).json({ message:'Status invalide' });
    const tx = await Transaction.findById(id);
    if(!tx) return res.status(404).json({ message:'Transaction introuvable' });
    tx.status = status; tx.updatedAt = Date.now(); await tx.save();
    // emit via socket.io so user or admin clients see change in real-time
    try { global.io && global.io.emit('txStatusChanged', { id: tx._id.toString(), status: tx.status, tx }); } catch(e){ console.warn('socket emit failed', e); }
    res.json({ success:true, message:'Status mis à jour', tx });
  } catch(err){ console.error(err); res.status(500).json({ error:'Impossible de modifier' }); }
});

// admin: users list
router.get('/admin/users', adminAuth, async (req,res) => { try { const users = await User.find().sort({ createdAt:-1 }); res.json(users); } catch(err){ console.error(err); res.status(500).json({ error:'Impossible' }); } });

// admin: create news
router.post('/admin/news', adminAuth, async (req,res) => {
  try { const { title, description, content, image, link } = req.body; const news = await News.create({ title, description, content, image, link }); res.json({ success:true, message:'News ajoutée', news }); } catch(err){ console.error(err); res.status(500).json({ error:'Impossible d\'ajouter news' }); }
});

// admin: rates
router.post('/admin/rates', adminAuth, async (req,res) => {
  try { const { pair, rate } = req.body; const existing = await Rate.findOne({ pair }); if(existing){ existing.rate = rate; existing.updatedAt = Date.now(); await existing.save(); } else await Rate.create({ pair, rate }); res.json({ success:true, message:'Taux ajouté/modifié' }); } catch(err){ console.error(err); res.status(500).json({ error:'Impossible de modifier' }); }
});

module.exports = router;
