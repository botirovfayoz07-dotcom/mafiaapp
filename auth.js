'use strict';
const crypto = require('crypto');

/** Telegram Mini App initData imzosini tekshiradi. To'g'ri bo'lsa {id, name} qaytaradi. */
function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const str = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
  const a = Buffer.from(calc);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > maxAgeSec) return null;
  try {
    const u = JSON.parse(p.get('user'));
    return { id: Number(u.id), name: u.first_name || u.username || 'Noma’lum' };
  } catch {
    return null;
  }
}

/** Faqat DEV=1 bo'lganda: brauzerda ?dev=Ali bilan sinash uchun */
function devUser(name) {
  const clean = String(name).slice(0, 20);
  const h = crypto.createHash('sha1').update(clean).digest().readUInt32BE(0);
  return { id: 1_000_000_000 + (h % 1_000_000_000), name: clean };
}

module.exports = { verifyInitData, devUser };
