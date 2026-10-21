'use strict';
/* Kun / tun / ovoz sahnalari: tashqi fayl kerak emas, CSS bilan animatsiya qilingan SVG.
   Xohlasangiz public/gif/ papkasiga night.gif, day.gif, vote.gif, lobby.gif qo'ying — ular avtomatik ustiga chiqadi. */
const SCENE_CAP = { lobby: 'Shahar kutmoqda…', night: 'Shahar uyquda. Mafiya uyg‘ondi…', day: 'Tong otdi. Shahar muhokama qilmoqda', vote: 'Ovoz berish: kim osiladi?' };

function skyline(fill, nightMode) {
  const B = [[0, 40, 60], [40, 30, 85], [70, 45, 50], [115, 35, 95], [150, 50, 65], [200, 30, 80], [230, 45, 55], [275, 35, 100], [310, 40, 70], [350, 50, 60]];
  let s = '';
  B.forEach(([x, w, h], b) => {
    s += `<rect x="${x}" y="${150 - h}" width="${w}" height="${h}" fill="${fill}"/>`;
    const cols = Math.floor((w - 8) / 10), rows = Math.floor((h - 10) / 14);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const k = (i * 7 + j * 3 + b) % 5;
      if (k === 4) continue;
      const cls = nightMode ? (k === 0 ? 'win blink' : 'win') : 'winD';
      s += `<rect class="${cls}" style="animation-delay:${(b + i + j) % 5 * 0.7}s" x="${x + 6 + i * 10}" y="${150 - h + 8 + j * 14}" width="5" height="7"/>`;
    }
  });
  return s;
}
function stars(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += `<circle class="tw" style="animation-delay:${(i % 7) * 0.4}s" cx="${(i * 97 + 13) % 400}" cy="${(i * 53 + 7) % 85}" r="${0.8 + (i % 3) * 0.5}"/>`;
  return s;
}
const SVG = {
  night: () => `<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    ${stars(22)}
    <line class="shoot" x1="0" y1="0" x2="26" y2="10" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
    <circle class="glow" cx="72" cy="40" r="30" fill="#f5efc9" opacity=".12"/>
    <circle cx="72" cy="40" r="18" fill="#f5efc9"/>
    <circle cx="66" cy="35" r="3.5" fill="#dcd3a4"/><circle cx="78" cy="46" r="4.5" fill="#dcd3a4"/><circle cx="80" cy="33" r="2" fill="#dcd3a4"/>
    ${skyline('#070d1d', true)}
    <ellipse class="fog" cx="100" cy="146" rx="120" ry="8" fill="#9db4e6" opacity=".12"/>
    <ellipse class="fog f2" cx="300" cy="148" rx="130" ry="7" fill="#9db4e6" opacity=".10"/>
    <g class="walker"><ellipse cx="0" cy="-27" rx="8" ry="2" fill="#000"/><rect x="-4.5" y="-34" width="9" height="7" rx="1" fill="#000"/>
      <circle cx="0" cy="-22" r="4.5" fill="#000"/><path d="M-6 -17 L6 -17 L8 0 L-8 0 Z" fill="#000"/></g>
  </svg>`,
  day: () => `<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <g class="rays">${Array.from({ length: 12 }, (_, i) => `<line x1="320" y1="22" x2="320" y2="8" stroke="#ffd54a" stroke-width="3" stroke-linecap="round" transform="rotate(${i * 30} 320 45)"/>`).join('')}</g>
    <circle cx="320" cy="45" r="19" fill="#ffd54a"/>
    <g class="cloud" style="animation-duration:38s"><ellipse cx="0" cy="30" rx="26" ry="9" fill="#fff"/><ellipse cx="-14" cy="35" rx="16" ry="7" fill="#fff"/><ellipse cx="16" cy="36" rx="18" ry="7" fill="#fff"/></g>
    <g class="cloud" style="animation-duration:55s;animation-delay:-20s;opacity:.85"><ellipse cx="0" cy="62" rx="20" ry="7" fill="#fff"/><ellipse cx="12" cy="66" rx="14" ry="6" fill="#fff"/></g>
    <g class="bird" style="animation-delay:-3s"><path d="M0 0 q5 -7 10 0 q5 -7 10 0" fill="none" stroke="#33415c" stroke-width="1.6"/></g>
    <g class="bird b2" style="animation-delay:-9s"><path d="M0 0 q4 -6 8 0 q4 -6 8 0" fill="none" stroke="#33415c" stroke-width="1.4"/></g>
    ${skyline('#5b7a8c', false)}
    <rect y="146" width="400" height="4" fill="#3c5a46"/>
  </svg>`,
  vote: () => `<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <circle cx="200" cy="70" r="70" fill="#ffb86b" opacity=".12" class="glow"/>
    <rect x="198" y="30" width="4" height="100" fill="#d9c27a"/><rect x="170" y="128" width="60" height="6" rx="2" fill="#d9c27a"/>
    <g class="beam"><rect x="140" y="28" width="120" height="4" rx="2" fill="#d9c27a"/>
      <line x1="146" y1="30" x2="146" y2="62" stroke="#d9c27a"/><path d="M130 62 h32 q-2 12 -16 12 q-14 0 -16 -12z" fill="#d9c27a"/>
      <line x1="254" y1="30" x2="254" y2="62" stroke="#d9c27a"/><path d="M238 62 h32 q-2 12 -16 12 q-14 0 -16 -12z" fill="#d9c27a"/></g>
    ${[60, 110, 290, 340, 245].map((x, i) => `<rect class="ballot" style="animation-delay:${i * 0.6}s;left:0" x="${x}" y="-12" width="12" height="16" rx="2" fill="#fff"/>`).join('')}
  </svg>`,
  lobby: () => `<svg viewBox="0 0 400 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    ${stars(14)}
    <g class="fan"><g transform="translate(200 82) rotate(-18)"><rect x="-22" y="-32" width="44" height="64" rx="5" fill="#f3ecd8"/><text y="8" font-size="26" text-anchor="middle" fill="#222">♠</text></g>
    <g transform="translate(200 82) rotate(0)"><rect x="-22" y="-34" width="44" height="64" rx="5" fill="#f3ecd8"/><text y="8" font-size="26" text-anchor="middle" fill="#b3261e">♥</text></g>
    <g transform="translate(200 82) rotate(18)"><rect x="-22" y="-32" width="44" height="64" rx="5" fill="#f3ecd8"/><text y="8" font-size="26" text-anchor="middle" fill="#222">♣</text></g></g>
  </svg>`,
};
const sceneKey = (phase) => (phase === 'last' ? 'vote' : phase);

/** Sahna bloki. Agar public/gif/<nom>.gif mavjud bo'lsa, o'sha ustiga chiqadi. */
function sceneHTML(key, caption) {
  return `<div class="scene ${key}">${SVG[key]()}<img class="scene-gif" alt="" src="gif/${key}.gif" onerror="this.remove()">${caption ? `<span class="cap">${caption}</span>` : ''}</div>`;
}
