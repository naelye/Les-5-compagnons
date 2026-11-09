/* Page de jeu : salon, table, résultats. Dépend de game.js, cards.js, sfx.js. */
(function () {
  const $ = s => document.querySelector(s);
  const view = $('#view');
  let ws = null, S = null, session = null, retry = 0, offset = 0, wasConnected = false, intent = null;
  let order = [], sortMode = 'perso', sel = null, handRound = -1, newIds = new Set(), modal = null, toastT = null;
  let kicked = false, popNow = false, lastSeq = -1, lastBanner = '', lastView = '', lastTickSec = null, lastCdSec = null, countDone = {}, dragId = null, askName = false, joinErr = '';
  const KEY = 'c5k-session';

  try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { session = null; }
  const params = new URLSearchParams(location.search);
  const wantCode = (params.get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  try { intent = JSON.parse(sessionStorage.getItem('c5k-intent') || 'null'); sessionStorage.removeItem('c5k-intent'); } catch (e) { intent = null; }
  if (wantCode && session && session.code !== wantCode) session = null;
  if (!session && !intent) {
    if (wantCode) askName = true;
    else location.replace('index.html');
  }

  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function saveSession(s) { session = s; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { session = null; try { localStorage.removeItem(KEY); } catch (e) {} }
  function toast(msg) {
    let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 3500);
  }

  function connect() {
    if (askName) return;
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => {
      retry = 0;
      if (session) send({ t: 'hello', code: session.code, pid: session.pid, token: session.token });
      else if (intent) { send(intent); intent = null; }
      if (wasConnected) toast('Connexion rétablie.');
      wasConnected = true;
    };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.t === 'joined') { saveSession({ code: m.code, pid: m.pid, token: m.token }); try { history.replaceState(null, '', 'play.html?c=' + m.code); } catch (x) {} }
      else if (m.t === 'state') onState(m.s);
      else if (m.t === 'kicked') { kicked = true; lastView = ''; render(); }
      else if (m.t === 'gone') { clearSession(); location.replace('index.html?gone=1'); }
      else if (m.t === 'error') { toast(m.msg); if (!S) { joinErr = m.msg; render(); } }
    };
    ws.onclose = () => { if (kicked) return; if (S) toast('Connexion perdue : reconnexion…'); setTimeout(connect, Math.min(5000, 500 * Math.pow(2, retry++))); };
  }

  /* ----------------------------------------------------------- données */
  const me = () => S.players.find(p => p.id === S.you);
  const pl = id => S.players.find(p => p.id === id) || { name: '?' };
  const wildName = r => G.FIG[r] ? G.FIG[r] + 's' : 'les ' + r;
  const now = () => Date.now() + offset;
  const byVal = (a, b) => (a.r === 'B') - (b.r === 'B') || G.val(a.r) - G.val(b.r) || G.HOUSES.indexOf(a.a) - G.HOUSES.indexOf(b.a);
  const byHouse = (a, b) => (a.r === 'B') - (b.r === 'B') || G.HOUSES.indexOf(a.a) - G.HOUSES.indexOf(b.a) || G.val(a.r) - G.val(b.r);

  function onState(s) {
    const prev = S; S = s; offset = s.now - Date.now();
    const g = s.game;
    if (g) {
      if (g.round !== handRound) { handRound = g.round; order = g.hand.map(c => c.id); sel = null; newIds = new Set(); }
      else {
        const ids = g.hand.map(c => c.id); const old = new Set(order);
        order = order.filter(id => ids.indexOf(id) >= 0);
        ids.forEach(id => { if (!old.has(id)) { order.push(id); if (prev && prev.game) newIds.add(id); } });
        if (sel && ids.indexOf(sel) < 0) sel = null;
      }
      if (g.ev && g.ev.seq !== lastSeq) { if (lastSeq !== -1) { playEv(g); popNow = true; } lastSeq = g.ev.seq; }
      const key = g.round + ':' + g.ev.seq;
      if (g.state === 'play' && g.turn === s.you && g.phase === 'draw' && key !== lastBanner) { lastBanner = key; showBanner(); sfx('turn'); }
    } else { lastSeq = -1; lastBanner = ''; handRound = -1; }
    render();
    popNow = false; newIds = new Set();
  }
  function playEv(g) {
    const e = g.ev;
    if (e.kind === 'drawDeck' || e.kind === 'drawPile') sfx('draw', e.pid === S.you ? 0.7 : 0.55);
    else if (e.kind === 'discard' || e.kind === 'close') sfx('discard', e.pid === S.you ? 0.8 : 0.6);
    else if (e.kind === 'roundEnd' && g.results) {
      const mine = g.results[S.you]; const min = Math.min.apply(null, Object.values(g.results).map(r => r.pts));
      if (mine && mine.pts === min) sfx('win');
    }
  }
  function showBanner() {
    const b = document.createElement('div'); b.className = 'banner'; b.setAttribute('aria-hidden', 'true'); b.innerHTML = '<span>À ton tour !</span>';
    document.body.appendChild(b); setTimeout(() => b.remove(), 1900);
  }

  /* ------------------------------------------------------------- rendu */
  function render() {
    renderTop();
    let html;
    if (kicked) html = '<div class="wrap"><div class="panel" style="max-width:560px;margin:30px auto;text-align:center"><h1 style="font-size:26px">Partie ouverte ailleurs</h1><p>Cette partie est maintenant ouverte dans un autre onglet ou appareil.</p><button class="btn btn-p" data-a="takeover">Reprendre ici</button></div></div>';
    else if (askName) html = renderAsk();
    else if (!S) html = '<div class="wrap"><p class="dim" role="status">' + (joinErr ? '<span class="err">' + esc(joinErr) + '</span> <a href="index.html">Retour à l’accueil</a>' : 'Connexion à la partie…') + '</p></div>';
    else if (S.status === 'lobby') html = renderLobby();
    else html = renderGame();
    if (html !== lastView) { view.innerHTML = html; lastView = html; afterRender(); }
    tickUI();
  }
  function renderTop() {
    const el = $('#topbar'); if (!el) return;
    const extra = S ? '<span class="chip">Code <b>' + esc(S.code) + '</b></span><button class="btn btn-s" style="min-height:40px;padding:0 14px" data-a="copyLink">' + (copied ? 'Lien copié ✓' : 'Copier le lien') + '</button>' : '';
    const html = '<a class="logo" href="index.html" data-a="home">LES CINQ COMPAGNONS</a>' + extra + '<span class="sp"></span>' +
      '<button class="btn btn-s" style="min-height:40px;padding:0 14px" data-a="sound" aria-pressed="' + (!S_mute()) + '">Son : ' + (S_mute() ? 'coupé' : 'activé') + '</button>' +
      '<a class="btn btn-s" style="min-height:40px;padding:0 14px" href="rules.html" target="_blank" rel="noopener">Règles</a>' +
      (S ? '<button class="btn btn-s" style="min-height:40px;padding:0 14px" data-a="quit">Quitter</button>' : '');
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  }
  const S_mute = () => { try { return localStorage.getItem('c5k-mute') === '1'; } catch (e) { return false; } };
  let copied = false;

  function renderAsk() {
    let nm = ''; try { nm = localStorage.getItem('c5k-name') || ''; } catch (e) {}
    return '<div class="wrap"><div class="panel" style="max-width:520px;margin:30px auto"><h1 style="font-size:30px">Rejoindre la partie ' + esc(wantCode) + '</h1><p class="dim">Choisissez le prénom que verront les autres joueurs.</p><form data-form="join" class="row"><label for="nm" style="position:absolute;left:-9999px">Votre prénom</label><input id="nm" type="text" maxlength="16" placeholder="Votre prénom" value="' + esc(nm) + '" autocomplete="nickname" required><button class="btn btn-p" type="submit">Rejoindre</button></form>' + (joinErr ? '<p class="err" role="alert">' + esc(joinErr) + '</p>' : '') + '<p style="margin:14px 0 0"><a class="link" href="index.html">← Retour à l’accueil</a></p></div></div>';
  }

  /* ----- salon */
  function renderLobby() {
    const host = S.host === S.you, m = me(), full = S.players.length >= S.opts.max;
    const rows = S.players.map(p => {
      const isMe = p.id === S.you;
      let right = '';
      if (p.bot) {
        right = '<span role="group" aria-label="Niveau du bot ' + esc(p.name) + '" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
          ['Débutant', 'Malin', 'Rusé'].map(l => '<button class="seg" style="min-height:40px;padding:0 10px;font-size:13px" aria-pressed="' + (p.level === l) + '" ' + (host ? 'data-a="botLevel" data-pid="' + p.id + '" data-l="' + l + '"' : 'disabled') + '>' + l + '</button>').join('') +
          (host ? '<button class="btn btn-s" style="min-height:40px;padding:0 12px;font-size:13px" data-a="removeBot" data-pid="' + p.id + '" aria-label="Retirer le bot ' + esc(p.name) + '">Retirer</button>' : '') + '</span>';
      } else if (!p.connected) right = '<span class="dim">hors ligne</span>';
      else if (p.ready) right = '<span class="dim">✓ Prêt</span>';
      else right = '<span class="dim">En attente…</span>';
      return '<li class="' + (p.bot ? 'botrow' : '') + '"><div class="av">' + esc(p.name[0].toUpperCase()) + '</div><div style="flex:1 1 auto;min-width:0"><div style="font-size:21px">' + esc(p.name) + (p.bot ? '<span class="bot">BOT</span>' : '') + (isMe ? ' <span class="dim">(vous)</span>' : '') + (p.id === S.host ? ' <span class="dim">· hôte</span>' : '') + '</div></div>' + right + '</li>';
    }).join('');
    const empty = []; for (let i = S.players.length; i < S.opts.max; i++) empty.push('<li style="border-style:dashed;background:transparent"><div class="av" style="background:transparent;color:var(--soft);border:1px dashed var(--soft)">+</div><div class="dim" style="flex:1">Place libre : partagez le code ou le lien</div>' + (host ? '<button class="btn btn-s" style="min-height:40px;padding:0 14px;font-size:13px" data-a="addBot">Ajouter un bot</button>' : '') + '</li>');
    const opt = (label, list, cur, act, fmt) => '<fieldset class="fieldset"><legend>' + label + '</legend><div class="row" style="gap:8px">' + list.map(v => '<button class="seg" aria-pressed="' + (v === cur) + '" ' + (host ? 'data-a="' + act + '" data-v="' + v + '"' : 'disabled') + '>' + fmt(v) + '</button>').join('') + '</div></fieldset>';
    const humansReady = S.players.filter(p => !p.bot).every(p => p.ready);
    let foot;
    if (S.cdEnd) foot = 'Tout le monde est prêt : la partie démarre…';
    else if (S.players.length < 2) foot = 'Il faut au moins 2 joueurs : invitez un ami ou ajoutez un bot.';
    else if (!m.ready) foot = 'Cliquez sur « Je suis prêt » quand vous voulez commencer.';
    else foot = humansReady ? '' : 'En attente des autres joueurs…';
    const cd = S.cdEnd ? '<div class="big" role="dialog" aria-modal="true" aria-labelledby="cdt"><div><h2 id="cdt" style="font-size:34px;margin-bottom:22px">Tout le monde est prêt !</h2><div class="num" id="cdNum" aria-hidden="true">' + Math.max(1, Math.ceil((S.cdEnd - now()) / 1000)) + '</div><p style="font-size:24px;margin:24px 0">La partie démarre dans quelques secondes…</p><button class="btn btn-s" data-a="unready">Annuler</button></div></div>' : '';
    return '<div class="wrap"><div class="codebox"><div><div style="font-family:var(--head);font-size:13px;font-weight:700;letter-spacing:.03em;color:#2c4a50">CODE DE LA PARTIE</div><div class="c">' + esc(S.code) + '</div></div><div class="row" style="margin-left:auto"><button class="btn" data-a="copyCode">' + (copiedCode ? 'Copié ✓' : 'Copier le code') + '</button><button class="btn d" data-a="copyLink">' + (copied ? 'Lien copié ✓' : 'Copier le lien d’invitation') + '</button></div></div>' +
      '<div class="lobby"><section class="panel" aria-labelledby="tj"><div class="row" style="justify-content:space-between;margin-bottom:14px"><h2 id="tj" style="font-size:22px">Joueurs</h2><span class="dim">' + S.players.length + ' sur ' + S.opts.max + ' · minimum 2</span></div><ul class="plist">' + rows + empty.join('') + '</ul></section>' +
      '<section class="panel" aria-labelledby="to"><h2 id="to" style="font-size:22px;margin-bottom:18px">Options</h2>' + opt('Nombre de joueurs maximum', [2, 3, 4, 5, 6, 7], S.opts.max, 'max', v => v) + opt('Temps par tour', [30, 60, 0], S.opts.time, 'time', v => v ? v + ' s' : 'Illimité') + (host ? '' : '<p class="dim" style="margin:0">Seul l’hôte modifie les options.</p>') + '</section></div>' +
      '<div class="row" style="margin-top:24px;padding:14px 18px;border-radius:12px;background:var(--pine2)"><button class="btn ' + (m.ready ? 'btn-s' : 'btn-p') + '" data-a="' + (m.ready ? 'unready' : 'ready') + '" aria-pressed="' + m.ready + '">' + (m.ready ? 'Annuler' : 'Je suis prêt') + '</button><button class="btn btn-s" data-a="abandon">Quitter le salon</button><span role="status" aria-live="polite" class="dim" style="margin-left:auto;font-size:18px">' + foot + '</span></div></div>' + cd + modalHTML();
  }
  let copiedCode = false;

  /* ----- partie */
  function evMsg(g) {
    const e = g.ev || {}; if (!e.kind || !e.pid) return '';
    const n = '<b>' + esc(pl(e.pid).name) + '</b>';
    if (e.kind === 'drawDeck') return n + ' a pioché sur la pioche.';
    if (e.kind === 'drawPile') return n + ' a pris ' + (e.card ? '<b>' + esc(G.label(e.card)) + '</b>' : 'la carte') + ' sur la défausse.';
    if (e.kind === 'discard') return n + ' a défaussé <b>' + esc(G.label(e.card)) + '</b>.';
    if (e.kind === 'close') return n + ' clôture la manche avec <b>' + esc(G.label(e.card)) + '</b> !';
    return '';
  }
  function handList(g) {
    const m = {}; g.hand.forEach(c => { m[c.id] = c; });
    let list = order.map(id => m[id]).filter(Boolean);
    if (sortMode === 'valeur') list = list.slice().sort(byVal);
    else if (sortMode === 'maison') list = list.slice().sort(byHouse);
    return list;
  }
  const rest = (g, id) => g.hand.filter(c => c.id !== id);
  function renderGame() {
    const g = S.game, mine = g.state === 'play' && g.turn === S.you;
    const list = handList(g);
    const selOk = sel && g.hand.some(c => c.id === sel);
    const leftPts = selOk && mine && g.phase === 'discard' ? G.minLeft(rest(g, sel), g.wild) : null;
    const canClose = mine && g.phase === 'discard' && g.closer === null && selOk && leftPts === 0;
    const locked = selOk && sel === g.lockId && g.hand.length > 1;
    const canDiscard = mine && g.phase === 'discard' && selOk && !locked;
    const tp = pl(g.turn);
    let status;
    if (g.state !== 'play') status = 'Manche terminée.';
    else if (mine && g.phase === 'draw') status = '<b>À vous :</b> piochez ou prenez la carte de la défausse.';
    else if (mine) status = '<b>À vous :</b> choisissez une carte à défausser' + (g.closer === null ? ', ou clôturez' : '') + '.';
    else status = 'Au tour de <b>' + esc(tp.name) + '</b>' + (tp.bot ? '' : tp.connected ? '' : ' (hors ligne)') + '…';
    const lastTurn = g.closer !== null ? '<div class="msg" style="color:var(--gold)">' + esc(pl(g.closer).name) + ' a clôturé : dernier tour pour les autres.</div>' : '';
    const prog = Array.from({ length: 11 }, (_, i) => '<i class="' + (i + 1 < g.round ? 'on' : (i + 1 === g.round ? 'cur' : '')) + '"></i>').join('');
    const opps = g.seats.filter(id => id !== S.you).map(id => {
      const p = pl(id), n = g.counts[id] || 0;
      const backs = Array.from({ length: Math.min(n, 13) }, () => backHTML()).join('');
      return '<div class="opp' + (g.turn === id && g.state === 'play' ? ' turn' : '') + (p.connected ? '' : ' off') + '"><div class="nm">' + esc(p.name) + (p.bot ? '<span class="bot">BOT</span>' : '') + '</div><div class="pt">' + p.total + ' pt · ' + n + ' cartes' + (g.closer === id ? ' · clôture' : '') + '</div><div class="bk">' + backs + '</div></div>';
    }).join('');
    const canPick = mine && g.phase === 'draw';
    const deckBtn = '<button class="pbtn' + (canPick ? ' can' : '') + '" ' + (canPick ? 'data-a="drawDeck"' : 'disabled') + ' aria-label="Piocher une carte (' + g.deckCount + ' restantes)"><div class="stack">' + backHTML() + backHTML() + backHTML() + '</div></button>';
    const pileCard = g.pileTop ? cardHTML(g.pileTop, { wild: false }) : emptyHTML();
    const pileBtn = '<button class="pbtn' + (canPick && g.pileTop ? ' can' : '') + '" data-pile ' + (canPick && g.pileTop ? 'data-a="drawPile"' : 'disabled') + ' aria-label="' + (g.pileTop ? 'Prendre ' + esc(G.label(g.pileTop)) + ' sur la défausse' : 'Défausse vide') + '"><div class="' + (popNow && g.ev && (g.ev.kind === 'discard' || g.ev.kind === 'close') ? 'pop' : '') + '" id="pileCard">' + pileCard + '</div></button>';
    const hand = list.map(c => {
      const w = G.isWild(c, g.wild);
      return '<div role="button" tabindex="0" class="hc' + (sel === c.id ? ' sel' : '') + (newIds.has(c.id) ? ' new' : '') + '" draggable="true" data-card="' + c.id + '" data-a="pick" data-id="' + c.id + '" aria-pressed="' + (sel === c.id) + '">' + cardHTML(c, { wild: w }) + '</div>';
    }).join('');
    const log = g.log.slice().reverse().map(l => '<li>' + esc(l.text) + '</li>').join('');
    const score = S.players.slice().sort((a, b) => a.total - b.total).map(p => '<tr class="' + (p.id === S.you ? 'me' : '') + '"><td>' + esc(p.name) + (p.bot ? '<span class="bot">BOT</span>' : '') + '</td><td>' + p.total + ' pt</td></tr>').join('');
    const hint = mine && g.phase === 'discard' && selOk ? (locked ? 'Vous ne pouvez pas rejeter la carte que vous venez de prendre sur la défausse.' : (canClose ? '✓ En défaussant celle-ci, toutes vos autres cartes sont rangées : vous pouvez clôturer.' : 'Points restants si vous défaussez cette carte : <b>' + leftPts + '</b>')) : (mine && g.phase === 'discard' ? 'Touchez une carte pour la choisir, puis « Défausser ». Double-clic ou glisser vers la défausse fonctionne aussi.' : '');
    const timer = g.deadline && g.state === 'play' ? '<div class="ring" id="ring"><span id="ringTxt">…</span></div>' : '';
    return '<div class="table"><div class="main">' +
      '<div class="bar2"><div><div class="rn">MANCHE ' + g.round + ' SUR 11 · ' + g.size + ' cartes</div><div class="prog" aria-hidden="true">' + prog + '</div></div><span class="wildchip">Atout : <b>' + esc(wildName(g.wild)) + '</b> et Jokers</span><span class="sp"></span><div role="status" aria-live="polite" id="status" style="font-size:18px;flex:1 1 280px;text-align:right">' + status + '</div>' + timer + '</div>' +
      '<div class="opps">' + opps + '</div>' +
      '<div class="center"><div class="pcol">' + deckBtn + '<div class="lb">PIOCHE · ' + g.deckCount + '</div></div><div class="pcol" id="pileDrop">' + pileBtn + '<div class="lb">DÉFAUSSE</div></div></div>' +
      '<div class="msg" aria-live="polite">' + evMsg(g) + '</div>' + lastTurn +
      '<div class="hwrap"><div class="hand" style="--n:' + list.length + ';--step:' + (list.length <= 6 ? 6 : list.length <= 9 ? 4.4 : 3.3) + ';--ov:' + (list.length <= 6 ? '.5em' : list.length <= 9 ? '-1.6em' : '-3.1em') + ';--ovm:' + (list.length <= 6 ? '-1em' : list.length <= 9 ? '-2.6em' : '-3.7em') + '" aria-label="Votre main">' + hand + '</div></div>' +
      '<div class="hint" aria-live="polite">' + hint + '</div>' +
      '<div class="acts"><button class="btn btn-s" data-a="sort" style="min-height:44px">Trier : ' + ({ perso: 'mon ordre', valeur: 'par valeur', maison: 'par maison' })[sortMode] + '</button><button class="btn btn-s" data-a="left" style="min-height:44px" ' + (selOk ? '' : 'disabled') + ' aria-label="Déplacer la carte à gauche">◀</button><button class="btn btn-s" data-a="right" style="min-height:44px" ' + (selOk ? '' : 'disabled') + ' aria-label="Déplacer la carte à droite">▶</button>' +
      '<button class="btn btn-p" data-a="discard" ' + (canDiscard ? '' : 'disabled') + '>Défausser</button><button class="btn btn-p" data-a="close" ' + (canClose ? '' : 'disabled') + '>Clore la manche</button></div>' +
      '</div><aside class="side"><section class="panel" aria-labelledby="ts"><h2 id="ts" style="font-size:18px;margin-bottom:8px">Scores</h2><table class="score"><tbody>' + score + '</tbody></table></section><section class="panel" aria-labelledby="tl"><h2 id="tl" style="font-size:18px">Journal</h2><ul class="log">' + log + '</ul></section></aside></div>' +
      (g.state !== 'play' ? renderResults(g) : '') + modalHTML();
  }
  function renderResults(g) {
    const fin = g.state === 'final';
    const key = g.round + (fin ? 'f' : '');
    const animate = !countDone[key];
    const list = S.players.filter(p => g.results[p.id]).sort((a, b) => fin ? a.total - b.total : g.results[a.id].pts - g.results[b.id].pts);
    const minPts = Math.min.apply(null, list.map(p => g.results[p.id].pts));
    const best = list[0];
    const rows = list.map((p, i) => {
      const r = g.results[p.id], from = p.total - r.pts;
      const groups = r.groups.map(gr => '<div class="g">' + gr.map(c => cardHTML(c, {})).join('') + '</div>').join('') + (r.rest.length ? '<div class="g rest" title="Cartes non rangées">' + r.rest.map(c => cardHTML(c, {})).join('') + '</div>' : '');
      return '<li class="' + (p.id === S.you ? 'me' : '') + '"><div class="hd"><span class="nm">' + (fin ? (i + 1) + '. ' : '') + esc(p.name) + (p.bot ? '<span class="bot">BOT</span>' : '') + (g.closer === p.id ? ' <span class="dim" style="font-size:16px">· a clôturé</span>' : '') + '</span><span class="add" ' + (animate ? 'data-count="0" data-to="' + r.pts + '" data-pre="+"' : '') + '>+' + (animate ? 0 : r.pts) + '</span><span class="tot" ' + (animate ? 'data-count="' + from + '" data-to="' + p.total + '"' : '') + '>' + (animate ? from : p.total) + '</span></div><div class="grp">' + groups + '</div></li>';
    }).join('');
    const nr = g.nextReady || {}, waiting = S.players.filter(p => !p.bot && p.connected && !nr[p.id]).map(p => p.name);
    let foot;
    if (fin) foot = (S.host === S.you ? '<button class="btn btn-p" data-a="rematch">Nouvelle partie (même salon)</button>' : '<span class="dim">En attente de l’hôte pour relancer…</span>') + '<button class="btn btn-s" data-a="abandon">Retour à l’accueil</button>';
    else foot = (nr[S.you] ? '<span class="dim">' + (waiting.length ? 'En attente de ' + esc(waiting.join(', ')) + '…' : 'Manche suivante…') + '</span>' : '<button class="btn btn-p" data-a="next">Manche suivante</button>');
    const title = fin ? 'Fin de la partie' : 'Manche ' + g.round + ' terminée';
    const sub = fin ? (best.id === S.you ? 'Bravo, vous remportez la partie !' : esc(best.name) + ' remporte la partie.') : (g.closer === S.you ? 'Vous avez clôturé la manche à 0 point.' : esc(pl(g.closer).name) + ' a clôturé la manche.');
    return '<div class="ov" role="dialog" aria-modal="true" aria-labelledby="ovt"><div class="box"><h2 id="ovt" style="font-size:30px">' + title + '</h2><p style="margin:4px 0 0;font-size:20px">' + sub + '</p><p class="dim" style="margin:6px 0 0;font-size:15px">Cartes rangées en combinaisons, puis cartes restantes (en rouge) qui comptent des points.</p><ol class="res" data-key="' + key + '">' + rows + '</ol><div class="row" style="justify-content:center">' + foot + '</div></div></div>';
  }
  function modalHTML() {
    if (!modal) return '';
    const inGame = S && S.status !== 'lobby';
    return '<div class="ov" role="dialog" aria-modal="true" aria-labelledby="qt" style="z-index:100;padding-top:160px"><div class="box" style="max-width:540px;text-align:center"><h2 id="qt" style="font-size:28px;margin-bottom:12px">Quitter la partie ?</h2><p style="margin:0 0 20px;font-size:19px">' + (inGame ? 'Si vous quittez provisoirement, la partie continue (un bot joue à votre place si vous êtes absent) et vous pourrez la reprendre depuis l’accueil.' : 'Vous pourrez revenir avec le code ou le lien.') + '</p><div class="row" style="justify-content:center"><button class="btn btn-p" data-a="stay">Continuer à jouer</button><a class="btn btn-s" href="index.html">Quitter et reprendre plus tard</a></div><p style="margin:18px 0 10px;color:var(--soft);font-size:17px">Ou quitter pour de bon :</p><button class="btn btn-s" data-a="abandon" style="min-height:44px">Abandonner la partie</button></div></div>';
  }

  /* ----------------------------------------------------------- actions */
  function afterRender() {
    document.querySelectorAll('[data-count]').forEach(el => {
      const from = +el.dataset.count, to = +el.dataset.to, pre = el.dataset.pre || '', t0 = performance.now(), dur = 900;
      const step = t => { const k = Math.min(1, (t - t0) / dur); el.textContent = pre + Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    const r = document.querySelector('.res[data-key]'); if (r) countDone[r.dataset.key] = true;
    const f = view.querySelector('[data-form]'); const inp = f && f.querySelector('input'); if (inp && !inp.dataset.f) { inp.dataset.f = 1; inp.focus(); }
  }
  function move(dir) {
    if (!sel) return;
    const cur = handList(S.game).map(c => c.id); const i = cur.indexOf(sel), j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    cur.splice(j, 0, cur.splice(i, 1)[0]); order = cur; sortMode = 'perso'; lastView = ''; render();
  }
  function leaveAndGo() { send({ t: 'leave' }); clearSession(); location.href = 'index.html'; }
  function act(a, d) {
    const g = S && S.game;
    switch (a) {
      case 'home': return;
      case 'takeover': kicked = false; lastView = ''; connect(); return;
      case 'sound': setMute(!S_mute()); lastView = ''; const el = $('#topbar'); el.dataset.h = ''; render(); return;
      case 'copyLink': return copy(location.origin + '/play.html?c=' + S.code, 'link');
      case 'copyCode': return copy(S.code, 'code');
      case 'quit': modal = true; lastView = ''; render(); return;
      case 'stay': modal = null; lastView = ''; render(); return;
      case 'abandon': return leaveAndGo();
      case 'ready': return send({ t: 'ready', value: true });
      case 'unready': return send({ t: 'ready', value: false });
      case 'addBot': return send({ t: 'addBot', level: 'Malin' });
      case 'removeBot': return send({ t: 'removeBot', pid: d.pid });
      case 'botLevel': return send({ t: 'botLevel', pid: d.pid, level: d.l });
      case 'max': return send({ t: 'setOpts', max: +d.v, time: S.opts.time });
      case 'time': return send({ t: 'setOpts', max: S.opts.max, time: +d.v });
      case 'next': return send({ t: 'next' });
      case 'rematch': return send({ t: 'rematch' });
      case 'drawDeck': sel = null; return send({ t: 'drawDeck' });
      case 'drawPile': sel = null; return send({ t: 'drawPile' });
      case 'pick': sel = sel === d.id ? null : d.id; lastView = ''; render(); return;
      case 'sort': sortMode = sortMode === 'perso' ? 'valeur' : sortMode === 'valeur' ? 'maison' : 'perso'; if (sortMode === 'perso') { /* garde l'ordre précédent */ } lastView = ''; render(); return;
      case 'left': return move(-1);
      case 'right': return move(1);
      case 'discard': if (sel) { const id = sel; sel = null; send({ t: 'discard', id }); } return;
      case 'close': if (sel) { const id = sel; sel = null; send({ t: 'close', id }); } return;
    }
  }
  function copy(txt, which) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt); } catch (e) {}
    if (which === 'code') copiedCode = true; else copied = true;
    lastView = ''; const t = $('#topbar'); if (t) t.dataset.h = ''; render();
    setTimeout(() => { copied = false; copiedCode = false; lastView = ''; const t2 = $('#topbar'); if (t2) t2.dataset.h = ''; render(); }, 1800);
  }
  view.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b || b.disabled) return; act(b.dataset.a, b.dataset); });
  $('#topbar').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b || b.disabled) return; if (b.dataset.a === 'home') return; act(b.dataset.a, b.dataset); });
  view.addEventListener('dblclick', e => {
    const c = e.target.closest('[data-card]'); if (!c || !S || !S.game) return;
    const g = S.game; if (g.state === 'play' && g.turn === S.you && g.phase === 'discard' && c.dataset.id !== g.lockId) { sel = null; send({ t: 'discard', id: c.dataset.id }); }
  });
  view.addEventListener('submit', e => {
    const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
    const nm = f.querySelector('input').value.trim(); if (!nm) return;
    try { localStorage.setItem('c5k-name', nm); } catch (x) {}
    askName = false; intent = { t: 'join', name: nm, code: wantCode }; lastView = ''; joinErr = ''; connect(); render();
  });
  // glisser-déposer
  view.addEventListener('dragstart', e => { const c = e.target.closest('[data-card]'); if (!c) return; dragId = c.dataset.id; c.classList.add('drag'); try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (x) {} });
  view.addEventListener('dragend', () => { dragId = null; lastView = ''; if (S) render(); });
  view.addEventListener('dragover', e => { if (dragId && (e.target.closest('[data-card]') || e.target.closest('#pileDrop'))) e.preventDefault(); });
  view.addEventListener('drop', e => {
    if (!dragId || !S || !S.game) return; const g = S.game;
    const pile = e.target.closest('#pileDrop');
    if (pile) { e.preventDefault(); if (g.state === 'play' && g.turn === S.you && g.phase === 'discard' && dragId !== g.lockId) { sel = null; send({ t: 'discard', id: dragId }); } dragId = null; return; }
    const t = e.target.closest('[data-card]'); if (!t || t.dataset.id === dragId) return; e.preventDefault();
    const cur = handList(g).map(c => c.id); const i = cur.indexOf(dragId), j = cur.indexOf(t.dataset.id);
    if (i < 0 || j < 0) return; cur.splice(j, 0, cur.splice(i, 1)[0]); order = cur; sortMode = 'perso'; dragId = null; lastView = ''; render();
  });
  view.addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('[data-card]'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); act('pick', c.dataset); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal) { modal = null; lastView = ''; render(); } });

  /* ------------------------------------------------------------- minuteries */
  function tickUI() {
    if (!S) return;
    if (S.cdEnd) {
      const n = Math.max(0, Math.ceil((S.cdEnd - now()) / 1000)); const el = $('#cdNum'); if (el) el.textContent = Math.max(1, n);
      if (n !== lastCdSec) { lastCdSec = n; if (n > 0) sfx('tick'); }
    } else lastCdSec = null;
    const g = S.game; const ring = $('#ring');
    if (g && g.deadline && g.state === 'play' && ring) {
      const left = Math.max(0, g.deadline - now());
      const rem = Math.ceil(left / 1000); const span = Math.max(1000, S.opts.time * 1000);
      ring.style.setProperty('--p', Math.min(360, (left / span) * 360) + 'deg');
      $('#ringTxt').textContent = rem;
      ring.classList.toggle('urgent', rem <= 10);
      if (g.turn === S.you && rem <= 10 && rem > 0 && rem !== lastTickSec) { lastTickSec = rem; sfx(rem <= 3 ? 'tickHi' : 'tick'); }
    } else lastTickSec = null;
  }
  setInterval(tickUI, 200);

  render();
  connect();
})();
