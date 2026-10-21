'use strict';
require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Room, GRACE } = require('./game');
const store = require('./store');
const { verifyInitData, devUser } = require('./auth');
const { startBot } = require('./bot');

const { BOT_TOKEN, MONGO_URI, WEBAPP_URL, PORT = 3000, DEV, TURN_URL, TURN_USER, TURN_PASS, ADMIN_IDS = '', SUPPORT = '', DATA_DIR } = process.env;
const ADMINS = new Set(ADMIN_IDS.split(',').map((x) => Number(x.trim())).filter(Boolean));
// DEV rejimida ?dev=Admin bilan kirgan odam admin bo'ladi
const isAdmin = (u) => ADMINS.has(u.id) || (DEV === '1' && u.dev && u.name === 'Admin');

const ITEMS = {
  shield: { n: 'Himoya qalqoni', e: '🛡', price: 50, d: 'Tunda sizga qilingan birinchi hujumni qaytaradi (bir o‘yinga).' },
  docs: { n: 'Soxta hujjat', e: '📄', price: 30, d: 'Komissar birinchi marta tekshirganda sizni tinch aholi deb ko‘radi (bir o‘yinga).' },
};
let botUsername = process.env.BOT_USERNAME || '';

const app = express();
app.get('/health', (_req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
// Aloqa uzilishini tez aniqlash uchun ping qisqa
const io = new Server(server, { pingInterval: 8000, pingTimeout: 6000 });

/* ───── Profil ma'lumotlari ───── */
const profileOf = (u, admin) => ({
  id: u._id, name: u.name, games: u.games, wins: u.wins, balance: u.balance,
  items: u.items, use: u.use, history: u.history.slice(0, 10), tx: u.tx.slice(0, 10), admin: !!admin,
});
const pushMe = (uid) => {
  const u = store.peek(uid), s = sockets.get(uid);
  if (u && s) s.emit('me', profileOf(u, isAdmin(s.data.user)));
};
function saveStats(_room, winner, players) {
  for (const p of players) {
    const u = store.user(p.id, p.name);
    u.games++;
    if (p.won) u.wins++;
    u.history = [{ ts: Date.now(), role: p.role, won: p.won, winner }, ...u.history].slice(0, 20);
    store.save(u);
    pushMe(p.id);
  }
}
/** O'yin boshida yoqilgan narsalarni sarflaydi */
function takeItems(uid) {
  const u = store.peek(uid);
  const got = {};
  if (!u) return got;
  for (const k of Object.keys(ITEMS)) {
    if (u.use[k] && u.items[k] > 0) { u.items[k]--; got[k] = true; }
    u.use[k] = false;
  }
  store.save(u);
  setImmediate(() => pushMe(uid));
  return got;
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
const makeRoom = (id) => { const r = new Room(id, send, { onFinish: saveStats, takeItems }); rooms.set(id, r); return r; };

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
  const admin = isAdmin(user);
  store.user(uid, user.name);
  socket.emit('config', { ice, bot: botUsername, id: uid, items: ITEMS, support: SUPPORT, admin });
  pushMe(uid);

  const cur = () => rooms.get(where.get(uid));

  socket.on('room:create', (cb) => {
    if (typeof cb !== 'function') return;
    if (store.peek(uid)?.banned) return cb({ error: 'Hisobingiz bloklangan' });
    const id = newCode();
    makeRoom(id);
    cb({ id });
  });

  socket.on('room:join', (data, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    if (store.peek(uid)?.banned) return cb({ error: 'Hisobingiz bloklangan' });
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
    const err = r && r.action(uid, d);
    if (err) socket.emit('err', err);
  });
  socket.on('vote', (d) => {
    const r = cur();
    const t = d?.target === 'skip' ? 'skip' : Number(d?.target);
    const err = r && r.vote(uid, t);
    if (err) socket.emit('err', err);
  });
  socket.on('chat', (d) => { const r = cur(); if (r) r.say(uid, d?.text); });

  /* ── Profil va do'kon ── */
  socket.on('shop:buy', (d, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    const it = ITEMS[d?.item], u = store.peek(uid);
    if (!it || !u) return cb({ error: 'Noma’lum narsa' });
    if (u.balance < it.price) return cb({ error: 'Balans yetarli emas' });
    u.items[d.item]++;
    store.adjust(u, -it.price, `Do‘kon: ${it.n}`);
    pushMe(uid);
    cb({ ok: true });
  });
  socket.on('item:use', (d, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    const u = store.peek(uid);
    if (!u || !ITEMS[d?.item]) return cb({ error: 'Xato' });
    if (!u.items[d.item]) return cb({ error: 'Sizda bu narsa yo‘q' });
    u.use[d.item] = !!d.on;
    store.save(u);
    pushMe(uid);
    cb({ ok: true });
  });

  /* ── Admin panel (har bir so'rov serverda qayta tekshiriladi) ── */
  const adminUser = (u) => ({
    id: u._id, name: u.name, balance: u.balance, games: u.games, wins: u.wins, banned: u.banned,
    items: u.items, tx: u.tx.slice(0, 10), online: sockets.has(u._id), seen: u.seen,
  });
  socket.on('admin', (d, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    if (!admin) return cb({ error: 'Ruxsat yo‘q' });
    try {
      const op = d?.op;
      if (op === 'overview') {
        let playing = 0;
        rooms.forEach((r) => { if (r.phase !== 'lobby') playing++; });
        return cb({ ok: true, ...store.stats(), online: sockets.size, rooms: rooms.size, playing });
      }
      if (op === 'users') return cb({ ok: true, users: store.search(d.q).map(adminUser) });
      const u = store.peek(Number(d?.id));
      if (!u) return cb({ error: 'Foydalanuvchi topilmadi' });
      if (op === 'user') return cb({ ok: true, user: adminUser(u) });
      if (op === 'grant') {
        const amount = Math.trunc(Number(d.amount));
        if (!amount || Math.abs(amount) > 10_000_000) return cb({ error: 'Summa noto‘g‘ri' });
        store.adjust(u, amount, String(d.note || '').slice(0, 60) || (amount > 0 ? 'Admin to‘ldirdi' : 'Admin ayirdi'), uid);
        pushMe(u._id);
        send(u._id, 'notice', amount > 0 ? `💰 Hisobingizga ${amount} tanga qo‘shildi.` : `Hisobingizdan ${-amount} tanga ayirildi.`);
        return cb({ ok: true, user: adminUser(u) });
      }
      if (op === 'item') {
        if (!ITEMS[d.item]) return cb({ error: 'Noma’lum narsa' });
        const q = Math.trunc(Number(d.qty)) || 0;
        u.items[d.item] = Math.max(0, u.items[d.item] + q);
        store.save(u);
        pushMe(u._id);
        if (q > 0) send(u._id, 'notice', `${ITEMS[d.item].e} ${ITEMS[d.item].n} sovg‘a qilindi (+${q}).`);
        return cb({ ok: true, user: adminUser(u) });
      }
      if (op === 'ban') {
        if (u._id === uid) return cb({ error: 'O‘zingizni bloklab bo‘lmaydi' });
        u.banned = !!d.banned;
        store.save(u);
        return cb({ ok: true, user: adminUser(u) });
      }
      cb({ error: 'Noma’lum amal' });
    } catch (e) { console.error('admin:', e); cb({ error: 'Server xatosi' }); }
  });

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
  await store.init({ mongoUri: MONGO_URI, dir: DATA_DIR }).catch(async (e) => {
    console.error('MongoDB:', e.message, '— fayl rejimiga o‘tildi.');
    await store.init({ dir: DATA_DIR });
  });
  if (!ADMINS.size) console.log('ADMIN_IDS berilmagan: admin panel hech kimga ochiq emas.');
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
