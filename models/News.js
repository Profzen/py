// models/News.js
const mongoose = require('mongoose');

const newsSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  content: { type: String },
  image: { type: String },
  link: { type: String },
  date: { type: Date, default: Date.now }
});

module.exports = mongoose.models.News || mongoose.model('News', newsSchema);
