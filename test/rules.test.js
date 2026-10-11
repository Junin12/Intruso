// Testa as regras do servidor via HTTP + SSE. Rode: node test/rules.test.js
process.env.SEC_MS = '40'; process.env.INTRO_MS = '60';
const http = require('http'); const assert = require('assert');
const { server } = require('../server.js');
let port, fails = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => new Promise((res) => {
  const d = JSON.stringify(b);
  const r = http.request({ port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (x) => { let t = ''; x.on('data', (c) => t += c); x.on('end', () => res({ s: x.statusCode, ...JSON.parse(t) })); });
  r.end(d);
});
class P {
  constructor(name, code, pid) { this.name = name; this.code = code; this.pid = pid; this.v = null; this.req = null; }
  connect() { return new Promise((res) => { this.req = http.get({ port, path: `/api/events?code=${this.code}&pid=${this.pid}` }, (x) => { let buf = ''; x.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const m = buf.slice(0, i); buf = buf.slice(i + 2); if (m.startsWith('data: ')) { this.v = JSON.parse(m.slice(6)); res(); } } }); }); }); }
  act(o) { return post('/api/act', { code: this.code, pid: this.pid, ...o }); }
  drop() { this.req.destroy(); }
}
async function room(n, opts = {}) {
  const c = await post('/api/create', { name: 'P1' });
  const ps = [new P('P1', c.code, c.pid)];
  for (let i = 2; i <= n; i++) { const j = await post('/api/join', { code: c.code, name: 'P' + i }); ps.push(new P('P' + i, c.code, j.pid)); }
  for (const p of ps) await p.connect();
  await sleep(30);
  return ps;
}
const test = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n    ', e.message); } };
const byId = (ps, id) => ps.find((p) => p.pid === id);
async function toVote(ps) {
  await ps[0].act({ type: 'start' }); await sleep(120);
  for (let i = 0; i < ps[0].v.totalTurns; i++) { const cur = byId(ps, ps[0].v.order[ps[0].v.turn % ps[0].v.order.length]); await cur.act({ type: 'clue', text: 'dica' + i }); await sleep(15); }
  assert.strictEqual(ps[0].v.phase, 'vote');
}
const imps = (ps) => ps.filter((p) => p.v.role === 'impostor');

(async () => {
  await new Promise((r) => server.listen(0, r)); port = server.address().port;

  await test('um intruso com 4, dois com 7; palavra oculta ao intruso', async () => {
    let ps = await room(4); await ps[0].act({ type: 'start' }); await sleep(20);
    assert.strictEqual(imps(ps).length, 1); assert.strictEqual(imps(ps)[0].v.word, null);
    assert.ok(ps.filter((p) => p.v.role === 'crew').every((p) => p.v.word));
    ps = await room(7); await ps[0].act({ type: 'start' }); await sleep(20);
    assert.strictEqual(imps(ps).length, 2);
    assert.deepStrictEqual(imps(ps)[0].v.partnerIds, [imps(ps)[1].pid]);
  });

  await test('intruso pego e erra o palpite: tripulação +1', async () => {
    const ps = await room(4); await toVote(ps);
    const imp = imps(ps)[0];
    for (const p of ps) await p.act({ type: 'vote', target: p === imp ? ps.find((x) => x !== imp).pid : imp.pid });
    await sleep(20); assert.strictEqual(ps[0].v.phase, 'guess');
    await imp.act({ type: 'guess', text: 'xxxx' }); await sleep(20);
    assert.strictEqual(ps[0].v.phase, 'result'); assert.strictEqual(ps[0].v.result.impostorWins, false);
    assert.strictEqual(ps.find((p) => p !== imp).v.players.find((x) => x.id === imp.pid).score, 0);
  });

  await test('intruso pego mas acerta: intruso +2', async () => {
    const ps = await room(4); await toVote(ps);
    const imp = imps(ps)[0], crew = ps.find((p) => p !== imp);
    for (const p of ps) await p.act({ type: 'vote', target: p === imp ? crew.pid : imp.pid });
    await imp.act({ type: 'guess', text: crew.v.word.toUpperCase() }); await sleep(20);
    assert.strictEqual(ps[0].v.result.reason, 'guessed');
    assert.strictEqual(ps[0].v.players.find((x) => x.id === imp.pid).score, 2);
  });

  await test('dois intrusos: precisa pegar os dois', async () => {
    const ps = await room(7); await toVote(ps);
    const [a, b] = imps(ps); const inn = ps.filter((p) => p !== a && p !== b);
    // só um é o mais votado -> escapam
    for (const p of ps) await p.act({ type: 'vote', target: p === a ? inn[0].pid : a.pid });
    await sleep(20); assert.strictEqual(ps[0].v.phase, 'result'); assert.strictEqual(ps[0].v.result.impostorWins, true);
    const ps2 = await room(7); await toVote(ps2);
    const [c, d] = imps(ps2);
    ps2.forEach((p, i) => p.act({ type: 'vote', target: (i % 2 ? c : d) === p ? (p === c ? d : c).pid : (i % 2 ? c : d).pid }));
    await sleep(60);
    assert.strictEqual(ps2[0].v.phase, 'guess', 'fase ' + ps2[0].v.phase);
  });

  await test('tempo de dica esgota e passa a vez; votação esgota e encerra', async () => {
    const ps = await room(3); await ps[0].act({ type: 'settings', key: 'clueSecs', value: 10 });
    await ps[0].act({ type: 'settings', key: 'voteSecs', value: 30 });
    await ps[0].act({ type: 'start' }); await sleep(100);
    assert.strictEqual(ps[0].v.phase, 'clues');
    await sleep(10 * 40 + 80);
    assert.ok(ps[0].v.turn >= 1, 'turn ' + ps[0].v.turn);
    await sleep(6 * 10 * 40 + 300);
    assert.strictEqual(ps[0].v.phase, 'vote');
    await sleep(30 * 40 + 150);
    assert.ok(['result'].includes(ps[0].v.phase), ps[0].v.phase);
  });

  await test('só o anfitrião muda ajustes; valores inválidos recusados', async () => {
    const ps = await room(3);
    assert.strictEqual((await ps[1].act({ type: 'settings', key: 'total', value: 10 })).s, 400);
    assert.strictEqual((await ps[0].act({ type: 'settings', key: 'total', value: 7 })).s, 400);
    assert.strictEqual((await ps[0].act({ type: 'settings', key: 'total', value: 10 })).s, 200);
    await sleep(20); assert.strictEqual(ps[2].v.settings.total, 10);
  });

  await test('partida de 5 rodadas termina em final com prêmios; palavras não repetem', async () => {
    const ps = await room(3);
    await ps[0].act({ type: 'settings', key: 'clueSecs', value: 0 }); await ps[0].act({ type: 'settings', key: 'voteSecs', value: 0 });
    await ps[0].act({ type: 'category', value: 'Marcas' });
    const words = new Set();
    for (let r = 1; r <= 5; r++) {
      await ps[0].act({ type: r === 1 ? 'start' : 'next' }); await sleep(30);
      await ps[0].act({ type: 'skip' }); await sleep(20);
      assert.strictEqual(ps[0].v.matchRound, r);
      words.add(ps.find((p) => p.v.role === 'crew').v.word);
      for (let i = 0; i < ps[0].v.totalTurns; i++) { await byId(ps, ps[0].v.order[ps[0].v.turn % 3]).act({ type: 'clue', text: 'x' + i }); await sleep(10); }
      const imp = imps(ps)[0];
      for (const p of ps) await p.act({ type: 'vote', target: p === imp ? ps.find((x) => x !== imp).pid : imp.pid });
      await sleep(20);
      if (ps[0].v.phase === 'guess') { await imp.act({ type: 'guess', text: 'nada' }); await sleep(20); }
      assert.strictEqual(ps[0].v.phase, 'result'); assert.strictEqual(ps[0].v.result.last, r === 5);
    }
    assert.strictEqual(words.size, 5, 'palavras repetidas');
    await ps[0].act({ type: 'next' }); await sleep(30);
    assert.strictEqual(ps[0].v.phase, 'final'); assert.ok(ps[0].v.awards.detective);
    await ps[0].act({ type: 'rematch' }); await sleep(20);
    assert.strictEqual(ps[0].v.phase, 'lobby'); assert.ok(ps[0].v.players.every((p) => p.score === 0));
  });

  await test('entrada no meio da partida: espectador sem palavra', async () => {
    const ps = await room(3); await ps[0].act({ type: 'start' }); await sleep(100);
    const j = await post('/api/join', { code: ps[0].code, name: 'Tarde' }); assert.ok(j.pid);
    const late = new P('Tarde', ps[0].code, j.pid); await late.connect();
    assert.strictEqual(late.v.role, 'spectator'); assert.strictEqual(late.v.word, null);
    assert.strictEqual((await late.act({ type: 'vote', target: ps[0].pid })).s, 400);
  });

  server.close(); setTimeout(() => process.exit(fails ? 1 : 0), 50);
})();
