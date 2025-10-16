// server.js (version améliorée : retry DB, logs clairs, cloudinary init kept)
require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const socketio = require('socket.io');
const { v2: cloudinary } = require('cloudinary');

const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: "*", methods: ["GET","POST","PUT","DELETE"] } });
global.io = io;

// cloudinary config (optional)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
  secure: true
});

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// === Require route modules (they assume Mongoose models may be used) ===
const apiRoutes = require('./routes/api');       // /api/*
const authRoutes = require('./routes/auth');     // /auth/*
const uploadRoutes = require('./routes/upload'); // /admin/upload & /api/upload-proof
const adminRoutes = require('./routes/admin');   // /admin/*

// Mount API and auth routes BEFORE static view routes
app.use('/api', apiRoutes);
app.use('/api', uploadRoutes); // expose /api/upload-proof and keep /admin/upload
app.use('/', authRoutes);     // routes /auth/*
app.use('/', adminRoutes);    // admin actions (requires admin auth middleware inside)

// Serve static from public (css/js/assets)
app.use(express.static(path.join(__dirname, 'public')));

// Serve view pages explicitly
const VIEWS = path.join(__dirname, 'views');
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

// optional: serve any /views/* file directly
app.get('/views/:name', (req, res) => {
  const n = req.params.name;
  const full = path.join(VIEWS, n);
  res.sendFile(full, (err) => err && console.error(err));
});

// health check
app.get('/health', (req, res) => res.json({ ok: true }));

// 404 for unknown API routes (JSON)
app.use('/api/*', (req, res) => res.status(404).json({ error: 'API endpoint introuvable' }));

// --- Mongoose connect with retry/backoff ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/PY';
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  // increase server selection timeout (how long to try to find a server)
  serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 30000),
  socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
  // poolSize deprecated name; new option is maxPoolSize if needed
  // maxPoolSize: 10
};

let connectAttempts = 0;
const MAX_RETRY = Number(process.env.MONGO_MAX_RETRY || 10);

async function connectWithRetry() {
  connectAttempts++;
  console.log(`Mongo connecting attempt ${connectAttempts} -> ${MONGO_URI}`);
  try {
    await mongoose.connect(MONGO_URI, mongooseOptions);
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error(`Mongo connect attempt ${connectAttempts} failed:`, err && err.message ? err.message : err);
    if (connectAttempts >= MAX_RETRY) {
      console.error(`Exceeded max Mongo connection attempts (${MAX_RETRY}). Will keep trying in background but consider checking MONGO_URI / network / credentials.`);
      // don't crash the process; keep trying every 30s
      setTimeout(connectWithRetry, 30000);
    } else {
      // exponential backoff (min 1s, max 30s)
      const backoff = Math.min(30000, 1000 * Math.pow(2, connectAttempts));
      console.log(`Retrying Mongo connection in ${Math.round(backoff/1000)}s...`);
      setTimeout(connectWithRetry, backoff);
    }
  }
}
connectWithRetry();

// Mongoose connection event handlers
mongoose.connection.on('connected', () => console.log('Mongoose event: connected'));
mongoose.connection.on('reconnected', () => console.log('Mongoose event: reconnected'));
mongoose.connection.on('disconnected', () => {
  console.warn('Mongoose event: disconnected — attempting to reconnect...');
  // try reconnecting if not already connecting
  connectWithRetry();
});
mongoose.connection.on('error', (err) => {
  console.error('Mongoose event error', err && err.message ? err.message : err);
});

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
  if (req.path && req.path.startsWith && req.path.startsWith('/api')) {
    return res.status(500).json({ success:false, message:'Unhandled server error', error: String(err) });
  }
  res.status(500).send('Unhandled server error');
});

// start server (even if Mongo not connected yet — we retry)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
