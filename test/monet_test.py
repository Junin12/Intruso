# Testa a monetização com uma ponte Android falsa. Rode: python3 test/monet_test.py
import os, subprocess, time, json
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); PORT = 3297
srv = subprocess.Popen(['node', os.path.join(HERE, '..', 'server.js')], env=dict(os.environ, PORT=str(PORT)))
time.sleep(1)
BRIDGE = """window.__calls=[]; window.AndroidApp={init(){__calls.push('init'); setTimeout(()=>window.onMonet({type:'prices',prices:{remove_ads:'R$ 9,90',avatar_pack:'R$ 6,90'}}),50)},
 showInterstitial(){__calls.push('inter')}, showRewarded(){__calls.push('rewarded'); setTimeout(()=>window.onMonet({type:'reward',ok:true}),50)}, buy(id){__calls.push('buy:'+id); setTimeout(()=>window.onMonet({type:'purchased',id}),50)}};"""
errs = []
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}); p = ctx.new_page()
        p.on('pageerror', lambda e: errs.append(str(e)))
        p.add_init_script(BRIDGE)
        p.goto(f'http://localhost:{PORT}/'); p.click('[data-act=profile]'); p.wait_for_selector('[data-act=buy]')
        assert 'R$ 9,90' in p.inner_text('.screen.profile')
        p.click('[data-act=watchAd]'); time.sleep(.4)
        assert p.evaluate('prof.xp') == 30 and p.evaluate('Monet.rewardsLeft()') == 2
        p.click('[data-act=buy][data-id=avatar_pack]'); time.sleep(.4)
        assert p.evaluate('prof.pack') is True and p.evaluate('Profile.unlocked(prof, 19)')
        assert p.locator('.screen.profile .shoprow .okmark').count() == 1
        # intersticial: a cada 2 partidas, respeitando o intervalo e a compra de remover anúncios
        p.evaluate('Monet.afterMatch(); Monet.afterMatch()'); assert p.evaluate('__calls').count('inter') == 1
        p.evaluate('Monet.afterMatch(); Monet.afterMatch()'); assert p.evaluate('__calls').count('inter') == 1  # intervalo mínimo
        p.click('[data-act=buy][data-id=remove_ads]'); time.sleep(.4)
        p.evaluate('Monet.afterMatch(); Monet.afterMatch(); Monet.afterMatch(); Monet.afterMatch()'); assert p.evaluate('__calls').count('inter') == 1
        # navegador comum: nada de loja
        p2 = ctx.new_page(); p2.goto(f'http://localhost:{PORT}/'); p2.click('[data-act=profile]')
        assert p2.locator('[data-act=buy]').count() == 0
        b.close()
    print('ERROS:', errs or 'nenhum'); print('OK' if not errs else 'FALHOU')
finally:
    srv.terminate()
