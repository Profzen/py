// models/Currency.js
// Schéma des devises disponibles (crypto / fiat)
const mongoose = require('mongoose');

const currencySchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    index: true,
    unique: true // ex: 'USDT', 'XOF', 'BTC'
  },
  name: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  type: {
    type: String,
    enum: ['crypto', 'fiat'],
    required: true,
    default: 'crypto'
  },
  active: {
    type: Boolean,
    default: true
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  meta: {
    decimals: { type: Number, default: 6 },
    logoUrl: { type: String, default: '' }
  }
}, {
  timestamps: true
});

// Normalize symbol before save
currencySchema.pre('save', function(next) {
  if (this.symbol) this.symbol = this.symbol.toUpperCase().trim();
  next();
});

// Static: get active currencies sorted
currencySchema.statics.getActive = function() {
  return this.find({ active: true }).sort({ displayOrder: 1, symbol: 1 }).exec();
};

// Static: upsert by symbol (payload may contain symbol, name, type, active, displayOrder, decimals, logoUrl)
currencySchema.statics.upsertBySymbol = async function(payload) {
  const symbol = (payload.symbol || '').toUpperCase().trim();
  if (!symbol) throw new Error('symbol is required for upsert');

  const update = {
    name: typeof payload.name === 'string' ? payload.name : undefined,
    type: payload.type || 'crypto',
    active: typeof payload.active === 'boolean' ? payload.active : true,
    displayOrder: typeof payload.displayOrder === 'number' ? payload.displayOrder : 0,
  };

  // meta fields
  if (typeof payload.decimals === 'number') update['meta.decimals'] = payload.decimals;
  if (typeof payload.logoUrl === 'string') update['meta.logoUrl'] = payload.logoUrl;

  // remove undefined
  Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);

  return this.findOneAndUpdate(
    { symbol },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();
};

module.exports = mongoose.models.Currency || mongoose.model('Currency', currencySchema);
