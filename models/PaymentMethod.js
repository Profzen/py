// models/PaymentMethod.js
const mongoose = require('mongoose');

const paymentMethodSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },      // Nom du moyen ou réseau
  type: { type: String, enum: ['crypto', 'fiat'], required: true }, // Type
  network: { type: String, default: '' },                  // Pour crypto: BEP20/TRC20... Pour fiat: ''
  details: { type: String, default: '' },                  // Adresse crypto ou numéro compte
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

paymentMethodSchema.pre('save', function(next){
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.models.PaymentMethod || mongoose.model('PaymentMethod', paymentMethodSchema);
