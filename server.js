// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// static
app.use(express.static(path.join(__dirname, 'public')));

// serve views
app.get('/', (req,res) => res.sendFile(path.join(__dirname,'views','index.html')));
app.get('/exchange', (req,res) => res.sendFile(path.join(__dirname,'views','exchange.html')));
app.get('/news', (req,res) => res.sendFile(path.join(__dirname,'views','news.html')));
app.get('/historique', (req,res) => res.sendFile(path.join(__dirname,'views','historique.html')));
app.get('/apropos', (req,res) => res.sendFile(path.join(__dirname,'views','apropos.html')));
app.get('/contact', (req,res) => res.sendFile(path.join(__dirname,'views','contact.html')));
app.get('/login', (req,res) => res.sendFile(path.join(__dirname,'views','login.html')));
app.get('/login_admin', (req,res) => res.sendFile(path.join(__dirname,'views','login_admin.html')));
app.get('/admin', (req,res) => res.sendFile(path.join(__dirname,'views','admin.html')));

// api routes
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/', adminRoutes);   // admin routes include /admin/...
app.use('/', uploadRoutes);  // upload route

// start http server + socket.io
const http = require('http');
const server = http.createServer(app);

const { Server } = require('socket.io');
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});
// expose io globally for route modules to emit (simple pattern)
global.io = io;

io.on('connection', socket => {
  console.log('socket connected:', socket.id);
  // client may send identify to tag as admin or user if desired
  socket.on('identify', (data) => {
    // data example { role:'admin' } - we keep minimal for now
    socket.role = data?.role || 'guest';
  });
  socket.on('disconnect', ()=>{ /*console.log('socket disconnected', socket.id)*/ });
});

const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
.then(()=> {
  console.log('✅ Connected to MongoDB');
  server.listen(PORT, ()=> console.log(`✅ Server running on http://localhost:${PORT}`));
})
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});
