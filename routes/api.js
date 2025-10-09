// routes/api.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const News = require('../models/News');
const Rate = require('../models/Rate');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');
const User = require('../models/user');

const COINGECKO = process.env.COINGECKO_API || 'https://api.coingecko.com/api/v3';

// prices cache
let pricesCache = null, pricesFetched = 0;
const PRICES_TTL = 30 * 1000;

router.get('/prices', async (req,res) => {
  try {
    const now = Date.now();
    if(pricesCache && (now - pricesFetched) < PRICES_TTL) return res.json({ source:'cache', prices: pricesCache });
    const ids = ['bitcoin','ethereum','tether','usd-coin','solana','binancecoin','cardano','dogecoin','matic-network','litecoin'].join(',');
    const r = await axios.get(`${COINGECKO}/simple/price`, { params: { ids, vs_currencies: 'usd' }, timeout:10000 });
    pricesCache = r.data; pricesFetched = Date.now();
    res.json({ source:'coingecko', prices: pricesCache });
  } catch(err){
    console.error('prices err', err.message || err);
    if(pricesCache) return res.json({ source:'cache-stale', prices: pricesCache });
    res.status(500).json({ error:'Impossible de récupérer les prix' });
  }
});

// market_chart route
const marketCache = {};
const MARKET_TTL = 60 * 1000;
router.get('/market_chart', async (req,res) => {
  const coin = req.query.coin || 'bitcoin';
  const days = req.query.days || '1';
  const key = `${coin}_${days}`;
  const now = Date.now();
  try {
    if(marketCache[key] && (now - marketCache[key].ts) < MARKET_TTL) return res.json({ source:'cache', data: marketCache[key].data });
    const r = await axios.get(`${COINGECKO}/coins/${coin}/market_chart`, { params: { vs_currency:'usd', days }, timeout:10000 });
    const points = (r.data.prices || []).map(p => ({ t: p[0], v: p[1] }));
    marketCache[key] = { ts: Date.now(), data: points };
    res.json({ source:'coingecko', data: points });
  } catch(err){
    console.error('market_chart err', err.message || err);
    if(marketCache[key]) return res.json({ source:'cache-stale', data: marketCache[key].data });
    res.status(500).json({ error:'Impossible de récupérer market chart' });
  }
});

// news
router.get('/news', async (req,res) => {
  try {
    const news = await News.find().sort({ date: -1 });
    res.json(news);
  } catch(err){ console.error(err); res.status(500).json({ error:'Impossible de récupérer news' }); }
});

// rates
router.get('/rates', async (req,res) => {
  try { const rates = await Rate.find(); res.json(rates); } catch(err){ console.error(err); res.status(500).json({ error:'Impossible de récupérer rates' }); }
});

// helper to get user from token if present
async function getUserFromHeader(req){
  const auth = req.headers['authorization'];
  if(!auth) return null;
  const token = auth.split(' ')[1];
  if(!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
    const user = await User.findById(decoded.id);
    return user;
  } catch(e){ return null; }
}

// create transaction
router.post('/transactions', async (req,res) => {
  try {
    const { from, to, amountFrom, amountTo, type, details } = req.body;
    const user = await getUserFromHeader(req);
    const tx = await Transaction.create({
      user: user ? user._id : null,
      type, from, to, amountFrom, amountTo, details, status: 'pending'
    });
    // emit newTransaction to admins via socket.io
    try { global.io && global.io.emit('newTransaction', tx); } catch(e){ console.warn('socket emit newTransaction failed', e); }
    res.json({ success:true, transaction: tx });
  } catch(err){
    console.error('create tx err', err);
    res.status(500).json({ error:'Impossible de créer la transaction' });
  }
});

// transactions listing
router.get('/transactions', async (req,res) => {
  try {
    const mine = req.query.mine === '1';
    const user = await getUserFromHeader(req);
    let txs;
    if(mine && user) txs = await Transaction.find({ user: user._id }).sort({ createdAt: -1 });
    else if(mine && !user) txs = []; // guest: frontend uses localStorage
    else txs = await Transaction.find().populate('user').sort({ createdAt:-1 });
    res.json(txs);
  } catch(err){ console.error(err); res.status(500).json({ error:'Impossible de récupérer les transactions' }); }
});

module.exports = router;
