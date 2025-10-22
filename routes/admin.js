// routes/admin.js
// Admin routes complete: news, transactions, currencies, + payment-methods
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v2: cloudinary } = require('cloudinary');
const mongoose = require('mongoose');

const News = require('../models/News');
const Transaction = require('../models/Transaction');
const Currency = require('../models/Currency'); // NEW: currencies model
const User = require('../models/user');

const mailer = require('./mail'); // mailer (best-effort)

// cloudinary config (kept)
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

/* ---------- PAYMENT METHODS model bootstrap (use existing model if present) ---------- */
let PaymentMethod;
try {
  PaymentMethod = require('../models/PaymentMethod');
  if (PaymentMethod && PaymentMethod.modelName) {
    // ok
  } else if (PaymentMethod && PaymentMethod.default && PaymentMethod.default.modelName) {
    PaymentMethod = PaymentMethod.default;
  }
} catch (e) {
  if (mongoose && !mongoose.models.PaymentMethod) {
    const pmSchema = new mongoose.Schema({
      name: { type: String, required: true },
      type: { type: String, enum: ['fiat', 'crypto'], default: 'fiat' },
      network: { type: String, default: '' },
      details: { type: String, default: '' },
      active: { type: Boolean, default: true },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    }, { timestamps: true });
    PaymentMethod = mongoose.model('PaymentMethod', pmSchema);
  } else {
    PaymentMethod = null;
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

    // emit socket update
    try { global.io && global.io.emit('txStatusChanged', { id: tx._id, status }); } catch (e) { console.warn('socket emit failed', e); }

    // attempt to notify client by email
    try {
      let clientEmail = null;
      if (tx.user) {
        if (typeof tx.user === 'object' && tx.user.email) clientEmail = tx.user.email;
        else {
          const u = await User.findById(tx.user);
          if (u && u.email) clientEmail = u.email;
        }
      }
      if (!clientEmail && tx.details && typeof tx.details === 'object') {
        clientEmail = tx.details.email || tx.details.emailAddress || null;
      }

      if (clientEmail) {
        mailer.sendTransactionStatusChanged(tx, clientEmail).catch(err => {
          console.warn('mailer.sendTransactionStatusChanged failed', err && err.message ? err.message : err);
        });
      }
    } catch (mailErr) {
      console.warn('Error sending status changed email', mailErr && mailErr.message ? mailErr.message : mailErr);
    }

    return res.json({ success: true, message: 'Statut mis à jour', transaction: tx });
  } catch (err) {
    console.error('POST /admin/transactions/:id/status err', err);
    res.status(500).json({ success: false, message: 'Erreur mise à jour statut', error: String(err) });
  }
});

/* ---------- CURRENCIES (CRUD) ---------- */

// GET currencies (admin)
router.get('/admin/currencies', requireAdmin, async (req, res) => {
  try {
    const list = await Currency.find().sort({ displayOrder: 1, symbol: 1 });
    return res.json({ success: true, currencies: list });
  } catch (err) {
    console.error('GET /admin/currencies err', err);
    return res.status(500).json({ success: false, message: 'Impossible de récupérer devises', error: String(err) });
  }
});

// POST create/update currency (upsert by symbol or id)
// Accepts payload: { id?, symbol, name?, type?, active?, displayOrder?, decimals?, logoUrl? }
router.post('/admin/currencies', requireAdmin, async (req, res) => {
  try {
    const payload = req.body || {};
    // If id provided -> update by id
    if (payload.id) {
      const doc = await Currency.findById(payload.id);
      if (!doc) return res.status(404).json({ success: false, message: 'Devise introuvable' });
      if (payload.symbol) doc.symbol = String(payload.symbol).toUpperCase().trim();
      if (typeof payload.name === 'string') doc.name = payload.name;
      if (payload.type) doc.type = payload.type;
      if (typeof payload.active === 'boolean') doc.active = payload.active;
      if (typeof payload.displayOrder === 'number') doc.displayOrder = payload.displayOrder;
      if (payload.decimals !== undefined) doc.meta = doc.meta || {}, doc.meta.decimals = Number(payload.decimals);
      if (payload.logoUrl !== undefined) doc.meta = doc.meta || {}, doc.meta.logoUrl = payload.logoUrl;
      await doc.save();
      return res.json({ success: true, message: 'Devise mise à jour', currency: doc });
    }

    // else if symbol present -> upsertBySymbol
    if (!payload.symbol || !String(payload.symbol).trim()) {
      return res.status(400).json({ success: false, message: 'symbol requis pour créer/modifier la devise' });
    }

    const up = await Currency.upsertBySymbol({
      symbol: payload.symbol,
      name: payload.name,
      type: payload.type,
      active: typeof payload.active === 'boolean' ? payload.active : true,
      displayOrder: typeof payload.displayOrder === 'number' ? payload.displayOrder : 0,
      decimals: typeof payload.decimals === 'number' ? payload.decimals : undefined,
      logoUrl: payload.logoUrl
    });

    return res.json({ success: true, message: 'Devise ajoutée/mise à jour', currency: up });
  } catch (err) {
    console.error('POST /admin/currencies err', err);
    return res.status(500).json({ success: false, message: 'Erreur sauvegarde devise', error: String(err) });
  }
});

// DELETE currency
router.delete('/admin/currencies/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await Currency.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: 'Devise introuvable' });
    await Currency.findByIdAndDelete(id);
    return res.json({ success: true, message: 'Devise supprimée' });
  } catch (err) {
    console.error('DELETE /admin/currencies/:id err', err);
    return res.status(500).json({ success: false, message: 'Erreur suppression devise', error: String(err) });
  }
});

/* ---------- PAYMENT METHODS (CRUD) ---------- */

// GET payment methods
router.get('/admin/payment-methods', requireAdmin, async (req, res) => {
  try {
    if (!PaymentMethod) return res.status(500).json({ success: false, message: 'PaymentMethod model non disponible' });
    const methods = await PaymentMethod.find().sort({ createdAt: -1 });
    return res.json({ success: true, methods });
  } catch (err) {
    console.error('GET /admin/payment-methods err', err);
    return res.status(500).json({ success: false, message: 'Impossible de récupérer moyens de paiement', error: String(err) });
  }
});

// POST create or update payment method
router.post('/admin/payment-methods', requireAdmin, async (req, res) => {
  try {
    if (!PaymentMethod) return res.status(500).json({ success: false, message: 'PaymentMethod model non disponible' });
    const { id, name, type, network, details, active } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Nom requis' });

    if (id) {
      const pm = await PaymentMethod.findById(id);
      if (!pm) return res.status(404).json({ success: false, message: 'Méthode introuvable' });
      pm.name = name.trim();
      pm.type = type || pm.type;
      pm.network = network || pm.network;
      pm.details = details || pm.details;
      pm.active = typeof active === 'boolean' ? active : pm.active;
      pm.updatedAt = new Date();
      await pm.save();
      return res.json({ success: true, message: 'Méthode mise à jour', method: pm });
    } else {
      const pm = new PaymentMethod({
        name: name.trim(),
        type: type || 'fiat',
        network: network || '',
        details: details || '',
        active: typeof active === 'boolean' ? active : true
      });
      await pm.save();
      return res.status(201).json({ success: true, message: 'Méthode créée', method: pm });
    }
  } catch (err) {
    console.error('POST /admin/payment-methods err', err);
    return res.status(500).json({ success: false, message: 'Erreur sauvegarde méthode', error: String(err) });
  }
});

// DELETE payment method
router.delete('/admin/payment-methods/:id', requireAdmin, async (req, res) => {
  try {
    if (!PaymentMethod) return res.status(500).json({ success: false, message: 'PaymentMethod model non disponible' });
    const id = req.params.id;
    const pm = await PaymentMethod.findById(id);
    if (!pm) return res.status(404).json({ success: false, message: 'Méthode introuvable' });
    await PaymentMethod.findByIdAndDelete(id);
    return res.json({ success: true, message: 'Méthode supprimée' });
  } catch (err) {
    console.error('DELETE /admin/payment-methods/:id err', err);
    return res.status(500).json({ success: false, message: 'Erreur suppression méthode', error: String(err) });
  }
});

module.exports = router;
