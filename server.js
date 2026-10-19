'use strict';
require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Room, GRACE } = require('./game');
const { verifyInitData, devUser } = require('./auth');
const { startBot } = require('./bot');

const { BOT_TOKEN, MONGO_URI, WEBAPP_URL, PORT = 3000, DEV, TURN_URL, TURN_USER, TURN_PASS } = process.env;
let botUsername = process.env.BOT_USERNAME || '';

const app = express();
app.get('/health', (_req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
// Aloqa uzilishini tez aniqlash uchun ping qisqa
const io = new Server(server, { pingInterval: 8000, pingTimeout: 6000 });

/* ───── Statistika (ixtiyoriy, MongoDB) ───── */
let users = null;
async function initDb() {
  if (!MONGO_URI) return console.log('MONGO_URI yo‘q: statistika saqlanmaydi.');
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(MONGO_URI);
  users = client.db().collection('users');
  console.log('MongoDB ulandi.');
}
function saveStats(_room, winner, players) {
  if (!users) return;
  const ops = players.map((p) => ({
    updateOne: {
      filter: { _id: p.id },
      update: { $set: { name: p.name }, $inc: { games: 1, wins: p.won ? 1 : 0 } },
      upsert: true,
    },
  }));
  users.bulkWrite(ops).catch((e) => console.error('stats:', e.message));
}

/* ───── Xonalar ───── */
const rooms = new Map();
const sockets = new Map(); // userId -> socket
const where = new Map();   // userId -> roomId

const send = (uid, ev, data) => { const s = sockets.get(uid); if (s) s.emit(ev, data); };
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{2,40}$/.test(id);
const newCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => abc[Math.floor(Math.random() * abc.length)]).join(''); } while (rooms.has(c));
  return c;
};
const makeRoom = (id) => { const r = new Room(id, send, saveStats); rooms.set(id, r); return r; };

function voiceLeave(room, uid) {
  if (!room.voice.delete(uid)) return;
  room.voice.forEach((id) => send(id, 'voice:left', { id: uid }));
  room.broadcast();
}

setInterval(() => {
  for (const [id, r] of rooms) if (r.isEmpty()) { r.destroy(); rooms.delete(id); }
}, 60000);

/* ───── Autentifikatsiya ───── */
io.use((socket, next) => {
  const a = socket.handshake.auth || {};
  let user = verifyInitData(a.initData, BOT_TOKEN);
  if (!user && DEV === '1' && a.dev) user = devUser(a.dev);
  if (!user) return next(new Error('auth'));
  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  const uid = user.id;

  // Bir vaqtda faqat bitta qurilma
  const prev = sockets.get(uid);
  sockets.set(uid, socket);
  if (prev && prev.id !== socket.id) { prev.emit('kicked'); prev.disconnect(true); }

  const ice = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (TURN_URL) ice.push({ urls: TURN_URL, username: TURN_USER, credential: TURN_PASS });
  socket.emit('config', { ice, bot: botUsername, id: uid });
  if (users) {
    users.findOne({ _id: uid })
      .then((doc) => socket.emit('me', { wins: doc?.wins || 0, games: doc?.games || 0 }))
      .catch(() => {});
  }

  const cur = () => rooms.get(where.get(uid));

  socket.on('room:create', (cb) => {
    if (typeof cb !== 'function') return;
    const id = newCode();
    makeRoom(id);
    cb({ id });
  });

  socket.on('room:join', (data, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    const id = String(data?.id || '').trim();
    const norm = id.startsWith('g') ? id : id.toUpperCase(); // guruh xonalari kichik 'g' bilan
    if (!validId(norm)) return cb({ error: 'Xona kodi noto‘g‘ri' });
    let room = rooms.get(norm);
    if (!room) {
      if (!norm.startsWith('g')) return cb({ error: 'Bunday xona topilmadi' });
      room = makeRoom(norm); // guruh xonasi birinchi kirishda ochiladi
    }
    const old = cur();
    if (old && old.id !== room.id) { voiceLeave(old, uid); old.eject(uid); }
    const r = room.join(user);
    if (r.error) return cb(r);
    where.set(uid, room.id);
    socket.emit('history', room.history(uid));
    cb({ ok: true, id: room.id });
  });

  socket.on('room:leave', (cb) => {
    const room = cur();
    if (room) { voiceLeave(room, uid); room.eject(uid); }
    where.delete(uid);
    if (typeof cb === 'function') cb({ ok: true });
  });

  // Ilova fonga o'tdi / yopildi: qisqa muddatdan so'ng o'yindan chiqariladi
  socket.on('away', () => { const r = cur(); if (r) r.startLeave(uid, GRACE.away); });

  socket.on('start', () => {
    const r = cur();
    const err = r && r.start(uid);
    if (err) socket.emit('err', err);
  });
  socket.on('action', (d) => {
    const r = cur();
    const err = r && r.action(uid, Number(d?.target));
    if (err) socket.emit('err', err);
  });
  socket.on('vote', (d) => {
    const r = cur();
    const t = d?.target === 'skip' ? 'skip' : Number(d?.target);
    const err = r && r.vote(uid, t);
    if (err) socket.emit('err', err);
  });
  socket.on('chat', (d) => { const r = cur(); if (r) r.say(uid, d?.text); });

  /* ── Ovozli chat: WebRTC signalizatsiya (server faqat uzatadi) ── */
  socket.on('voice:join', () => {
    const r = cur();
    if (!r) return;
    const peers = [...r.voice].filter((id) => id !== uid);
    r.voice.add(uid);
    socket.emit('voice:peers', peers);
    r.broadcast();
  });
  socket.on('voice:leave', () => { const r = cur(); if (r) voiceLeave(r, uid); });
  socket.on('voice:signal', (d) => {
    const r = cur();
    const to = Number(d?.to);
    if (r && r.voice.has(uid) && r.voice.has(to)) send(to, 'voice:signal', { from: uid, data: d.data });
  });

  socket.on('disconnect', () => {
    if (sockets.get(uid) !== socket) return; // eski qurilma almashtirilgan
    sockets.delete(uid);
    const r = cur();
    if (r) { voiceLeave(r, uid); r.dropped(uid); }
  });
});

/* ───── Ishga tushirish ───── */
(async () => {
  await initDb().catch((e) => console.error('MongoDB:', e.message));
  server.listen(PORT, () => console.log('Server:', PORT));
  if (BOT_TOKEN && WEBAPP_URL) {
    const bot = startBot(BOT_TOKEN, WEBAPP_URL);
    bot.telegram.getMe().then((me) => { botUsername = me.username; }).catch(() => {});
    const stop = (s) => { bot.stop(s); server.close(); };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  } else {
    console.log('BOT_TOKEN/WEBAPP_URL yo‘q: bot o‘chiq, faqat server ishlaydi.');
  }
})();
