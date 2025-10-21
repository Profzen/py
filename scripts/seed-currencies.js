// scripts/seed-currencies.js
require('dotenv').config();
const mongoose = require('mongoose');
const Rate = require('../models/Rate'); // adapte le path si nécessaire

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/PY';

const currencies = [
  { symbol: 'USDT', name: 'Tether', type: 'crypto', active: true, displayOrder: 1, meta: { decimals: 6 } },
  { symbol: 'BTC', name: 'Bitcoin', type: 'crypto', active: true, displayOrder: 2, meta: { decimals: 8 } },
  { symbol: 'ETH', name: 'Ethereum', type: 'crypto', active: true, displayOrder: 3, meta: { decimals: 8 } },
  { symbol: 'USDC', name: 'USD Coin', type: 'crypto', active: true, displayOrder: 4, meta: { decimals: 6 } },
  { symbol: 'USD', name: 'US Dollar', type: 'fiat', active: true, displayOrder: 10, meta: { decimals: 0 } },
  { symbol: 'EUR', name: 'Euro', type: 'fiat', active: true, displayOrder: 11, meta: { decimals: 0 } },
  { symbol: 'XOF', name: 'Franc CFA (XOF)', type: 'fiat', active: true, displayOrder: 12, meta: { decimals: 0 } }
];

async function run(){
  await mongoose.connect(MONGO_URI, { useNewUrlParser:true, useUnifiedTopology:true });
  for(const c of currencies){
    try {
      await Rate.upsertBySymbol(c); // method we added to model
      console.log('Upserted', c.symbol);
    } catch(e){
      console.error('Err upsert', c.symbol, e && e.message ? e.message : e);
    }
  }
  await mongoose.disconnect();
  console.log('Done seed');
}
run().catch(e => { console.error(e); process.exit(1); });
