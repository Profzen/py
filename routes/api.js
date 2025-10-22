// routes/api.js
// Routes publiques et API (prices, market_chart, news, transactions, rates/currencies, price)
// Mis à jour pour utiliser services/priceService.js et le modèle Currency / Rate (compatibilité)

const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const News = require('../models/News');
const Transaction = require('../models/Transaction');
const User = require('../models/user');

let CurrencyModel = null;
// try to prefer models/Currency.js, fallback to models/Rate.js for compatibility
try {
  CurrencyModel = require('../models/Currency');
} catch (e) {
  try {
    CurrencyModel = require('../models/Rate');
  } catch (e2) {
    CurrencyModel = null;
  }
}

const PaymentMethod = (() => {
  try { return require('../models/PaymentMethod'); } catch(e){ return null; }
})();

const mailer = require('./mail');

const createPriceService = require('../services/priceService');
const priceService = createPriceService({ autoInit: true, refreshMs: 30_000, maxConcurrent: 6 });

const COINGECKO = process.env.COINGECKO_API || 'https://api.coingecko.com/api/v3';

// --- prices cache (simple) ---
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
// Keep /rates for backward-compat and provide /currencies as clearer name

// Helper to fetch currencies (uses CurrencyModel if available)
async function fetchCurrencies() {
  if (!CurrencyModel) return [];
  return CurrencyModel.find().sort({ displayOrder: 1, symbol: 1 }).lean();
}

// GET /api/rates (legacy)
router.get('/rates', async (req, res) => {
  try {
    const list = await fetchCurrencies();
    res.json(list);
  } catch (err) {
    console.error('GET /api/rates err', err && (err.message || err));
    res.status(500).json({ error: 'Impossible de récupérer rates' });
  }
});

// GET /api/currencies (explicit)
router.get('/currencies', async (req, res) => {
  try {
    const list = await fetchCurrencies();
    res.json(list);
  } catch (err) {
    console.error('GET /api/currencies err', err && (err.message || err));
    res.status(500).json({ error: 'Impossible de récupérer currencies' });
  }
});

// --- payments ---
router.get('/payments', async (req, res) => {
  try {
    if (!PaymentMethod) {
      // fallback empty list if model not available
      return res.json([]);
    }
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
 * Uses priceService.getPrice(pair)
 */
router.get('/price', async (req, res) => {
  try {
    const pairRaw = (req.query.pair || '').toString().trim().toUpperCase();
    if (!pairRaw) return res.status(400).json({ error: 'Query param pair is required (e.g. USDT-XOF)' });

    const normalized = pairRaw.replace(/\s+/g, '').replace(/[_]/g, '-');

    // get price data (priceService will throw if invalid pair)
    const data = await priceService.getPrice(normalized);

    // optional conversion
    const amountParam = req.query.amount;
    const operation = (req.query.operation || '').toString().toLowerCase();
    let quote = null;

    if (amountParam !== undefined && amountParam !== null && amountParam !== '') {
      const amount = Number(amountParam);
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ error: 'amount must be a positive number' });
      }

      // choose price depending on operation
      const priceSell = Number(data.sellPriceForUs || data.coinbasePrice || 0); // client buys crypto (we sell)
      const priceBuy = Number(data.buyPriceForUs || data.coinbasePrice || 0);   // client sells crypto (we buy)

      // Use high-precision arithmetic via Number but avoid premature rounding; formatting only for output.
      if (operation === 'sell') {
        const amountQuote = amount * priceBuy;
        quote = {
          amountBase: amount,
          priceUsed: priceBuy,
          amountQuote: amountQuote,
          amountQuoteFormatted: Number(amountQuote).toString()
        };
      } else if (operation === 'buy') {
        const amountQuote = amount * priceSell;
        quote = {
          amountBase: amount,
          priceUsed: priceSell,
          amountQuote: amountQuote,
          amountQuoteFormatted: Number(amountQuote).toString()
        };
      } else {
        // return both
        const amountQuoteUsingBuy = amount * priceBuy;
        const amountQuoteUsingSell = amount * priceSell;
        quote = {
          amountBase: amount,
          usingBuyPriceForUs: {
            price: priceBuy,
            amountQuote: amountQuoteUsingBuy,
            amountQuoteFormatted: Number(amountQuoteUsingBuy).toString()
          },
          usingSellPriceForUs: {
            price: priceSell,
            amountQuote: amountQuoteUsingSell,
            amountQuoteFormatted: Number(amountQuoteUsingSell).toString()
          }
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

    return res.json(resp);
  } catch (err) {
    console.error('GET /api/price err', err && (err.message || err));
    return res.status(500).json({ error: 'Impossible de récupérer le prix pour cette paire', details: String(err) });
  }
});

/**
 * POST /api/transactions
 * Accept guest transactions; store proof URL/object if provided inside details.proof
 */
router.post('/transactions', async (req, res) => {
  try {
    const { from, to, amountFrom, amountTo, type, details: rawDetails, proof } = req.body || {};

    if (!from || !to || typeof amountFrom === 'undefined' || typeof amountTo === 'undefined') {
      return res.status(400).json({ success: false, message: 'Champs requis: from, to, amountFrom, amountTo' });
    }

    const user = await getUserFromHeader(req);

    let details = {};
    if (rawDetails && typeof rawDetails === 'object') details = { ...rawDetails };

    if (proof && typeof proof === 'object') {
      const p = {};
      if (proof.url) p.url = proof.url;
      if (proof.public_id) p.public_id = proof.public_id;
      if (proof.mimeType) p.mimeType = proof.mimeType;
      if (proof.filename) p.filename = proof.filename;
      if (Object.keys(p).length > 0) details.proof = p;
    } else if (details && typeof details.proof === 'string') {
      details.proof = { url: details.proof };
    }

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

    return res.json({ success: true, message: 'Transaction créée', transaction: txDoc });
  } catch (err) {
    console.error('create tx err', err && (err.message || err));
    return res.status(500).json({ success: false, message: 'Impossible de créer la transaction', error: String(err) });
  }
});

/**
 * GET /api/transactions
 * ?mine=1 -> user's transactions (token required)
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
        txs = [];
      }
    } else {
      txs = await Transaction.find().populate('user').sort({ createdAt: -1 }).limit(1000);
    }
    return res.json(txs);
  } catch (err) {
    console.error('GET /api/transactions err', err);
    return res.status(500).json({ error: 'Impossible de récupérer les transactions' });
  }
});

module.exports = router;
