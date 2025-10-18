// models/Rate.js
const mongoose = require('mongoose');

const rateSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  name: {
    type: String,
    default: ''
  },
  // 'crypto' ou 'fiat'
  type: {
    type: String,
    enum: ['crypto', 'fiat'],
    required: true
  },
  // Permet d'overrider la politique d'arrondi par défaut (ex: 0, 2, 6)
  decimals: {
    type: Number,
    min: 0
  },
  // Si la devise est affichable/active dans les selects
  enabled: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Mettre à jour updatedAt automatiquement
rateSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});
rateSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updatedAt: new Date() });
  next();
});
rateSchema.pre('updateOne', function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

// Static helpers

/**
 * Retourne la liste des devises actives (enabled = true)
 * Utiliser .lean() si tu veux de simples objets JS.
 */
rateSchema.statics.getActiveCurrencies = function () {
  return this.find({ enabled: true }).sort({ symbol: 1 });
};

/**
 * Récupère le nombre de décimales à utiliser pour une devise.
 * Si decimals est défini dans le document on l'utilise,
 * sinon on retourne 2 for fiat, 6 for crypto par défaut.
 */
rateSchema.statics.getDecimals = async function (symbol) {
  const doc = await this.findOne({ symbol: String(symbol).toUpperCase() }).lean();
  if (!doc) {
    // fallback générique : fiat 2, crypto 6 impossible de deviner -> 2
    return 2;
  }
  if (typeof doc.decimals === 'number') return doc.decimals;
  return doc.type === 'crypto' ? 6 : 2;
};

/**
 * Arrondit proprement un montant en fonction de la devise.
 * Retourne un Number (pas une chaîne).
 */
rateSchema.statics.formatAmount = async function (symbol, amount) {
  const decimals = await this.getDecimals(symbol);
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(Number(amount) * factor) / factor;
  // évite -0
  return Object.is(rounded, -0) ? 0 : rounded;
};

module.exports = mongoose.models.Rate || mongoose.model('Rate', rateSchema);
