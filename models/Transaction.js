// models/Transaction.js
const mongoose = require('mongoose');

const proofSchema = new mongoose.Schema({
  url: { type: String, default: '' },
  public_id: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  filename: { type: String, default: '' }
}, { _id: false });

const txSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: { type: String, default: 'exchange' }, // crypto-crypto, crypto-fiat, fiat-crypto, fiat-fiat
  from: { type: String, required: true },
  to: { type: String, required: true },
  amountFrom: { type: Number, required: true },
  amountTo: { type: Number, required: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} }, // objet libre pour nom,phone,address...
  proof: { type: proofSchema, default: {} }, // preuve (url, public_id, mimeType, filename)
  status: { type: String, enum: ['pending','approved','rejected','cancelled'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

txSchema.pre('save', function(next){
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', txSchema);
