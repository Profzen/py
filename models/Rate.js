// models/Rate.js
// Maintenant : modèle des monnaies disponibles (crypto / fiat) — pas des paires ni des taux
const mongoose = require('mongoose');

const currencySchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    index: true,
    unique: true, // ex: 'USDT', 'XOF', 'BTC'
  },
  name: {
    type: String,
    required: false, // ex: 'Tether', 'Franc CFA', 'Bitcoin'
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
    default: true // si false, n'apparaitra pas dans les menus
  },
  displayOrder: {
    type: Number,
    default: 0 // ordre d'affichage dans les menus
  },
  meta: {
    // champs optionnels, utiles pour futures intégrations (ex: logo cloudinary, decimals)
    decimals: { type: Number, default: 6 }, // précision d'affichage pour les cryptos
    logoUrl: { type: String, default: '' }
  }
}, {
  timestamps: true // createdAt, updatedAt automatiques
});

//
// Hooks & helpers
//
currencySchema.pre('save', function(next) {
  if (this.symbol) this.symbol = this.symbol.toUpperCase().trim();
  next();
});

// Static helper : récupère les monnaies actives triées
currencySchema.statics.getActive = function() {
  return this.find({ active: true }).sort({ displayOrder: 1, symbol: 1 }).exec();
};

// Static helper : upsert (create/update) currency by symbol
currencySchema.statics.upsertBySymbol = async function(payload) {
  const symbol = (payload.symbol || '').toUpperCase().trim();
  if (!symbol) throw new Error('symbol is required for upsert');
  const update = {
    name: payload.name || '',
    type: payload.type || 'crypto',
    active: typeof payload.active === 'boolean' ? payload.active : true,
    displayOrder: typeof payload.displayOrder === 'number' ? payload.displayOrder : 0,
    'meta.decimals': typeof payload.decimals === 'number' ? payload.decimals : undefined,
    'meta.logoUrl': payload.logoUrl || undefined
  };

  // remove undefined keys from update
  Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);

  return this.findOneAndUpdate(
    { symbol },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).exec();
};

module.exports = mongoose.models.Rate || mongoose.model('Rate', currencySchema);
