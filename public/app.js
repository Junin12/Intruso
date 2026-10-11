'use strict';
// Interface do Intruso. Depende de util.js, avatars.js, profile.js, sound.js, qr.js e share.js (carregados antes).

// ---------- estado ----------
const view = document.getElementById('view');
const toastEl = document.getElementById('toast');
const connEl = document.getElementById('conn');
let session = null;     // { code, pid }
let state = null;       // última visão enviada pelo servidor
let es = null;
let myAvatar = Number(ls.get('intruso-avatar'));
if (!Number.isInteger(myAvatar) || myAvatar < 0 || myAvatar >= AVATARS.length) myAvatar = 0;
let secretShown = false;   // o papel fica escondido até a pessoa tocar
let pickerOpen = false, showQR = false, showTimes = false, tab = 'home';
let introDur = 6000;
let lastChat = 0, lastReact = 0;
let focusClue = false;
let toastTimer = null;
let deadlineAt = 0, deadlineTotal = 0, tkey = '';
let rv = null;             // sequência de revelação do resultado
let roundGain = null, matchGain = null;

try { session = JSON.parse(ls.get('intruso-sessao')); } catch { session = null; }

// ---------- perfil (fica no aparelho) ----------
let prof = Object.assign(Profile.blank(), (() => { try { return JSON.parse(ls.get('intruso-perfil')) || {}; } catch { return {}; } })());
Profile.touch(prof);
const saveProf = () => ls.set('intruso-perfil', JSON.stringify(prof));
saveProf();
if (!Profile.unlocked(prof, myAvatar)) myAvatar = 0;

const P = (id) => state.players.find((p) => p.id === id) || { id, name: '?', avatar: 0, score: 0 };
const isHost = () => state.hostId === state.you;
const isMyTurn = (s) => !!s && s.phase === 'clues' && s.role !== 'spectator' && s.order[s.turn % s.order.length] === s.you;
const nz = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const fmtSecs = (n) => (n ? `${n}s` : 'Sem limite');
const baseUrl = () => location.origin + location.pathname;
const roomUrl = () => `${baseUrl()}?sala=${state.code}`;

function toast(msg, ok) {
  toastEl.textContent = msg;
  toastEl.className = ok ? 'ok' : '';
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

async function api(path, body) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Algo deu errado.');
    return j;
  } catch (e) {
    toast(e instanceof TypeError ? 'Sem conexão com o servidor.' : e.message);
    throw e;
  }
}

const act = (type, extra) => api('/api/act', { code: session.code, pid: session.pid, type, ...extra }).catch(() => {});

function connect() {
  if (es) es.close();
  es = new EventSource(`/api/events?code=${encodeURIComponent(session.code)}&pid=${encodeURIComponent(session.pid)}`);
  es.onopen = () => { connEl.hidden = true; };
  es.onmessage = (e) => {
    const prev = state;
    state = JSON.parse(e.data);
    onState(prev, state);
    render();
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {   // o servidor recusou: a sala não existe mais
      leave(); toast('Essa sala foi encerrada.');
    } else {
      connEl.hidden = false;
    }
  };
}

function leave() {
  if (es) es.close();
  clearTimeout(rv && rv.timer); rv = null;
  ls.del('intruso-sessao');
  session = null; state = null; tab = 'home';
  history.replaceState(null, '', location.pathname);
  render();
}

// ---------- reações do estado ----------
function onState(prev, s) {
  const phaseChanged = !prev || prev.phase !== s.phase || prev.matchRound !== s.matchRound;
  if (phaseChanged) {
    window.scrollTo(0, 0);
    secretShown = false; pickerOpen = false; lastChat = 0; showTimes = false; showQR = false;
    lastReact = Math.max(0, ...(s.reactions || []).map((r) => r.id));
    clearTimeout(rv && rv.timer); rv = null;
    if (s.phase === 'intro') { introDur = s.leftMs; Snd.pop(); }
    if (s.phase === 'guess') Snd.drum();
    if (s.phase === 'result') startReveal(s);
    if (s.phase === 'final') onFinal(s);
  }
  const k = `${s.matchRound}|${s.phase}|${s.turn}`;
  deadlineAt = s.leftMs ? Date.now() + s.leftMs : 0;
  if (k !== tkey) { tkey = k; deadlineTotal = s.leftMs; }
  if (isMyTurn(s) && !isMyTurn(prev)) { focusClue = true; Snd.turn(); }
  // reações novas (só as que chegaram agora)
  if (prev && s.reactions) {
    for (const r of s.reactions) if (r.id > lastReact) { lastReact = r.id; floatReaction(s, r); }
  }
}

function burst() {
  const fx = document.getElementById('fx');
  const colors = ['#FFD23F', '#FF5A5F', '#1FC98D', '#7CC6FF', '#FFFFFF'];
  for (let i = 0; i < 36; i++) {
    fx.append(h('i', { style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};--t:${2.2 + Math.random() * 1.6}s;--r:${Math.round(Math.random() * 720 - 360)}deg;animation-delay:${Math.random() * .5}s` }));
  }
  setTimeout(() => fx.replaceChildren(), 4500);
}

function floatReaction(s, r) {
  const p = s.players.find((x) => x.id === r.pid);
  const el = h('div', { class: 'floaty', style: `left:${8 + Math.random() * 76}%` }, h('span', {}, r.emoji), p ? av(p.avatar, 28) : null);
  document.getElementById('fx').append(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- revelação do resultado ----------
function startReveal(s) {
  const n = Object.keys(s.result.votes).length;
  rv = { stage: 0, n, timer: null, done: false };
  roundGain = s.role === 'spectator' ? null : creditRound(s);
  rv.timer = setTimeout(stepReveal, 900);
  Snd.unlock();
}

function stepReveal() {
  if (!rv || rv.done || !state || state.phase !== 'result') return;
  rv.stage++;
  const { n } = rv;
  if (rv.stage <= n) { Snd.tick(rv.stage); rv.timer = setTimeout(stepReveal, 1000); }
  else if (rv.stage === n + 1) { Snd.drum(); rv.timer = setTimeout(stepReveal, 2300); }
  else finishReveal();
  render();
}

function finishReveal() {
  if (!rv || rv.done) return;
  clearTimeout(rv.timer);
  rv.done = true; rv.stage = rv.n + 2;
  const s = state, wasImp = s.impostorIds.includes(s.you);
  const iWon = s.role !== 'spectator' && s.result.impostorWins === wasImp;
  if (s.role === 'spectator') Snd.pop();
  else if (iWon) { Snd.win(); burst(); } else Snd.lose();
  if (roundGain && roundGain.levelUp) setTimeout(() => Snd.fanfare(), 900);
}

function creditRound(s) {
  const key = `${s.code}|${s.matchRound}`;
  if (ls.get('intruso-ult') === key) return null;       // já contado (reconexão)
  ls.set('intruso-ult', key);
  const r = s.result, wasImp = s.impostorIds.includes(s.you);
  const g = Profile.onRound(prof, {
    won: r.impostorWins === wasImp, wasImp, duo: s.impostorCount === 2,
    votedRight: !!r.votes[s.you] && s.impostorIds.includes(r.votes[s.you]), guessed: wasImp && r.reason === 'guessed',
  });
  saveProf();
  return g;
}

function onFinal(s) {
  const me = s.players.find((p) => p.id === s.you);
  const rows = rankingOf(s);
  const champion = rows.length && rows[0].p.score > 0 && me && me.score === rows[0].p.score;
  if (champion) { Snd.fanfare(); burst(); } else Snd.pop();
  matchGain = null;
  if (me && !me.waiting) {
    const key = `${s.code}|final|${s.players.map((p) => p.score).join(',')}|${JSON.stringify(s.awards)}`;
    if (ls.get('intruso-ultf') !== key) {
      ls.set('intruso-ultf', key);
      matchGain = Profile.onMatch(prof, { champion: !!champion });
      saveProf();
    }
  }
}

// ---------- tempo ----------
function timerBar(label) {
  if (!deadlineAt) return null;
  const left = Math.max(0, deadlineAt - Date.now());
  const pct = deadlineTotal ? Math.min(100, left / deadlineTotal * 100) : 0;
  return h('div', { class: 'tmr' + (left <= 5000 ? ' hot' : ''), 'data-end': deadlineAt, 'data-total': deadlineTotal, role: 'timer', 'aria-label': label },
    h('span', { class: 'tbar' }, h('i', { style: `width:${pct}%` })), h('b', {}, Math.ceil(left / 1000)));
}

let lastSec = -1;
setInterval(() => {
  const t = document.querySelector('.tmr');
  if (!t || !state) return;
  const end = Number(t.dataset.end), total = Number(t.dataset.total);
  const left = Math.max(0, end - Date.now());
  t.querySelector('i').style.width = (total ? Math.min(100, left / total * 100) : 0) + '%';
  const sec = Math.ceil(left / 1000);
  t.querySelector('b').textContent = sec;
  t.classList.toggle('hot', left <= 5000);
  if (sec !== lastSec) { lastSec = sec; if (sec <= 3 && sec > 0 && (isMyTurn(state) || state.phase === 'vote')) Snd.low(); }
}, 200);

// ---------- peças de tela ----------
function rankingOf(s) {
  const rows = s.players.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0, prev = null;
  return rows.map((p) => { if (p.score !== prev) rank++; prev = p.score; return { p, rank }; });
}
const ranking = () => rankingOf(state);

function scoreRows(delta) {
  const rows = ranking();
  const max = Math.max(1, ...rows.map((r) => r.p.score));
  const allZero = rows.every((r) => r.p.score === 0);   // sem pontos ainda: ninguém está "em primeiro"
  return h('ol', { class: 'rows' }, rows.map(({ p, rank }, i) => {
    const d = delta ? delta[p.id] : 0;
    return h('li', { class: 'row' + (rank === 1 && p.score > 0 ? ' first' : ''), style: `--i:${i}`, 'data-key': p.id },
      h('span', { class: 'rank' }, allZero ? '' : rank),
      av(p.avatar, 48),
      h('div', { class: 'rname' },
        h('span', { class: 'nm' }, p.name + (p.id === state.you ? ' (você)' : '') + (p.waiting ? ' · assistindo' : '')),
        h('span', { class: 'bar' }, h('i', { style: `--w:${p.score ? Math.max(8, p.score / max * 100) : 0}%` }))),
      h('b', { class: 'pts' }, d > 0 ? h('span', { class: 'delta' }, '+' + d) : null, p.score));
  }));
}

function avatarGrid(action, selected, taken) {
  return h('div', { class: 'avgrid', role: 'group', 'aria-label': 'Personagens' },
    AVATARS.map((a, i) => {
      const locked = !Profile.unlocked(prof, i);
      return h('button', { type: 'button', class: 'avbtn' + (locked ? ' locked' : ''), 'data-act': action, 'data-i': i,
        'aria-pressed': String(i === selected), 'aria-label': a.name + (locked ? ' (bloqueado)' : ''), disabled: taken.has(i), 'data-key': 'a' + i },
      av(i, 0), locked ? h('span', { class: 'lockbadge' }, icon('lock')) : null);
    }));
}

function xpBar() {
  const li = Profile.levelInfo(prof.xp);
  return h('div', { class: 'xp' },
    h('div', { class: 'xpline' }, h('b', {}, `Nível ${li.level}`), h('span', {}, li.title), h('small', {}, `${li.into}/${li.need} XP`)),
    h('span', { class: 'bar' }, h('i', { style: `--w:${Math.max(4, li.into / li.need * 100)}%` })));
}

function dailyCard() {
  Profile.touch(prof);
  const d = prof.daily, def = Profile.DAILY.find((x) => x.id === d.id);
  return h('div', { class: 'daily' + (d.done ? ' done' : '') },
    h('div', {}, h('small', {}, 'Desafio do dia · +' + Profile.XP.daily + ' XP'), h('b', {}, def.text)),
    d.done ? h('span', { class: 'okmark' }, icon('check'))
      : h('span', { class: 'prog' }, `${Math.min(d.prog, def.goal)}/${def.goal}`));
}

function settingRow(label, key, values, current, fmt, editable) {
  return h('div', { class: 'setrow', 'data-key': 's' + key },
    h('p', { class: 'setlbl' }, label),
    h('div', { class: 'chips' }, values.map((v) => h('button', { type: 'button', class: 'chip', 'data-act': 'setting', 'data-k': key, 'data-v': v,
      'aria-pressed': String(v === current), disabled: !editable, 'data-key': key + v }, fmt(v)))));
}

function settingsPanel(withTotal) {
  const s = state, ed = isHost(), o = s.options;
  return h('div', { class: 'stack' },
    withTotal ? settingRow('Tamanho da partida', 'total', o.total, s.settings.total, (v) => `${v} rodadas`, ed) : null,
    settingRow('Tempo para dar a dica', 'clueSecs', o.clueSecs, s.settings.clueSecs, fmtSecs, ed),
    settingRow('Tempo para votar', 'voteSecs', o.voteSecs, s.settings.voteSecs, fmtSecs, ed),
    ed ? null : h('p', { class: 'sub dark' }, `Só ${P(s.hostId).name} muda esses ajustes.`));
}

function reactionBar() {
  return h('div', { class: 'reacts', role: 'group', 'aria-label': 'Reações' },
    state.emojis.map((e) => h('button', { type: 'button', class: 'react', 'data-act': 'react', 'data-e': e, 'aria-label': 'Reagir ' + e, 'data-key': e }, e)));
}

function spectatorNote() {
  return state.role === 'spectator'
    ? h('div', { class: 'panel note', role: 'status' }, h('b', {}, 'Você entrou com a rodada em andamento.'), h('p', {}, 'Assista por aqui: você joga a partir da próxima rodada.'))
    : null;
}

function ipLabel(n) { return n === 2 ? 'Há 2 intrusos nesta rodada' : 'Há 1 intruso nesta rodada'; }

// ---------- telas ----------
function homeScreen() {
  const nameIn = h('input', { id: 'nome', maxlength: 14, autocomplete: 'nickname', placeholder: 'Como te chamam?' });
  nameIn.value = ls.get('intruso-nome') || '';
  const codeIn = h('input', { id: 'codigo', class: 'code-in', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off',
    placeholder: 'ABCD', 'aria-label': 'Código da sala' });
  codeIn.value = (new URLSearchParams(location.search).get('sala') || '').toUpperCase().slice(0, 4);
  const logo = h('span', { class: 'mark', 'data-static': 'mark' });
  logo.innerHTML = MARK;
  const li = Profile.levelInfo(prof.xp);
  return h('div', { class: 'screen home', 'data-screen': 'home' },
    h('div', { class: 'logo' }, logo, h('h1', {}, 'Intruso')),
    h('p', { class: 'lead' }, 'Todo mundo recebe a mesma palavra, menos um. Descubra quem está blefando.'),
    h('button', { type: 'button', class: 'panel mini', 'data-act': 'profile', 'aria-label': 'Abrir meu perfil' },
      av(myAvatar, 52), h('div', { class: 'grow' }, xpBar()), h('span', { class: 'chev' }, icon('user'))),
    h('section', { class: 'panel' },
      h('h2', {}, 'Escolha seu personagem'),
      avatarGrid('homeAvatar', myAvatar, new Set()),
      h('p', { class: 'hint' }, 'Os com cadeado liberam jogando. Toque para ver como.'),
      h('div', {}, h('label', { for: 'nome' }, 'Seu nome'), nameIn)),
    dailyCard(),
    h('button', { class: 'btn primary', type: 'button', 'data-act': 'create' }, 'Criar sala'),
    h('form', { class: 'form-row', 'data-form': 'join' }, codeIn, h('button', { class: 'btn', type: 'submit' }, 'Entrar')));
}

function profileScreen() {
  const li = Profile.levelInfo(prof.xp);
  const stat = (n, l) => h('div', { class: 'stat', 'data-key': l }, h('b', {}, n), h('small', {}, l));
  const doneCount = Profile.ACH.filter((a) => prof.ach[a.id]).length;
  return h('div', { class: 'screen profile', 'data-screen': 'profile' },
    h('button', { class: 'btn ghost back', type: 'button', 'data-act': 'home' }, icon('back'), 'Voltar'),
    h('section', { class: 'panel prof-head' }, av(myAvatar, 96), h('h2', {}, ls.get('intruso-nome') || 'Jogador'),
      h('p', { class: 'title-tag' }, li.title), xpBar()),
    h('section', { class: 'stats' },
      stat(prof.rounds, 'Rodadas'), stat(prof.wins, 'Vitórias'), stat(prof.impWins, 'Vitórias como intruso'),
      stat(prof.rightVotes, 'Votos certos'), stat(prof.bestStreak, 'Melhor sequência'), stat(prof.matchWins, 'Partidas ganhas')),
    dailyCard(),
    h('section', { class: 'panel' }, h('h2', {}, `Conquistas (${doneCount}/${Profile.ACH.length})`),
      h('ul', { class: 'achs' }, Profile.ACH.map((a) => h('li', { class: 'ach' + (prof.ach[a.id] ? ' on' : ''), 'data-key': a.id },
        h('span', { class: 'achic' }, prof.ach[a.id] ? icon('check') : icon('lock')),
        h('div', {}, h('b', {}, a.name), h('small', {}, a.desc)))))),
    h('section', { class: 'panel' }, h('h2', {}, 'Personagens exclusivos'),
      h('ul', { class: 'achs' }, Profile.UNLOCKS.map((u) => h('li', { class: 'ach' + (Profile.unlocked(prof, u.i) ? ' on' : ''), 'data-key': 'u' + u.i },
        av(u.i, 44), h('div', {}, h('b', {}, AVATARS[u.i].name), h('small', {}, Profile.unlocked(prof, u.i) ? 'Desbloqueado' : u.req)))))));
}

function lobbyScreen() {
  const s = state, me = P(s.you), host = isHost();
  const taken = new Set(s.players.filter((p) => p.id !== s.you).map((p) => p.avatar));
  const need = s.minPlayers - s.players.length;
  const link = roomUrl();
  return h('div', { class: 'screen lobby', 'data-screen': 'lobby' },
    h('section', { class: 'invite' },
      h('p', { class: 'sub' }, 'Chame a galera com este código'),
      h('div', { class: 'code', role: 'img', 'aria-label': 'Código ' + s.code.split('').join(' ') }, s.code.split('').map((c, i) => h('span', { 'data-key': 'c' + i }, c))),
      h('div', { class: 'two' },
        h('button', { class: 'btn', type: 'button', 'data-act': 'share' }, icon('share'), 'Convidar'),
        h('button', { class: 'btn', type: 'button', 'data-act': 'toggleQR', 'aria-expanded': String(showQR) }, 'QR code')),
      showQR ? qrPanel(link) : null),
    h('section', { class: 'stack' },
      h('h2', {}, `Na sala (${s.players.length} de 10)`),
      h('div', { class: 'tags' }, s.players.map((p) => {
        const inner = [av(p.avatar, 38), h('span', { class: 'nm' }, p.name), p.id === s.hostId ? icon('crown') : null, p.id === s.you ? icon('edit') : null];
        const cls = 'tag' + (p.id === s.you ? ' me' : '') + (p.online ? '' : ' off');
        return p.id === s.you
          ? h('button', { type: 'button', class: cls, 'data-act': 'togglePicker', 'data-key': p.id, 'aria-expanded': String(pickerOpen),
              'aria-label': 'Trocar meu personagem' }, inner)
          : h('div', { class: cls, 'data-key': p.id }, inner);
      })),
      s.players.length >= s.twoFrom ? h('p', { class: 'sub' }, 'Com 7 ou mais jogadores entram 2 intrusos.') : null,
      pickerOpen ? h('div', { class: 'panel flat' }, h('h2', {}, 'Trocar personagem'), avatarGrid('pickAvatar', me.avatar, taken)) : null),
    h('section', { class: 'stack' },
      h('h2', {}, 'Categoria'),
      h('div', { class: 'chips' }, s.categories.map((c) => h('button', { type: 'button', class: 'chip', 'data-act': 'category', 'data-v': c,
        'aria-pressed': String(c === s.category), disabled: !host, 'data-key': c }, c)))),
    h('section', { class: 'panel flat' }, h('h2', {}, 'Ajustes da partida'), settingsPanel(true)),
    host
      ? h('button', { class: 'btn primary', type: 'button', 'data-act': 'start', disabled: need > 0 },
          need > 0 ? `Faltam ${need} ${need === 1 ? 'jogador' : 'jogadores'}` : 'Começar partida')
      : h('p', { class: 'sub', style: 'text-align:center' }, `Aguardando ${P(s.hostId).name} começar a partida`));
}

function qrPanel(link) {
  const box = h('div', { class: 'qr', 'data-static': 'qr' + link });
  try { box.innerHTML = QR.svg(link); } catch { box.textContent = link; }
  return h('div', { class: 'panel flat qrbox' }, box, h('p', { class: 'hint' }, 'Aponte a câmera do celular para entrar na sala.'));
}

function introScreen() {
  const s = state;
  const zero = s.players.every((p) => p.score === 0);
  return h('div', { class: 'screen intro', 'data-screen': 'intro' },
    h('div', { class: 'hero' }, h('p', { class: 'sub' }, `Rodada ${s.matchRound} de ${s.settings.total}`), h('h1', {}, zero ? 'Todo mundo zerado' : 'Placar')),
    h('section', { class: 'panel' }, scoreRows(null)),
    h('p', { class: 'sub' }, `Categoria: ${s.wordCategory}. ${ipLabel(s.impostorCount)}. Em instantes você vê seu papel, em segredo.`),
    spectatorNote(),
    h('div', { class: 'count', 'aria-hidden': 'true' }, h('i', { style: `--dur:${introDur}ms` })),
    isHost() ? h('button', { class: 'btn ghost', type: 'button', 'data-act': 'skip' }, 'Começar agora') : null);
}

function roleCard() {
  const s = state, imp = s.role === 'impostor';
  if (s.role === 'spectator') return null;
  if (!secretShown) {
    return h('button', { type: 'button', class: 'role hid', 'data-act': 'toggleRole' },
      icon('eye'), h('span', { class: 'big' }, 'Ver meu papel'), h('span', { class: 'hint' }, 'Esconda a tela dos outros antes de tocar'));
  }
  const partner = imp && s.partnerIds && s.partnerIds.length ? `Seu parceiro: ${s.partnerIds.map((id) => P(id).name).join(', ')}` : null;
  return h('button', { type: 'button', class: 'role show ' + (imp ? 'imp' : 'crew'), 'data-act': 'toggleRole', 'aria-label': 'Esconder meu papel' },
    h('span', { class: 'hint' }, 'Categoria: ' + s.wordCategory),
    imp ? [h('span', { class: 'big' }, s.impostorCount === 2 ? 'Você é um dos 2 intrusos' : 'Você é o intruso'),
      h('span', { class: 'hint' }, partner || 'Descubra a palavra sem se entregar')]
      : [h('span', { class: 'hint' }, 'A palavra é'), h('span', { class: 'big' }, s.word)],
    h('span', { class: 'hint' }, 'Toque para esconder'));
}

function cluesScreen() {
  const s = state, n = s.order.length, idx = s.turn % n, cur = s.order[idx], mine = isMyTurn(s);
  const volta = Math.floor(s.turn / n) + 1;
  return h('div', { class: 'screen clues', 'data-screen': 'clues' },
    spectatorNote(),
    roleCard(),
    h('div', { class: 'strip', role: 'group', 'aria-label': 'Ordem das dicas' }, s.order.map((id, i) =>
      h('div', { class: 'sp' + (i === idx ? ' now' : i < idx ? ' done' : ''), 'data-key': id }, av(P(id).avatar, 42)))),
    h('div', { class: 'turn' + (mine ? ' mine' : ''), role: 'status' },
      mine ? 'Sua vez de dar uma dica' : `Vez de ${P(cur).name}`, h('small', {}, `Volta ${volta} de ${s.laps} · ${ipLabel(s.impostorCount)}`),
      timerBar('Tempo para a dica')),
    mine ? h('form', { class: 'panel', 'data-form': 'clue' },
      h('div', {}, h('label', { for: 'dica' }, 'Sua dica (uma palavra)'),
        h('input', { id: 'dica', maxlength: 24, autocomplete: 'off', placeholder: s.role === 'impostor' ? 'Disfarce bem' : 'Algo que lembre a palavra' })),
      h('button', { class: 'btn primary', type: 'submit' }, 'Enviar dica', icon('send'))) : null,
    s.clues.length ? h('div', { class: 'clues' }, s.clues.map((c, i) =>
      h('div', { class: 'bub', 'data-key': 'b' + i }, av(P(c.pid).avatar, 40), h('div', { class: 'txt' }, h('small', {}, P(c.pid).name), h('b', {}, c.text))))) : null);
}

function voteScreen() {
  const s = state, spec = s.role === 'spectator';
  const online = s.players.filter((p) => p.online && !p.waiting).length;
  const clueOf = (id) => s.clues.filter((c) => c.pid === id && c.text !== '—' && c.text !== '⏰').map((c) => c.text).join(', ');
  return h('div', { class: 'screen vote', 'data-screen': 'vote' },
    h('div', { class: 'hero' }, h('h1', {}, s.impostorCount === 2 ? 'Quem são os intrusos?' : 'Quem é o intruso?'),
      h('p', { class: 'sub' }, s.impostorCount === 2 ? 'São 2 intrusos: vote em quem você mais suspeita. Para vencer, a sala precisa pegar os dois.'
        : 'Conversem e votem. Dá para mudar o voto até todos votarem.'), timerBar('Tempo para votar')),
    spectatorNote(),
    roleCard(),
    reactionBar(),
    h('section', { class: 'panel' },
      h('h2', {}, 'Conversa'),
      h('div', { class: 'chat', 'aria-live': 'polite' }, s.chat.map((m, i) =>
        h('div', { class: 'msg', 'data-key': 'm' + i }, av(P(m.pid).avatar, 26), h('p', {}, h('b', {}, P(m.pid).name + ' '), m.text)))),
      spec ? null : h('form', { class: 'form-row', 'data-form': 'chat' },
        h('input', { id: 'msg', maxlength: 120, autocomplete: 'off', placeholder: 'Escreva algo', 'aria-label': 'Mensagem para o grupo' }),
        h('button', { class: 'btn', type: 'submit', 'aria-label': 'Enviar mensagem' }, icon('send')))),
    spec ? null : h('section', {},
      h('h2', {}, `Seu voto (${s.voted.length} de ${online} já votaram)`),
      h('div', { class: 'vgrid' }, s.players.filter((p) => p.id !== s.you && !p.waiting).map((p) =>
        h('button', { type: 'button', class: 'vcard', 'data-act': 'vote', 'data-id': p.id, 'aria-pressed': String(s.myVote === p.id), 'data-key': p.id },
          h('span', { class: 'tick' }, icon('check')), av(p.avatar, 64), h('span', { class: 'nm' }, p.name), h('small', {}, clueOf(p.id)))))));
}

function guessScreen() {
  const s = state, acc = s.accusedIds.map(P), imp = s.role === 'impostor', done = s.guessed.includes(s.you);
  const names = acc.map((a) => a.name).join(' e ');
  const faces = h('div', { class: 'faces' }, acc.map((a) => av(a.avatar, acc.length > 1 ? 96 : 120)));
  if (!imp || done) {
    return h('div', { class: 'screen guess', 'data-screen': 'guess' },
      h('section', { class: 'panel accused' }, faces, h('h2', {}, acc.length > 1 ? `${names} foram descobertos` : `${names} foi descoberto`),
        h('p', {}, imp ? 'Palpite enviado. Aguardando o parceiro.' : 'Ainda dá para virar o jogo: os intrusos têm uma chance de adivinhar a palavra.'), timerBar('Tempo do palpite')),
      reactionBar());
  }
  return h('div', { class: 'screen guess', 'data-screen': 'guess' },
    h('form', { class: 'panel accused', 'data-form': 'guess' },
      faces, h('h2', {}, acc.length > 1 ? 'Vocês foram descobertos' : 'Você foi descoberto'),
      h('p', {}, `A categoria é ${s.wordCategory}. Acerte a palavra secreta e vença mesmo assim.`), timerBar('Tempo do palpite'),
      h('div', { style: 'width:100%;text-align:left' }, h('label', { for: 'palpite' }, 'Seu palpite'),
        h('input', { id: 'palpite', maxlength: 40, autocomplete: 'off' })),
      h('button', { class: 'btn primary', type: 'submit' }, 'Chutar')));
}

function gainPanel(g, title) {
  if (!g) return null;
  return h('section', { class: 'panel gain' },
    h('h2', {}, title), h('p', { class: 'xpgain' }, `+${g.xp} XP`),
    g.levelUp ? h('p', { class: 'lvup' }, `Subiu para o nível ${g.levelUp} · ${Profile.levelInfo(prof.xp).title}`) : null,
    g.dailyDone ? h('p', { class: 'lvup' }, 'Desafio do dia completo!') : null,
    g.ach.length ? h('div', { class: 'chips' }, g.ach.map((a) => h('span', { class: 'fact ok', 'data-key': a.id }, 'Conquista: ' + a.name))) : null,
    g.avatars.length ? h('div', { class: 'unl' }, h('small', {}, 'Personagem liberado'), g.avatars.map((i) => h('span', { 'data-key': 'u' + i }, av(i, 56)))) : null);
}

function resultScreen() {
  const s = state, r = s.result, R = rv || { stage: 99, n: 0, done: true };
  const n = R.n, shown = Math.min(R.stage, n);
  const votes = Object.entries(r.votes);
  if (!R.done) {
    const counts = {};
    votes.slice(0, shown).forEach(([, t]) => { counts[t] = (counts[t] || 0) + 1; });
    const last = shown > 0 ? votes[shown - 1] : null;
    const suspense = R.stage > n;
    return h('div', { class: 'screen result', 'data-screen': 'result-count' },
      h('div', { class: 'hero' }, h('h1', {}, suspense ? 'O intruso é…' : 'Contando os votos'), h('p', { class: 'sub' }, `Rodada ${s.matchRound} de ${s.settings.total}`)),
      suspense ? h('div', { class: 'drum' }, s.impostorCount === 2 ? [h('span', { 'data-key': 'q1' }, '?'), h('span', { 'data-key': 'q2' }, '?')] : h('span', { 'data-key': 'q' }, '?'))
        : h('section', { class: 'panel' },
          h('div', { class: 'tally' }, s.players.filter((p) => !p.waiting).map((p) => h('div', { class: 'tcell' + (counts[p.id] ? ' has' : ''), 'data-key': p.id },
            av(p.avatar, 56), h('span', { class: 'nm' }, p.name), h('b', { class: 'cnt' }, counts[p.id] || 0)))),
          last ? h('p', { class: 'lastvote', 'data-key': 'lv' + shown }, h('b', {}, P(last[0]).name), ' votou em ', h('b', {}, P(last[1]).name)) : h('p', { class: 'lastvote' }, ' ')),
      h('button', { class: 'btn ghost', type: 'button', 'data-act': 'skipReveal' }, 'Pular suspense'));
  }
  const wasImp = s.impostorIds.includes(s.you), spec = s.role === 'spectator';
  const iWon = !spec && r.impostorWins === wasImp;
  const why = { escaped: s.impostorCount === 2 ? 'Os intrusos escaparam da votação.' : 'O intruso escapou da votação.',
    guessed: 'Descobertos, mas acertaram a palavra.', caught: s.impostorCount === 2 ? 'Os dois intrusos foram pegos e erraram a palavra.' : 'O intruso foi pego e errou a palavra.' }[r.reason];
  const guesses = Object.entries(r.guesses);
  return h('div', { class: 'screen result', 'data-screen': 'result' },
    h('div', { class: 'banner ' + (spec ? 'win' : iWon ? 'win' : 'lose') }, spec ? 'Fim da rodada' : iWon ? 'Você venceu!' : 'Você perdeu'),
    h('section', { class: 'reveal' },
      h('p', { class: 'sub' }, s.impostorCount === 2 ? 'Os intrusos eram' : 'O intruso era'),
      h('div', { class: 'faces' }, s.impostorIds.map((id) => h('div', { class: 'face', 'data-key': id }, av(P(id).avatar, s.impostorCount === 2 ? 96 : 116), h('p', { class: 'who' }, P(id).name)))),
      h('div', { class: 'facts' }, h('span', { class: 'fact' }, 'Palavra: ' + s.word),
        guesses.map(([pid, g]) => h('span', { class: 'fact ' + (nz(g) === nz(s.word) ? 'ok' : 'no'), 'data-key': 'g' + pid }, `Palpite de ${P(pid).name}: ${g}`))),
      h('p', { class: 'sub' }, why)),
    votes.length ? h('section', { class: 'panel flat' }, h('h2', {}, 'Votos'),
      votes.map(([voter, target]) => h('div', { class: 'vrow', 'data-key': voter },
        av(P(voter).avatar, 30), h('b', {}, P(voter).name), 'votou em', av(P(target).avatar, 30), h('b', {}, P(target).name)))) : null,
    gainPanel(roundGain, 'Seu progresso'),
    h('section', { class: 'panel' }, h('h2', {}, 'Placar'), scoreRows(r.delta)),
    isHost()
      ? [h('button', { class: 'btn', type: 'button', 'data-act': 'toggleTimes', 'aria-expanded': String(showTimes) }, showTimes ? 'Fechar ajuste de tempos' : 'Ajustar tempos da próxima rodada'),
        showTimes ? h('section', { class: 'panel flat' }, settingsPanel(false)) : null,
        h('button', { class: 'btn primary', type: 'button', 'data-act': 'next' }, r.last ? 'Ver resultado final' : `Próxima rodada (${s.matchRound + 1} de ${s.settings.total})`)]
      : h('p', { class: 'sub', style: 'text-align:center' }, `Aguardando ${P(s.hostId).name}`));
}

const AWARDS = [
  ['bluffer', 'Melhor blefador', '🎭', (v) => `${v} ${v === 1 ? 'vitória' : 'vitórias'} como intruso`],
  ['suspect', 'Mais suspeito', '🕵️', (v) => `${v} ${v === 1 ? 'voto' : 'votos'} recebidos`],
  ['detective', 'Detetive da noite', '🔍', (v) => `${v} ${v === 1 ? 'acerto' : 'acertos'} no intruso`],
  ['fastest', 'Dica mais rápida', '⚡', (v) => `${(v / 1000).toFixed(1).replace('.', ',')} s por dica`],
];

function awardList(s) {
  return AWARDS.filter(([k]) => s.awards && s.awards[k]).map(([k, label, emoji, fmt]) => ({ k, label, emoji, name: P(s.awards[k].pid).name, avatar: P(s.awards[k].pid).avatar, detail: fmt(s.awards[k].value) }));
}

function summaryText(s) {
  const rows = rankingOf(s), tops = rows.filter((r) => r.rank === 1).map((r) => r.p.name).join(' e ');
  const aw = awardList(s).map((a) => `${a.emoji} ${a.label}: ${a.name}`);
  const rest = rows.filter((r) => r.rank > 1).slice(0, 3).map((r) => `${r.rank}º ${r.p.name} (${r.p.score})`).join(' · ');
  return [`🕵️ Intruso: fim de partida (${s.settings.total} rodadas)!`, `👑 ${tops} ${rows.filter((r) => r.rank === 1).length > 1 ? 'empataram' : 'é o campeão'} com ${rows[0].p.score} pts`,
    rest, ...aw, `Joga com a gente: ${baseUrl()}`].filter(Boolean).join('\n');
}

function finalScreen() {
  const s = state, rows = ranking(), tops = rows.filter((r) => r.rank === 1);
  const podium = rows.filter((r) => r.rank <= 3).slice(0, 3);
  const order = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium;
  const aw = awardList(s);
  return h('div', { class: 'screen final', 'data-screen': 'final' },
    h('div', { class: 'hero' }, h('p', { class: 'sub' }, `Fim da partida · ${s.settings.total} rodadas`),
      h('h1', {}, tops.length > 1 ? 'Empate no topo!' : 'Temos um campeão!')),
    h('section', { class: 'podium' }, order.map((r) => h('div', { class: 'pcol r' + r.rank, 'data-key': r.p.id },
      r.rank === 1 ? h('span', { class: 'crown' }, icon('crown')) : null,
      av(r.p.avatar, r.rank === 1 ? 84 : 64), h('span', { class: 'nm' }, r.p.name), h('div', { class: 'block' }, h('b', {}, r.p.score), h('small', {}, r.rank + 'º'))))),
    aw.length ? h('section', { class: 'stack' }, h('h2', {}, 'Prêmios da noite'),
      h('div', { class: 'awards' }, aw.map((a) => h('div', { class: 'award', 'data-key': a.k },
        h('span', { class: 'aemoji' }, a.emoji), h('small', {}, a.label), av(a.avatar, 52), h('b', {}, a.name), h('small', {}, a.detail))))) : null,
    h('section', { class: 'panel' }, h('h2', {}, 'Classificação final'), scoreRows(null)),
    gainPanel(matchGain, 'Seu progresso na partida'),
    h('div', { class: 'two' },
      h('button', { class: 'btn wa', type: 'button', 'data-act': 'whatsapp' }, 'WhatsApp'),
      h('button', { class: 'btn', type: 'button', 'data-act': 'saveCard' }, 'Salvar imagem')),
    isHost() ? h('button', { class: 'btn primary', type: 'button', 'data-act': 'rematch' }, 'Nova partida')
      : h('p', { class: 'sub', style: 'text-align:center' }, `Aguardando ${P(s.hostId).name}`));
}

const SCREENS = { lobby: lobbyScreen, intro: introScreen, clues: cluesScreen, vote: voteScreen, guess: guessScreen, result: resultScreen, final: finalScreen };

function buildHeader() {
  const t = h('header', { id: 'top', class: 'top' });
  const snd = h('button', { 'data-key': 'snd', class: 'iconbtn', type: 'button', 'data-act': 'sound', 'aria-label': Snd.muted ? 'Ligar som' : 'Desligar som' }, icon(Snd.muted ? 'mute' : 'sound'));
  if (!state) { t.append(h('span', {}), h('div', { class: 'r' }, snd)); return t; }
  t.append(
    h('button', { class: 'pill', 'data-key': 'room', type: 'button', 'data-act': 'copy', 'aria-label': 'Copiar link da sala' }, 'Sala', h('b', {}, state.code)),
    h('div', { class: 'r' },
      state.matchRound && state.phase !== 'final' ? h('span', { class: 'pill', 'data-key': 'rd' }, `${state.matchRound}/${state.settings.total}`) : null,
      snd,
      h('button', { 'data-key': 'lv', class: 'iconbtn', type: 'button', 'data-act': 'leave', 'aria-label': 'Sair da sala' }, icon('exit'))));
  return t;
}

function render() {
  morph(document.getElementById('top'), buildHeader());
  const next = state ? SCREENS[state.phase]() : (tab === 'profile' ? profileScreen() : homeScreen());
  const cur = view.firstElementChild;
  if (!cur || cur.getAttribute('data-screen') !== next.getAttribute('data-screen')) view.replaceChildren(next);
  else { syncAttrs(cur, next); morph(cur, next); }

  const chat = view.querySelector('.chat');
  if (chat && state.chat.length !== lastChat) { chat.scrollTop = chat.scrollHeight; lastChat = state.chat.length; }
  if (focusClue) {
    const inp = document.getElementById('dica');
    if (inp) { inp.focus(); focusClue = false; }
  }
}

// ---------- ações (eventos delegados: os elementos não guardam estado antigo) ----------
async function enter(path, body) {
  const name = document.getElementById('nome').value.trim();
  if (!name) { toast('Digite seu nome.'); document.getElementById('nome').focus(); return; }
  ls.set('intruso-nome', name);
  ls.set('intruso-avatar', myAvatar);
  Snd.unlock();
  try {
    const r = await api(path, { name, avatar: myAvatar, ...body });
    session = { code: r.code, pid: r.pid };
    ls.set('intruso-sessao', JSON.stringify(session));
    connect();
  } catch { /* o aviso já foi mostrado */ }
}

function shareLink() {
  const url = roomUrl();
  if (navigator.share && state.phase === 'lobby') {
    navigator.share({ title: 'Intruso', text: 'Entra na minha sala do Intruso!', url }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast('Link da sala copiado.', true), () => toast(url));
  } else {
    toast(url);
  }
}

async function saveCard() {
  const s = state;
  try {
    const rows = rankingOf(s).map((r) => r.p);
    const blob = await Share.card({ rows, rounds: s.settings.total, link: baseUrl(), awards: awardList(s).map((a) => ({ label: a.label, name: a.name })) });
    const file = new File([blob], 'intruso-resultado.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: summaryText(s) }); return; }
    const a = h('a', { href: URL.createObjectURL(blob), download: 'intruso-resultado.png' });
    document.body.append(a); a.click(); a.remove();
    toast('Imagem salva.', true);
  } catch (e) { if (e && e.name !== 'AbortError') toast('Não consegui gerar a imagem.'); }
}

const ACT = {
  homeAvatar: (el) => {
    const i = Number(el.dataset.i);
    if (!Profile.unlocked(prof, i)) { const u = Profile.UNLOCKS.find((x) => x.i === i); toast(`${AVATARS[i].name}: ${u.req} para liberar.`); return; }
    myAvatar = i; ls.set('intruso-avatar', myAvatar); render();
  },
  create: () => enter('/api/create', {}),
  share: shareLink,
  copy: shareLink,
  toggleQR: () => { showQR = !showQR; render(); },
  togglePicker: () => { pickerOpen = !pickerOpen; render(); },
  pickAvatar: (el) => {
    const i = Number(el.dataset.i);
    if (!Profile.unlocked(prof, i)) { const u = Profile.UNLOCKS.find((x) => x.i === i); toast(`${AVATARS[i].name}: ${u.req} para liberar.`); return; }
    pickerOpen = false; render(); act('avatar', { value: i });
  },
  category: (el) => act('category', { value: el.dataset.v }),
  setting: (el) => act('settings', { key: el.dataset.k, value: Number(el.dataset.v) }),
  toggleTimes: () => { showTimes = !showTimes; render(); },
  start: () => { Snd.unlock(); act('start'); },
  skip: () => act('skip'),
  next: () => act('next'),
  rematch: () => act('rematch'),
  toggleRole: () => { secretShown = !secretShown; render(); },
  vote: (el) => act('vote', { target: el.dataset.id }),
  react: (el) => act('react', { emoji: el.dataset.e }),
  skipReveal: () => { finishReveal(); render(); },
  whatsapp: () => window.open(Share.whatsappUrl(summaryText(state)), '_blank', 'noopener'),
  saveCard,
  sound: () => { Snd.toggle(); render(); },
  profile: () => { tab = 'profile'; window.scrollTo(0, 0); render(); },
  home: () => { tab = 'home'; window.scrollTo(0, 0); render(); },
  leave: () => {
    if (state && state.phase !== 'lobby' && state.phase !== 'final' && !confirm('Sair da sala? Você deixa esta partida.')) return;
    leave();
  },
};

const FORM = {
  join: (f) => {
    const code = f.elements.codigo.value.trim();
    if (code.length !== 4) { toast('O código tem 4 letras.'); f.elements.codigo.focus(); return; }
    enter('/api/join', { code });
  },
  clue: (f) => { const text = f.elements.dica.value.trim(); if (text) act('clue', { text }); },
  chat: (f) => { const i = f.elements.msg; const text = i.value.trim(); if (text) { i.value = ''; act('chat', { text }); } },
  guess: (f) => { const text = f.elements.palpite.value.trim(); if (text) act('guess', { text }); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && ACT[el.dataset.act]) ACT[el.dataset.act](el);
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  FORM[f.dataset.form](f);
});

render();
if (session) connect();
