// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['user','admin'], default: 'user' },
  createdAt:{ type: Date, default: Date.now }
});

// Si le modèle existe déjà (redémarrage nodemon), on le réutilise.
module.exports = mongoose.models.User || mongoose.model('User', userSchema);
