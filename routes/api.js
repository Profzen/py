// routes/api.js
// Routes publiques et API (prices, market_chart, news, transactions, rates/currencies, price)
// Mis à jour pour utiliser services/priceService.js et le nouveau modèle Rate (qui représente désormais des currencies)

const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');

const News = require('../models/News');
const Rate = require('../models/Rate'); // nouveau modèle "currency"
const Transaction = require('../models/Transaction');
const User = require('../models/user');
const PaymentMethod = require('../models/PaymentMethod'); // Assure-toi que ce modèle existe

const mailer = require('./mail');

const createPriceService = require('../services/priceService');
const priceService = createPriceService({ autoInit: true, refreshMs: 30_000, maxConcurrent: 6 });

const COINGECKO = process.env.COINGECKO_API || 'https://api.coingecko.com/api/v3';

// --- prices cache (simple) ---
// conserve la route existante qui appelle CoinGecko (liste restée identique)
let pricesCache = null, pricesFetched = 0;
const PRICES_TTL = 30 * 1000;

// GET /api/prices
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

// --- rates / currencies ---
// Note: Rate model now represents a currency (symbol, type, active, displayOrder, meta...)
// Keep /rates for backward-compat, and add /currencies which is clearer.

// GET /api/rates  (legacy name — retourne la liste des currencies)
router.get('/rates', async (req, res) => {
  try {
    const rates = await Rate.find().sort({ displayOrder: 1, symbol: 1 }).lean();
    res.json(rates);
  } catch (err) {
    console.error('GET /api/rates err', err && (err.message || err));
    res.status(500).json({ error: 'Impossible de récupérer rates' });
  }
});

// GET /api/currencies  (nomenclature plus explicite)
router.get('/currencies', async (req, res) => {
  try {
    const currencies = await Rate.find().sort({ displayOrder: 1, symbol: 1 }).lean();
    res.json(currencies);
  } catch (err) {
    console.error('GET /api/currencies err', err && (err.message || err));
    res.status(500).json({ error: 'Impossible de récupérer currencies' });
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

// --- helper: getUserFromHeader (returns user or null) ---
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

/**
 * GET /api/price?pair=USDT-XOF
 * Returns the latest cached/remote price for a pair using services/priceService.js
 * Response:
 * {
 *   pair, coinbasePrice, buyPriceForUs, sellPriceForUs, lastUpdated,
 *   (optional) quote: { amountProvided, amountConverted, note }
 * }
 *
 * Optional query parameters:
 * - amount (number) : interpreted as amount in BASE (crypto) to be converted to QUOTE
 * - operation (string) : 'sell' (client sells crypto -> we buy at buyPriceForUs) OR 'buy' (client buys crypto -> we sell at sellPriceForUs)
 *
 * Example:
 * GET /api/price?pair=USDT-XOF&amount=1&operation=sell
 */
router.get('/price', async (req, res) => {
  try {
    const pair = (req.query.pair || '').toString().trim().toUpperCase();
    if (!pair) return res.status(400).json({ error: 'Query param pair is required (e.g. USDT-XOF)' });

    // normalize pair to format BASE-QUOTE
    const normalized = pair.replace(/\s+/g, '').replace(/[_]/g, '-');

    // get price from service (will fetch & cache as necessary)
    const data = await priceService.getPrice(normalized); // { pair, coinbasePrice, buyPriceForUs, sellPriceForUs, lastUpdated }

    // optional conversion if amount provided
    const amountParam = req.query.amount;
    const operation = (req.query.operation || '').toString().toLowerCase(); // 'sell' or 'buy'
    let quote = null;
    if (amountParam !== undefined && amountParam !== null && amountParam !== '') {
      const amount = Number(amountParam);
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ error: 'amount must be a positive number' });
      }
      // Interpret amount as amount in BASE (crypto). Convert to QUOTE (fiat) using appropriate price:
      // - operation === 'sell' -> client sells crypto -> we buy, use buyPriceForUs
      // - operation === 'buy'  -> client buys crypto -> we sell, use sellPriceForUs
      const priceUsed = (operation === 'sell') ? data.buyPriceForUs : (operation === 'buy') ? data.sellPriceForUs : null;
      if (priceUsed === null) {
        // if no operation provided, return both conversions (using buy and sell)
        quote = {
          amountBase: amount,
          usingBuyPriceForUs: {
            price: data.buyPriceForUs,
            amountQuote: Number((amount * data.buyPriceForUs).toFixed(6))
          },
          usingSellPriceForUs: {
            price: data.sellPriceForUs,
            amountQuote: Number((amount * data.sellPriceForUs).toFixed(6))
          },
          note: 'amount interpreted as BASE (crypto). Use operation=sell (client sells) or operation=buy (client buys) to get single conversion.'
        };
      } else {
        quote = {
          amountBase: amount,
          priceUsed,
          amountQuote: Number((amount * priceUsed).toFixed(6)),
          note: `Converted amount in QUOTE currency using ${operation === 'sell' ? 'buyPriceForUs (we buy from client)' : 'sellPriceForUs (we sell to client)'}`
        };
      }
    }

    const resp = {
      pair: data.pair,
      coinbasePrice: data.coinbasePrice,
      buyPriceForUs: data.buyPriceForUs,
      sellPriceForUs: data.sellPriceForUs,
      lastUpdated: data.lastUpdated,
      ...(quote ? { quote } : {})
    };

    res.json(resp);
  } catch (err) {
    console.error('GET /api/price err', err && (err.message || err));
    res.status(500).json({ error: 'Impossible de récupérer le prix pour cette paire', details: String(err) });
  }
});

/**
 * POST /api/transactions
 * - Accepte transactions même sans token (guest).
 * - Peut recevoir un objet `proof` (body.proof) => sera stocké dans details.proof
 * - Forcer status: 'pending'
 * - Structure attendue dans body: { from, to, amountFrom, amountTo, type, details, proof }
 */
router.post('/transactions', async (req, res) => {
  try {
    const { from, to, amountFrom, amountTo, type, details: rawDetails, proof } = req.body || {};

    // basic validation
    if (!from || !to || typeof amountFrom === 'undefined' || typeof amountTo === 'undefined') {
      return res.status(400).json({ success: false, message: 'Champs requis: from, to, amountFrom, amountTo' });
    }

    const user = await getUserFromHeader(req); // may be null -> guest allowed

    // normalize details: ensure it's an object
    let details = {};
    if (rawDetails && typeof rawDetails === 'object') details = { ...rawDetails };
    // If a separate proof object provided in body, attach it under details.proof
    if (proof && typeof proof === 'object') {
      // keep only url, public_id, mimeType if present
      const p = {};
      if (proof.url) p.url = proof.url;
      if (proof.public_id) p.public_id = proof.public_id;
      if (proof.mimeType) p.mimeType = proof.mimeType;
      if (Object.keys(p).length > 0) details.proof = p;
    } else if (details.proof && typeof details.proof === 'string') {
      // if client sent details.proof as a string (url), convert to object
      details.proof = { url: details.proof };
    }

    const txDoc = await Transaction.create({
      user: user ? user._id : null,
      type: type || 'unknown',
      from, to,
      amountFrom: Number(amountFrom),
      amountTo: Number(amountTo),
      details: details || {},
      status: 'pending',      // force pending by default
      createdAt: new Date()
    });

    // emit newTransaction via socket.io (admins can listen)
    try { global.io && global.io.emit('newTransaction', txDoc); } catch (e) { console.warn('socket emit failed', e); }

    // determine client email (either from logged user or details.email)
    let clientEmail = null;
    if (user && user.email) clientEmail = user.email;
    else if (details && typeof details === 'object') {
      clientEmail = details.email || details.emailAddress || details.mail || null;
    }

    // send emails (best-effort)
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

/**
 * GET /api/transactions
 * - ?mine=1 -> return user's transactions if token present (else [] for guests)
 * - otherwise -> public listing (admin should use /admin/transactions)
 */
router.get('/transactions', async (req, res) => {
  try {
    const mine = req.query.mine === '1';
    const user = await getUserFromHeader(req);
    let txs;
    if (mine) {
      if (user) {
        txs = await Transaction.find({ user: user._id }).sort({ createdAt: -1 });
      } else {
        // guest: frontend uses localStorage; keep empty to indicate none on server
        txs = [];
      }
    } else {
      // public listing (not paginated here) - admin UI should prefer /admin/transactions
      txs = await Transaction.find().populate('user').sort({ createdAt: -1 }).limit(1000);
    }
    res.json(txs);
  } catch (err) {
    console.error('GET /api/transactions err', err);
    res.status(500).json({ error: 'Impossible de récupérer les transactions' });
  }
});

module.exports = router;
