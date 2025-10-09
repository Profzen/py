// ---- début patch pour routes/api.js ----
const express = require('express');
const router = express.Router();
const axios = require('axios');

const COINGECKO = process.env.COINGECKO_API || 'https://api.coingecko.com/api/v3';

// simple axios instance
const axiosInstance = axios.create({ timeout: 10000 });

// retry helper (respecte Retry-After si fourni)
async function doRequestWithRetry(config, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await axiosInstance.request(config);
    } catch (err) {
      attempt++;
      const res = err.response;
      // si pas de response ou autre erreur non 429 -> throw
      if(!res || res.status !== 429 || attempt > maxRetries) throw err;
      // respect retry-after (secondes) si présent
      const ra = res.headers && (res.headers['retry-after'] || res.headers['Retry-After']);
      const waitSec = ra ? parseInt(ra,10) : Math.min(2 ** attempt, 60);
      console.warn(`429 reçu — attente ${waitSec}s avant retry (attempt ${attempt})`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      continue;
    }
  }
}

// petite file d'attente / throttle minimal (concurrency limiter)
const maxConcurrent = 2;
let currentConcurrent = 0;
const queue = [];

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  if (currentConcurrent >= maxConcurrent) return;
  const job = queue.shift();
  if (!job) return;
  currentConcurrent++;
  job.fn()
    .then(result => { job.resolve(result); })
    .catch(err => { job.reject(err); })
    .finally(() => {
      currentConcurrent--;
      processQueue();
    });
}

// caches
let pricesCache = null, pricesTs = 0;
const PRICES_TTL = 30 * 1000; // 30s

const marketCache = {}; // key: coin_days -> { ts, data }
const MARKET_TTL = 60 * 1000; // 60s

// /api/prices
router.get('/prices', async (req, res) => {
  try {
    const now = Date.now();
    if (pricesCache && (now - pricesTs) < PRICES_TTL) {
      return res.json({ source: 'cache', prices: pricesCache });
    }

    const ids = ['bitcoin','ethereum','tether','usd-coin','solana','binancecoin','cardano','dogecoin','matic-network','litecoin'].join(',');
    const config = { method: 'get', url: `${COINGECKO}/simple/price`, params: { ids, vs_currencies: 'usd' } };

    // enqueue request to avoid bursts
    const r = await enqueue(() => doRequestWithRetry(config, 2));
    pricesCache = r.data;
    pricesTs = Date.now();
    res.json({ source: 'coingecko', prices: pricesCache });
  } catch (err) {
    console.error('prices err', err.message || err);
    if (pricesCache) return res.json({ source: 'cache-stale', prices: pricesCache });
    res.status(500).json({ error: 'Impossible de récupérer les prix (rate limit).' });
  }
});

// /api/market_chart?coin=bitcoin&days=1
router.get('/market_chart', async (req, res) => {
  const coin = (req.query.coin || 'bitcoin').toString();
  const days = (req.query.days || '1').toString();
  const key = `${coin}_${days}`;
  try {
    const now = Date.now();
    if (marketCache[key] && (now - marketCache[key].ts) < MARKET_TTL) {
      return res.json({ source: 'cache', data: marketCache[key].data });
    }
    const config = { method: 'get', url: `${COINGECKO}/coins/${coin}/market_chart`, params: { vs_currency: 'usd', days } };
    const r = await enqueue(() => doRequestWithRetry(config, 2));
    const points = (r.data && r.data.prices) ? r.data.prices.map(p => ({ t: p[0], v: p[1] })) : [];
    marketCache[key] = { ts: Date.now(), data: points };
    res.json({ source: 'coingecko', data: points });
  } catch (err) {
    console.error('market_chart err', err.message || err.toString());
    if (marketCache[key]) return res.json({ source: 'cache-stale', data: marketCache[key].data });
    res.status(500).json({ error: 'Impossible de récupérer market chart (rate limit).' });
  }
});
module.exports = router;
