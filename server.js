// server.js (COLLE / REMPLACE entièrement)
require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: "*", methods: ["GET","POST","PUT","DELETE"] } });
global.io = io;

// Middlewares (IMPORTANT : json BEFORE route handlers)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// === Require route modules (assure-toi que ces fichiers existent) ===
const apiRoutes = require('./routes/api');       // /api/*
const authRoutes = require('./routes/auth');     // /auth/*
const uploadRoutes = require('./routes/upload'); // /admin/upload
const adminRoutes = require('./routes/admin');   // /admin/*

// Mount API and auth routes BEFORE static view routes
app.use('/api', apiRoutes);
app.use('/', authRoutes);     // routes /auth/*
app.use('/', uploadRoutes);   // /admin/upload
app.use('/', adminRoutes);    // admin actions (requires admin auth middleware inside)

// Serve static from public (css/js/assets)
app.use(express.static(path.join(__dirname, 'public')));

// Serve view pages explicitly
const VIEWS = path.join(__dirname, 'views');

// map of page -> file (add any pages you want here)
const pages = {
  '/': 'index.html',
  '/index': 'index.html',
  '/exchange': 'exchange.html',
  '/news': 'news.html',
  '/historique': 'historique.html',
  '/apropos': 'apropos.html',
  '/contact': 'contact.html',
  '/login': 'login.html',
  '/login_admin': 'login_admin.html',
  '/admin': 'admin.html'
};

// create routes for each view
Object.keys(pages).forEach(route => {
  app.get(route, (req, res) => {
    const file = pages[route];
    const full = path.join(VIEWS, file);
    return res.sendFile(full, (err) => {
      if (err) {
        console.error(`Error serving ${full}:`, err && err.code ? err.code : err);
        if (!res.headersSent) res.status(500).send('Erreur serveur');
      }
    });
  });
});

// optional: serve any /views/* file directly (not recommended for production but handy)
app.get('/views/:name', (req, res) => {
  const n = req.params.name;
  const full = path.join(VIEWS, n);
  res.sendFile(full, (err) => err && console.error(err));
});

// health check
app.get('/health', (req, res) => res.json({ ok: true }));

// 404 and catch-all for unknown API routes (JSON) and fallback for other routes
app.use('/api/*', (req, res) => res.status(404).json({ error: 'API endpoint introuvable' }));

// If you want unknown non-API routes to fallback to index (spa-style), uncomment:
// app.get('*', (req,res) => res.sendFile(path.join(VIEWS,'index.html')));

// connect to MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/PY';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => { console.error('Mongo connect error', err); process.exit(1); });

// socket.io
io.on('connection', socket => {
  console.log('socket connected:', socket.id);
  socket.on('disconnect', () => console.log('socket disconnected:', socket.id));
});

// show mounted routes (debug)
function listRoutes() {
  console.log('--- Mounted GET routes (views + API) ---');
  Object.keys(pages).forEach(r => console.log('GET', r, '->', pages[r]));
}
listRoutes();

// Generic error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  if (req.path.startsWith('/api')) return res.status(500).json({ success:false, message:'Unhandled server error', error: String(err) });
  res.status(500).send('Unhandled server error');
});

// start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
