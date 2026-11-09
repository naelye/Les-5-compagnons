'use strict';
/* Les Cinq Compagnons : serveur (HTTP statique + WebSocket + parties).
   Aucune dépendance : Node 18+ suffit. Lancement : node server.js */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./public/game.js');

const PORT = process.env.PORT || 3000;
const SPEED = process.env.FAST ? 0.01 : 1; // FAST=1 : tests accélérés
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };

/* ------------------------------------------------------------------ HTTP */
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUB, url));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); res.end('403'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Page introuvable'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ------------------------------------------------------------ WebSocket */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(payload, op) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}
function makeConn(socket, onMsg, onClose) {
  let buf = Buffer.alloc(0), frags = [], fragOp = 0, closed = false;
  const conn = {
    alive: true,
    send(str) { if (!closed && socket.writable) socket.write(frame(Buffer.from(str, 'utf8'), 1)); },
    ping() { if (!closed && socket.writable) socket.write(frame(Buffer.alloc(0), 9)); },
    close() { if (!closed) { closed = true; try { socket.end(frame(Buffer.alloc(0), 8)); } catch (e) {} } }
  };
  const done = () => { if (closed && conn.dead) return; conn.dead = true; closed = true; onClose(); };
  socket.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = !!(b0 & 0x80), op = b0 & 15, masked = !!(b1 & 0x80);
      let len = b1 & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { socket.destroy(); return; }
      const mlen = masked ? 4 : 0;
      if (buf.length < off + mlen + len) return;
      let payload = Buffer.from(buf.slice(off + mlen, off + mlen + len));
      if (masked) { const m = buf.slice(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      buf = buf.slice(off + mlen + len);
      conn.alive = true;
      if (op === 8) { conn.close(); return; }
      if (op === 9) { if (socket.writable) socket.write(frame(payload, 10)); continue; }
      if (op === 10) continue;
      if (op !== 0) { frags = [payload]; fragOp = op; } else frags.push(payload);
      if (fin) {
        const msg = Buffer.concat(frags); frags = [];
        if (fragOp === 1) { try { onMsg(msg.toString('utf8')); } catch (e) { console.error('msg error', e); } }
      }
    }
  });
  socket.on('error', () => {});
  socket.on('close', done);
  socket.on('end', () => { try { socket.end(); } catch (e) {} });
  return conn;
}
server.on('upgrade', (req, socket) => {
  if ((req.url || '').split('?')[0] !== '/ws' || !req.headers['sec-websocket-key']) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const ctx = { room: null, player: null };
  const conn = makeConn(socket, raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m && typeof m === 'object') handle(conn, ctx, m);
  }, () => onDisconnect(conn, ctx));
  conns.add(conn);
});
const conns = new Set();
setInterval(() => { conns.forEach(c => { if (c.dead) conns.delete(c); else c.ping(); }); }, 25000);

/* ---------------------------------------------------------------- Salons */
const rooms = new Map();
const BOT_NAMES = ['Garance', 'Hugo', 'Inès', 'Léon', 'Maëlle', 'Aldric', 'Thibault'];
const LEVELS = ['Débutant', 'Malin', 'Rusé'];
const rid = n => crypto.randomBytes(n || 6).toString('hex');
function roomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) { let c = ''; for (let i = 0; i < 6; i++) c += A[crypto.randomInt(A.length)]; if (!rooms.has(c)) return c; }
}
function cleanName(s, fallback) { s = String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16); return s || fallback; }
function uniqueName(room, name) {
  let n = name, k = 2; const used = new Set(room.players.map(p => p.name));
  while (used.has(n)) n = name.slice(0, 13) + ' ' + (k++);
  return n;
}
function newPlayer(name, bot, level) { return { id: rid(6), token: rid(16), name, bot: !!bot, level: level || 'Malin', conn: null, ready: !!bot, total: 0, gone: false }; }
function humans(room) { return room.players.filter(p => !p.bot); }
function send(p, obj) { if (p.conn && !p.conn.dead) p.conn.send(JSON.stringify(obj)); }
function err(conn, msg) { conn.send(JSON.stringify({ t: 'error', msg })); }

function view(room, p) {
  const v = {
    code: room.code, you: p.id, host: room.hostId, status: room.status, opts: room.opts, cdEnd: room.cdEnd || null, now: Date.now(),
    players: room.players.map(q => ({ id: q.id, name: q.name, bot: q.bot, level: q.level, connected: q.bot || !!q.conn, ready: q.ready, total: q.total }))
  };
  const g = room.game;
  if (g) {
    v.game = {
      round: g.round, size: g.round + 2, wild: G.wildOf(g.round), seats: g.seats, turn: g.seats[g.turn], phase: g.phase, state: g.state,
      deadline: g.deadline, closer: g.closer, lastLeft: g.lastLeft, deckCount: g.deck.length, pileTop: g.pile[g.pile.length - 1] || null, pileCount: g.pile.length,
      hand: g.hands[p.id] || [], counts: Object.fromEntries(g.seats.map(id => [id, (g.hands[id] || []).length])),
      lockId: g.seats[g.turn] === p.id ? g.lockId : null, ev: g.ev, log: g.log.slice(-30), results: g.results, nextReady: g.nextReady
    };
  }
  return v;
}
function push(room) { room.players.forEach(p => { if (!p.bot && p.conn) send(p, { t: 'state', s: view(room, p) }); }); }

function handle(conn, ctx, m) {
  const t = m.t;
  if (t === 'hello') {
    const room = rooms.get(String(m.code || '').toUpperCase());
    const p = room && room.players.find(q => q.id === m.pid && q.token === m.token && !q.bot);
    if (!p) { conn.send(JSON.stringify({ t: 'gone' })); return; }
    if (p.conn && p.conn !== conn) { p.conn.send(JSON.stringify({ t: 'kicked' })); const old = p.conn; p.conn = null; old.close(); }
    p.conn = conn; ctx.room = room; ctx.player = p; room.lastActive = Date.now();
    if (room.status === 'lobby' && !room.players.find(q => q.id === room.hostId && q.conn)) room.hostId = p.id;
    conn.send(JSON.stringify({ t: 'joined', code: room.code, pid: p.id, token: p.token }));
    push(room);
    if (room.game && room.game.state === 'play' && curPlayer(room) === p) arm(room);
    return;
  }
  if (t === 'create' || t === 'join') {
    if (ctx.room) return;
    let room;
    if (t === 'create') {
      if (rooms.size > 300) return err(conn, 'Le serveur est plein, réessayez plus tard.');
      room = { code: roomCode(), hostId: null, players: [], opts: { max: m.solo ? 4 : 5, time: 60 }, status: 'lobby', game: null, cdEnd: null, cdTimer: null, lastActive: Date.now() };
      rooms.set(room.code, room);
    } else {
      room = rooms.get(String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
      if (!room) return err(conn, 'Code de partie introuvable.');
      if (room.status !== 'lobby') return err(conn, 'Cette partie a déjà commencé.');
      if (room.players.length >= room.opts.max) return err(conn, 'La partie est complète.');
    }
    const p = newPlayer(uniqueName(room, cleanName(m.name, 'Joueur')), false);
    p.conn = conn; room.players.push(p); if (!room.hostId) room.hostId = p.id;
    if (t === 'create' && m.solo) {
      ['Malin', 'Malin', 'Rusé'].forEach(lv => addBot(room, lv));
    }
    ctx.room = room; ctx.player = p;
    conn.send(JSON.stringify({ t: 'joined', code: room.code, pid: p.id, token: p.token }));
    checkCountdown(room); push(room); return;
  }
  const room = ctx.room, p = ctx.player;
  if (!room || !p) return;
  room.lastActive = Date.now();
  const isHost = room.hostId === p.id;
  if (room.status === 'lobby') {
    if (t === 'ready') { p.ready = !!m.value; checkCountdown(room); push(room); return; }
    if (t === 'setOpts' && isHost) {
      const max = Math.max(2, Math.min(7, parseInt(m.max, 10) || room.opts.max));
      if (max < room.players.length) return err(conn, 'Retirez d’abord des joueurs ou des bots.');
      const time = [0, 30, 60].includes(m.time) ? m.time : room.opts.time;
      room.opts = { max, time }; resetReady(room); push(room); return;
    }
    if (t === 'addBot' && isHost) {
      if (room.players.length >= room.opts.max) return err(conn, 'La partie est complète.');
      addBot(room, LEVELS.includes(m.level) ? m.level : 'Malin'); resetReady(room); push(room); return;
    }
    if (t === 'botLevel' && isHost) { const b = room.players.find(q => q.id === m.pid && q.bot); if (b && LEVELS.includes(m.level)) { b.level = m.level; push(room); } return; }
    if (t === 'removeBot' && isHost) { room.players = room.players.filter(q => !(q.id === m.pid && q.bot)); resetReady(room); push(room); return; }
    if (t === 'leave') { leaveLobby(room, p); ctx.room = null; ctx.player = null; return; }
    return;
  }
  // en partie
  const g = room.game; if (!g) return;
  if (t === 'drawDeck') return doDraw(room, p.id, 'deck', conn);
  if (t === 'drawPile') return doDraw(room, p.id, 'pile', conn);
  if (t === 'discard') return doDiscard(room, p.id, String(m.id), false, conn);
  if (t === 'close') return doDiscard(room, p.id, String(m.id), true, conn);
  if (t === 'next') { if (g.state === 'end') { g.nextReady[p.id] = true; checkNext(room); push(room); } return; }
  if (t === 'rematch' && isHost && g.state === 'final') return backToLobby(room);
  if (t === 'leave') { leaveGame(room, p); ctx.room = null; ctx.player = null; return; }
}

function addBot(room, level) {
  const used = new Set(room.players.map(p => p.name));
  const name = BOT_NAMES.find(n => !used.has(n)) || ('Bot ' + (room.players.length + 1));
  room.players.push(newPlayer(name, true, level));
}
function resetReady(room) { cancelCountdown(room); humans(room).forEach(p => { p.ready = false; }); }
function cancelCountdown(room) { if (room.cdTimer) clearTimeout(room.cdTimer); room.cdTimer = null; room.cdEnd = null; }
function checkCountdown(room) {
  if (room.status !== 'lobby') return;
  const hs = humans(room);
  const ok = room.players.length >= 2 && hs.length >= 1 && hs.every(p => p.ready && p.conn);
  if (ok && !room.cdTimer) {
    room.cdEnd = Date.now() + 5000;
    room.cdTimer = setTimeout(() => { room.cdTimer = null; room.cdEnd = null; startGame(room); }, 5000 * SPEED);
  } else if (!ok && room.cdTimer) cancelCountdown(room);
}
function leaveLobby(room, p) {
  room.players = room.players.filter(q => q !== p);
  if (!humans(room).length) { destroyRoom(room); return; }
  if (room.hostId === p.id) room.hostId = (humans(room).find(q => q.conn) || humans(room)[0]).id;
  checkCountdown(room); push(room);
}
function destroyRoom(room) {
  cancelCountdown(room);
  if (room.game) clearTimers(room.game);
  rooms.delete(room.code);
}
function backToLobby(room) {
  if (room.game) clearTimers(room.game);
  room.game = null; room.status = 'lobby'; cancelCountdown(room);
  room.players.forEach(p => { p.total = 0; p.ready = p.bot; });
  push(room);
}
function onDisconnect(conn, ctx) {
  const room = ctx.room, p = ctx.player;
  if (!room || !p || p.conn !== conn) return;
  p.conn = null;
  if (room.status === 'lobby') {
    p.ready = false;
    if (room.hostId === p.id) { const n = humans(room).find(q => q.conn); if (n) room.hostId = n.id; }
    checkCountdown(room);
  }
  push(room);
  if (room.game && room.game.state === 'play' && curPlayer(room) === p) arm(room);
}

/* ------------------------------------------------------------------ Jeu */
function startGame(room) {
  room.status = 'playing';
  room.players.forEach(p => { p.total = 0; });
  room.game = { round: 0, seats: room.players.map(p => p.id), hands: {}, deck: [], pile: [], turn: 0, phase: 'draw', closer: null, lastLeft: 0, state: 'play', deadline: null, lockId: null, ev: { seq: 0 }, log: [], results: null, nextReady: {}, timers: [], armId: 0 };
  startRound(room, 1);
}
function L(room, text) { room.game.log.push({ t: Date.now(), text }); }
function nameOf(room, id) { const p = room.players.find(q => q.id === id); return p ? p.name : '?'; }
function startRound(room, r) {
  const g = room.game; clearTimers(g);
  g.round = r; g.deck = G.shuffle(G.newDeck()); g.hands = {};
  g.seats.forEach(id => { g.hands[id] = g.deck.splice(0, r + 2); });
  g.pile = [g.deck.pop()];
  g.turn = (r - 1) % g.seats.length; g.phase = 'draw'; g.closer = null; g.lastLeft = 0; g.state = 'play'; g.results = null; g.lockId = null; g.nextReady = {};
  g.ev = { seq: g.ev.seq + 1, kind: 'deal', round: r };
  L(room, 'Manche ' + r + ' : ' + (r + 2) + ' cartes chacun. Atout : ' + (G.FIG[G.wildOf(r)] ? G.FIG[G.wildOf(r)] + 's' : G.wildOf(r)) + ' et Jokers.');
  push(room); arm(room);
}
function clearTimers(g) { (g.timers || []).forEach(clearTimeout); g.timers = []; g.armId++; }
function curPlayer(room) { const g = room.game; return room.players.find(p => p.id === g.seats[g.turn]); }
function arm(room) {
  const g = room.game; if (!g || g.state !== 'play') return;
  clearTimers(g);
  const id = g.armId, p = curPlayer(room);
  const at = (ms, fn) => g.timers.push(setTimeout(() => { if (g.armId === id && rooms.get(room.code) === room) fn(); }, ms * SPEED));
  const wild = G.wildOf(g.round);
  const auto = (level, fast) => {
    const think = fast ? 700 : 1300 + Math.random() * 1000;
    at(think, () => {
      const hand = g.hands[p.id], top = g.pile[g.pile.length - 1];
      const src = G.botDraw(hand, top, wild, level);
      doDraw(room, p.id, src === 'pile' ? 'pile' : 'deck', null);
      at(fast ? 700 : 1500 + Math.random() * 1000, () => {
        const d = G.botDiscard(g.hands[p.id], wild, level, g.lockId);
        doDiscard(room, p.id, d.id, d.close && g.closer === null, null);
      });
    });
  };
  if (p.bot) { g.deadline = null; auto(p.level, false); push(room); return; }
  if (!p.conn) { g.deadline = null; at(12000, () => { if (p.conn) return; L(room, p.name + ' est hors ligne : un bot joue à sa place.'); auto('Malin', true); push(room); }); push(room); return; }
  if (room.opts.time > 0) {
    g.deadline = Date.now() + room.opts.time * 1000;
    at(room.opts.time * 1000, () => timeout(room));
  } else g.deadline = null;
  push(room);
}
function timeout(room) {
  const g = room.game, p = curPlayer(room); if (!g || g.state !== 'play') return;
  const id = g.armId;
  L(room, 'Temps écoulé pour ' + p.name + '.');
  if (g.phase === 'draw') {
    doDraw(room, p.id, 'deck', null, true);
    g.deadline = Date.now() + 4000; push(room);
    g.timers.push(setTimeout(() => { if (g.armId === id) timeoutDiscard(room); }, 4000));
  } else timeoutDiscard(room);
}
function timeoutDiscard(room) {
  const g = room.game, p = curPlayer(room); if (!g || g.state !== 'play' || g.phase !== 'discard') return;
  const hand = g.hands[p.id], wild = G.wildOf(g.round);
  const pool = hand.filter(c => c.id !== g.lockId);
  const c = pool.sort((a, b) => G.points(b, wild) - G.points(a, wild))[0] || hand[hand.length - 1];
  doDiscard(room, p.id, c.id, false, null);
}
function refill(g) {
  if (g.deck.length) return;
  const top = g.pile.pop();
  g.deck = G.shuffle(g.pile); g.pile = [top];
}
function doDraw(room, pid, src, conn, silent) {
  const g = room.game;
  if (!g || g.state !== 'play' || g.seats[g.turn] !== pid || g.phase !== 'draw') return conn && err(conn, 'Ce n’est pas le moment de piocher.');
  refill(g);
  let card;
  if (src === 'pile') { if (!g.pile.length) return; card = g.pile.pop(); g.lockId = card.id; }
  else { if (!g.deck.length) return; card = g.deck.pop(); g.lockId = null; }
  g.hands[pid].push(card); g.phase = 'discard';
  g.ev = { seq: g.ev.seq + 1, kind: src === 'pile' ? 'drawPile' : 'drawDeck', pid, card: src === 'pile' ? card : null };
  L(room, nameOf(room, pid) + (src === 'pile' ? ' a pris ' + G.label(card) + ' sur la défausse.' : ' a pioché.'));
  if (!silent) push(room);
}
function doDiscard(room, pid, cardId, close, conn) {
  const g = room.game;
  if (!g || g.state !== 'play' || g.seats[g.turn] !== pid || g.phase !== 'discard') return conn && err(conn, 'Piochez d’abord une carte.');
  const hand = g.hands[pid], wild = G.wildOf(g.round);
  const i = hand.findIndex(c => c.id === cardId);
  if (i < 0) return conn && err(conn, 'Carte inconnue.');
  if (cardId === g.lockId && hand.length > 1) return conn && err(conn, 'Vous ne pouvez pas rejeter la carte que vous venez de prendre sur la défausse.');
  if (close) {
    if (g.closer !== null) return conn && err(conn, 'La manche est déjà close.');
    const rest = hand.filter((_, j) => j !== i);
    if (G.minLeft(rest, wild) !== 0) return conn && err(conn, 'Vos cartes ne forment pas toutes des combinaisons valides.');
  }
  const [card] = hand.splice(i, 1);
  g.pile.push(card); g.lockId = null;
  g.ev = { seq: g.ev.seq + 1, kind: close ? 'close' : 'discard', pid, card };
  if (close) { g.closer = pid; g.lastLeft = g.seats.length - 1; L(room, nameOf(room, pid) + ' clôture la manche avec ' + G.label(card) + ' ! Dernier tour pour les autres.'); }
  else {
    L(room, nameOf(room, pid) + ' a défaussé ' + G.label(card) + '.');
    if (g.closer !== null) g.lastLeft--;
  }
  if (g.closer !== null && g.lastLeft <= 0) { endRound(room); return; }
  g.turn = (g.turn + 1) % g.seats.length; g.phase = 'draw';
  arm(room);
}
function endRound(room) {
  const g = room.game; clearTimers(g);
  const wild = G.wildOf(g.round), res = {};
  g.seats.forEach(id => {
    const b = G.best(g.hands[id], wild);
    const pts = id === g.closer ? 0 : b.pts;
    res[id] = { pts, groups: b.groups, rest: id === g.closer ? [] : b.rest };
    const p = room.players.find(q => q.id === id); if (p) p.total += pts;
  });
  g.results = res; g.deadline = null;
  g.state = g.round >= 11 ? 'final' : 'end';
  g.nextReady = {}; room.players.forEach(p => { g.nextReady[p.id] = p.bot || !p.conn; });
  L(room, 'Manche ' + g.round + ' terminée.');
  g.ev = { seq: g.ev.seq + 1, kind: 'roundEnd' };
  push(room);
  if (g.state === 'end') { const id = g.armId; g.timers.push(setTimeout(() => { if (g.armId === id && g.state === 'end') startRound(room, g.round + 1); }, 40000 * SPEED)); checkNext(room); }
}
function checkNext(room) {
  const g = room.game; if (!g || g.state !== 'end') return;
  if (humans(room).every(p => !p.conn || g.nextReady[p.id])) startRound(room, g.round + 1);
}
function leaveGame(room, p) {
  p.bot = true; p.level = 'Malin'; p.conn = null; p.ready = true;
  if (!humans(room).length) { destroyRoom(room); return; }
  if (room.hostId === p.id) room.hostId = humans(room)[0].id;
  const g = room.game; L(room, p.name + ' a quitté la partie : un bot le remplace.');
  if (g.state === 'end') checkNext(room);
  push(room);
  if (g.state === 'play' && g.seats[g.turn] === p.id) arm(room);
}

/* ---------------------------------------------------------------- Ménage */
setInterval(() => {
  const now = Date.now();
  rooms.forEach(room => {
    const online = humans(room).some(p => p.conn);
    if (!online && now - room.lastActive > 30 * 60 * 1000) destroyRoom(room);
    else if (online) room.lastActive = now;
  });
}, 60000);

if (require.main === module) server.listen(PORT, () => console.log('Les Cinq Compagnons : http://localhost:' + PORT));
module.exports = { server, rooms };
