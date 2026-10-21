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

const SCREENS = ['home', 'profile', 'admin', 'room'];
function show(name) {
  SCREENS.forEach((n) => { $('#' + n).hidden = n !== name; });
  if (tg && tg.BackButton) {
    if (name === 'profile' || name === 'admin') { tg.BackButton.show(); tg.BackButton.onClick(showHome); } else { tg.BackButton.hide(); tg.BackButton.offClick(showHome); }
  }
}
function showHome() {
  room = null; S = null; sceneKey_ = ''; hideFx();
  show('home');
  document.body.dataset.phase = 'lobby';
  tg && tg.disableClosingConfirmation && tg.disableClosingConfirmation();
}
function showRoom() {
  show('room');
  $('#log').innerHTML = '';
  setTab('game');
  // Ilova yopilishidan oldin tasdiq so'raydi
  tg && tg.enableClosingConfirmation && tg.enableClosingConfirmation();
}

/* ───────── Socket hodisalari ───────── */
socket.on('connect', () => {
  $('#conn').hidden = true;
  if (room) join(room);
  else if (startParam && startParam !== 'profile' && !autoTried) { autoTried = true; join(startParam); }
  if (Voice.on) voiceRejoin();
});
socket.on('disconnect', () => { $('#conn').textContent = 'Ulanmoqda…'; $('#conn').hidden = false; });
socket.on('connect_error', (e) => {
  $('#conn').textContent = e.message === 'auth' ? 'Ilovani Telegram ichida oching' : 'Ulanmoqda…';
  $('#conn').hidden = false;
});
socket.on('config', (c) => { cfg = Object.assign(cfg, c); myId = c.id; });
socket.on('kicked', () => { voiceStop(); showHome(); toast('Ilova boshqa qurilmada ochildi'); });
socket.on('err', (t) => { toast(t); haptic('error'); });
socket.on('history', (list) => { $('#log').innerHTML = ''; list.forEach(addMsg); });
socket.on('chat', (m) => {
  addMsg(m);
  if (m.card) showCardFx(m.card);
  if (tab !== 'chat' && !m.sys) { unread++; renderBadge(); }
});
socket.on('role', (r) => { showRoleCard(r); haptic('success'); });
socket.on('state', (s) => {
  if (s.id !== room) return;
  const prev = S;
  S = s;
  clockOff = s.now - Date.now();
  document.body.dataset.phase = s.phase;
  if (!prev || prev.phase !== s.phase || prev.round !== s.round) pairSel = [];
  phaseFx(prev, s);
  renderHead(); renderScene(); renderGame(); renderChatInput(); renderVoice(); applyMic();
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

/* ───────── Sahna va effektlar ───────── */
let sceneKey_ = '';
function renderScene() {
  const k = sceneKey(S.phase);
  if (k !== sceneKey_) { sceneKey_ = k; $('#scene').innerHTML = sceneHTML(k, ''); }
  const el = $('#scene .cap') || (() => { const c = document.createElement('span'); c.className = 'cap'; $('#scene .scene').appendChild(c); return c; })();
  el.textContent = SCENE_CAP[k];
}
let fxTimer;
function hideFx() { clearTimeout(fxTimer); $('#fx').hidden = true; }
function showFx(html, ms, button = true) {
  const f = $('#fx');
  f.innerHTML = `<div class="fxcard">${html}${button ? '<button class="primary" id="fxOk">Davom etish</button>' : ''}</div>`;
  f.hidden = false;
  clearTimeout(fxTimer);
  fxTimer = setTimeout(hideFx, ms);
  const ok = $('#fxOk');
  if (ok) ok.onclick = hideFx;
}
$('#fx').addEventListener('click', (e) => { if (e.target.id === 'fx') hideFx(); });
function phaseFx(prev, s) {
  if (!prev || prev.phase === s.phase || prev.phase === 'lobby') return;
  if (s.phase === 'night' && $('#overlay').hidden) {
    showFx(`${sceneHTML('night', '')}<h3 class="fxt">🌙 ${s.round}-tun</h3><p class="fxs">Shahar uyquga ketdi…</p>`, 2600, false);
  }
}
function showCardFx(c) {
  if ($('#overlay').hidden === false) return;
  if (c.kind === 'night') {
    showFx(`${sceneHTML('day', '')}<h3 class="fxt">☀️ Tong otdi</h3>${cardHTML(c)}`, 9000);
  } else if (c.kind === 'votes') {
    showFx(`${sceneHTML('vote', '')}<h3 class="fxt">🗳 Ovoz natijalari</h3>${cardHTML(c)}`, 11000);
  }
}

/* ───────── Natija kartochkalari (tun / ovoz) ───────── */
const cap1 = (n) => esc(String(n).slice(0, 1).toUpperCase());
function cardHTML(c) {
  if (c.kind === 'night') {
    const rows = c.deaths.map((d) => `<div class="drow"><span class="av dead">${cap1(d.name)}</span>
      <div><b>${esc(d.name)}</b><small>${roleName(d.role)} · ${d.cause === 'guard' ? 'mijozini himoya qilib halok bo‘ldi' : 'tunda o‘ldirildi'}</small></div><span class="skull">💀</span></div>`).join('');
    const e = c.esc || {};
    const extra = [e.saved ? '💉 Shifokor kimnidir o‘lim changalidan qutqardi.' : '', e.shield ? '🛡 Kimdir himoya qalqoni bilan qutuldi.' : '', e.lucky ? '🤞 Kimningdir omadi keldi.' : '']
      .filter(Boolean).map((t) => `<p class="esc">${t}</p>`).join('');
    return `<div class="rc rc-night"><h4>🌙 ${c.round}-tun natijasi</h4>
      ${rows || '<p class="quiet">Bu tunda hech kim o‘lmadi.</p>'}${extra}</div>`;
  }
  if (c.kind === 'votes') {
    const max = Math.max(1, ...c.rows.map((r) => r.total));
    const rows = c.rows.map((r) => `<div class="vrow ${c.hanged && c.hanged.id === r.id ? 'top' : ''}">
      <div class="vhead"><b>${esc(r.name)}</b><span class="vcount">${r.total}</span></div>
      <div class="bar"><i style="width:${Math.round((r.total / max) * 100)}%"></i></div>
      <div class="chips">${r.voters.map((v) => `<span class="chip">${esc(v.name)}${v.w > 1 ? ` ×${v.w}` : ''}</span>`).join('')}</div></div>`).join('');
    const out = c.hanged
      ? `<p class="hang">⚖️ <b>${esc(c.hanged.name)}</b> osildi. Roli: ${roleName(c.hanged.role)}</p>`
      : '<p class="hang">⚖️ Ovozlar teng yoki yetarli emas — hech kim osilmadi.</p>';
    return `<div class="rc rc-votes"><h4>🗳 ${c.round}-kun: kim kimga ovoz berdi</h4>
      ${rows || '<p class="quiet">Hech kim ovoz bermadi.</p>'}
      ${c.skips.length ? `<p class="esc">Hech kimga: ${c.skips.map(esc).join(', ')}</p>` : ''}
      ${c.none.length ? `<p class="esc">Ovoz bermadi: ${c.none.map(esc).join(', ')}</p>` : ''}${out}</div>`;
  }
  return '';
}
function renderRecap() {
  const s = S;
  let h = '';
  if ((s.phase === 'day' || s.phase === 'vote') && s.lastNight) h = cardHTML(s.lastNight);
  else if ((s.phase === 'last' || s.phase === 'night') && s.lastVote) h = cardHTML(s.lastVote);
  $('#recap').innerHTML = h;
}

/* ───────── O'yin tabi ───────── */
let pairSel = [];
let polMode = 'check';
const nameOf = (id) => { const p = S && S.players.find((x) => x.id === id); return p ? esc(p.name) : '?'; };

function showRoleCard(r) {
  if (!ROLE[r]) return;
  const o = $('#overlay');
  o.innerHTML = `<div class="card">
    <div class="emo">${ROLE[r].e}</div>
    <small>Sizning rolingiz · ${TEAM[ROLE[r].team]}</small>
    <h2>${ROLE[r].n}</h2>
    <p>${ROLE[r].d}</p>
    <small>Ilovadan chiqsangiz, rolingiz e’lon qilinadi va o‘yindan chiqarilasiz.</small>
    <button class="primary" id="okRole">Tushunarli</button></div>`;
  o.hidden = false;
  hideFx();
  $('#okRole').onclick = () => { o.hidden = true; };
}

function renderGame() {
  const s = S, m = s.me;
  let rc = '';
  if (m && m.role && s.phase !== 'lobby') {
    const mates = isMafiaRole(m.role) ? s.players.filter((p) => isMafiaRole(p.role) && p.id !== m.id).map((p) => `${ROLE[p.role].e} ${esc(p.name)}`) : [];
    const sub = isMafiaRole(m.role) ? `Mafiya jamoasi: ${mates.length ? mates.join(', ') : 'yolg‘iz o‘zingiz'}`
      : m.role === 'serjant' ? `Komissar: ${s.players.filter((p) => p.role === 'komissar').map((p) => esc(p.name)).join(', ') || 'yo‘q'}`
      : TEAM[ROLE[m.role].team];
    const badges = `${m.shield ? ' 🛡' : ''}${m.docs ? ' 📄' : ''}`;
    rc = `<div class="role"><span class="emo">${ROLE[m.role].e}</span><div><b>${ROLE[m.role].n}${badges}</b><small>${sub}</small></div></div>`;
  }
  $('#roleCard').innerHTML = rc;
  renderRecap();
  $('#action').innerHTML = actionHTML(s);
  $('#players').innerHTML = s.players.map((p) => playerRow(p, s)).join('');
  $('#result').innerHTML = resultHTML(s);
}

const NIGHT_TXT = {
  don: 'Siz hal qilasiz: bu tunda kim o‘ladi? Mafiya bilan Chat tabida kelishing.',
  mafia: 'Don bilan kelishib nishon tanlang. Don tanlamasa, ko‘pchilik ovozi hisoblanadi.',
  qotil: 'Yolg‘iz o‘zingiz. Kimni o‘ldirasiz?',
  komissar: 'Tekshirasizmi yoki otasizmi? Rejimni tanlab, o‘yinchini bosing.',
  serjant: 'Komissar ishlaridan xabardor bo‘lib turasiz. Tekshiruv natijalari pastda chiqadi.',
  shifokor: 'Kimni qutqaramiz? O‘zingizni ham tanlashingiz mumkin.',
  mashuqa: 'Kimni zararsizlantirasiz? U tunda harakat qila olmaydi, kunduzi gapira va ovoz bera olmaydi.',
  advokat: 'Kimni himoya qilasiz? Komissar uni tekshirsa, tinch aholi bo‘lib ko‘rinadi.',
  jurnalist: 'Ikki fuqaroni tanlang: ular bir qayiqdami yoki turli qayiqdami?',
  tansoqchi: 'Kimni qo‘riqlaysiz? Unga hujum bo‘lsa, uning o‘rniga siz halok bo‘lasiz.',
  daydi: 'Kimning uyiga shisha olgani borasiz? Qotillikka guvoh bo‘lib qolishingiz mumkin.',
};

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
  const intel = m.intel.length
    ? `<div class="intel"><b>🔒 Maxfiy ma’lumotlar</b>${m.intel.slice().reverse().map((i) => `<p>${esc(i.text)} <small>(${i.round}-tun)</small></p>`).join('')}</div>` : '';
  const silenced = m.silenced && (s.phase === 'day' || s.phase === 'vote')
    ? '<p class="warn">💃🏼 Ma’shuqa sizni zararsizlantirdi: bugun gapira va ovoz bera olmaysiz.</p>' : '';
  if (s.phase === 'night') {
    let t = NIGHT_TXT[m.role] || 'Tun. Hamma uxlayapti. Tongni kuting.';
    let extra = '';
    if (m.act === 'police') {
      const mode = m.mode || polMode;
      extra = `<div class="row2"><button data-mode="check" class="${mode === 'check' ? 'primary' : ''}">🔎 Tekshirish</button>
        <button data-mode="kill" class="${mode === 'kill' ? 'primary' : ''}">🔫 Otish</button></div>`;
    }
    if (m.act === 'pair') {
      extra = m.pick && m.pick2 ? `<p class="sel">Tanlandi: ${nameOf(m.pick)} va ${nameOf(m.pick2)} (qayta tanlashingiz mumkin)</p>`
        : `<p class="sel">Tanlangan: ${pairSel.map(nameOf).join(', ') || 'hali yo‘q'} (${pairSel.length}/2)</p>`;
    } else if (m.act && m.pick) extra += `<p class="sel">Tanlandi: ${nameOf(m.pick)}${m.act === 'police' ? (m.mode === 'kill' ? ' (otish)' : ' (tekshirish)') : ''}</p>`;
    return note(t, extra) + intel;
  }
  if (s.phase === 'day') return note('Muhokama. Chat yoki ovozli chat orqali gaplashing: kimdan shubhalanasiz?', silenced) + intel;
  if (s.phase === 'vote') {
    const skipMarks = s.marks.filter((k) => k.k === 'vote' && k.to === 'skip');
    return note('Kimni osamiz? Kim kimga ovoz berayotgani hammaga ko‘rinadi.',
      `<div class="row2"><button id="skip" ${m.pick === 'skip' ? 'class="primary"' : ''} ${m.silenced ? 'disabled' : ''}>${m.pick === 'skip' ? '✓ ' : ''}Hech kimga</button>
       ${skipMarks.map((k) => `<span class="chip">${nameOf(k.from)}</span>`).join('')}</div>${silenced}`) + intel;
  }
  if (s.phase === 'last') {
    const w = s.players.find((p) => p.id === s.lastWord);
    if (m.canTake) return note('💣 Siz osildingiz! O‘zingiz bilan kimni olib ketasiz? Ro‘yxatdan tanlang.');
    return note(s.lastWord === m.id ? 'Sizning so‘nggi so‘zingiz. Gapiring!' : `${esc(w ? w.name : '')} so‘nggi so‘zni aytmoqda.`) + intel;
  }
  return '';
}

function canTarget(s, p) {
  const m = s.me;
  if (!m || !m.alive || m.spec || m.out || !p.alive || !p.inGame) return false;
  if (s.phase === 'last') return !!m.canTake && p.id !== m.id;
  if (s.phase === 'vote') return p.id !== m.id && !m.silenced;
  if (s.phase !== 'night') return false;
  switch (m.act) {
    case 'kill': return p.id !== m.id && !(isMafiaRole(m.role) && isMafiaRole(p.role));
    case 'heal': case 'cover': return true;
    case 'police': case 'block': case 'guard': case 'visit': case 'pair': return p.id !== m.id;
    default: return false;
  }
}
const VERB = { kill: 'O‘ldirish', heal: 'Qutqarish', block: 'Band qilish', cover: 'Himoya', pair: 'Tanlash', guard: 'Qo‘riqlash', visit: 'Borish' };

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
  const picked = m && (m.pick === p.id || m.pick2 === p.id || (m.act === 'pair' && pairSel.includes(p.id)));
  let verb = '';
  if (s.phase === 'last') verb = 'Olib ketish';
  else if (s.phase === 'vote') verb = 'Ovoz';
  else if (m && m.act === 'police') verb = (m.mode || polMode) === 'kill' ? 'Otish' : 'Tekshirish';
  else if (m) verb = VERB[m.act] || '';
  const can = canTarget(s, p);
  const btn = can || (picked && s.phase !== 'lobby')
    ? `<button data-target="${p.id}" class="${picked ? 'primary' : ''}" ${can ? '' : 'disabled'}>${picked ? '✓ ' : ''}${verb}</button>` : '';
  // Ovozlar / mafiya tanlovi: kim kimni tanlagani ko'rinib turadi
  const mk = s.marks.filter((k) => k.to === p.id);
  const total = mk.reduce((a, k) => a + k.w, 0);
  const chips = mk.length
    ? `<div class="chips">${mk.map((k) => `<span class="chip ${k.k}">${k.k === 'kill' ? '🔪' : '🗳'} ${nameOf(k.from)}${k.w > 1 ? ` ×${k.w}` : ''}</span>`).join('')}</div>` : '';
  const badge = s.phase === 'vote' && mk.length ? `<span class="vcount">${total}</span>` : '';
  return `<div class="item ${dead ? 'dead' : ''} ${picked ? 'picked' : ''}">
    <div class="av">${cap1(p.name)}</div>
    <div class="who"><b class="nm"><i class="dot ${p.online ? '' : 'off'}"></i>${esc(p.name)}</b><span>${sub.join(' · ')}</span>${chips}</div>${badge}${btn}</div>`;
}

function resultHTML(s) {
  if (s.phase !== 'lobby' || !s.result) return '';
  const r = s.result;
  const title = { mafia: '🤵🏻 Mafiya g‘alaba qildi', town: '🏙 Shahar g‘alaba qildi', qotil: '🔪 Qotil g‘alaba qildi', suidsid: '🤦🏼‍♂️ Suidsid g‘alaba qildi' }[r.winner];
  return `<h3>${title}</h3>
    <div class="list">${r.players.map((p) => `<div class="item"><div class="av">${cap1(p.name)}</div>
      <div class="who"><b class="nm">${esc(p.name)}</b><span>${roleName(p.role)}${p.out ? ' · ilovadan chiqqan' : p.alive ? '' : ' · o‘lgan'}</span></div>
      <span>${p.won ? '🏆' : ''}</span></div>`).join('')}</div>`;
}

// Tugmalar (delegatsiya)
$('#action').addEventListener('click', (e) => {
  if (e.target.closest('#start')) socket.emit('start');
  if (e.target.closest('#skip')) socket.emit('vote', { target: 'skip' });
  const md = e.target.closest('button[data-mode]');
  if (md && S) { polMode = md.dataset.mode; renderGame(); }
});
$('#players').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-target]');
  if (!b || !S || !S.me) return;
  const target = Number(b.dataset.target);
  if (S.phase === 'night' && S.me.act === 'pair') {
    pairSel = pairSel.includes(target) ? pairSel.filter((x) => x !== target) : [...pairSel, target].slice(-2);
    if (pairSel.length === 2) { socket.emit('action', { target: pairSel[0], target2: pairSel[1] }); pairSel = []; }
    renderGame();
    return;
  }
  if (S.phase === 'vote') socket.emit('vote', { target });
  else socket.emit('action', { target, mode: S.me.act === 'police' ? (S.me.mode || polMode) : undefined });
  haptic('success');
});

/* ───────── Chat ───────── */
function addMsg(m) {
  const log = $('#log');
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const d = document.createElement('div');
  if (m.card) { d.className = 'm cardmsg'; d.innerHTML = cardHTML(m.card); }
  else if (m.sys) { d.className = `m sys${m.ch === 'dm' ? ' dm' : ''}`; d.textContent = m.text; }
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
    document.querySelectorAll(`[data-vid="${id}"]`).forEach((el) => el.classList.toggle('speaking', max > 12));
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
  const peer = { pc, audio: null, pending: [] };
  Voice.peers.set(id, peer);
  Voice.stream.getTracks().forEach((t) => pc.addTrack(t, Voice.stream));
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('voice:signal', { to: id, data: { candidate: e.candidate } }); };
  pc.ontrack = (e) => {
    const a = document.createElement('audio');
    a.autoplay = true; a.playsInline = true;
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

/** Mikrofon faqat o'yin qoidalari ruxsat bergan paytda ochiq */
function applyMic() {
  if (!Voice.stream) return;
  const ok = !!(S && S.me && S.me.canSpeak) && !Voice.muted;
  Voice.stream.getAudioTracks().forEach((t) => { t.enabled = ok; });
  renderVoice();
}
function micStatus() {
  if (Voice.muted) return 'Siz mikrofonni o‘chirgansiz.';
  if (S && S.me && S.me.canSpeak) return 'Mikrofon yoqilgan, sizni eshitishmoqda.';
  if (S.phase === 'night') return 'Tun: mikrofon o‘chiq.';
  if (S.me && !S.me.alive) return 'Siz o‘lgansiz: mikrofon o‘chiq.';
  return 'Hozir gapirish mumkin emas.';
}
function renderVoice() {
  if (!S) return;
  $('#voiceJoin').textContent = Voice.on ? 'Ovozli chatdan chiqish' : 'Ovozli chatga kirish';
  $('#micToggle').hidden = !Voice.on;
  $('#micToggle').textContent = Voice.muted ? 'Mikrofonni yoqish' : 'Mikrofonni o‘chirish';
  $('#voiceHint').textContent = Voice.on ? micStatus() : 'Ovozli chatga kirib, xonadagilar bilan gaplashing. Birinchi marta mikrofonga ruxsat so‘raladi.';
  $('#voiceList').innerHTML = S.voice.length
    ? S.voice.map((id) => {
      const p = S.players.find((x) => x.id === id);
      return `<div class="item" data-vid="${id}"><div class="av">${esc(p ? p.name.slice(0, 1).toUpperCase() : '?')}</div>
        <div class="who"><b class="nm">${esc(p ? p.name : '')}${id === myId ? ' (siz)' : ''}</b></div></div>`;
    }).join('')
    : '<div class="item"><div class="who"><span>Hozir ovozli chatda hech kim yo‘q.</span></div></div>';
}
$('#voiceJoin').onclick = () => (Voice.on ? voiceStop() : voiceJoin());
$('#micToggle').onclick = () => { Voice.muted = !Voice.muted; applyMic(); };
$('#unmute').onclick = () => { Voice.peers.forEach((p) => p.audio && p.audio.play().catch(() => {})); if (actx) actx.resume(); $('#unmute').hidden = true; };
