// services/priceService.js
// Service to fetch & cache pair prices from Coinbase, compute applied buy/sell prices with margins,
// refresh every 30s, and provide a simple programmatic API.
//
// Dependencies: axios (npm i axios)
// Notes:
//  - Primary: GET https://api.coinbase.com/v2/prices/{PAIR}/spot
//  - Fallback: GET https://api.coinbase.com/v2/exchange-rates?currency=USD
// Docs: Coinbase Prices & Exchange Rates endpoints.
//
// Copyright: adapt as needed for your project.

const axios = require('axios');

const COINBASE_BASE = 'https://api.coinbase.com/v2';
const SPOT_PATH = (pair) => `${COINBASE_BASE}/prices/${encodeURIComponent(pair)}/spot`;
const EXCHANGE_RATES = (currency = 'USD') => `${COINBASE_BASE}/exchange-rates?currency=${encodeURIComponent(currency)}`;

const DEFAULT_REFRESH_MS = 30_000; // 30 seconds
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 300; // backoff base

// Business margins (as fractions)
const BUY_DISCOUNT = 0.005; // when we BUY from client (client sells crypto) => we give 0.5% below spot
const SELL_MARKUP = 0.03;  // when we SELL to client (client buys crypto) => we charge 3% above spot

class PriceService {
  constructor(opts = {}) {
    this.refreshMs = opts.refreshMs || DEFAULT_REFRESH_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.axiosInstance = axios.create({
      timeout: opts.timeoutMs || 8_000
    });

    // in-memory cache: pair -> { coinbasePrice, buyPriceForUs, sellPriceForUs, lastUpdated, fetching }
    this.cache = new Map();
    // pairs that are being polled periodically
    this.warmPairs = new Set();
    this.intervalId = null;

    // Simple local throttle to avoid too many parallel requests (respect Coinbase public rate limits)
    this.concurrentRequests = 0;
    this.maxConcurrent = opts.maxConcurrent || 6; // conservative relative to public limits
  }

  async init() {
    // start the periodic refresh loop
    if (!this.intervalId) this.intervalId = setInterval(() => this._refreshWarmPairs(), this.refreshMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.warmPairs.clear();
  }

  // Public: request fresh data for a pair (returns computed object)
  async getPrice(pair) {
    const normalized = this._normalizePair(pair);
    // if currently fetching, return the same promise to dedupe
    const cached = this.cache.get(normalized);
    if (cached && cached.fetching) {
      return cached.fetching;
    }

    const p = this._fetchAndCache(normalized);
    // store promise so concurrent requests are deduped
    this.cache.set(normalized, Object.assign({}, cached || {}, { fetching: p }));
    try {
      const res = await p;
      // remove fetching pointer
      const entry = this.cache.get(normalized) || {};
      delete entry.fetching;
      this.cache.set(normalized, entry);
      return res;
    } catch (err) {
      // cleanup fetching on error
      const entry = this.cache.get(normalized) || {};
      delete entry.fetching;
      this.cache.set(normalized, entry);
      throw err;
    }
  }

  // Return cached value or null
  getCached(pair) {
    const normalized = this._normalizePair(pair);
    const entry = this.cache.get(normalized);
    if (!entry || !entry.coinbasePrice) return null;
    // return a shallow copy
    const { coinbasePrice, buyPriceForUs, sellPriceForUs, lastUpdated } = entry;
    return { pair: normalized, coinbasePrice, buyPriceForUs, sellPriceForUs, lastUpdated };
  }

  // Ask service to keep refreshing this pair every refreshMs
  prewarmPairs(pairs = []) {
    pairs.forEach(p => this.warmPairs.add(this._normalizePair(p)));
    // ensure loop started
    if (!this.intervalId) this.init();
    // also immediately fetch them once
    pairs.forEach(p => this.getPrice(p).catch(() => {}));
  }

  // INTERNAL: normalize pair format to UPPER-BASE-QUOTE form with dash
  _normalizePair(pair) {
    if (!pair || typeof pair !== 'string') throw new Error('pair must be string like "USDT-XOF"');
    return pair.trim().toUpperCase().replace(/\s+/g, '').replace(/[_]/g, '-');
  }

  // INTERNAL: refresh logic run every refreshMs
  async _refreshWarmPairs() {
    if (this.warmPairs.size === 0) return;
    const pairs = Array.from(this.warmPairs);
    for (const pair of pairs) {
      // fire-and-forget - keep sequential-ish to be polite
      try {
        await this.getPrice(pair);
      } catch (e) {
        // swallow; already logged in fetch
      }
      // small pause to avoid quick bursts
      await this._sleep(120);
    }
  }

  // INTERNAL: fetch from Coinbase, compute margins, store in cache
  async _fetchAndCache(pair) {
    // throttle concurrency
    while (this.concurrentRequests >= this.maxConcurrent) {
      await this._sleep(50);
    }
    this.concurrentRequests += 1;
    try {
      const coinbasePrice = await this._fetchCoinbasePriceWithFallback(pair, this.maxRetries);
      if (typeof coinbasePrice !== 'number' || Number.isNaN(coinbasePrice)) {
        throw new Error(`invalid coinbase price for ${pair}`);
      }

      // compute our applied prices
      const buyPriceForUs = this._roundNumeric(coinbasePrice * (1 - BUY_DISCOUNT));
      const sellPriceForUs = this._roundNumeric(coinbasePrice * (1 - SELL_MARKUP));
      const lastUpdated = new Date();

      const entry = { pair, coinbasePrice, buyPriceForUs, sellPriceForUs, lastUpdated };
      this.cache.set(pair, entry);
      return Object.assign({ pair }, entry);
    } finally {
      this.concurrentRequests -= 1;
    }
  }

  // INTERNAL: call Coinbase spot endpoint; fallback to route via USD + exchange-rates if necessary
  async _fetchCoinbasePriceWithFallback(pair, retries = 2) {
    // try direct spot endpoint first
    try {
      const direct = await this._fetchSpot(pair);
      if (direct !== null) return direct;
    } catch (err) {
      // if 404 or unsupported - we'll try fallback below; for other errors attempt retries
      // console.warn('direct spot error', pair, err.message || err.toString());
    }

    // fallback: try to compute cross via USD: base -> USD and USD -> quote
    // pair format assumed BASE-QUOTE
    const [base, quote] = pair.split('-');
    if (!base || !quote) throw new Error('pair must be BASE-QUOTE');

    // if either base or quote is USD, we can try other endpoints
    try {
      // get base -> USD spot (1 BASE = X USD)
      const baseUsd = await this._fetchSpotWithRetry(`${base}-USD`, retries);
      // get exchange rates for USD to get USD -> quote (1 USD = R quote)
      const usdRates = await this._fetchExchangeRates('USD', retries);
      const usdToQuote = usdRates && usdRates[quote];
      if (baseUsd !== null && usdToQuote) {
        // 1 BASE = baseUsd USD ; 1 USD = usdToQuote QUOTE => 1 BASE = baseUsd * usdToQuote QUOTE
        return Number(baseUsd * usdToQuote);
      }

      // else: try reverse route: get quote -> USD then invert
      const quoteUsd = await this._fetchSpotWithRetry(`${quote}-USD`, retries).catch(() => null);
      if (quoteUsd) {
        // 1 QUOTE = quoteUsd USD => 1 USD = 1/quoteUsd QUOTE
        const usdToQuoteViaInvert = 1 / quoteUsd;
        const baseUsd2 = await this._fetchSpotWithRetry(`${base}-USD`, retries).catch(() => null);
        if (baseUsd2) return Number(baseUsd2 * usdToQuoteViaInvert);
      }

    } catch (err) {
      // fallback failed
      // console.warn('fallback compute failed', pair, err.message || err.toString());
    }

    throw new Error(`Unable to get price for pair ${pair} from Coinbase (direct or fallback)`);
  }

  // INTERNAL: wrapper to fetch spot with retries
  async _fetchSpotWithRetry(pair, retries) {
    let attempt = 0;
    while (attempt <= retries) {
      try {
        const res = await this._fetchSpot(pair);
        if (res !== null) return res;
      } catch (err) {
        // if 404 not found - break early
        if (err && err.response && err.response.status === 404) break;
        if (attempt === retries) throw err;
      }
      attempt++;
      await this._sleep(DEFAULT_RETRY_BASE_MS * Math.pow(2, attempt));
    }
    return null;
  }

  // INTERNAL: call Coinbase /v2/prices/{pair}/spot
  // returns a Number (price.quote currency per 1 base) or null if 404/unsupported
  async _fetchSpot(pair) {
    const url = SPOT_PATH(pair);
    try {
      const resp = await this.axiosInstance.get(url, {
        headers: {
          'Accept': 'application/json'
        }
      });
      if (resp && resp.data && resp.data.data && resp.data.data.amount) {
        const amount = Number(resp.data.data.amount);
        if (!Number.isNaN(amount)) return amount;
      }
      return null;
    } catch (err) {
      // If 404 => unsupported pair, return null so fallback logic can try other routes
      if (err && err.response && err.response.status === 404) return null;
      // if rate-limited 429, throw to allow caller to backoff
      if (err && err.response && err.response.status === 429) {
        const e = new Error('Coinbase rate-limited (429)');
        e.code = 429;
        throw e;
      }
      // rethrow other network errors
      throw err;
    }
  }

  // INTERNAL: get exchange-rates?currency=CUR -> returns rates object (currency->rate)
  async _fetchExchangeRates(currency = 'USD', retries = 1) {
    const url = EXCHANGE_RATES(currency);
    try {
      const resp = await this.axiosInstance.get(url, { headers: { Accept: 'application/json' } });
      if (resp && resp.data && resp.data.data && resp.data.data.rates) {
        // rates are strings like "XOF": "600"
        const raw = resp.data.data.rates || {};
        const parsed = {};
        for (const k of Object.keys(raw)) {
          const v = Number(raw[k]);
          if (!Number.isNaN(v)) parsed[k] = v;
        }
        return parsed;
      }
      return null;
    } catch (err) {
      if (retries > 0) {
        await this._sleep(DEFAULT_RETRY_BASE_MS);
        return this._fetchExchangeRates(currency, retries - 1);
      }
      // rethrow
      throw err;
    }
  }

  _roundNumeric(n) {
    // default rounding: if quote is fiat-like we may want integer; here keep 6 decimals safety
    if (typeof n !== 'number' || Number.isNaN(n)) return n;
    return Math.round((n + Number.EPSILON) * 1000000) / 1000000;
  }

  _sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
  }
}

module.exports = function createPriceService(opts) {
  const s = new PriceService(opts);
  // convenience: auto-init if wanted
  if (opts && opts.autoInit) s.init().catch(() => {});
  return s;
};
