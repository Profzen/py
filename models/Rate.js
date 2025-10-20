// models/Rate.js
const mongoose = require('mongoose');

const rateSchema = new mongoose.Schema({
  pair: { type: String, required: true, unique: true }, // e.g. BTC-USD
  rate: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Rate || mongoose.model('Rate', rateSchema);
