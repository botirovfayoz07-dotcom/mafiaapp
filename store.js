'use strict';
/*
 * Foydalanuvchi ma'lumotlari: statistika, balans, do'kon narsalari, tarix.
 * MONGO_URI bo'lsa MongoDB'da, bo'lmasa data/users.json faylida saqlanadi.
 * Hammasi xotirada ushlanadi (kichik/o'rta loyiha uchun yetarli).
 */
const fs = require('fs');
const path = require('path');

const blank = (id, name) => ({
  _id: id, name: name || 'Noma’lum', games: 0, wins: 0, balance: 0,
  items: { shield: 0, docs: 0 }, use: { shield: false, docs: false },
  history: [], tx: [], banned: false, created: Date.now(), seen: Date.now(),
});
const norm = (d) => {
  const b = blank(d._id, d.name);
  return Object.assign(b, d, { items: Object.assign(b.items, d.items), use: Object.assign(b.use, d.use) });
};

class Store {
  constructor() { this.users = new Map(); this.col = null; this.file = null; this.timer = null; }

  async init({ mongoUri, dir }) {
    if (mongoUri) {
      const { MongoClient } = require('mongodb');
      const client = await MongoClient.connect(mongoUri);
      this.col = client.db().collection('users');
      (await this.col.find().toArray()).forEach((d) => this.users.set(d._id, norm(d)));
      console.log(`MongoDB ulandi (${this.users.size} foydalanuvchi).`);
      return;
    }
    dir = dir || path.join(__dirname, 'data');
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'users.json');
    try {
      JSON.parse(fs.readFileSync(this.file, 'utf8')).forEach((d) => this.users.set(d._id, norm(d)));
    } catch { /* birinchi ishga tushirish */ }
    console.log(`Ma'lumotlar fayli: ${this.file} (${this.users.size} foydalanuvchi).`);
  }

  /** Foydalanuvchini oladi (yo'q bo'lsa yaratadi) */
  user(id, name) {
    let u = this.users.get(id);
    if (!u) { u = blank(id, name); this.users.set(id, u); }
    if (name) u.name = name;
    u.seen = Date.now();
    this.save(u);
    return u;
  }
  peek(id) { return this.users.get(id) || null; }

  save(u) {
    if (this.col) {
      this.col.replaceOne({ _id: u._id }, u, { upsert: true }).catch((e) => console.error('store:', e.message));
    } else if (this.file && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        const tmp = this.file + '.tmp';
        fs.writeFile(tmp, JSON.stringify([...this.users.values()]), (err) => {
          if (err) return console.error('store:', err.message);
          fs.rename(tmp, this.file, () => {});
        });
      }, 500);
    }
  }

  /** Balansni o'zgartiradi va tarixga yozadi */
  adjust(u, amount, note, by) {
    u.balance = Math.max(0, u.balance + amount);
    u.tx = [{ ts: Date.now(), amount, note: note || '', by: by || null }, ...u.tx].slice(0, 30);
    this.save(u);
  }

  search(q, limit = 30) {
    q = String(q || '').trim().toLowerCase();
    let arr = [...this.users.values()];
    if (q) arr = arr.filter((u) => String(u._id) === q || u.name.toLowerCase().includes(q));
    return arr.sort((a, b) => b.seen - a.seen).slice(0, limit);
  }
  stats() {
    let banned = 0, balance = 0, games = 0;
    for (const u of this.users.values()) { if (u.banned) banned++; balance += u.balance; games += u.games; }
    return { users: this.users.size, banned, balance, games: Math.round(games / 4) };
  }
}

module.exports = new Store();
