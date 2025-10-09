// models/Transaction.js
const mongoose = require('mongoose');

const txSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null for guest
  type: { type: String }, // crypto-crypto, crypto-fiat, fiat-crypto, fiat-fiat
  from: { type: String },
  to: { type: String },
  amountFrom: { type: Number },
  amountTo: { type: Number },
  details: { type: Object }, // additional info entered in modal (name, phone, addresses...)
  status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', txSchema);
