/* Dessin des cartes (HTML) : utilisé par l'accueil, la table et les règles. */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function cardHTML(c, o) {
  o = o || {};
  const col = G.HOUSE_COLOR[c.a], shown = { 'É': 'V', 'S': 'D', 'B': 'J' }[c.r] || c.r, lab = G.FIG[c.r] || '';
  const aria = G.label(c);
  return '<div class="card' + (o.wild ? ' wild' : '') + '" role="img" aria-label="' + esc(aria) + '" style="--c:' + col + '">' +
    '<div class="ix">' + shown + '</div><div class="ix b">' + shown + '</div>' +
    '<div class="mid">' + (lab ? '<span class="l">' + lab + '</span>' : '') + '<span class="r">' + shown + '</span><span class="bar"></span><span class="a">' + G.HOUSE_NAME[c.a] + '</span></div></div>';
}
function backHTML() {
  return '<div class="card back" aria-hidden="true"><svg viewBox="0 0 70 98"><g fill="none" stroke="#cecdb9" stroke-width="1.4"><circle cx="35" cy="49" r="22"/><rect x="21" y="35" width="28" height="28" transform="rotate(45 35 49)"/></g><circle cx="35" cy="49" r="5" fill="#cecdb9"/></svg></div>';
}
function emptyHTML() { return '<div class="card empty" aria-hidden="true"></div>'; }
