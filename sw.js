// Guarda o app no aparelho para abrir sem internet.
// Ao alterar index.html, suba o número da versão para os celulares receberem a atualização.
// Os PDFs dos projetos ficam num cache à parte ("armacao-pdfs"), que não é apagado nas atualizações.
const VERSAO = "armacao-v82";
const APP = ["./", "index.html", "painel.html", "manifest.webmanifest", "icon-wigo-192.png", "icon-wigo-512.png", "icon-wigo-maskable-512.png", "logo-relatorio.jpg", "marcas.json", "romaneios-os.json", "checklists-maquinas.json"];
const LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js",
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSAO);
    // cache:"reload" ignora o cache do navegador (o GitHub guarda arquivos por até 10 min)
    await c.addAll(APP.map(u => new Request(u, { cache: "reload" })));
    for (const u of LIBS) { try { await c.add(u); } catch {} } // se falhar, baixa no primeiro uso
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("armacao-v") && k !== VERSAO) await caches.delete(k);
    self.clients.claim();
  })());
});

self.addEventListener("message", e => { if (e.data === "pular-espera") self.skipWaiting(); });

// tenta a rede por até `ms`; se não vier, usa o que está guardado
const comPrazo = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || !url.protocol.startsWith("http")) return;
  if (url.hostname.endsWith("script.google.com") || url.hostname.endsWith("googleusercontent.com")) return; // banco: sempre rede

  e.respondWith((async () => {
    const c = await caches.open(VERSAO);
    if (url.origin === location.origin) {
      // arquivos do app: primeiro a rede (versão mais nova), com prazo curto; sem sinal, a cópia guardada
      const rede = fetch(url.href, { cache: "no-cache", credentials: "same-origin" }).then(r => {
        if (r.ok) c.put(req, r.clone());
        return r;
      }).catch(() => null);
      const r = await comPrazo(rede, 4000);
      if (r && r.ok) return r;
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await c.match("index.html") : null);
      if (hit) { e.waitUntil(rede); return hit; }
      return (await rede) || Response.error();
    }
    // bibliotecas e fontes de outros sites: cópia guardada primeiro
    const hit = await c.match(req);
    if (hit) return hit;
    try { const r = await fetch(req); if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }
    catch { return Response.error(); }
  })());
});
