'use strict';
// Servidor do "Intruso": HTTP + Server-Sent Events, sem dependências.
// Estado em memória (dev-senior: para escalar além de 1 instância, mover salas para Redis/Firebase).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WORDS = require('./words');

const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'public', 'index.html');
const ROUNDS = 2;          // quantas dicas cada jogador dá por partida
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;
const MAX_ROOMS = 500;
const LOBBY_GRACE_MS = 20000;
const INTRO_MS = Number(process.env.INTRO_MS) || 6000;   // tempo do placar no início de cada rodada
const AVATAR_COUNT = 12;                                  // deve bater com a lista AVATARS de public/index.html
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVXZ';

const rooms = new Map();

// ---------- utilidades ----------
const newId = () => crypto.randomBytes(8).toString('hex');
const pick = (arr) => arr[crypto.randomInt(arr.length)];
const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (s) => clean(s, 60).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

// ---------- modelo ----------
// Personagem escolhido se estiver livre; senão o primeiro livre (MAX_PLAYERS < AVATAR_COUNT, sempre sobra um).
function pickAvatar(room, wanted) {
  const taken = new Set(room ? room.players.map((p) => p.avatar) : []);
  if (Number.isInteger(wanted) && wanted >= 0 && wanted < AVATAR_COUNT && !taken.has(wanted)) return wanted;
  return pick([...Array(AVATAR_COUNT).keys()].filter((i) => !taken.has(i)));
}

function makePlayer(name, avatar) {
  return { id: newId(), name, avatar, score: 0, res: null, timer: null };
}

function makeRoom(host) {
  return {
    code: newCode(), hostId: host.id, players: [host], phase: 'lobby', category: 'Todas', roundNo: 0,
    wordCategory: null, word: null, impostorId: null, order: [], turn: 0, introUntil: 0, introTimer: null,
    clues: [], votes: {}, chat: [], result: null, lastActive: Date.now(),
  };
}

const findPlayer = (room, pid) => room.players.find((p) => p.id === pid);
const connected = (room) => room.players.filter((p) => p.res);

// O que cada jogador pode ver. O impostor nunca recebe a palavra antes do resultado.
function view(room, pid) {
  const playing = room.phase !== 'lobby';
  const reveal = room.phase === 'result';
  const isImp = playing && pid === room.impostorId;
  const v = {
    code: room.code, you: pid, hostId: room.hostId, phase: room.phase,
    categories: ['Todas', ...Object.keys(WORDS)], category: room.category,
    minPlayers: MIN_PLAYERS, rounds: ROUNDS, roundNo: room.roundNo,
    players: room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score, online: !!p.res })),
  };
  if (!playing) return v;
  if (room.phase === 'intro') v.introMs = Math.max(0, room.introUntil - Date.now());
  v.role = isImp ? 'impostor' : 'crew';
  v.wordCategory = room.wordCategory;
  v.word = isImp && !reveal ? null : room.word;
  v.order = room.order;
  v.turn = room.turn;
  v.totalTurns = room.order.length * ROUNDS;
  v.clues = room.clues;
  v.chat = room.chat;
  v.voted = Object.keys(room.votes);        // quem já votou (sem revelar em quem)
  v.myVote = room.votes[pid] || null;
  if (room.phase === 'guess') v.accusedId = room.impostorId;
  if (reveal) { v.impostorId = room.impostorId; v.result = room.result; }
  return v;
}

function push(player, data) {
  if (player.res) player.res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const p of room.players) push(p, view(room, p.id));
}

// ---------- regras ----------
function startGame(room) {
  const cat = room.category === 'Todas' ? pick(Object.keys(WORDS)) : room.category;
  room.wordCategory = cat;
  room.word = pick(WORDS[cat]);
  room.impostorId = pick(room.players).id;
  room.order = shuffle(room.players.map((p) => p.id));
  room.turn = 0;
  room.clues = [];
  room.votes = {};
  room.chat = [];
  room.result = null;
  room.roundNo++;
  // Todos veem o placar por alguns segundos antes das dicas começarem.
  room.phase = 'intro';
  room.introUntil = Date.now() + INTRO_MS;
  clearTimeout(room.introTimer);
  room.introTimer = setTimeout(() => {
    if (rooms.get(room.code) !== room || room.phase !== 'intro') return;
    endIntro(room);
    advance(room);
    broadcast(room);
  }, INTRO_MS);
}

function endIntro(room) {
  clearTimeout(room.introTimer);
  room.phase = 'clues';
}

function finish(room, reason, guess) {
  const impostorWins = reason !== 'caught';
  const delta = {};
  for (const p of room.players) {
    delta[p.id] = impostorWins ? (p.id === room.impostorId ? 2 : 0) : (p.id === room.impostorId ? 0 : 1);
    p.score += delta[p.id];
  }
  room.result = { impostorWins, reason, guess: guess || null, votes: { ...room.votes }, delta };
  room.phase = 'result';
}

function tally(room) {
  const counts = {};
  for (const target of Object.values(room.votes)) counts[target] = (counts[target] || 0) + 1;
  const max = Math.max(...Object.values(counts));
  const top = Object.keys(counts).filter((id) => counts[id] === max);
  if (top.length === 1 && top[0] === room.impostorId) room.phase = 'guess';
  else finish(room, 'escaped');           // empate ou voto errado: o impostor escapa
}

// Avança fases automaticamente (pula jogadores offline, fecha votação, etc.).
function advance(room) {
  const total = room.order.length * ROUNDS;
  if (room.phase === 'clues') {
    while (room.turn < total && !findPlayer(room, room.order[room.turn % room.order.length]).res) {
      room.clues.push({ pid: room.order[room.turn % room.order.length], text: '—', round: Math.floor(room.turn / room.order.length) + 1 });
      room.turn++;
    }
    if (room.turn >= total) room.phase = 'vote';
  }
  if (room.phase === 'vote') {
    const online = connected(room);
    if (online.length && online.every((p) => room.votes[p.id])) tally(room);
  }
  if (room.phase === 'guess' && !findPlayer(room, room.impostorId).res) finish(room, 'caught');
}

function act(room, player, body) {
  switch (body.type) {
    case 'category': {
      if (room.phase !== 'lobby' || player.id !== room.hostId) fail('Só o anfitrião muda a categoria.');
      const c = clean(body.value, 30);
      if (c !== 'Todas' && !WORDS[c]) fail('Categoria inválida.');
      room.category = c;
      break;
    }
    case 'avatar': {
      if (room.phase !== 'lobby') fail('Só dá para trocar de personagem no lobby.');
      const a = body.value;
      if (!Number.isInteger(a) || a < 0 || a >= AVATAR_COUNT) fail('Personagem inválido.');
      if (room.players.some((p) => p !== player && p.avatar === a)) fail('Esse personagem já foi escolhido.');
      player.avatar = a;
      break;
    }
    case 'start':
      if (room.phase !== 'lobby' || player.id !== room.hostId) fail('Só o anfitrião inicia a partida.');
      if (room.players.length < MIN_PLAYERS) fail(`São necessários ${MIN_PLAYERS} jogadores.`);
      startGame(room);
      break;
    case 'skip':
      if (room.phase !== 'intro' || player.id !== room.hostId) fail('Só o anfitrião pula o placar.');
      endIntro(room);
      break;
    case 'clue': {
      if (room.phase !== 'clues') fail('Não é hora de dar dicas.');
      if (room.order[room.turn % room.order.length] !== player.id) fail('Não é a sua vez.');
      const text = clean(body.text, 24);
      if (!text) fail('Escreva uma dica.');
      if (norm(text) === norm(room.word)) fail('Essa dica entrega a palavra!');
      room.clues.push({ pid: player.id, text, round: Math.floor(room.turn / room.order.length) + 1 });
      room.turn++;
      break;
    }
    case 'chat': {
      if (room.phase !== 'vote') fail('O chat abre na votação.');
      const text = clean(body.text, 120);
      if (!text) fail('Mensagem vazia.');
      room.chat.push({ pid: player.id, text });
      if (room.chat.length > 60) room.chat.shift();
      break;
    }
    case 'vote': {
      if (room.phase !== 'vote') fail('Não é hora de votar.');
      if (body.target === player.id || !findPlayer(room, body.target)) fail('Voto inválido.');
      room.votes[player.id] = body.target;
      break;
    }
    case 'guess': {
      if (room.phase !== 'guess' || player.id !== room.impostorId) fail('Você não pode palpitar agora.');
      const guess = clean(body.text, 40);
      if (!guess) fail('Escreva um palpite.');
      finish(room, norm(guess) === norm(room.word) ? 'guessed' : 'caught', guess);
      break;
    }
    case 'again':
      if (room.phase !== 'result' || player.id !== room.hostId) fail('Só o anfitrião reinicia.');
      room.players = room.players.filter((p) => p.res);   // quem saiu não volta para a próxima
      room.phase = 'lobby';
      break;
    default:
      fail('Ação desconhecida.');
  }
  advance(room);
}

function removePlayer(room, player) {
  room.players = room.players.filter((p) => p !== player);
  if (!room.players.length) { rooms.delete(room.code); return; }
  if (room.hostId === player.id) room.hostId = (connected(room)[0] || room.players[0]).id;
  broadcast(room);
}

function onDisconnect(room, player) {
  if (room.phase === 'lobby') {
    player.timer = setTimeout(() => {
      if (!player.res && room.phase === 'lobby') removePlayer(room, player);   // se a partida já começou, o jogador fica
    }, LOBBY_GRACE_MS);
  } else {
    advance(room);
  }
  if (room.hostId === player.id && connected(room).length) room.hostId = connected(room)[0].id;
  broadcast(room);
}

// ---------- HTTP ----------
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2048) { reject(new GameError('Requisição grande demais.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { reject(new GameError('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function lookup(code, pid) {
  const room = rooms.get(String(code || '').toUpperCase());
  const player = room && findPlayer(room, pid);
  if (!player) fail('Sala não encontrada.');
  return { room, player };
}

function validName(room, raw) {
  const name = clean(raw, 14);
  if (!name) fail('Digite seu nome.');
  if (room && room.players.some((p) => norm(p.name) === norm(name))) fail('Esse nome já está na sala.');
  return name;
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const { room, player } = lookup(url.searchParams.get('code'), url.searchParams.get('pid'));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    clearTimeout(player.timer);
    if (player.res) player.res.end();           // substitui conexão antiga (ex.: aba duplicada)
    player.res = res;
    const beat = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(beat);
      if (player.res === res) { player.res = null; if (rooms.has(room.code)) onDisconnect(room, player); }
    });
    broadcast(room);
    return;
  }
  if (req.method !== 'POST') fail('Método não permitido.');
  const body = await readJson(req);

  if (url.pathname === '/api/create') {
    if (rooms.size >= MAX_ROOMS) fail('Servidor cheio, tente em instantes.');
    const player = makePlayer(validName(null, body.name), pickAvatar(null, body.avatar));
    const room = makeRoom(player);
    if (!room.code) fail('Não foi possível criar a sala.');
    rooms.set(room.code, room);
    return send(res, 200, { code: room.code, pid: player.id });
  }
  if (url.pathname === '/api/join') {
    const room = rooms.get(clean(body.code, 4).toUpperCase());
    if (!room) fail('Sala não encontrada.');
    if (room.phase !== 'lobby') fail('A partida já começou. Aguarde a próxima rodada.');
    if (room.players.length >= MAX_PLAYERS) fail('Sala cheia.');
    const player = makePlayer(validName(room, body.name), pickAvatar(room, body.avatar));
    room.players.push(player);
    broadcast(room);
    return send(res, 200, { code: room.code, pid: player.id });
  }
  if (url.pathname === '/api/act') {
    const { room, player } = lookup(body.code, body.pid);
    act(room, player, body);
    broadcast(room);
    return send(res, 200, { ok: true });
  }
  fail('Rota inexistente.');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      if (!(e instanceof GameError)) console.error(e);
      if (!res.headersSent) send(res, e instanceof GameError ? (e.message === 'Sala não encontrada.' ? 404 : 400) : 500,
        { error: e instanceof GameError ? e.message : 'Erro interno.' });
    });
    return;
  }
  if (url.pathname === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html não encontrado'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('Não encontrado');
});

// Remove salas abandonadas.
setInterval(() => {
  for (const [code, room] of rooms) {
    if (!connected(room).length && Date.now() - room.lastActive > 30 * 60 * 1000) rooms.delete(code);
  }
}, 5 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Intruso rodando em http://localhost:${PORT}`));
}
module.exports = { server };
