const assert = require('assert');
const P = require('../public/profile.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };
const day = '2026-10-11';
t('níveis crescem', () => { assert.strictEqual(P.levelInfo(0).level, 1); assert.strictEqual(P.levelInfo(100).level, 2); assert.strictEqual(P.levelInfo(250).level, 3); assert.strictEqual(P.levelInfo(250).into, 0); });
t('rodada vencida como intruso dá XP, conquistas e personagem', () => {
  const p = P.blank(); const r = P.onRound(p, { won: true, wasImp: true, votedRight: false }, day);
  assert.strictEqual(p.xp >= 40, true); assert.ok(p.ach.first && p.ach.win && p.ach.imp1);
  assert.deepStrictEqual(r.avatars, [13]); assert.ok(P.unlocked(p, 13)); assert.ok(!P.unlocked(p, 14)); assert.ok(P.unlocked(p, 5));
});
t('sequência de vitórias e derrota zera', () => {
  const p = P.blank(); for (let i = 0; i < 3; i++) P.onRound(p, { won: true }, day);
  assert.strictEqual(p.streak, 3); assert.ok(p.ach.st3); assert.ok(P.unlocked(p, 16));
  P.onRound(p, { won: false }, day); assert.strictEqual(p.streak, 0); assert.strictEqual(p.bestStreak, 3);
});
t('desafio diário completa uma vez e dá bônus', () => {
  const p = P.blank(); P.touch(p, day);
  const def = P.dailyFor(day); let bonus = 0, hits = 0;
  for (let i = 0; i < 12; i++) {
    const r = P.onRound(p, { won: true, wasImp: true, votedRight: true }, day); if (r.dailyDone) hits++; bonus += r.xp;
    if (def.ev === 'match') P.onMatch(p, { champion: true }, day);
  }
  assert.strictEqual(p.dailyDone, 1); assert.ok(p.daily.done);
});
t('muda o desafio no dia seguinte', () => { const p = P.blank(); P.touch(p, '2026-10-11'); P.touch(p, '2026-10-12'); assert.strictEqual(p.daily.day, '2026-10-12'); assert.strictEqual(p.days, 2); });
t('campeão desbloqueia Rei', () => { const p = P.blank(); const r = P.onMatch(p, { champion: true }, day); assert.ok(p.ach.champ); assert.ok(r.avatars.includes(19)); });
t('nível sobe e é informado', () => { const p = P.blank(); p.xp = 95; const r = P.onRound(p, { won: false }, day); assert.strictEqual(r.levelUp, 2); });
t('cada desafio existe e tem meta', () => { P.DAILY.forEach((d) => assert.ok(d.goal > 0 && d.text)); assert.strictEqual(P.UNLOCKS.length, 8); });
console.log(n + ' ok');
