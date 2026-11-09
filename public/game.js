/* Règles des Cinq Compagnons : partagé entre le serveur et le navigateur. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.G = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ORD = ['3', '4', '5', '6', '7', '8', '9', '10', 'É', 'S', 'R'];
  const HOUSES = ['loutre', 'grenouille', 'chat', 'hibou', 'raton'];
  const HOUSE_NAME = { loutre: 'Loutre', grenouille: 'Grenouille', chat: 'Chat', hibou: 'Hibou', raton: 'Raton', joker: 'Joker' };
  const HOUSE_COLOR = { loutre: '#1f3f94', grenouille: '#1f5a34', chat: '#a3162e', hibou: '#845500', raton: '#566474', joker: '#4a2f63' };
  const FIG = { 'É': 'Valet', 'S': 'Dame', 'R': 'Roi' };

  const wildOf = round => ORD[round - 1];
  const val = r => ({ 'É': 11, 'S': 12, 'R': 13 }[r] !== undefined ? { 'É': 11, 'S': 12, 'R': 13 }[r] : parseInt(r, 10));
  const isWild = (c, wild) => c.r === 'B' || c.r === wild;
  const points = (c, wild) => c.r === 'B' ? 50 : (c.r === wild ? 20 : val(c.r));
  const label = c => c.r === 'B' ? 'Joker' : (FIG[c.r] ? FIG[c.r] : c.r) + ' de ' + HOUSE_NAME[c.a];

  // Une combinaison valide : 3 cartes ou plus. Brelan (même valeur) ou suite (même maison, valeurs qui se suivent).
  function checkCards(cs, wild) {
    if (cs.length < 3) return { ok: false, kind: '' };
    const nat = cs.filter(c => !isWild(c, wild));
    const w = cs.length - nat.length;
    if (nat.length === 0) return { ok: true, kind: 'Combinaison' };
    if (nat.every(c => c.r === nat[0].r)) return { ok: true, kind: 'Brelan' };
    if (nat.every(c => c.a === nat[0].a)) {
      const idx = nat.map(c => ORD.indexOf(c.r)).sort((x, y) => x - y);
      const uniq = idx.every((v, i) => i === 0 || v !== idx[i - 1]);
      if (uniq && ((idx[idx.length - 1] - idx[0] + 1) - idx.length) <= w && cs.length <= ORD.length) return { ok: true, kind: 'Suite' };
    }
    return { ok: false, kind: '' };
  }

  // Meilleur rangement d'une main : points restants minimum + groupes choisis.
  function best(cards, wild) {
    const n = cards.length;
    if (!n) return { pts: 0, groups: [], rest: [] };
    const groupsByLow = [];
    for (let i = 0; i < n; i++) groupsByLow.push([]);
    const total = 1 << n;
    for (let m = 1; m < total; m++) {
      let c = 0, x = m; while (x) { c += x & 1; x >>= 1; }
      if (c < 3) continue;
      const g = []; for (let i = 0; i < n; i++) if (m >> i & 1) g.push(cards[i]);
      if (checkCards(g, wild).ok) groupsByLow[31 - Math.clz32(m & -m)].push(m);
    }
    const memo = new Map();
    const f = m => {
      if (!m) return { v: 0, pick: [] };
      if (memo.has(m)) return memo.get(m);
      const low = m & -m, li = 31 - Math.clz32(low), rest = m ^ low;
      const r0 = f(rest);
      let res = { v: points(cards[li], wild) + r0.v, pick: r0.pick, skip: li };
      for (const g of groupsByLow[li]) {
        if ((g & m) !== g) continue;
        const r = f(m ^ g);
        if (r.v < res.v) res = { v: r.v, pick: [g].concat(r.pick) };
      }
      memo.set(m, res);
      return res;
    };
    const r = f(total - 1);
    const used = new Set(); const groups = [];
    r.pick.forEach(g => { const gr = []; for (let i = 0; i < n; i++) if (g >> i & 1) { gr.push(cards[i]); used.add(i); } groups.push(gr); });
    const rest = cards.filter((_, i) => !used.has(i));
    return { pts: r.v, groups, rest };
  }
  const minLeft = (cards, wild) => best(cards, wild).pts;

  let uid = 0;
  function newDeck() {
    const d = [];
    for (let k = 0; k < 2; k++) HOUSES.forEach(a => ORD.forEach(r => d.push({ id: 'k' + (uid++), a, r })));
    for (let k = 0; k < 6; k++) d.push({ id: 'k' + (uid++), a: 'joker', r: 'B' });
    return d;
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = a[i]; a[i] = a[j]; a[j] = x; } return a; }

  // Décision d'un bot. hand = main actuelle (avant pioche).
  function botDraw(hand, top, wild, level) {
    if (!top) return 'deck';
    const base = Math.min.apply(null, hand.map((_, i) => minLeft(hand.filter((__, j) => j !== i), wild)));
    let withTop = Infinity;
    const h2 = hand.concat([top]);
    for (let i = 0; i < hand.length; i++) withTop = Math.min(withTop, minLeft(h2.filter((_, j) => j !== i), wild));
    const gain = base - withTop;
    if (level === 'Débutant') return (gain > 4 && Math.random() < 0.6) ? 'pile' : 'deck';
    if (level === 'Malin') return gain > 0 ? 'pile' : 'deck';
    return (gain > 0 || isWild(top, wild)) ? 'pile' : 'deck';
  }
  // Après pioche : { close: bool, id }
  function botDiscard(hand, wild, level, lockId) {
    let bestV = Infinity, bestC = null;
    hand.forEach((c, i) => {
      if (c.id === lockId && hand.length > 1) return;
      const v = minLeft(hand.filter((_, j) => j !== i), wild);
      if (v < bestV || (v === bestV && bestC && points(c, wild) > points(bestC, wild))) { bestV = v; bestC = c; }
    });
    if (!bestC) bestC = hand[hand.length - 1];
    let close = bestV === 0;
    if (close && level === 'Débutant' && Math.random() < 0.4) close = false;
    return { close, id: bestC.id };
  }

  return { ORD, HOUSES, HOUSE_NAME, HOUSE_COLOR, FIG, wildOf, val, isWild, points, label, checkCards, best, minLeft, newDeck, shuffle, botDraw, botDiscard };
});
