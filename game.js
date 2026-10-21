'use strict';
/*
 * Mafia o'yin mantig'i. Tashqi kutubxonasiz.
 * send(uid, event, data) — serverdan beriladi.
 * hooks.onFinish(room, winner, players) — statistika uchun.
 * hooks.takeItems(uid) -> {shield, docs} — o'yin boshida do'kondan olingan narsalarni sarflaydi.
 */

const FAST = !!process.env.FAST; // sinov uchun tez rejim
const T = FAST
  ? { night: 0.3, discuss: 0.3, vote: 0.3, last: 0.2 }
  : { night: 40, discuss: 75, vote: 35, last: 20 }; // soniyalarda
const GRACE = { away: 3, drop: 8 }; // ilovadan chiqqandan keyin necha soniyada o'yindan chiqariladi
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 20;
const LUCK = 0.5; // Omadli: tunda hujumdan omon qolish ehtimoli

/* team: town | mafia | qotil | suidsid  (g'alaba shu bo'yicha hisoblanadi) */
const ROLES = {
  tinch: { n: 'Tinch aholi', e: '👨🏼', team: 'town' },
  don: { n: 'Don', e: '🤵🏻', team: 'mafia' },
  mafia: { n: 'Mafia', e: '🤵🏼', team: 'mafia' },
  komissar: { n: 'Komissar Katani', e: '🕵️', team: 'town' },
  serjant: { n: 'Serjant', e: '👮🏼‍♂️', team: 'town' },
  shifokor: { n: 'Shifokor', e: '👨🏼‍⚕️', team: 'town' },
  qotil: { n: 'Qotil', e: '🔪', team: 'qotil' },
  mashuqa: { n: 'Ma’shuqa', e: '💃🏼', team: 'town' },
  advokat: { n: 'Advokat', e: '👨🏼‍💼', team: 'mafia' },
  suidsid: { n: 'Suidsid', e: '🤦🏼‍♂️', team: 'suidsid' },
  daydi: { n: 'Daydi', e: '🧙🏼‍♂️', team: 'town' },
  omadli: { n: 'Omadli', e: '🤞', team: 'town' },
  kamikaze: { n: 'Kamikaze', e: '💣', team: 'town' },
  jurnalist: { n: 'Jurnalist', e: '📰', team: 'town' },
  tansoqchi: { n: 'Tansoqchi', e: '🛡', team: 'town' },
  mer: { n: 'Mer', e: '🏛', team: 'town' },
};

/* Tungi harakat turlari */
const NIGHT = {
  don: 'kill', mafia: 'kill', qotil: 'kill',
  komissar: 'police', shifokor: 'heal', mashuqa: 'block', advokat: 'cover',
  jurnalist: 'pair', tansoqchi: 'guard', daydi: 'visit',
};

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const tag = (p) => `${ROLES[p.role].e} ${ROLES[p.role].n}`;
const isMafia = (p) => !!p.role && ROLES[p.role].team === 'mafia';
const weight = (p) => (p.role === 'mer' ? 2 : 1);

/** O'yinchilar soniga qarab rollar ro'yxatini tuzadi */
function buildRoles(n) {
  const mc = n <= 5 ? 1 : n <= 8 ? 2 : n <= 13 ? 3 : 4;
  const mafiaSide = ['don', 'mafia', 'advokat', 'mafia'].slice(0, mc);
  const tinchMin = Math.max(1, Math.ceil(n / 5));
  const slots = Math.max(0, n - mc - tinchMin);
  const rest = shuffle(['serjant', 'mashuqa', 'qotil', 'omadli', 'jurnalist', 'tansoqchi', 'daydi', 'kamikaze', 'suidsid', 'mer']);
  const specials = ['komissar', 'shifokor', ...rest].slice(0, slots);
  const roles = [...mafiaSide, ...specials];
  while (roles.length < n) roles.push('tinch');
  return shuffle(roles);
}

class Room {
  constructor(id, send, hooks) {
    this.id = id;
    this.send = send;
    this.hooks = hooks || {};
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
    this.kamiUsed = false;
    this.result = null;
    this.mafiaN = 0;
    this.voice = new Set();
    this.lastNight = null;
    this.lastVote = null;
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
  push_(msg) {
    this.chat.push(msg);
    if (this.chat.length > 300) this.chat.shift();
    this.deliver(msg);
  }
  deliver(msg) {
    for (const p of this.list) {
      if (!p.online) continue;
      if (msg.ch === 'mafia' && !(p.inGame && isMafia(p))) continue;
      if (msg.ch === 'dm' && msg.to !== p.id) continue;
      this.send(p.id, 'chat', msg);
    }
  }
  /** Hammaga tizim xabari. card — maxsus kartochka (tun natijasi, ovozlar) */
  sys(text, card) {
    const msg = { id: ++this.seq, ch: 'all', sys: true, text, ts: Date.now() };
    if (card) msg.card = card;
    this.push_(msg);
  }
  sysMafia(text) { this.push_({ id: ++this.seq, ch: 'mafia', sys: true, text, ts: Date.now() }); }
  /** Faqat bitta o'yinchiga maxfiy xabar */
  tell(uid, text) {
    const p = this.players.get(uid);
    if (!p) return;
    p.intel.push({ round: this.round, text });
    if (p.intel.length > 30) p.intel.shift();
    this.push_({ id: ++this.seq, ch: 'dm', to: uid, sys: true, text: `🔒 ${text}`, ts: Date.now() });
  }
  canWrite(uid, ch) {
    const p = this.players.get(uid);
    if (!p) return false;
    if (this.phase === 'lobby') return ch === 'all';
    if (this.phase === 'last') return uid === this.lastWord && ch === 'all';
    if (!p.inGame || !p.alive || p.spec || p.silenced) return false;
    if (this.phase === 'night') return isMafia(p) && ch === 'mafia';
    return ch === 'all'; // day, vote
  }
  canSpeak(uid) {
    const p = this.players.get(uid);
    if (!p) return false;
    if (this.phase === 'lobby') return true;
    if (this.phase === 'last') return uid === this.lastWord;
    if (this.phase === 'day' || this.phase === 'vote') return p.inGame && p.alive && !p.spec && !p.silenced;
    return false; // tun
  }
  say(uid, text) {
    const p = this.players.get(uid);
    if (!p) return false;
    const ch = this.phase === 'night' ? 'mafia' : 'all';
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text || !this.canWrite(uid, ch)) return false;
    const now = Date.now();
    if (now - (p.lastMsg || 0) < 700) return false;
    p.lastMsg = now;
    this.push_({ id: ++this.seq, ch, from: uid, name: p.name, text, ts: now });
    return true;
  }
  history(uid) {
    const p = this.players.get(uid);
    const mafia = p && p.inGame && isMafia(p);
    return this.chat
      .filter((m) => m.ch === 'all' || (m.ch === 'mafia' && mafia) || (m.ch === 'dm' && m.to === uid))
      .slice(-100);
  }

  /* ───── holat ko'rinishi (har bir o'yinchi uchun alohida) ───── */
  nightPick(p) { return this.night && this.night.acts[p.id] ? this.night.acts[p.id] : null; }
  marks(me) {
    const out = [];
    if (this.phase === 'vote') {
      for (const [v, t] of Object.entries(this.votes)) {
        const vp = this.players.get(Number(v));
        out.push({ k: 'vote', from: Number(v), to: t === null ? 'skip' : t, w: vp ? weight(vp) : 1 });
      }
    } else if (this.phase === 'night' && this.night && me && me.inGame && isMafia(me)) {
      for (const [v, a] of Object.entries(this.night.acts)) {
        const vp = this.players.get(Number(v));
        if (vp && (vp.role === 'don' || vp.role === 'mafia')) out.push({ k: 'kill', from: Number(v), to: a.target, w: 1 });
      }
    }
    return out;
  }
  view(uid) {
    const me = this.players.get(uid);
    const mate = !!(me && me.inGame && isMafia(me));
    const sj = !!(me && me.inGame && me.role === 'serjant');
    const players = this.list.map((p) => {
      const open = this.phase !== 'lobby' && p.inGame &&
        (!p.alive || p.id === uid || (mate && isMafia(p)) || (sj && p.role === 'komissar'));
      return { id: p.id, name: p.name, online: p.online, alive: p.alive, inGame: p.inGame, out: p.out, spec: p.spec, role: open ? p.role : null };
    });
    let pick = null, pick2 = null, mode = null;
    if (me && me.inGame) {
      if (this.phase === 'night') {
        const a = this.nightPick(me);
        if (a) { pick = a.target; pick2 = a.target2 || null; mode = a.mode || null; }
      } else if (this.phase === 'vote' && uid in this.votes) {
        pick = this.votes[uid] === null ? 'skip' : this.votes[uid];
      }
    }
    return {
      id: this.id, phase: this.phase, round: this.round, until: this.until, now: Date.now(),
      host: this.host, min: MIN_PLAYERS, mafiaN: this.mafiaN, lastWord: this.lastWord,
      players, voice: [...this.voice], result: this.result,
      marks: this.marks(me), lastNight: this.lastNight, lastVote: this.lastVote,
      me: me ? {
        id: uid, role: me.inGame ? me.role : null, alive: me.alive, spec: me.spec, out: me.out,
        silenced: !!me.silenced,
        act: me.inGame && me.alive ? NIGHT[me.role] || null : null,
        pick, pick2, mode,
        intel: (me.intel || []).slice(-8),
        shield: !!me.shield, docs: !!me.docs,
        canTake: this.phase === 'last' && this.lastWord === uid && me.role === 'kamikaze' && !this.kamiUsed,
        canWrite: this.canWrite(uid, this.phase === 'night' ? 'mafia' : 'all'),
        canSpeak: this.canSpeak(uid),
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
        out: false, spec: this.phase !== 'lobby', timer: null, lastMsg: 0, intel: [],
        silenced: false, shield: false, docs: false,
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
      this.sys(`🚪 ${p.name} ilovadan chiqdi. Roli: ${tag(p)}. U shu o‘yindan chiqarildi.`);
      this.die(p, true);
      if (this.night) delete this.night.acts[uid];
      delete this.votes[uid];
      if (this.checkWin()) return;
    }
    this.broadcast();
  }

  /** O'yinchini o'ldiradi va Don / Komissar o'rniga voris tayinlaydi */
  die(p, out = false) {
    if (!p.alive) return;
    p.alive = false;
    if (out) p.out = true;
    if (p.role === 'don') {
      const heir = shuffle(this.alive().filter((x) => x.role === 'mafia'))[0];
      if (heir) {
        heir.role = 'don';
        this.tell(heir.id, '🤵🏻 Don halok bo‘ldi. Endi siz yangi Donsiz: tunda kim o‘lishini siz hal qilasiz!');
        this.sysMafia(`🤵🏻 ${heir.name} yangi Don bo‘ldi.`);
        this.send(heir.id, 'role', 'don');
      }
    }
    if (p.role === 'komissar') {
      const sj = this.alive().find((x) => x.role === 'serjant');
      if (sj) {
        sj.role = 'komissar';
        this.tell(sj.id, '🕵️ Komissar halok bo‘ldi. Endi siz Komissar Katanisiz!');
        this.send(sj.id, 'role', 'komissar');
      }
    }
  }

  /* ───── o'yin boshlanishi ───── */
  start(uid) {
    if (this.phase !== 'lobby') return 'O‘yin allaqachon ketmoqda';
    if (uid !== this.host) return 'Faqat boshlovchi boshlay oladi';
    for (const p of this.list) if (!p.online) this.players.delete(p.id);
    const ps = this.list;
    if (ps.length < MIN_PLAYERS) return `Kamida ${MIN_PLAYERS} o‘yinchi kerak`;

    const n = ps.length;
    const roles = buildRoles(n);
    this.mafiaN = roles.filter((r) => ROLES[r].team === 'mafia').length;

    this.chat = [];
    this.result = null;
    this.round = 0;
    this.lastNight = null;
    this.lastVote = null;
    this.kamiUsed = false;
    ps.forEach((p, i) => {
      const items = (this.hooks.takeItems && this.hooks.takeItems(p.id)) || {};
      Object.assign(p, {
        inGame: true, alive: true, spec: false, out: false, intel: [], silenced: false,
        role: roles[i], shield: !!items.shield, docs: !!items.docs,
      });
    });
    this.sys(`🎭 O‘yin boshlandi! ${n} o‘yinchi, ${this.mafiaN} ta mafiya tarafdori. Rollar ro‘yxati maxfiy.`);
    this.sys('⚠️ Ilovadan chiqsangiz, rolingiz e’lon qilinadi va o‘yindan chiqarilasiz.');
    for (const p of ps) {
      this.send(p.id, 'role', p.role);
      if (p.shield) this.tell(p.id, '🛡 Himoya qalqoni faol: birinchi tungi hujum qaytariladi.');
      if (p.docs) this.tell(p.id, '📄 Soxta hujjat faol: komissar birinchi tekshirganda sizni tinch deb ko‘radi.');
      if (p.role === 'serjant') {
        const k = ps.find((x) => x.role === 'komissar');
        if (k) this.tell(p.id, `Komissar Katani: ${k.name}.`);
      }
    }
    this.startNight();
    return null;
  }

  /* ───── tun ───── */
  startNight() {
    this.round++;
    this.phase = 'night';
    this.lastWord = null;
    this.night = { acts: {} };
    this.list.forEach((p) => { p.silenced = false; });
    this.sys(`🌙 ${this.round}-tun. Shahar uyquga ketdi.`);
    this.arm(T.night, () => this.resolveNight());
    this.broadcast();
  }
  action(uid, d) {
    d = d || {};
    const p = this.players.get(uid);
    if (!p || !p.inGame || !p.alive) return 'Hozir mumkin emas';
    const get = (id) => {
      const t = this.players.get(Number(id));
      return t && t.inGame && t.alive ? t : null;
    };
    if (this.phase === 'last') return this.takeWithYou(p, get(d.target));
    if (this.phase !== 'night' || !this.night) return 'Hozir mumkin emas';

    const kind = NIGHT[p.role];
    if (!kind) return 'Sizning tunda harakatingiz yo‘q';
    const t = get(d.target);
    if (!t) return 'Nishon yaroqsiz';
    const act = { target: t.id };
    switch (kind) {
      case 'kill':
        if (t.id === uid) return 'O‘zingizni o‘ldira olmaysiz';
        if (isMafia(p) && isMafia(t)) return 'Mafiyani o‘ldirib bo‘lmaydi';
        break;
      case 'police':
        if (t.id === uid) return 'O‘zingizni tanlab bo‘lmaydi';
        act.mode = d.mode === 'kill' ? 'kill' : 'check';
        break;
      case 'pair': {
        const t2 = get(d.target2);
        if (!t2 || t2.id === t.id || t.id === uid || t2.id === uid) return 'O‘zingizdan boshqa ikki xil fuqaroni tanlang';
        act.target2 = t2.id;
        break;
      }
      case 'heal':
      case 'cover':
        break;
      default:
        if (t.id === uid) return 'O‘zingizni tanlab bo‘lmaydi';
    }
    this.night.acts[uid] = act;
    if (kind === 'kill' && isMafia(p)) this.list.filter((x) => x.inGame && isMafia(x)).forEach((x) => this.push(x.id));
    else this.push(uid);
    return null;
  }
  takeWithYou(p, t) {
    if (this.lastWord !== p.id || p.role !== 'kamikaze' || this.kamiUsed) return 'Hozir mumkin emas';
    if (!t || t.id === p.id) return 'Nishon yaroqsiz';
    this.kamiUsed = true;
    this.die(t);
    this.sys(`💣 Kamikaze ${p.name} o‘zi bilan ${t.name}ni olib ketdi. Roli: ${tag(t)}.`);
    if (this.checkWin()) return null;
    this.broadcast();
    return null;
  }

  resolveNight() {
    const acts = this.night.acts;
    const snap = this.alive();
    const pl = (id) => this.players.get(id);
    const blocked = new Set();
    for (const p of snap) if (p.role === 'mashuqa' && acts[p.id]) blocked.add(acts[p.id].target);
    const ok = (p) => !!acts[p.id] && !blocked.has(p.id) && p.alive;

    /* Hujumlar */
    const attacks = [];
    const mafs = snap.filter((p) => p.role === 'don' || p.role === 'mafia');
    const don = mafs.find((p) => p.role === 'don');
    if (don && acts[don.id]) {
      if (ok(don)) attacks.push({ t: pl(acts[don.id].target), by: don });
    } else {
      const tally = {};
      for (const m of mafs) if (ok(m)) (tally[acts[m.id].target] = tally[acts[m.id].target] || []).push(m);
      const ent = Object.entries(tally);
      if (ent.length) {
        const max = Math.max(...ent.map((e) => e[1].length));
        const top = ent.filter((e) => e[1].length === max);
        const [tid, by] = top[Math.floor(Math.random() * top.length)];
        attacks.push({ t: pl(Number(tid)), by: by[0] });
      }
    }
    for (const p of snap) {
      if (p.role === 'qotil' && ok(p)) attacks.push({ t: pl(acts[p.id].target), by: p });
      if (p.role === 'komissar' && ok(p) && acts[p.id].mode === 'kill') attacks.push({ t: pl(acts[p.id].target), by: p });
    }

    const guards = new Map();
    const heals = new Map(); // nishon -> [shifokorlar]
    const covers = new Set();
    for (const p of snap) {
      if (!ok(p)) continue;
      const a = acts[p.id];
      if (p.role === 'tansoqchi') (guards.get(a.target) || guards.set(a.target, []).get(a.target)).push(p);
      if (p.role === 'shifokor') (heals.get(a.target) || heals.set(a.target, []).get(a.target)).push(p);
      if (p.role === 'advokat') covers.add(a.target);
    }

    /* Hujumlarni hal qilish */
    const dead = new Set();
    const deaths = [];
    const esc = { saved: 0, lucky: 0, shield: 0 };
    for (const a of attacks) {
      const t = a.t;
      if (!t || dead.has(t.id)) continue;
      const g = (guards.get(t.id) || []).find((b) => !dead.has(b.id));
      if (g) { dead.add(g.id); deaths.push({ p: g, cause: 'guard' }); continue; }
      if (heals.has(t.id)) {
        esc.saved++;
        heals.get(t.id).forEach((d) => this.tell(d.id, `💉 Siz ${t.name}ni o‘lim changalidan qutqardingiz.`));
        continue;
      }
      if (t.shield) { t.shield = false; esc.shield++; this.tell(t.id, '🛡 Himoya qalqoni sizni hujumdan qutqardi!'); continue; }
      if (t.role === 'omadli' && Math.random() < LUCK) { esc.lucky++; this.tell(t.id, '🤞 Sizga hujum bo‘ldi, lekin omadingiz keldi!'); continue; }
      dead.add(t.id);
      deaths.push({ p: t, cause: 'kill' });
    }

    /* Maxfiy ma'lumotlar */
    const team = (p) => ROLES[p.role].team;
    for (const p of snap) {
      if (!ok(p)) continue;
      const a = acts[p.id];
      if (p.role === 'komissar' && a.mode === 'check') {
        const t = pl(a.target);
        let evil = (isMafia(t) || t.role === 'qotil') && !covers.has(t.id);
        if (evil && t.docs) { t.docs = false; evil = false; }
        const text = `🔎 ${t.name}: ${evil ? 'MAFIYA / xavfli' : 'tinch aholi'}.`;
        this.tell(p.id, text);
        snap.filter((s) => s.role === 'serjant').forEach((s) => this.tell(s.id, `Komissar tekshiruvi — ${text}`));
      }
      if (p.role === 'jurnalist') {
        const x = pl(a.target), y = pl(a.target2);
        this.tell(p.id, `📰 ${x.name} va ${y.name}: ${team(x) === team(y) ? 'bir qayiqda' : 'turli qayiqda'}.`);
      }
      if (p.role === 'daydi' && !dead.has(p.id)) {
        const t = pl(a.target);
        const who = attacks.filter((x) => x.t === t).map((x) => x.by.name);
        if (who.length) this.tell(p.id, `🧙🏼‍♂️ ${t.name}ning uyida qotillikka guvoh bo‘ldingiz. Hujumchi: ${[...new Set(who)].join(', ')}.`);
        else this.tell(p.id, `🍾 ${t.name}ning uyidan shisha oldingiz. Tinch tun edi.`);
      }
    }

    /* O'limlar */
    this.night = null;
    this.phase = 'day';
    for (const d of deaths) this.die(d.p);
    for (const p of snap) {
      p.silenced = p.alive && blocked.has(p.id);
      if (p.silenced) this.tell(p.id, '💃🏼 Ma’shuqa sizni zararsizlantirdi: tunda harakatingiz o‘tmadi, bugun gapira va ovoz bera olmaysiz.');
    }

    const card = {
      kind: 'night', round: this.round, esc,
      deaths: deaths.map((d) => ({ id: d.p.id, name: d.p.name, role: d.p.role, cause: d.cause })),
    };
    this.lastNight = card;
    this.sys('☀️ Tong otdi.');
    this.sys(deaths.length ? `💀 Tunda halok bo‘lganlar: ${deaths.map((d) => d.p.name).join(', ')}.` : 'Bu tunda hech kim o‘lmadi.', card);
    if (this.checkWin()) return;
    this.sys(`Tirik: ${this.alive().map((p) => p.name).join(', ')}.`);
    this.arm(T.discuss, () => this.startVote());
    this.broadcast();
  }

  /* ───── kunduz ───── */
  startVote() {
    this.phase = 'vote';
    this.votes = {};
    this.sys('🗳 Ovoz berish boshlandi. Kimni osamiz? Kim kimga ovoz berayotgani hammaga ko‘rinadi.');
    this.arm(T.vote, () => this.resolveVote());
    this.broadcast();
  }
  vote(uid, target) {
    const p = this.players.get(uid);
    if (this.phase !== 'vote' || !p || !p.inGame || !p.alive) return 'Hozir ovoz bera olmaysiz';
    if (p.silenced) return 'Ma’shuqa sizni zararsizlantirgan: bugun ovoz bera olmaysiz';
    let label;
    if (target === 'skip' || target === null) { this.votes[uid] = null; label = 'hech kimga'; }
    else {
      const t = this.players.get(target);
      if (!t || !t.alive || !t.inGame || target === uid) return 'Nishon yaroqsiz';
      this.votes[uid] = target;
      label = t.name;
    }
    this.sys(`🗳 ${p.name} ➜ ${label}`);
    this.broadcast();
    return null;
  }
  resolveVote() {
    const alive = this.alive();
    const tally = {}, voters = {}, skips = [];
    for (const [vid, t] of Object.entries(this.votes)) {
      const v = this.players.get(Number(vid));
      if (!v) continue;
      const w = weight(v);
      if (t === null) skips.push(v.name);
      else {
        tally[t] = (tally[t] || 0) + w;
        (voters[t] = voters[t] || []).push({ name: v.name, w });
      }
    }
    const none = alive.filter((p) => !(p.id in this.votes)).map((p) => p.name);
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const rows = entries.map(([id, total]) => ({ id: Number(id), name: this.players.get(Number(id)).name, total, voters: voters[id] }));
    const tie = !entries.length || (entries[1] && entries[1][1] === entries[0][1]);
    const victim = tie ? null : this.players.get(Number(entries[0][0]));
    const card = {
      kind: 'votes', round: this.round, rows, skips, none, tie,
      hanged: victim ? { id: victim.id, name: victim.name, role: victim.role } : null,
    };
    this.lastVote = card;
    this.votes = {};
    this.sys(victim ? `⚖️ ${victim.name} osildi. Roli: ${tag(victim)}.` : '⚖️ Ovozlar teng yoki yetarli emas — hech kim osilmadi.', card);

    if (!victim) return this.startNight();
    this.die(victim);
    if (victim.role === 'suidsid') {
      this.sys(`🤦🏼‍♂️ ${victim.name} Suidsid edi — u aynan shuni xohlagan edi!`);
      return this.finish('suidsid');
    }
    if (this.checkWin()) return null;
    this.phase = 'last';
    this.lastWord = victim.id;
    this.kamiUsed = false;
    const kami = victim.role === 'kamikaze';
    this.sys(kami
      ? `💣 ${victim.name} Kamikaze edi! U o‘zi bilan bir o‘yinchini qabrga olib ketishi mumkin (${T.last} soniya).`
      : `🎤 ${victim.name}ning so‘nggi so‘zi (${T.last} soniya).`);
    this.arm(T.last, () => this.startNight());
    this.broadcast();
    return null;
  }

  /* ───── g'alaba ───── */
  checkWin() {
    const a = this.alive();
    const m = a.filter(isMafia).length;
    const q = a.filter((p) => p.role === 'qotil').length;
    let winner = null;
    if (m === 0 && q === 0) winner = 'town';
    else if (m === 0 && a.length <= 2) winner = 'qotil';
    else if (m > 0 && m >= a.length - m) winner = 'mafia';
    if (winner) this.finish(winner);
    return winner;
  }
  finish(winner) {
    clearTimeout(this.timer);
    const players = this.list.filter((p) => p.inGame).map((p) => ({
      id: p.id, name: p.name, role: p.role, alive: p.alive, out: p.out, won: ROLES[p.role].team === winner,
    }));
    const text = {
      mafia: '🏁 MAFIYA g‘alaba qildi!',
      town: '🏁 SHAHAR g‘alaba qildi!',
      qotil: '🏁 QOTIL yolg‘iz g‘alaba qildi!',
      suidsid: '🏁 SUIDSID g‘alaba qildi!',
    }[winner];
    this.sys(text);
    if (this.hooks.onFinish) this.hooks.onFinish(this, winner, players);

    this.result = { winner, players };
    this.phase = 'lobby';
    this.night = null;
    this.votes = {};
    this.lastWord = null;
    this.round = 0;
    for (const p of this.list) {
      if (!p.online) { clearTimeout(p.timer); this.players.delete(p.id); continue; }
      Object.assign(p, { inGame: false, alive: false, role: null, out: false, spec: false, intel: [], silenced: false, shield: false, docs: false });
    }
    this.fixHost();
    this.broadcast();
  }
}

module.exports = { Room, ROLES, NIGHT, T, GRACE, MIN_PLAYERS, MAX_PLAYERS, buildRoles };
