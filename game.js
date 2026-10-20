'use strict';
/*
 * Mafia o'yin mantig'i. Tashqi kutubxonasiz.
 * send(uid, event, data) — serverdan beriladi; onFinish(room, winner, players) — statistika uchun.
 */

const FAST = !!process.env.FAST; // sinov uchun tez rejim
const T = FAST
  ? { night: 0.3, discuss: 0.3, vote: 0.3, last: 0.2 }
  : { night: 35, discuss: 50, vote: 30, last: 15 }; // soniyalarda
const REVEAL = FAST ? 0 : 4; // o'lim/osilish e'loni ko'rsatilayotgan vaqt: muhokama vaqtidan yeyilmasin
const GRACE = { away: 3, drop: 8 }; // ilovadan chiqqandan keyin necha soniyada o'yindan chiqariladi
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 12;
const BULLETS = 1; // komissarning butun o'yin uchun o'qlari soni

const ROLES = {
  mafia: { n: 'Mafiya', e: '🕴', team: 'mafia' },
  komissar: { n: 'Komissar', e: '🕵️', team: 'town' },
  shifokor: { n: 'Shifokor', e: '💉', team: 'town' },
  fuqaro: { n: 'Fuqaro', e: '👤', team: 'town' },
};

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const tag = (p) => `${ROLES[p.role].e} ${ROLES[p.role].n}`;

class Room {
  constructor(id, send, onFinish) {
    this.id = id;
    this.send = send;
    this.onFinish = onFinish || (() => {});
    this.players = new Map();
    this.host = null;
    this.phase = 'lobby'; // lobby | night | day | vote | last
    this.round = 0;
    this.until = 0;
    this.timer = null;
    this.chat = [];
    this.seq = 0;
    this.night = null;
    this.votes = {};
    this.lastWord = null;
    this.result = null;
    this.mafiaN = 0;
    this.voice = new Set();
  }

  /* ───── yordamchilar ───── */
  get list() { return [...this.players.values()]; }
  alive() { return this.list.filter((p) => p.inGame && p.alive); }
  isEmpty() { return this.list.every((p) => !p.online && !p.timer); }
  destroy() {
    clearTimeout(this.timer);
    this.list.forEach((p) => clearTimeout(p.timer));
  }
  arm(secs, fn) {
    clearTimeout(this.timer);
    this.until = Date.now() + secs * 1000;
    this.timer = setTimeout(() => {
      try { fn(); } catch (e) { console.error('[room]', this.id, e); }
    }, secs * 1000);
  }
  fixHost() {
    const h = this.players.get(this.host);
    if (h && h.online) return;
    const next = this.list.find((p) => p.online);
    this.host = next ? next.id : null;
  }

  /* ───── xabarlar ───── */
  deliver(msg) {
    for (const p of this.list) {
      if (!p.online) continue;
      if (msg.ch === 'mafia' && !(p.inGame && p.role === 'mafia')) continue;
      this.send(p.id, 'chat', msg);
    }
  }
  sys(text) {
    const msg = { id: ++this.seq, ch: 'all', sys: true, text, ts: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > 200) this.chat.shift();
    this.deliver(msg);
  }
  announce(ev, data) {
    for (const p of this.list) if (p.online) this.send(p.id, ev, data);
  }
  /** O'lim / osilish / chiqib ketish: rol hammaga katta oynada ko'rsatiladi */
  reveal(p, cause, extra = {}) {
    this.announce('reveal', { kind: 'death', cause, id: p.id, name: p.name, role: p.role, team: ROLES[p.role].team, ...extra });
  }
  canWrite(uid, ch) {
    const p = this.players.get(uid);
    if (!p) return false;
    if (this.phase === 'lobby') return ch === 'all';
    if (this.phase === 'last') return uid === this.lastWord && ch === 'all';
    if (!p.inGame || !p.alive || p.spec) return false;
    if (this.phase === 'night') return p.role === 'mafia' && ch === 'mafia';
    return ch === 'all'; // day, vote
  }
  isGhost(p) { return !!(p.spec || (p.inGame && !p.alive)); }
  /*
   * Mikrofon qaysi kanalga uzatadi:
   *  'pub'   — hamma eshitadi (kunduz tiriklar, so'nggi so'z, kutish zali)
   *  'ghost' — faqat o'lganlar/tomoshabinlar eshitadi (o'lganlar o'zaro gaplashadi)
   *  null    — mikrofon o'chiq (tunda tiriklar)
   */
  voiceClass(uid) {
    const p = this.players.get(uid);
    if (!p) return null;
    if (this.phase === 'lobby') return 'pub';
    if (this.phase === 'last' && uid === this.lastWord) return 'pub';
    if (this.isGhost(p)) return 'ghost';
    if ((this.phase === 'day' || this.phase === 'vote') && p.inGame && p.alive) return 'pub';
    return null;
  }
  canSpeak(uid) { return this.voiceClass(uid) !== null; }
  say(uid, text) {
    const p = this.players.get(uid);
    if (!p) return false;
    const ch = this.phase === 'night' ? 'mafia' : 'all';
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text || !this.canWrite(uid, ch)) return false;
    const now = Date.now();
    if (now - (p.lastMsg || 0) < 700) return false;
    p.lastMsg = now;
    const msg = { id: ++this.seq, ch, from: uid, name: p.name, text, ts: now };
    this.chat.push(msg);
    if (this.chat.length > 200) this.chat.shift();
    this.deliver(msg);
    return true;
  }
  history(uid) {
    const p = this.players.get(uid);
    const mafia = p && p.inGame && p.role === 'mafia';
    return this.chat.filter((m) => m.ch === 'all' || (m.ch === 'mafia' && mafia)).slice(-80);
  }

  /* ───── holat ko'rinishi (har bir o'yinchi uchun alohida) ───── */
  pickOf(p) {
    if (!p || !p.inGame) return null;
    if (this.phase === 'night' && this.night) {
      const n = this.night;
      if (p.role === 'mafia') return n.kill[p.id] || null;
      if (p.role === 'shifokor') return n.heal[p.id] || null;
      if (p.role === 'komissar') return n.check[p.id] || n.shoot[p.id] || null;
    }
    if (this.phase === 'vote' && p.id in this.votes) return this.votes[p.id] === null ? 'skip' : this.votes[p.id];
    return null;
  }
  view(uid) {
    const me = this.players.get(uid);
    const mate = me && me.inGame && me.role === 'mafia';
    const players = this.list.map((p) => {
      const open = this.phase !== 'lobby' && p.inGame && (!p.alive || p.id === uid || (mate && p.role === 'mafia'));
      return { id: p.id, name: p.name, online: p.online, alive: p.alive, inGame: p.inGame, out: p.out, spec: p.spec, role: open ? p.role : null, ghost: this.isGhost(p), vc: this.voiceClass(p.id) };
    });
    return {
      id: this.id, phase: this.phase, round: this.round, until: this.until, now: Date.now(),
      host: this.host, min: MIN_PLAYERS, mafiaN: this.mafiaN, lastWord: this.lastWord,
      players, voice: [...this.voice], result: this.result,
      // Ovoz berish ochiq: kim kimga ovoz bergani hammaga ko'rinadi
      votes: this.phase === 'vote' ? Object.fromEntries(Object.entries(this.votes).map(([k, v]) => [k, v === null ? 'skip' : v])) : null,
      me: me ? {
        id: uid, role: me.inGame ? me.role : null, alive: me.alive, spec: me.spec, out: me.out,
        pick: this.pickOf(me), checks: me.role === 'komissar' ? me.checks : [],
        pickMode: me.role === 'komissar' && this.night ? (this.night.shoot[uid] ? 'shoot' : this.night.check[uid] ? 'check' : null) : null,
        bullets: me.role === 'komissar' ? me.bullets : 0,
        canWrite: this.canWrite(uid, this.phase === 'night' ? 'mafia' : 'all'),
        canSpeak: this.canSpeak(uid), vc: this.voiceClass(uid), ghost: me.inGame || me.spec ? this.isGhost(me) : false,
      } : null,
    };
  }
  push(uid) {
    const p = this.players.get(uid);
    if (p && p.online) this.send(uid, 'state', this.view(uid));
  }
  broadcast() { this.list.forEach((p) => this.push(p.id)); }

  /* ───── kirish / chiqish ───── */
  join(user) {
    let p = this.players.get(user.id);
    if (p) {
      p.name = user.name;
      p.online = true;
      clearTimeout(p.timer);
      p.timer = null;
    } else {
      if (this.list.length >= MAX_PLAYERS) return { error: 'Xona to‘lgan' };
      p = {
        id: user.id, name: user.name, online: true, inGame: false, alive: false, role: null,
        out: false, spec: this.phase !== 'lobby', timer: null, lastMsg: 0, checks: [], bullets: 0,
      };
      this.players.set(user.id, p);
      this.sys(p.spec ? `👁 ${p.name} tomosha qilmoqda.` : `➕ ${p.name} xonaga qo‘shildi.`);
    }
    this.fixHost();
    this.broadcast();
    return { ok: true };
  }
  /** Ilovadan chiqdi yoki aloqa uzildi: qisqa muddatdan keyin o'yindan chiqariladi */
  startLeave(uid, secs) {
    const p = this.players.get(uid);
    if (!p || p.timer) return;
    p.timer = setTimeout(() => this.eject(uid), secs * 1000);
  }
  cancelLeave(uid) {
    const p = this.players.get(uid);
    if (!p) return;
    clearTimeout(p.timer);
    p.timer = null;
  }
  dropped(uid) {
    const p = this.players.get(uid);
    if (!p) return;
    p.online = false;
    this.startLeave(uid, GRACE.drop);
  }
  eject(uid) {
    const p = this.players.get(uid);
    if (!p) return;
    clearTimeout(p.timer);
    p.timer = null;
    this.voice.delete(uid);

    if (this.phase === 'lobby' || !p.inGame) {
      this.players.delete(uid);
      this.sys(`➖ ${p.name} chiqib ketdi.`);
      this.fixHost();
      this.broadcast();
      return;
    }
    p.online = false;
    if (p.alive) {
      p.alive = false;
      p.out = true;
      this.sys(`🚪 ${p.name} ilovadan chiqdi. Roli: ${tag(p)}. U shu o‘yindan chiqarildi.`);
      this.reveal(p, 'left');
      if (this.night) {
        delete this.night.kill[uid];
        delete this.night.heal[uid];
        delete this.night.check[uid];
        delete this.night.shoot[uid];
      }
      delete this.votes[uid];
      if (this.checkWin()) return;
    }
    this.broadcast();
  }

  /* ───── o'yin boshlanishi ───── */
  start(uid) {
    if (this.phase !== 'lobby') return 'O‘yin allaqachon ketmoqda';
    if (uid !== this.host) return 'Faqat boshlovchi boshlay oladi';
    for (const p of this.list) if (!p.online) this.players.delete(p.id);
    const ps = this.list;
    if (ps.length < MIN_PLAYERS) return `Kamida ${MIN_PLAYERS} o‘yinchi kerak`;

    const n = ps.length;
    this.mafiaN = n >= 9 ? 3 : n >= 6 ? 2 : 1;
    const roles = Array(this.mafiaN).fill('mafia');
    roles.push('komissar');
    if (n >= 5) roles.push('shifokor');
    while (roles.length < n) roles.push('fuqaro');
    shuffle(roles);

    this.chat = [];
    this.result = null;
    this.round = 0;
    ps.forEach((p, i) => {
      p.inGame = true; p.alive = true; p.spec = false; p.out = false; p.checks = [];
      p.bullets = 0;
      p.role = roles[i];
      if (p.role === 'komissar') p.bullets = BULLETS;
    });
    this.sys(`🎭 O‘yin boshlandi! ${n} o‘yinchi, ${this.mafiaN} ta mafiya, 1 komissar${n >= 5 ? ', 1 shifokor' : ''}.`);
    this.sys('⚠️ Ilovadan chiqsangiz, rolingiz e’lon qilinadi va o‘yindan chiqarilasiz.');
    for (const p of ps) this.send(p.id, 'role', p.role);
    this.startNight();
    return null;
  }

  /* ───── tun ───── */
  startNight() {
    this.round++;
    this.phase = 'night';
    this.lastWord = null;
    this.night = { kill: {}, heal: {}, check: {}, shoot: {} };
    this.sys(`🌙 ${this.round}-tun. Shahar uyquga ketdi. Mafiya, Shifokor va Komissar tanlov qiladi (Komissar tekshiradi yoki otadi).`);
    this.arm(T.night, () => this.resolveNight());
    this.broadcast();
  }
  action(uid, target, mode) {
    const p = this.players.get(uid);
    const t = this.players.get(target);
    if (this.phase !== 'night' || !p || !p.inGame || !p.alive) return 'Hozir mumkin emas';
    if (!t || !t.inGame || !t.alive) return 'Nishon yaroqsiz';
    const n = this.night;
    if (p.role === 'mafia') {
      if (t.role === 'mafia') return 'Mafiyani o‘ldirib bo‘lmaydi';
      n.kill[uid] = target;
    } else if (p.role === 'shifokor') {
      n.heal[uid] = target;
    } else if (p.role === 'komissar') {
      if (n.check[uid] || n.shoot[uid]) return 'Bu tunda tanlov qilib bo‘ldingiz';
      if (target === uid) return 'O‘zingizni tanlay olmaysiz';
      if (mode === 'shoot') {
        if (p.bullets < 1) return 'O‘qingiz qolmadi';
        p.bullets--;
        n.shoot[uid] = target;
      } else {
        n.check[uid] = target;
        p.checks.push({ round: this.round, id: t.id, name: t.name, team: ROLES[t.role].team });
      }
    } else return 'Sizning tunda harakatingiz yo‘q';
    this.push(uid);
    return null;
  }
  resolveNight() {
    const n = this.night;
    const tally = {};
    Object.values(n.kill).forEach((t) => { tally[t] = (tally[t] || 0) + 1; });
    const entries = Object.entries(tally);
    let victim = null;
    if (entries.length) {
      const max = Math.max(...entries.map((e) => e[1]));
      const tops = entries.filter((e) => e[1] === max).map((e) => Number(e[0]));
      victim = this.players.get(tops[Math.floor(Math.random() * tops.length)]);
    }
    this.night = null;
    this.phase = 'day';
    this.sys('☀️ Tong otdi.');
    let died = false;
    // Komissarning o'qi: shifokor ham to'sa olmaydi
    const shot = new Set(Object.values(n.shoot));
    for (const id of shot) {
      const t = this.players.get(id);
      if (!t || !t.alive) continue;
      t.alive = false;
      died = true;
      this.sys(`🔫 Komissar ${t.name}ni otdi. Roli: ${tag(t)}.`);
      this.reveal(t, 'shot');
    }
    if (victim && !victim.alive) {
      victim = null; // mafiya nishoni o'qdan o'lgan bo'lsa, ikki marta o'lmaydi
    }
    if (!victim) {
      if (!died) {
        this.sys('Bu tunda hech kim o‘lmadi.');
        this.announce('reveal', { kind: 'none', emoji: '☀️', title: 'Tong otdi', text: 'Bu tunda hech kim o‘lmadi.' });
      }
    } else if (Object.values(n.heal).includes(victim.id)) {
      this.sys('💉 Shifokor kimnidir o‘lim changalidan qutqardi.');
      if (!died) this.announce('reveal', { kind: 'none', emoji: '💉', title: 'Shifokor qutqardi', text: 'Mafiya hujum qildi, lekin hech kim o‘lmadi.' });
    } else {
      victim.alive = false;
      died = true;
      this.sys(`💀 ${victim.name} tunda o‘ldirildi. Roli: ${tag(victim)}.`);
      this.reveal(victim, 'night');
    }
    if (this.checkWin()) return;
    this.sys(`Tirik: ${this.alive().map((p) => p.name).join(', ')}.`);
    this.arm(T.discuss + (died ? REVEAL : 0), () => this.startVote());
    this.broadcast();
  }

  /* ───── kunduz ───── */
  startVote() {
    this.phase = 'vote';
    this.votes = {};
    this.sys('🗳 Ovoz berish boshlandi. Kimni osamiz?');
    this.arm(T.vote, () => this.resolveVote());
    this.broadcast();
  }
  vote(uid, target) {
    const p = this.players.get(uid);
    if (this.phase !== 'vote' || !p || !p.inGame || !p.alive) return 'Hozir ovoz bera olmaysiz';
    let next;
    if (target === 'skip' || target === null) next = null;
    else {
      const t = this.players.get(target);
      if (!t || !t.alive || !t.inGame || target === uid) return 'Nishon yaroqsiz';
      next = target;
    }
    if (uid in this.votes && this.votes[uid] === next) return null; // o'zgarmagan
    this.votes[uid] = next;
    this.sys(`🗳 ${p.name} → ${next === null ? 'hech kimga' : this.players.get(next).name}`);
    // Hamma ovoz bersa, kutib o'tirmaymiz
    if (this.alive().every((q) => q.id in this.votes) && this.until - Date.now() > 4000) {
      this.sys('Hamma ovoz berdi. Natija 3 soniyadan so‘ng.');
      this.arm(3, () => this.resolveVote());
    }
    this.broadcast();
    return null;
  }
  resolveVote() {
    const tally = {};
    let skips = 0;
    for (const t of Object.values(this.votes)) {
      if (t === null) skips++;
      else tally[t] = (tally[t] || 0) + 1;
    }
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const summary = entries.map(([id, c]) => `${this.players.get(Number(id)).name} — ${c}`).join(', ');
    this.sys(`Ovozlar: ${summary || 'hech kim'}${skips ? `; o‘tkazib yuborganlar: ${skips}` : ''}.`);
    this.votes = {};

    if (!entries.length || (entries[1] && entries[1][1] === entries[0][1])) {
      this.sys('⚖️ Ovozlar teng yoki yetarli emas — hech kim osilmadi.');
      this.announce('reveal', { kind: 'none', emoji: '⚖️', title: 'Hech kim osilmadi', text: 'Ovozlar teng yoki yetarli emas.' });
      return this.startNight();
    }
    const victim = this.players.get(Number(entries[0][0]));
    victim.alive = false;
    this.sys(`⚖️ ${victim.name} osildi. Roli: ${tag(victim)}.`);
    this.reveal(victim, 'hang', { votes: entries[0][1] });
    if (this.checkWin()) return;
    this.phase = 'last';
    this.lastWord = victim.id;
    this.sys(`🎤 ${victim.name}ning so‘nggi so‘zi (${T.last} soniya).`);
    this.arm(T.last + REVEAL, () => this.startNight());
    this.broadcast();
  }

  /* ───── g'alaba ───── */
  checkWin() {
    const a = this.alive();
    const m = a.filter((p) => p.role === 'mafia').length;
    const winner = m === 0 ? 'town' : m >= a.length - m ? 'mafia' : null;
    if (winner) this.finish(winner);
    return winner;
  }
  finish(winner) {
    clearTimeout(this.timer);
    const players = this.list.filter((p) => p.inGame).map((p) => ({
      id: p.id, name: p.name, role: p.role, alive: p.alive, out: p.out, won: ROLES[p.role].team === winner,
    }));
    this.sys(winner === 'mafia' ? '🏁 MAFIYA g‘alaba qildi!' : '🏁 SHAHAR g‘alaba qildi!');
    this.onFinish(this, winner, players);

    this.result = { winner, players };
    this.phase = 'lobby';
    this.night = null;
    this.votes = {};
    this.lastWord = null;
    this.round = 0;
    for (const p of this.list) {
      if (!p.online) { clearTimeout(p.timer); this.players.delete(p.id); continue; }
      Object.assign(p, { inGame: false, alive: false, role: null, out: false, spec: false, checks: [] });
    }
    this.fixHost();
    this.broadcast();
  }
}

module.exports = { Room, ROLES, T, GRACE, MIN_PLAYERS, MAX_PLAYERS };
