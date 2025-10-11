// models/user.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, trim:true },
  email: { type: String, required: true, index: true, unique: true, lowercase: true, trim:true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user','admin'], default: 'user' },
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// ensure isAdmin sync with role
userSchema.pre('save', function(next){
  this.isAdmin = this.role === 'admin';
  next();
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
