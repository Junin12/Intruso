# Gera ícone 512, gráfico de recursos 1024x500 e ícones do app Android. Rode: python3 play-store/make_assets.py
import os, re
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
src = open(os.path.join(ROOT, 'public', 'avatars.js'), encoding='utf-8').read()
ink = "#17143F"
sk = f'stroke="{ink}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"'
dot = lambda x, y, r=2.6: f'<circle cx="{x}" cy="{y}" r="{r}" fill="{ink}"/>'
mark = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="35" r="26" fill="#FFD23F" {sk}/>'
        f'<path d="M17 27c0-11 6-17 15-17s15 6 15 17z" fill="{ink}"/><path d="M10 28h44" {sk}/>'
        f'<circle cx="24" cy="39" r="5.5" fill="#fff" {sk}/><circle cx="40" cy="39" r="5.5" fill="#fff" {sk}/>{dot(26.5,39,2.3)}{dot(42.5,39,2.3)}'
        f'<path d="M26 50q6 4 12 0" fill="none" {sk}/></svg>')
icon_html = f'<body style="margin:0;background:#3B49F0;width:512px;height:512px;display:grid;place-items:center"><div style="width:380px">{mark}</div></body>'
feat_html = f'''<body style="margin:0;width:1024px;height:500px;background:#3B49F0 radial-gradient(rgba(255,255,255,.16) 2px,transparent 2.4px) 0 0/28px 28px;display:flex;align-items:center;justify-content:center;gap:36px;font-family:'Arial Rounded MT Bold','Trebuchet MS',system-ui,sans-serif">
<div style="width:230px;transform:rotate(-8deg);filter:drop-shadow(0 8px 0 {ink})">{mark}</div>
<div><div style="color:#fff;font-size:120px;font-weight:900;letter-spacing:-3px;line-height:1">Intruso</div>
<div style="color:#FFD23F;font-size:38px;font-weight:800;margin-top:10px">Quem está blefando na sua mesa?</div></div></body>'''
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page()
    pg.set_viewport_size({'width': 512, 'height': 512}); pg.set_content(icon_html)
    pg.screenshot(path=os.path.join(ROOT, 'play-store/graficos/icone-512.png'))
    for d, px in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        pg.set_viewport_size({'width': 512, 'height': 512})
        out = os.path.join(ROOT, f'android/app/src/main/res/mipmap-{d}'); os.makedirs(out, exist_ok=True)
        pg.set_content(f'<body style="margin:0;background:#3B49F0;width:{px}px;height:{px}px;display:grid;place-items:center"><div style="width:{int(px*.74)}px">{mark}</div></body>')
        pg.set_viewport_size({'width': px, 'height': px}); pg.screenshot(path=os.path.join(out, 'ic_launcher.png'))
    pg.set_viewport_size({'width': 1024, 'height': 500}); pg.set_content(feat_html)
    pg.screenshot(path=os.path.join(ROOT, 'play-store/graficos/grafico-recursos-1024x500.png'))
    b.close()
