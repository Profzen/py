// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

// Register user (client)
router.post('/register', async (req,res) => {
  try {
    const { username, email, password } = req.body;
    if(!username || !email || !password) return res.json({ success:false, message:'Champs manquants' });
    const exists = await User.findOne({ email });
    if(exists) return res.json({ success:false, message:'Email déjà utilisé' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, password: hashed, role: 'user' });
    res.json({ success:true, message:'Utilisateur créé', user: { id: user._id, email: user.email } });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Erreur serveur' });
  }
});

// Login for client (user)
router.post('/login', async (req,res) => {
  try {
    const { email, password } = req.body;
    if(!email || !password) return res.json({ success:false, message:'Champs manquants' });
    const user = await User.findOne({ email });
    if(!user) return res.json({ success:false, message:'Utilisateur introuvable' });
    const ok = await bcrypt.compare(password, user.password);
    if(!ok) return res.json({ success:false, message:'Mot de passe incorrect' });
    const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ success:true, token, role: user.role, username: user.username });
  } catch(err){
    console.error(err);
    res.status(500).json({ success:false, message:'Erreur serveur' });
  }
});

// Admin register/login: create admin only if none exists
router.post('/admin/register', async (req,res) => {
  try {
    const { username, email, password } = req.body;
    if(!username || !email || !password) return res.json({ success:false, message:'Champs manquants' });
    const adminCount = await User.countDocuments({ role:'admin' });
    if(adminCount > 0) return res.json({ success:false, message:'Un admin existe déjà' });
    const exists = await User.findOne({ email });
    if(exists) return res.json({ success:false, message:'Email déjà utilisé' });
    const hashed = await bcrypt.hash(password, 10);
    const admin = await User.create({ username, email, password: hashed, role: 'admin' });
    res.json({ success:true, message:'Admin créé', admin: { id: admin._id, email: admin.email } });
  } catch(err){
    console.error(err);
    res.status(500).json({ success:false, message:'Erreur serveur' });
  }
});

// Admin login
router.post('/admin/login', async (req,res) => {
  try {
    const { email, password } = req.body;
    if(!email || !password) return res.json({ success:false, message:'Champs manquants' });
    const user = await User.findOne({ email });
    if(!user || user.role !== 'admin') return res.json({ success:false, message:'Admin introuvable' });
    const ok = await bcrypt.compare(password, user.password);
    if(!ok) return res.json({ success:false, message:'Mot de passe incorrect' });
    const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, process.env.JWT_SECRET || 'secret123', { expiresIn: '1d' });
    res.json({ success:true, token, role: user.role, username: user.username });
  } catch(err){
    console.error(err);
    res.status(500).json({ success:false, message:'Erreur serveur' });
  }
});

module.exports = router;
