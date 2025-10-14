// routes/admin.js
// Admin routes complete: news, transactions, rates, payment-methods
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v2: cloudinary } = require('cloudinary');

const News = require('../models/News');
const Transaction = require('../models/Transaction');
const Rate = require('../models/Rate');
const User = require('../models/user');
const PaymentMethod = require('../models/PaymentMethod'); // NEW

// cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
  secure: true
});

// requireAdmin middleware
async function requireAdmin(req, res, next) {
  try {
    const auth = req.headers['authorization'] || '';
    const parts = auth.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({ success: false, message: 'Token manquant' });
    }
    const token = parts[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
    if (!decoded || !decoded.id) return res.status(401).json({ success: false, message: 'Token invalide' });
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ success: false, message: 'Utilisateur introuvable' });
    if (!(user.role === 'admin' || user.isAdmin)) return res.status(403).json({ success: false, message: 'Accès administrateur requis' });
    req.user = user;
    next();
  } catch (err) {
    console.error('requireAdmin err', err && err.message ? err.message : err);
    return res.status(401).json({ success: false, message: 'Authentification échouée', error: String(err) });
  }
}

/* ---------- NEWS CRUD ---------- */

// GET list
router.get('/admin/news', requireAdmin, async (req, res) => {
  try {
    const list = await News.find().sort({ date: -1 }).limit(1000);
    res.json(list);
  } catch (err) {
    console.error('GET /admin/news', err);
    res.status(500).json({ success: false, message: 'Impossible de récupérer news', error: String(err) });
  }
});

// POST create or update
router.post('/admin/news', requireAdmin, async (req, res) => {
  try {
    const { id, title, description, content, image, image_public_id } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, message: 'Titre requis' });

    if (id) {
      const news = await News.findById(id);
      if (!news) return res.status(404).json({ success: false, message: 'News introuvable' });
      news.title = title.trim();
      news.description = (description || '').trim();
      news.content = (content || '').trim();
      if (image) { news.image = image; if (image_public_id) news.image_public_id = image_public_id; }
      await news.save();
      return res.json({ success: true, message: 'Modification réussie', news });
    } else {
      const newNews = new News({
        title: title.trim(),
        description: (description || '').trim(),
        content: (content || '').trim(),
        image: image || '',
        image_public_id: image_public_id || '',
        author: req.user ? req.user._id : null,
        date: new Date()
      });
      await newNews.save();
      return res.json({ success: true, message: 'Publication réussie', news: newNews });
    }
  } catch (err) {
    console.error('POST /admin/news err', err);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: String(err) });
  }
});

// DELETE news (safe delete, remove cloudinary image if present)
router.delete('/admin/news/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const news = await News.findById(id);
    if (!news) return res.status(404).json({ success: false, message: 'News introuvable' });

    const publicId = news.image_public_id || null;

    // delete DB doc
    await News.findByIdAndDelete(id);

    // delete from Cloudinary (best effort)
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      } catch (e) {
        console.warn('Cloudinary delete failed', e);
      }
    }

    return res.json({ success: true, message: 'Suppression réussie' });
  } catch (err) {
    console.error('DELETE /admin/news/:id err', err);
    res.status(500).json({ success: false, message: 'Erreur suppression', error: String(err) });
  }
});

/* ---------- TRANSACTIONS (admin) ---------- */

// GET all transactions
router.get('/admin/transactions', requireAdmin, async (req, res) => {
  try {
    const txs = await Transaction.find().populate('user').sort({ createdAt: -1 }).limit(2000);
    res.json(txs);
  } catch (err) {
    console.error('GET /admin/transactions err', err);
    res.status(500).json({ success: false, message: 'Impossible de récupérer transactions', error: String(err) });
  }
});

// GET single transaction detail
router.get('/admin/transactions/:id', requireAdmin, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id).populate('user');
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction non trouvée' });
    res.json(tx);
  } catch (err) {
    console.error('GET /admin/transactions/:id err', err);
    res.status(500).json({ success: false, message: 'Erreur', error: String(err) });
  }
});

// POST change transaction status
router.post('/admin/transactions/:id/status', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;
    const allowed = ['pending', 'approved', 'rejected', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Statut invalide' });

    const tx = await Transaction.findById(id);
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction non trouvée' });

    tx.status = status;
    await tx.save();

    try { global.io && global.io.emit('txStatusChanged', { id: tx._id, status }); } catch (e) { console.warn('socket emit failed', e); }

    return res.json({ success: true, message: 'Statut mis à jour', transaction: tx });
  } catch (err) {
    console.error('POST /admin/transactions/:id/status err', err);
    res.status(500).json({ success: false, message: 'Erreur mise à jour statut', error: String(err) });
  }
});

/* ---------- RATES (CRUD) ---------- */

// GET rates
router.get('/admin/rates', requireAdmin, async (req, res) => {
  try {
    const rates = await Rate.find().sort({ pair: 1 });
    res.json(rates);
  } catch (err) {
    console.error('GET /admin/rates err', err);
    res.status(500).json({ success: false, message: 'Impossible de récupérer rates', error: String(err) });
  }
});

// POST add/update rate
router.post('/admin/rates', requireAdmin, async (req, res) => {
  try {
    const { pair, rate, desc } = req.body;
    if (!pair || typeof rate === 'undefined') return res.status(400).json({ success: false, message: 'pair et rate requis' });

    let r = await Rate.findOne({ pair });
    if (r) {
      r.rate = rate;
      r.desc = desc || r.desc;
      await r.save();
      return res.json({ success: true, message: 'Taux mis à jour', rate: r });
    } else {
      r = new Rate({ pair, rate, desc: desc || '' });
      await r.save();
      return res.json({ success: true, message: 'Taux ajouté', rate: r });
    }
  } catch (err) {
    console.error('POST /admin/rates err', err);
    res.status(500).json({ success: false, message: 'Erreur rates', error: String(err) });
  }
});

// DELETE rate
router.delete('/admin/rates/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const r = await Rate.findById(id);
    if (!r) return res.status(404).json({ success: false, message: 'Taux introuvable' });
    await Rate.findByIdAndDelete(id);
    res.json({ success: true, message: 'Suppression du taux réussie' });
  } catch (err) {
    console.error('DELETE /admin/rates/:id err', err);
    res.status(500).json({ success: false, message: 'Erreur suppression taux', error: String(err) });
  }
});

/* ---------- PAYMENT METHODS (CRUD) ---------- */

// GET all payment methods (admin)
router.get('/admin/payment-methods', requireAdmin, async (req, res) => {
  try {
    const methods = await PaymentMethod.find().sort({ type: 1, name: 1 });
    res.json({ success: true, methods });
  } catch (err) {
    console.error('GET /admin/payment-methods err', err);
    res.status(500).json({ success: false, message: 'Impossible de récupérer les méthodes de paiement', error: String(err) });
  }
});

// POST create or update payment method (admin)
router.post('/admin/payment-methods', requireAdmin, async (req, res) => {
  try {
    const { id, name, type, network, details, active } = req.body;
    if (!name || !type || !['crypto', 'fiat'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Nom et type valides requis' });
    }

    if (id) {
      const method = await PaymentMethod.findById(id);
      if (!method) return res.status(404).json({ success: false, message: 'Méthode introuvable' });

      method.name = name.trim();
      method.type = type;
      method.network = network || '';
      method.details = details || '';
      if (typeof active !== 'undefined') method.active = !!active;

      await method.save();
      return res.json({ success: true, message: 'Méthode mise à jour', method });
    } else {
      const newMethod = new PaymentMethod({
        name: name.trim(),
        type,
        network: network || '',
        details: details || '',
        active: typeof active !== 'undefined' ? !!active : true
      });
      await newMethod.save();
      return res.json({ success: true, message: 'Méthode ajoutée', method: newMethod });
    }
  } catch (err) {
    console.error('POST /admin/payment-methods err', err);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: String(err) });
  }
});

// DELETE payment method (admin)
router.delete('/admin/payment-methods/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const method = await PaymentMethod.findById(id);
    if (!method) return res.status(404).json({ success: false, message: 'Méthode introuvable' });
    await PaymentMethod.findByIdAndDelete(id);
    res.json({ success: true, message: 'Méthode supprimée' });
  } catch (err) {
    console.error('DELETE /admin/payment-methods/:id err', err);
    res.status(500).json({ success: false, message: 'Erreur suppression', error: String(err) });
  }
});

module.exports = router;
