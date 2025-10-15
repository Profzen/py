// routes/api.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');

const News = require('../models/News');
const Rate = require('../models/Rate');
const Transaction = require('../models/Transaction');
const User = require('../models/user');
const PaymentMethod = require('../models/PaymentMethod'); // <-- ton modèle de paiement

const mailer = require('./mail');

const COINGECKO = process.env.COINGECKO_API || 'https://api.coingecko.com/api/v3';

// --- prices cache (simple) ---
let pricesCache = null, pricesFetched = 0;
const PRICES_TTL = 30 * 1000;

router.get('/prices', async (req, res) => {
  try {
    const now = Date.now();
    if (pricesCache && (now - pricesFetched) < PRICES_TTL) {
      return res.json({ source: 'cache', prices: pricesCache });
    }
    const ids = [
      'bitcoin','ethereum','tether','usd-coin','solana',
      'binancecoin','cardano','dogecoin','matic-network','litecoin'
    ].join(',');
    const r = await axios.get(`${COINGECKO}/simple/price`, { params: { ids, vs_currencies: 'usd' }, timeout: 10000 });
    pricesCache = r.data; pricesFetched = Date.now();
    res.json({ source: 'coingecko', prices: pricesCache });
  } catch (err) {
    console.error('prices err', err && (err.message || err));
    if (pricesCache) return res.json({ source: 'cache-stale', prices: pricesCache });
    res.status(500).json({ error: 'Impossible de récupérer les prix' });
  }
});

// --- market_chart (single coin) ---
const marketCache = {};
const MARKET_TTL = 60 * 1000;

router.get('/market_chart', async (req, res) => {
  const coin = req.query.coin || 'bitcoin';
  const days = req.query.days || '1';
  const key = `${coin}_${days}`;
  const now = Date.now();
  try {
    if (marketCache[key] && (now - marketCache[key].ts) < MARKET_TTL) {
      return res.json({ source: 'cache', data: marketCache[key].data });
    }
    const r = await axios.get(`${COINGECKO}/coins/${coin}/market_chart`, { params: { vs_currency: 'usd', days }, timeout: 10000 });
    const points = (r.data.prices || []).map(p => ({ t: p[0], v: p[1] }));
    marketCache[key] = { ts: Date.now(), data: points };
    res.json({ source: 'coingecko', data: points });
  } catch (err) {
    console.error('market_chart err', err && (err.message || err));
    if (marketCache[key]) return res.json({ source: 'cache-stale', data: marketCache[key].data });
    res.status(500).json({ error: 'Impossible de récupérer market chart' });
  }
});

// --- news ---
router.get('/news', async (req, res) => {
  try {
    const news = await News.find().sort({ date: -1 });
    res.json(news);
  } catch (err) {
    console.error('GET /api/news err', err);
    res.status(500).json({ error: 'Impossible de récupérer news' });
  }
});

// --- rates ---
router.get('/rates', async (req, res) => {
  try {
    const rates = await Rate.find().sort({ pair: 1 });
    res.json(rates);
  } catch (err) {
    console.error('GET /api/rates err', err);
    res.status(500).json({ error: 'Impossible de récupérer rates' });
  }
});

// --- payments ---
router.get('/payments', async (req, res) => {
  try {
    const payments = await PaymentMethod.find().sort({ type: 1, name: 1 });
    res.json(payments);
  } catch (err) {
    console.error('GET /api/payments err', err);
    res.status(500).json({ error: 'Impossible de récupérer les moyens de paiement' });
  }
});

// --- helper: getUserFromHeader ---
async function getUserFromHeader(req) {
  try {
    const auth = req.headers['authorization'] || '';
    if (!auth) return null;
    const parts = auth.split(' ');
    if (parts.length !== 2) return null;
    const token = parts[1];
    if (!token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
    if (!decoded || !decoded.id) return null;
    const user = await User.findById(decoded.id);
    return user || null;
  } catch (e) {
    return null;
  }
}

// --- transactions ---
router.post('/transactions', async (req, res) => {
  try {
    const { from, to, amountFrom, amountTo, type, details } = req.body || {};
    if (!from || !to || typeof amountFrom === 'undefined' || typeof amountTo === 'undefined') {
      return res.status(400).json({ success: false, message: 'Champs requis: from, to, amountFrom, amountTo' });
    }

    const user = await getUserFromHeader(req);

    const txDoc = await Transaction.create({
      user: user ? user._id : null,
      type: type || 'unknown',
      from, to,
      amountFrom: Number(amountFrom),
      amountTo: Number(amountTo),
      details: details || {},
      status: 'pending',
      createdAt: new Date()
    });

    try { global.io && global.io.emit('newTransaction', txDoc); } catch (e) { console.warn('socket emit failed', e); }

    let clientEmail = null;
    if (user && user.email) clientEmail = user.email;
    else if (details && typeof details === 'object') {
      clientEmail = details.email || details.emailAddress || details.mail || null;
    }

    try {
      mailer.sendTransactionCreated(txDoc, clientEmail).catch(err => {
        console.warn('mailer.sendTransactionCreated failed', err && err.message ? err.message : err);
      });
    } catch (mailErr) {
      console.warn('sendTransactionCreated threw', mailErr && mailErr.message ? mailErr.message : mailErr);
    }

    res.json({ success: true, message: 'Transaction créée', transaction: txDoc });
  } catch (err) {
    console.error('create tx err', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Impossible de créer la transaction', error: String(err) });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const mine = req.query.mine === '1';
    const user = await getUserFromHeader(req);
    let txs;
    if (mine) {
      if (user) txs = await Transaction.find({ user: user._id }).sort({ createdAt: -1 });
      else txs = [];
    } else {
      txs = await Transaction.find().populate('user').sort({ createdAt: -1 }).limit(1000);
    }
    res.json(txs);
  } catch (err) {
    console.error('GET /api/transactions err', err);
    res.status(500).json({ error: 'Impossible de récupérer les transactions' });
  }
});

module.exports = router;
