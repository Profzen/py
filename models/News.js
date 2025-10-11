// models/News.js
const mongoose = require('mongoose');

const NewsSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  content: { type: String, default: '' },
  image: { type: String, default: '' },      // URL Cloudinary
  image_public_id: { type: String, default: '' }, // optional: Cloudinary public_id to delete later
  link: { type: String, default: '' },
  date: { type: Date, default: Date.now },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

// Indexes for searching by title
NewsSchema.index({ title: 'text', description: 'text', content: 'text' });

module.exports = mongoose.models.News || mongoose.model('News', NewsSchema);
