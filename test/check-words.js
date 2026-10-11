// Valida words.js: >=100 palavras por categoria, sem duplicatas (ignora acento/caixa), tamanho razoável.
const W = require('../words.js');
const cats = W.CATEGORIES || W.categories || W;
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
let bad = 0;
for (const [name, list] of Object.entries(cats)) {
  const seen = new Map();
  for (const w of list) {
    const k = norm(w);
    if (seen.has(k)) { console.log(`DUP em ${name}: "${w}" = "${seen.get(k)}"`); bad++; }
    seen.set(k, w);
    if (w.length < 2 || w.length > 28 || /[?!]/.test(w)) { console.log(`SUSPEITA em ${name}: "${w}"`); bad++; }
  }
  if (list.length < 100) { console.log(`POUCAS em ${name}: ${list.length}`); bad++; }
  console.log(name.padEnd(20), list.length);
}
// duplicatas entre categorias
const all = new Map();
for (const [name, list] of Object.entries(cats)) for (const w of list) {
  const k = norm(w); if (all.has(k) && all.get(k) !== name) { console.log(`aviso: "${w}" em ${all.get(k)} e ${name}`); } all.set(k, name);
}
console.log(bad ? `FALHOU (${bad})` : 'OK');
process.exit(bad ? 1 : 0);
