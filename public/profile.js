'use strict';
/* Profil, do'kon va admin panel */
let ME = null;
const tgUser = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || {};
const fmtDate = (ts) => new Date(ts).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const coins = (n) => `${Number(n).toLocaleString('uz-UZ')} 🪙`;
const call = (ev, data) => new Promise((res) => socket.emit(ev, data, (r) => res(r || { error: 'Javob yo‘q' })));

function avatar(name, cls = '') {
  if (tgUser.photo_url && ME && tgUser.first_name === name) return `<span class="av ${cls}"><img src="${esc(tgUser.photo_url)}" alt=""></span>`;
  return `<span class="av ${cls}">${cap1(name)}</span>`;
}

socket.on('config', (c) => { if (c.admin) $('#adminBtn').hidden = false; });
socket.on('notice', (t) => { toast(t); haptic('success'); });
socket.on('me', (m) => {
  ME = m;
  $('#stats').textContent = m.games ? `${m.wins} g‘alaba, ${m.games} o‘yin` : '';
  $('#meAv').outerHTML = avatar(m.name).replace('class="av ', 'id="meAv" class="av ');
  $('#meName').textContent = m.name;
  $('#meBal').textContent = coins(m.balance);
  $('#adminBtn').hidden = !m.admin;
  if (!$('#profile').hidden) renderProfile();
});

/* ───────── Profil ───────── */
$('#meBtn').onclick = () => { renderProfile(); show('profile'); };
$('#pBack').onclick = () => showHome();
if (startParam === 'profile') socket.once('me', () => { renderProfile(); show('profile'); });

function renderProfile() {
  if (!ME) return;
  const m = ME, rate = m.games ? Math.round((m.wins / m.games) * 100) : 0;
  const items = Object.entries(cfg.items || {}).map(([k, it]) => `
    <div class="shop">
      <span class="emo">${it.e}</span>
      <div class="who"><b>${it.n}</b><span>${it.d}</span><small>Sizda: ${m.items[k] || 0} ta · Narxi: ${coins(it.price)}</small></div>
      <div class="col">
        <button data-buy="${k}" ${m.balance < it.price ? 'disabled' : ''}>Sotib olish</button>
        <button data-use="${k}" class="${m.use[k] ? 'primary' : ''}" ${m.items[k] ? '' : 'disabled'}>${m.use[k] ? '✓ Keyingi o‘yinda' : 'Ishlatish'}</button>
      </div>
    </div>`).join('');
  const hist = m.history.length ? m.history.map((h) => `
    <div class="item"><span class="emo-s">${ROLE[h.role] ? ROLE[h.role].e : ''}</span>
      <div class="who"><b>${ROLE[h.role] ? ROLE[h.role].n : '—'}</b><span>${fmtDate(h.ts)}</span></div><span>${h.won ? '🏆 G‘alaba' : '✖ Mag‘lubiyat'}</span></div>`).join('')
    : '<div class="item"><div class="who"><span>Hali o‘yin o‘ynalmagan.</span></div></div>';
  const tx = m.tx.length ? m.tx.map((t) => `
    <div class="item"><div class="who"><b>${esc(t.note || 'Operatsiya')}</b><span>${fmtDate(t.ts)}</span></div>
      <b class="${t.amount > 0 ? 'plus' : 'minus'}">${t.amount > 0 ? '+' : ''}${t.amount}</b></div>`).join('')
    : '<div class="item"><div class="who"><span>Operatsiyalar yo‘q.</span></div></div>';
  const order = ['tinch', 'mer', 'komissar', 'serjant', 'shifokor', 'mashuqa', 'tansoqchi', 'jurnalist', 'daydi', 'omadli', 'kamikaze', 'don', 'mafia', 'advokat', 'qotil', 'suidsid'];
  const guide = order.map((k) => `<details class="role-d"><summary>${ROLE[k].e} ${ROLE[k].n} <small>${TEAM[ROLE[k].team]}</small></summary><p>${ROLE[k].d}</p></details>`).join('');
  const support = cfg.support
    ? `<button id="support" class="ghost-b">Balansni to‘ldirish: ${esc(cfg.support)} bilan bog‘lanish</button>`
    : '<p class="hint">Balansni to‘ldirish uchun administratorga murojaat qiling.</p>';

  $('#pBody').innerHTML = `
    <div class="hero">${avatar(m.name, 'big')}<div><h2>${esc(m.name)}</h2><small>ID: ${m.id}${m.admin ? ' · 🛠 admin' : ''}</small></div></div>
    <div class="wallet"><small>Hisobingiz</small><b>${coins(m.balance)}</b>${support}</div>
    <div class="stat3"><div><b>${m.games}</b><small>O‘yin</small></div><div><b>${m.wins}</b><small>G‘alaba</small></div><div><b>${rate}%</b><small>Foiz</small></div></div>
    <h3 class="sec">🛍 Do‘kon</h3>${items}
    <h3 class="sec">So‘nggi o‘yinlar</h3><div class="list">${hist}</div>
    <h3 class="sec">Hisob tarixi</h3><div class="list">${tx}</div>
    <h3 class="sec">📖 Rollar qo‘llanmasi</h3><div class="list guide">${guide}</div>`;
}
$('#pBody').addEventListener('click', async (e) => {
  const buy = e.target.closest('[data-buy]'), use = e.target.closest('[data-use]');
  if (buy) {
    const r = await call('shop:buy', { item: buy.dataset.buy });
    toast(r.error || 'Sotib olindi ✅'); haptic(r.error ? 'error' : 'success');
  } else if (use) {
    const k = use.dataset.use;
    const r = await call('item:use', { item: k, on: !ME.use[k] });
    if (r.error) toast(r.error);
  } else if (e.target.closest('#support')) {
    const link = `https://t.me/${String(cfg.support).replace('@', '')}`;
    tg && tg.openTelegramLink ? tg.openTelegramLink(link) : window.open(link, '_blank');
  }
});

/* ───────── Admin panel ───────── */
let aSel = null, aQuery = '';
$('#adminBtn').onclick = () => { aSel = null; show('admin'); renderAdmin(); };
$('#aBack').onclick = () => (aSel ? ((aSel = null), renderAdmin()) : showHome());

async function renderAdmin() {
  const body = $('#aBody');
  if (aSel) return renderAdminUser(await call('admin', { op: 'user', id: aSel }));
  body.innerHTML = '<p class="hint">Yuklanmoqda…</p>';
  const [ov, list] = await Promise.all([call('admin', { op: 'overview' }), call('admin', { op: 'users', q: aQuery })]);
  if (ov.error) { body.innerHTML = `<p class="warn">${esc(ov.error)}</p>`; return; }
  body.innerHTML = `
    <div class="stat3 four"><div><b>${ov.users}</b><small>Foydalanuvchi</small></div><div><b>${ov.online}</b><small>Onlayn</small></div>
      <div><b>${ov.rooms}</b><small>Xona (${ov.playing} o‘ynalmoqda)</small></div><div><b>${ov.balance}</b><small>Jami balans 🪙</small></div></div>
    <div class="join"><input id="aq" placeholder="Ism yoki ID bo‘yicha qidirish" value="${esc(aQuery)}"><button id="aSearch">Qidirish</button></div>
    <div class="list" style="margin-top:12px">${list.users.length ? list.users.map((u) => `
      <div class="item clickable" data-uid="${u.id}"><span class="av">${cap1(u.name)}</span>
        <div class="who"><b class="nm"><i class="dot ${u.online ? '' : 'off'}"></i>${esc(u.name)}</b><span>ID ${u.id} · ${u.games} o‘yin${u.banned ? ' · 🚫 bloklangan' : ''}</span></div>
        <b>${coins(u.balance)}</b></div>`).join('') : '<div class="item"><div class="who"><span>Topilmadi.</span></div></div>'}</div>`;
}
$('#aBody').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-uid]');
  if (row) { aSel = Number(row.dataset.uid); return renderAdmin(); }
  if (e.target.closest('#aSearch')) { aQuery = $('#aq').value.trim(); return renderAdmin(); }
  const q = e.target.closest('[data-q]');
  if (q) { $('#amt').value = q.dataset.q; return; }
  const sign = e.target.closest('[data-sign]');
  if (sign) {
    const n = Math.abs(Math.trunc(Number($('#amt').value)));
    if (!n) return toast('Summani kiriting');
    const r = await call('admin', { op: 'grant', id: aSel, amount: Number(sign.dataset.sign) * n, note: $('#note').value.trim() });
    toast(r.error || 'Bajarildi ✅');
    return r.error ? 0 : renderAdminUser(r);
  }
  const it = e.target.closest('[data-item]');
  if (it) { const r = await call('admin', { op: 'item', id: aSel, item: it.dataset.item, qty: Number(it.dataset.qty) }); return r.error ? toast(r.error) : renderAdminUser(r); }
  const ban = e.target.closest('[data-ban]');
  if (ban) { const r = await call('admin', { op: 'ban', id: aSel, banned: ban.dataset.ban === '1' }); return r.error ? toast(r.error) : renderAdminUser(r); }
});
$('#aBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'aq') { aQuery = e.target.value.trim(); renderAdmin(); } });

function renderAdminUser(r) {
  if (r.error) { toast(r.error); aSel = null; return renderAdmin(); }
  const u = r.user;
  $('#aBody').innerHTML = `
    <div class="hero"><span class="av big">${cap1(u.name)}</span><div><h2>${esc(u.name)}</h2><small>ID: ${u.id} · ${u.online ? 'onlayn' : 'oflayn'}${u.banned ? ' · 🚫 bloklangan' : ''}</small></div></div>
    <div class="wallet"><small>Balans</small><b>${coins(u.balance)}</b><small>${u.games} o‘yin · ${u.wins} g‘alaba</small></div>
    <h3 class="sec">💰 Pul tashlash / ayirish</h3>
    <div class="note">
      <div class="join"><input id="amt" type="number" inputmode="numeric" min="1" placeholder="Summa (tanga)"></div>
      <div class="row2">${[10, 50, 100, 500, 1000].map((n) => `<button data-q="${n}">${n}</button>`).join('')}</div>
      <div class="join" style="margin-top:8px"><input id="note" maxlength="60" placeholder="Izoh (ixtiyoriy), masalan: to‘lov #123"></div>
      <div class="row2"><button class="primary" data-sign="1">➕ Qo‘shish</button><button data-sign="-1">➖ Ayirish</button></div>
    </div>
    <h3 class="sec">🎁 Narsalar</h3>
    ${Object.entries(cfg.items || {}).map(([k, it]) => `<div class="item shopadm"><span class="emo-s">${it.e}</span><div class="who"><b>${it.n}</b><span>Hozir: ${u.items[k] || 0} ta</span></div>
      <button data-item="${k}" data-qty="1">+1</button><button data-item="${k}" data-qty="-1">−1</button></div>`).join('')}
    <h3 class="sec">Hisob tarixi</h3>
    <div class="list">${u.tx.length ? u.tx.map((t) => `<div class="item"><div class="who"><b>${esc(t.note || 'Operatsiya')}</b><span>${fmtDate(t.ts)}</span></div><b class="${t.amount > 0 ? 'plus' : 'minus'}">${t.amount > 0 ? '+' : ''}${t.amount}</b></div>`).join('') : '<div class="item"><div class="who"><span>Yo‘q</span></div></div>'}</div>
    <h3 class="sec">Xavfsizlik</h3>
    <button data-ban="${u.banned ? 0 : 1}" class="${u.banned ? 'primary' : 'danger'}">${u.banned ? '✅ Blokdan chiqarish' : '🚫 Bloklash'}</button>`;
}
