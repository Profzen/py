// routes/api.js
// Routes publiques et API (prices, market_chart, news, transactions, currencies, price pair)
// Mis à jour pour travailler avec Rate (devises) et CoinGecko pour cours en temps réel.

const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');

const News = require('../models/News');
const Rate = require('../models/Rate'); // maintenant devise (symbol, type, decimals, enabled)
const Transaction = require('../models/Transaction');
const User = require('../models/user');
let PaymentMethod;
try { PaymentMethod = require('../models/PaymentMethod'); } catch (e) { PaymentMethod = null; }

const mailer = require('./mail');

const COINGECKO = process.env.COINGECKO_API || 'https://api.coingecko.com/api/v3';

// --- prices cache (simple) (existing route) ---
let pricesCache = null, pricesFetched = 0;
const PRICES_TTL = 30 * 1000;

// GET /api/prices (kept for legacy/simple list)
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

// --- currencies (anciennement rates list) ---
router.get('/currencies', async (req, res) => {
  try {
    // retourne toutes les devises (admin UI pourra filtrer enabled)
    const list = await Rate.find().sort({ symbol: 1 }).lean();
    res.json({ success: true, currencies: list });
  } catch (err) {
    console.error('GET /api/currencies err', err);
    res.status(500).json({ success: false, message: 'Impossible de récupérer currencies', error: String(err) });
  }
});

// --- legacy /rates kept for compatibility (returns same as /currencies) ---
router.get('/rates', async (req, res) => {
  try {
    const rates = await Rate.find().sort({ symbol: 1 });
    res.json(rates);
  } catch (err) {
    console.error('GET /api/rates err', err);
    res.status(500).json({ error: 'Impossible de récupérer rates' });
  }
});

// --- payments ---
router.get('/payments', async (req, res) => {
  try {
    if (!PaymentMethod) return res.status(500).json({ error: 'PaymentMethod model non disponible' });
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

// --- mapping simple symbol -> coingecko id (common tokens)
//  You can extend this map or implement a dynamic resolver via /coins/list if needed.
const SYMBOL_TO_CG = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'USDT': 'tether',
  'USDC': 'usd-coin',
  'SOL': 'solana',
  'BNB': 'binancecoin',
  'ADA': 'cardano',
  'DOGE': 'dogecoin',
  'MATIC': 'matic-network',
  'LTC': 'litecoin',
  'XRP': 'ripple'
};

// Cache per pair (short TTL 15s to match UI)
const pairCache = {}; // { key: { ts: <ms>, data: { market_price, platform_buy_price, platform_sell_price, timestamp, raw } } }
const PAIR_TTL = 15 * 1000;

/**
 * Helper: resolveCoinGeckoId(symbolOrId)
 * - If input looks like a known CoinGecko id (contains '-'), return as-is.
 * - If symbol matches SYMBOL_TO_CG map, return corresponding id.
 * - Otherwise try lowercased symbol (sometimes id == lowercase symbol).
 */
function resolveCoinGeckoId(symbolOrId) {
  if (!symbolOrId) return null;
  const s = String(symbolOrId).trim();
  if (s.includes('-')) return s.toLowerCase();
  const up = s.toUpperCase();
  if (SYMBOL_TO_CG[up]) return SYMBOL_TO_CG[up];
  // fallback to lowercase symbol (may work for some coins)
  return s.toLowerCase();
}

/**
 * GET /api/price?from=USDT&to=XOF
 * - from: symbol (crypto or fiat)
 * - to: symbol (crypto or fiat)
 *
 * Returns:
 * {
 *   pair: "USDT-XOF",
 *   market_price: <Number>, // price expressed as (to currency) per 1 unit of from currency
 *   platform_buy_price: <Number>, // platform buys from client (client sells) = market * 0.995
 *   platform_sell_price: <Number>, // platform sells to client (client buys) = market * 1.03
 *   price_display: <Number> // (depending on optional direction param) - but we return both platform prices
 *   timestamp: ISOString,
 *   source: 'coingecko',
 *   raw: {...}
 * }
 *
 * Notes:
 * - We round prices according to Rate.getDecimals(to)
 */
router.get('/price', async (req, res) => {
  try {
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();
    if (!from || !to) return res.status(400).json({ success: false, message: 'Paramètres requis: from et to' });

    const key = `${from.toUpperCase()}-${to.toUpperCase()}`;
    const now = Date.now();
    if (pairCache[key] && (now - pairCache[key].ts) < PAIR_TTL) {
      return res.json({ success: true, pair: key, cached: true, ...pairCache[key].data });
    }

    // Determine whether 'from' is crypto or fiat by consulting Rate model (best-effort)
    const fromDoc = await Rate.findOne({ symbol: from.toUpperCase() }).lean();
    const toDoc = await Rate.findOne({ symbol: to.toUpperCase() }).lean();

    // For CoinGecko, we need crypto id for the coin. If 'from' is crypto -> get its id.
    // If 'from' is fiat and 'to' is crypto, we'll get price of the crypto in fiat (same endpoint).
    let marketPrice = null;
    let cgRaw = null;

    // Strategy:
    // 1) If from looks like known crypto symbol -> resolve id and request simple/price with vs_currencies=to (lowercase)
    // 2) Else if to looks like crypto -> resolve id for 'to' and request price, then invert (price = 1 / price_to_in_from)
    // 3) Else error.

    const fromIsCrypto = fromDoc ? (fromDoc.type === 'crypto') : null;
    const toIsCrypto = toDoc ? (toDoc.type === 'crypto') : null;

    // Helper to call CoinGecko simple/price
    async function fetchSimplePrice(ids, vs_currencies) {
      const r = await axios.get(`${COINGECKO}/simple/price`, {
        params: { ids, vs_currencies, include_last_updated_at: true },
        timeout: 10000
      });
      return r.data;
    }

    // Case A: from is crypto -> price = price of 'from' in 'to' (common)
    if (fromIsCrypto === true || (from.toUpperCase() !== to.toUpperCase() && resolveCoinGeckoId(from))) {
      const fromId = resolveCoinGeckoId(from);
      const vs = to.toLowerCase();
      try {
        const data = await fetchSimplePrice(fromId, vs);
        // data example: { tether: { xof: 600, last_updated_at: 169... } }
        if (data && data[fromId] && typeof data[fromId][vs] !== 'undefined') {
          marketPrice = Number(data[fromId][vs]);
          cgRaw = { data };
        } else {
          // if coin not found for vs_currency, fallback try swapping strategy below
          marketPrice = null;
        }
      } catch (e) {
        // continue to other strategies
        console.warn('fetchSimplePrice failed (from->to)', e && e.message ? e.message : e);
      }
    }

    // Case B: try reverse: if to is crypto -> get price of 'to' in 'from' and invert
    if ((marketPrice === null || typeof marketPrice === 'undefined') && to) {
      const toId = resolveCoinGeckoId(to);
      if (toId) {
        const vs = from.toLowerCase();
        try {
          const data = await fetchSimplePrice(toId, vs);
          if (data && data[toId] && typeof data[toId][vs] !== 'undefined') {
            const priceToInFrom = Number(data[toId][vs]); // price of 'to' in 'from' units
            if (priceToInFrom > 0) {
              marketPrice = 1 / priceToInFrom;
              cgRaw = { data, inverted: true };
            }
          }
        } catch (e) {
          console.warn('fetchSimplePrice failed (to->from)', e && e.message ? e.message : e);
        }
      }
    }

    // If still null -> error (unable to fetch price)
    if (marketPrice === null || typeof marketPrice === 'undefined' || Number.isNaN(marketPrice)) {
      return res.status(500).json({
        success: false,
        message: `Impossible d'obtenir le cours pour la paire ${key}. Vérifiez que les symboles sont corrects et mappés.`,
        hint: 'Assurez-vous que la devise crypto est mappée dans SYMBOL_TO_CG ou étendez la logique de résolution.'
      });
    }

    // Compute platform prices
    const platformBuy = marketPrice * 0.995;  // platform buys from client (client sells) -> -0.5%
    const platformSell = marketPrice * 1.03;  // platform sells to client (client buys) -> +3%

    // Determine decimals to format the returned prices: use 'to' decimals (price expressed in 'to' per 1 'from')
    const decimals = await Rate.getDecimals(to.toUpperCase()).catch(() => 2);
    const formatTo = await Rate.formatAmount(to.toUpperCase(), marketPrice);
    const formatPlatformBuy = await Rate.formatAmount(to.toUpperCase(), platformBuy);
    const formatPlatformSell = await Rate.formatAmount(to.toUpperCase(), platformSell);

    const payload = {
      pair: key,
      market_price: Number(formatTo),
      platform_buy_price: Number(formatPlatformBuy),
      platform_sell_price: Number(formatPlatformSell),
      // provide unrounded raw values too for any advanced consumer
      raw_market_price: marketPrice,
      raw_platform_buy_price: platformBuy,
      raw_platform_sell_price: platformSell,
      timestamp: new Date().toISOString(),
      source: 'coingecko',
      raw: cgRaw
    };

    // store in cache
    pairCache[key] = { ts: Date.now(), data: payload };

    return res.json({ success: true, pair: key, cached: false, ...payload });
  } catch (err) {
    console.error('GET /api/price err', err && (err.message || err));
    return res.status(500).json({ success: false, message: 'Erreur récupération prix', error: String(err) });
  }
});

// --- transactions (create + listing) ---
// POST /api/transactions
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
      if (Object.keys(p).length > 0) details.proof = p;
    } else if (details.proof && typeof details.proof === 'string') {
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

    res.json({ success: true, message: 'Transaction créée', transaction: txDoc });
  } catch (err) {
    console.error('create tx err', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Impossible de créer la transaction', error: String(err) });
  }
});

// GET /api/transactions
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
    res.json(txs);
  } catch (err) {
    console.error('GET /api/transactions err', err);
    res.status(500).json({ error: 'Impossible de récupérer les transactions' });
  }
});

module.exports = router;
