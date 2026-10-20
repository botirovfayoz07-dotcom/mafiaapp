'use strict';

/* ───────── Telegram va ulanish ───────── */
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.disableVerticalSwipes && tg.disableVerticalSwipes(); }

const qs = new URLSearchParams(location.search);
const startParam = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || qs.get('room') || '';
const auth = qs.get('dev') ? { dev: qs.get('dev') } : { initData: (tg && tg.initData) || '' };
const socket = io({ auth });

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROLE = {
  mafia: { n: 'Mafiya', e: '🕴', d: 'Tunda mafiya jamoasi bilan kelishib, bir kishini o‘ldirasiz. Kunduzi o‘zingizni fuqarodek tuting.' },
  komissar: { n: 'Komissar', e: '🕵️', d: 'Har tunda bir kishini tekshirasiz (mafiyami yoki tinch aholi) YOKI butun o‘yin davomida bitta o‘q bilan birovni otib o‘ldirasiz. Tunda bitta harakat. Xato odamni otsangiz, begunoh o‘ladi!' },
  shifokor: { n: 'Shifokor', e: '💉', d: 'Har tunda bir kishini (o‘zingizni ham) o‘limdan qutqara olasiz.' },
  fuqaro: { n: 'Fuqaro', e: '👤', d: 'Kunduzi muhokama qiling va ovoz berib mafiyani toping.' },
};
const PHASE = { lobby: 'Kutish zali', night: 'Tun', day: 'Muhokama', vote: 'Ovoz berish', last: 'So‘nggi so‘z' };

let S = null;          // oxirgi holat
let room = null;       // hozirgi xona kodi
let myId = null;
let cfg = { ice: [{ urls: 'stun:stun.l.google.com:19302' }], bot: '' };
let clockOff = 0;
let tab = 'game';
let unread = 0;
let autoTried = false;

/* ───────── Yordamchilar ───────── */
let toastTimer;
function toast(t) {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
const haptic = (k) => tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(k);
const roleName = (r) => (ROLE[r] ? `${ROLE[r].e} ${ROLE[r].n}` : '');

function showHome() {
  room = null; S = null;
  revealQ.length = 0; revealOn = false; clearTimeout(revealTimer); $('#reveal').hidden = true;
  $('#home').hidden = false; $('#room').hidden = true;
  document.body.dataset.phase = 'lobby';
  tg && tg.disableClosingConfirmation && tg.disableClosingConfirmation();
}
function showRoom() {
  $('#home').hidden = true; $('#room').hidden = false;
  $('#log').innerHTML = '';
  setTab('game');
  // Ilova yopilishidan oldin tasdiq so'raydi
  tg && tg.enableClosingConfirmation && tg.enableClosingConfirmation();
}

/* ───────── Socket hodisalari ───────── */
socket.on('connect', () => {
  $('#conn').hidden = true;
  if (room) join(room);
  else if (startParam && !autoTried) { autoTried = true; join(startParam); }
  if (Voice.on) voiceRejoin();
});
socket.on('disconnect', () => { $('#conn').textContent = 'Ulanmoqda…'; $('#conn').hidden = false; });
socket.on('connect_error', (e) => {
  $('#conn').textContent = e.message === 'auth' ? 'Ilovani Telegram ichida oching' : 'Ulanmoqda…';
  $('#conn').hidden = false;
});
socket.on('config', (c) => { cfg = Object.assign(cfg, c); myId = c.id; });
socket.on('me', (m) => { $('#stats').textContent = m.games ? `${m.wins} g‘alaba, ${m.games} o‘yin` : ''; });
socket.on('kicked', () => { voiceStop(); showHome(); toast('Ilova boshqa qurilmada ochildi'); });
socket.on('err', (t) => { toast(t); haptic('error'); });
socket.on('history', (list) => { $('#log').innerHTML = ''; list.forEach(addMsg); });
socket.on('chat', (m) => {
  addMsg(m);
  if (tab !== 'chat' && !m.sys) { unread++; renderBadge(); }
});
socket.on('role', (r) => { showRoleCard(r); haptic('success'); });
socket.on('reveal', (d) => pushReveal(d));
socket.on('state', (s) => {
  if (s.id !== room) return;
  S = s;
  clockOff = s.now - Date.now();
  document.body.dataset.phase = s.phase;
  renderHead(); renderGame(); renderChatInput(); renderVoice(); applyMic();
});

function join(id) {
  socket.emit('room:join', { id }, (r) => {
    if (r && r.ok) {
      const first = room !== r.id;
      room = r.id;
      if (first) showRoom();
    } else {
      showHome();
      toast((r && r.error) || 'Xonaga kirib bo‘lmadi');
    }
  });
}

/* ───────── Bosh sahifa ───────── */
$('#create').onclick = () => socket.emit('room:create', (r) => join(r.id));
const joinByCode = () => { const c = $('#code').value.trim(); if (c) join(c); };
$('#join').onclick = joinByCode;
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });

/* ───────── Sarlavha va taymer ───────── */
function renderHead() {
  $('#phaseName').textContent = S.phase === 'lobby' || !S.round ? PHASE[S.phase] : `${PHASE[S.phase]} · ${S.round}`;
  $('#codeBtn').textContent = `📤 ${S.id}`;
}
setInterval(() => {
  const el = $('#timer');
  if (!S || S.phase === 'lobby') { el.textContent = ''; return; }
  const left = Math.max(0, Math.ceil((S.until - (Date.now() + clockOff)) / 1000));
  el.textContent = `${left} s`;
}, 500);

$('#codeBtn').onclick = () => {
  if (!room) return;
  const link = cfg.bot ? `https://t.me/${cfg.bot}?startapp=${room}` : '';
  const text = `Mafia o‘ynaymiz! Xona kodi: ${room}`;
  if (link && tg && tg.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(link || room).then(() => toast('Nusxalandi'));
  }
};

$('#leave').onclick = () => {
  const playing = S && S.phase !== 'lobby' && S.me && S.me.alive;
  const doLeave = () => {
    voiceStop();
    socket.emit('room:leave', () => showHome());
  };
  if (!playing) return doLeave();
  const msg = 'Chiqsangiz rolingiz hammaga e’lon qilinadi va siz o‘yindan chiqarilasiz. Chiqasizmi?';
  if (tg && tg.showConfirm) tg.showConfirm(msg, (ok) => ok && doLeave());
  else if (confirm(msg)) doLeave();
};

/* ───────── Ilovadan chiqishni aniqlash ───────── */
const away = () => { if (room) socket.emit('away'); };
const back = () => { if (room && socket.connected) join(room); };
document.addEventListener('visibilitychange', () => (document.hidden ? away() : back()));
window.addEventListener('pagehide', away);
if (tg) { tg.onEvent('deactivated', away); tg.onEvent('activated', back); }

/* ───────── Tablar ───────── */
function setTab(t) {
  tab = t;
  ['game', 'chat', 'voice'].forEach((n) => { $('#pane-' + n).hidden = n !== t; });
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  if (t === 'chat') { unread = 0; renderBadge(); const l = $('#log'); l.scrollTop = l.scrollHeight; }
}
document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
function renderBadge() { const b = $('#badge'); b.hidden = !unread; b.textContent = unread; }

/* ───────── O'yin tabi ───────── */
function showRoleCard(r) {
  if (!ROLE[r]) return;
  const o = $('#overlay');
  o.innerHTML = `<div class="card">
    <div class="emo">${ROLE[r].e}</div>
    <small>Sizning rolingiz</small>
    <h2>${ROLE[r].n}</h2>
    <p>${ROLE[r].d}</p>
    <small>Ilovadan chiqsangiz, rolingiz e’lon qilinadi va o‘yindan chiqarilasiz.</small>
    <button class="primary" id="okRole">Tushunarli</button></div>`;
  o.hidden = false;
  $('#okRole').onclick = () => { o.hidden = true; };
}

/* ───────── O'lim / osilish: rol e'loni ───────── */
const revealQ = [];
let revealOn = false, revealTimer;
function pushReveal(d) { revealQ.push(d); if (!revealOn) nextReveal(); }
function nextReveal() {
  clearTimeout(revealTimer);
  const d = revealQ.shift(), el = $('#reveal');
  if (!d) { revealOn = false; el.hidden = true; return; }
  revealOn = true;
  const dur = d.kind === 'death' ? 4500 : 2400;
  el.innerHTML = revealHTML(d, dur);
  el.hidden = false;
  haptic(d.kind === 'death' ? 'warning' : 'success');
  revealTimer = setTimeout(nextReveal, dur);
}
$('#reveal').onclick = nextReveal; // bosib o'tkazib yuborish mumkin
function revealHTML(d, dur) {
  if (d.kind !== 'death') {
    return `<div class="rcard soft" style="--dur:${dur}ms"><div class="emo">${esc(d.emoji || '☀️')}</div>
      <h2>${esc(d.title || '')}</h2><p>${esc(d.text || '')}</p><i class="bar"></i></div>`;
  }
  const r = ROLE[d.role] || { e: '❔', n: '' };
  const cause = { night: ['🌙', 'Tunda o‘ldirildi'], hang: ['⚖️', 'Osildi'], shot: ['🔫', 'Komissar otib o‘ldirdi'], left: ['🚪', 'Ilovadan chiqdi'] }[d.cause] || ['💀', 'O‘yindan chiqdi'];
  const votes = d.cause === 'hang' && d.votes ? ` · ${d.votes} ovoz` : '';
  const me = d.id === myId;
  return `<div class="rcard ${d.team === 'mafia' ? 'mafia' : 'town'}" style="--dur:${dur}ms">
    <div class="cause">${cause[0]} ${cause[1]}${votes}</div>
    <div class="emo">${r.e}</div>
    <h2>${esc(d.name)}${me ? ' (siz)' : ''}</h2>
    <p class="rname">${r.n}</p>
    <small>${d.team === 'mafia' ? 'Mafiya jamoasi' : 'Tinch aholi'}</small>
    ${me && d.cause !== 'left' ? '<small class="ghosthint">👻 Endi o‘lganlar bilan ovozli chatda gaplasha olasiz.</small>' : ''}
    <i class="bar"></i></div>`;
}

/* ───────── Ovozlar jadvali: kim kimga ovoz berdi ───────── */
function voteBoard(s) {
  if (s.phase !== 'vote' || !s.votes) return '';
  const nameOf = (id) => { const p = s.players.find((x) => x.id === Number(id)); return p ? esc(p.name) : '?'; };
  const voters = s.players.filter((p) => p.inGame && p.alive);
  const by = {}, skip = [];
  let voted = 0;
  for (const [vid, t] of Object.entries(s.votes)) {
    voted++;
    if (t === 'skip') skip.push(vid); else (by[t] = by[t] || []).push(vid);
  }
  const rows = Object.entries(by).sort((a, b) => b[1].length - a[1].length)
    .map(([t, v]) => `<div class="vrow"><b>${nameOf(t)}</b><span class="vn">${v.length}</span><span class="vby">← ${v.map(nameOf).join(', ')}</span></div>`);
  if (skip.length) rows.push(`<div class="vrow skip"><b>Hech kimga</b><span class="vn">${skip.length}</span><span class="vby">← ${skip.map(nameOf).join(', ')}</span></div>`);
  const waiting = voters.filter((p) => !(p.id in s.votes)).map((p) => esc(p.name));
  return `<div class="board"><div class="bt">Ovozlar · ${voted}/${voters.length}</div>
    ${rows.join('') || '<div class="vby" style="color:var(--mute)">Hali hech kim ovoz bermadi.</div>'}
    ${waiting.length ? `<div class="wait">Hali ovoz bermagan: ${waiting.join(', ')}</div>` : ''}</div>`;
}

function renderGame() {
  const s = S, m = s.me;
  // Rol kartasi
  let rc = '';
  if (m && m.role && s.phase !== 'lobby') {
    const mates = m.role === 'mafia' ? s.players.filter((p) => p.role === 'mafia' && p.id !== m.id).map((p) => esc(p.name)) : [];
    rc = `<div class="role"><span class="emo">${ROLE[m.role].e}</span><div><b>${ROLE[m.role].n}</b>
      <small>${m.role === 'mafia' ? `Mafiya jamoasi: ${mates.length ? mates.join(', ') : 'yolg‘iz o‘zingiz'}` : `Mafiya soni: ${s.mafiaN}`}</small></div></div>`;
  }
  $('#roleCard').innerHTML = rc;
  $('#action').innerHTML = actionHTML(s);
  $('#board').innerHTML = voteBoard(s);
  $('#players').innerHTML = s.players.map((p) => playerRow(p, s)).join('');
  $('#result').innerHTML = resultHTML(s);
}

function actionHTML(s) {
  const m = s.me;
  if (!m) return '';
  const note = (t, extra = '') => `<div class="note">${t}${extra}</div>`;
  if (s.phase === 'lobby') {
    const n = s.players.filter((p) => p.online).length;
    if (s.host === m.id) {
      return note(`O‘yinchilar: ${n}. Boshlash uchun kamida ${s.min} kishi kerak.`,
        `<div class="row2"><button class="primary" id="start" ${n < s.min ? 'disabled' : ''}>O‘yinni boshlash</button></div>`);
    }
    return note('Boshlovchi o‘yinni boshlashini kuting. Kodni do‘stlaringizga yuboring: yuqoridagi 📤 tugmasi.');
  }
  if (m.spec) return note('Siz tomoshabinsiz. Keyingi o‘yinda qatnashasiz.');
  if (m.out) return note('Siz ilovadan chiqqaningiz uchun shu o‘yindan chiqarildingiz. Tomosha qilishingiz mumkin.');
  if (!m.alive) return note('Siz o‘lgansiz. Tomosha qilishingiz mumkin, yozib va gapirib bo‘lmaydi.');
  const checks = m.checks.length
    ? `<div class="checks">Tekshiruvlar: ${m.checks.map((c) => `${esc(c.name)} — ${c.team === 'mafia' ? 'mafiya' : 'tinch'}`).join('; ')}</div>` : '';
  if (s.phase === 'night') {
    const t = {
      mafia: 'Kimni o‘ldiramiz? Mafiya bilan Chat tabida kelishing.',
      shifokor: 'Kimni qutqaramiz? O‘zingizni ham tanlashingiz mumkin.',
      komissar: m.pick ? (m.pickMode === 'shoot' ? '🔫 Nishon tanlandi. Tong otganda o‘q uziladi.' : 'Natija sizga yuborildi, pastdagi tekshiruvlarga qarang.') : `Kimni tekshiramiz yoki otamiz? O‘qlar: ${m.bullets}.`,
      fuqaro: 'Tun. Hamma uxlayapti. Tongni kuting.',
    }[m.role];
    return note(t, checks);
  }
  if (s.phase === 'day') return note('Muhokama. Chat yoki ovozli chat orqali gaplashing: kimdan shubhalanasiz?', checks);
  if (s.phase === 'vote') {
    return note('Kimni osamiz? Ovozingizni tanlang.',
      `<div class="row2"><button id="skip" ${m.pick === 'skip' ? 'class="primary"' : ''}>${m.pick === 'skip' ? '✓ ' : ''}Hech kimga</button></div>${checks}`);
  }
  if (s.phase === 'last') {
    const w = s.players.find((p) => p.id === s.lastWord);
    return note(s.lastWord === m.id ? 'Sizning so‘nggi so‘zingiz. Gapiring!' : `${esc(w ? w.name : '')} so‘nggi so‘zni aytmoqda.`);
  }
  return '';
}

function canTarget(s, p) {
  const m = s.me;
  if (!m || !m.alive || m.spec || m.out || !p.alive || !p.inGame) return false;
  if (s.phase === 'night') {
    if (m.role === 'mafia') return p.role !== 'mafia';
    if (m.role === 'shifokor') return true;
    if (m.role === 'komissar') return p.id !== m.id && !m.pick;
    return false;
  }
  if (s.phase === 'vote') return p.id !== m.id;
  return false;
}

function playerRow(p, s) {
  const m = s.me;
  const dead = p.inGame && !p.alive;
  const sub = [];
  if (s.phase === 'lobby') { if (p.id === s.host) sub.push('boshlovchi'); }
  else if (p.spec) sub.push('tomoshabin');
  else if (p.out) sub.push(`${roleName(p.role)} · ilovadan chiqdi`);
  else if (dead) sub.push(`${roleName(p.role)} · o‘lgan`);
  else if (p.role) sub.push(roleName(p.role));
  if (m && p.id === m.id) sub.unshift('siz');
  const picked = m && m.pick === p.id;
  const vcount = s.phase === 'vote' && s.votes ? Object.values(s.votes).filter((t) => t === p.id).length : 0;
  const verb = s.phase === 'vote' ? 'Ovoz' : { mafia: 'O‘ldirish', shifokor: 'Qutqarish', komissar: 'Tekshirish' }[m && m.role] || '';
  const can = canTarget(s, p);
  const mine = (mode) => picked && (m.pickMode || 'check') === mode;
  let btn = '';
  if (s.phase === 'night' && m && m.role === 'komissar') {
    if (can || picked) {
      btn = `<button data-target="${p.id}" data-mode="check" class="${mine('check') ? 'primary' : ''}" ${can ? '' : 'disabled'}>${mine('check') ? '✓ ' : ''}Tekshirish</button>`;
      if (m.bullets > 0 || mine('shoot')) {
        btn += `<button data-target="${p.id}" data-mode="shoot" class="${mine('shoot') ? 'primary' : ''}" ${can && m.bullets > 0 ? '' : 'disabled'}>${mine('shoot') ? '✓ ' : '🔫 '}Otish</button>`;
      }
    }
  } else if (can || (picked && s.phase !== 'lobby')) {
    btn = `<button data-target="${p.id}" class="${picked ? 'primary' : ''}" ${can ? '' : 'disabled'}>${picked ? '✓ ' : ''}${verb}</button>`;
  }
  return `<div class="item ${dead ? 'dead' : ''} ${picked ? 'picked' : ''}" data-vid="${p.id}">
    <div class="av">${esc(p.name.slice(0, 1).toUpperCase())}</div>
    <div class="who"><b class="nm"><i class="dot ${p.online ? '' : 'off'}"></i>${esc(p.name)}</b><span>${sub.join(' · ')}</span></div>${vcount ? `<span class="vc" title="Ovozlar">${vcount}</span>` : ''}${btn}</div>`;
}

function resultHTML(s) {
  if (s.phase !== 'lobby' || !s.result) return '';
  const r = s.result;
  return `<h3>${r.winner === 'mafia' ? '🕴 Mafiya g‘alaba qildi' : '🏙 Shahar g‘alaba qildi'}</h3>
    <div class="list">${r.players.map((p) => `<div class="item"><div class="av">${esc(p.name.slice(0, 1).toUpperCase())}</div>
      <div class="who"><b class="nm">${esc(p.name)}</b><span>${roleName(p.role)}${p.out ? ' · ilovadan chiqqan' : p.alive ? '' : ' · o‘lgan'}</span></div>
      <span>${p.won ? '🏆' : ''}</span></div>`).join('')}</div>`;
}

// Tugmalar (delegatsiya)
$('#action').addEventListener('click', (e) => {
  if (e.target.closest('#start')) socket.emit('start');
  if (e.target.closest('#skip')) socket.emit('vote', { target: 'skip' });
});
$('#players').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-target]');
  if (!b || !S) return;
  const target = Number(b.dataset.target);
  socket.emit(S.phase === 'vote' ? 'vote' : 'action', { target, mode: b.dataset.mode });
  haptic('success');
});

/* ───────── Chat ───────── */
function addMsg(m) {
  const log = $('#log');
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const d = document.createElement('div');
  if (m.sys) { d.className = 'm sys'; d.textContent = m.text; }
  else {
    d.className = `m${m.from === myId ? ' mine' : ''}${m.ch === 'mafia' ? ' mafia' : ''}`;
    d.innerHTML = `<span class="nm">${m.ch === 'mafia' ? '🕴 ' : ''}${esc(m.name)}</span>${esc(m.text)}`;
  }
  log.appendChild(d);
  if (near || m.from === myId) log.scrollTop = log.scrollHeight;
}
function renderChatInput() {
  const m = S.me, inp = $('#msg');
  const ok = !!(m && m.canWrite);
  inp.disabled = !ok; $('#send').disabled = !ok;
  inp.placeholder = ok
    ? (S.phase === 'night' ? 'Mafiya chati (faqat mafiyalar ko‘radi)' : 'Xabar yozing…')
    : S.phase === 'night' ? 'Tunda faqat mafiya yozadi'
    : S.phase === 'last' ? 'Faqat so‘nggi so‘z egasi yozadi'
    : m && m.spec ? 'Tomoshabinlar yozolmaydi' : 'Siz yoza olmaysiz';
}
function sendMsg() {
  const inp = $('#msg'), text = inp.value.trim();
  if (!text || inp.disabled) return;
  socket.emit('chat', { text });
  inp.value = '';
}
$('#send').onclick = sendMsg;
$('#msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });

/* ───────── Ovozli chat (WebRTC, har kim har kim bilan) ───────── */
const Voice = { on: false, muted: false, stream: null, peers: new Map() };
let actx = null;
const meters = new Map();

function addMeter(id, stream) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const an = actx.createAnalyser();
    an.fftSize = 256;
    actx.createMediaStreamSource(stream).connect(an);
    meters.set(id, { an, buf: new Uint8Array(an.fftSize) });
  } catch (e) { /* ovoz darajasi ko'rsatkichi majburiy emas */ }
}
setInterval(() => {
  meters.forEach((m, id) => {
    m.an.getByteTimeDomainData(m.buf);
    let max = 0;
    for (const v of m.buf) max = Math.max(max, Math.abs(v - 128));
    const on = max > 12 && audible(id);
    document.querySelectorAll(`[data-vid="${id}"]`).forEach((el) => el.classList.toggle('speaking', on));
  });
}, 150);

async function voiceJoin() {
  if (Voice.on) return;
  try {
    Voice.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    toast('Mikrofonga ruxsat berilmadi. Telegram sozlamalarida ruxsat bering.');
    return;
  }
  Voice.on = true;
  addMeter(myId, Voice.stream);
  socket.emit('voice:join');
  applyMic(); renderVoice();
}
function voiceStop() {
  if (!Voice.on) return;
  socket.emit('voice:leave');
  Voice.peers.forEach((_p, id) => dropPeer(id));
  Voice.stream && Voice.stream.getTracks().forEach((t) => t.stop());
  meters.delete(myId);
  Voice.stream = null; Voice.on = false;
  S && renderVoice();
}
function voiceRejoin() {
  Voice.peers.forEach((_p, id) => dropPeer(id));
  socket.emit('voice:join');
}
function dropPeer(id) {
  const p = Voice.peers.get(id);
  if (!p) return;
  try { p.pc.close(); } catch (e) { /* yopilgan */ }
  if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
  meters.delete(id);
  Voice.peers.delete(id);
}
function makePeer(id, initiator) {
  dropPeer(id);
  const pc = new RTCPeerConnection({ iceServers: cfg.ice });
  const peer = { pc, audio: null, pending: [], sender: null, sending: true };
  Voice.peers.set(id, peer);
  Voice.stream.getTracks().forEach((t) => { peer.sender = pc.addTrack(t, Voice.stream); });
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('voice:signal', { to: id, data: { candidate: e.candidate } }); };
  pc.ontrack = (e) => {
    const a = document.createElement('audio');
    a.autoplay = true; a.playsInline = true;
    a.muted = !canHear(id);
    a.srcObject = e.streams[0];
    document.body.appendChild(a);
    a.play().catch(() => { $('#unmute').hidden = false; });
    peer.audio = a;
    addMeter(id, e.streams[0]);
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') dropPeer(id); };
  if (initiator) {
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .then(() => socket.emit('voice:signal', { to: id, data: { sdp: pc.localDescription } }));
  }
  applyMic(); // o'lgan/tirik qoidasini yangi ulanishga ham qo'llash
  return peer;
}
socket.on('voice:peers', (ids) => { if (Voice.on) ids.forEach((id) => makePeer(id, true)); });
socket.on('voice:left', ({ id }) => dropPeer(id));
socket.on('voice:signal', async ({ from, data }) => {
  if (!Voice.on) return;
  try {
    let peer = Voice.peers.get(from);
    if (data.sdp && data.sdp.type === 'offer') peer = makePeer(from, false);
    if (!peer) return;
    const pc = peer.pc;
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (data.sdp.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('voice:signal', { to: from, data: { sdp: pc.localDescription } });
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pending.push(data.candidate);
    }
  } catch (e) { console.warn('voice signal', e); }
});

/*
 * Kim kimni eshitadi:
 *  p.vc === 'pub'   — hamma eshitadi;
 *  p.vc === 'ghost' — faqat o'lganlar (ghost) eshitadi.
 * Qoida ikki tomonda qo'llanadi: jo'natuvchi ruxsat berilmagan odamlarga ovozni umuman yubormaydi,
 * qabul qiluvchi ham ruxsat berilmagan ovozni o'chirib qo'yadi.
 */
const pinfo = (id) => (S ? S.players.find((p) => p.id === id) : null);
function canHear(id) {
  const m = S && S.me, p = pinfo(id);
  if (!m || !p || !p.vc) return false;
  return p.vc === 'pub' || !!m.ghost;
}
function canSendTo(id) {
  const m = S && S.me, p = pinfo(id);
  if (!m || !m.vc || Voice.muted) return false;
  return m.vc === 'pub' || !!(p && p.ghost);
}
const audible = (id) => (id === myId ? !!(S && S.me && S.me.vc) && !Voice.muted : canHear(id));

function applyMic() {
  if (!Voice.stream) return;
  const track = Voice.stream.getAudioTracks()[0];
  const on = !!(S && S.me && S.me.vc) && !Voice.muted;
  Voice.stream.getAudioTracks().forEach((t) => { t.enabled = on; });
  Voice.peers.forEach((peer, id) => {
    const want = canSendTo(id);
    if (peer.sender && track && peer.sending !== want) {
      peer.sending = want;
      peer.sender.replaceTrack(want ? track : null).catch(() => {});
    }
    if (peer.audio) peer.audio.muted = !canHear(id);
  });
  renderVoice();
}
function micStatus() {
  const m = S && S.me;
  if (Voice.muted) return 'Siz mikrofonni o‘chirgansiz.';
  if (!m) return '';
  if (m.vc === 'ghost') return '👻 Siz o‘lgansiz: sizni faqat o‘lganlar eshitadi, siz esa hammani eshitasiz.';
  if (m.vc === 'pub') return m.ghost ? 'So‘nggi so‘zingiz: hamma sizni eshitmoqda.' : 'Mikrofon yoqilgan, sizni eshitishmoqda.';
  if (S.phase === 'night') return 'Tun: mikrofon o‘chiq.';
  return 'Hozir gapirish mumkin emas.';
}
function renderVoice() {
  if (!S) return;
  $('#voiceJoin').textContent = Voice.on ? 'Ovozli chatdan chiqish' : 'Ovozli chatga kirish';
  $('#micToggle').hidden = !Voice.on;
  $('#micToggle').textContent = Voice.muted ? 'Mikrofonni yoqish' : 'Mikrofonni o‘chirish';
  $('#voiceHint').textContent = Voice.on ? micStatus() : 'Ovozli chatga kirib, xonadagilar bilan gaplashing. Birinchi marta mikrofonga ruxsat so‘raladi.';
  const inVoice = S.voice.map((id) => S.players.find((x) => x.id === id)).filter(Boolean)
    .sort((a, b) => Number(a.ghost) - Number(b.ghost));
  $('#voiceList').innerHTML = inVoice.length
    ? inVoice.map((p) => `<div class="item ${p.ghost ? 'ghostly' : ''}" data-vid="${p.id}"><div class="av">${esc(p.name.slice(0, 1).toUpperCase())}</div>
        <div class="who"><b class="nm">${esc(p.name)}${p.id === myId ? ' (siz)' : ''}</b>${p.ghost ? '<span>👻 o‘lgan</span>' : ''}</div></div>`).join('')
    : '<div class="item"><div class="who"><span>Hozir ovozli chatda hech kim yo‘q.</span></div></div>';
}
$('#voiceJoin').onclick = () => (Voice.on ? voiceStop() : voiceJoin());
$('#micToggle').onclick = () => { Voice.muted = !Voice.muted; applyMic(); };
$('#unmute').onclick = () => { Voice.peers.forEach((p) => p.audio && p.audio.play().catch(() => {})); if (actx) actx.resume(); $('#unmute').hidden = true; };
