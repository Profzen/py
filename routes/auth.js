// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

// Helper: create token + safe user object
function makeAuthResult(user){
  const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  const safeUser = { _id: user._id, username: user.username, email: user.email, role: user.role, isAdmin: user.isAdmin };
  return { token, user: safeUser };
}

// Register (alias /auth/register and /auth/signup)
async function registerHandler(req, res){
  try {
    const { username, email, password, role } = req.body || {};
    if(!email || !password) return res.status(400).json({ success:false, message:'Email et mot de passe requis' });

    // normalize email
    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if(existing) return res.status(400).json({ success:false, message:'Email déjà utilisé' });

    const hash = await bcrypt.hash(String(password), 10);
    const user = new User({
      username: username ? String(username).trim() : normalizedEmail.split('@')[0],
      email: normalizedEmail,
      password: hash,
      role: role || 'user'
    });
    await user.save();

    const auth = makeAuthResult(user);
    return res.json({ success:true, message:'Compte créé', token: auth.token, user: auth.user });
  } catch (err){
    console.error('POST /auth/register err', err);
    return res.status(500).json({ success:false, message:'Erreur serveur', error: String(err) });
  }
}

// POST /auth/register
router.post('/auth/register', registerHandler);
// POST /auth/signup (alias)
router.post('/auth/signup', registerHandler);

// Login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if(!email || !password) return res.status(400).json({ success:false, message:'Email et mot de passe requis' });

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if(!user) return res.status(400).json({ success:false, message:'Utilisateur introuvable' });

    const ok = await bcrypt.compare(String(password), user.password);
    if(!ok) return res.status(401).json({ success:false, message:'Mot de passe incorrect' });

    const auth = makeAuthResult(user);
    return res.json({ success:true, token: auth.token, user: auth.user });
  } catch (err){
    console.error('POST /auth/login err', err);
    return res.status(500).json({ success:false, message:'Erreur serveur', error: String(err) });
  }
});

module.exports = router;
