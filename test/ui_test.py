# Partida completa com 8 celulares simulados no Chromium. Rode: python3 test/ui_test.py [pasta-das-capturas]
import os, subprocess, sys, time, json
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/intruso-shots'
os.makedirs(SHOTS, exist_ok=True)
PORT = 3299
env = dict(os.environ, PORT=str(PORT), INTRO_MS='1200', SEC_MS='1000')
srv = subprocess.Popen(['node', os.path.join(HERE, '..', 'server.js')], env=env)
time.sleep(1)
URL = f'http://localhost:{PORT}'
errors = []
def st(p): return p.evaluate('state')
def wait_phase(p, ph, t=30000): p.wait_for_function(f"state && state.phase === '{ph}'", timeout=t)
def shot(p, name): p.screenshot(path=f'{SHOTS}/{name}.png')
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path='/opt/pw-browsers/chromium' if os.path.exists('/opt/pw-browsers/chromium') else None)
        pages = []
        def newpage():
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
            p = ctx.new_page()
            p.on('pageerror', lambda e: errors.append(str(e)))
            p.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'ERR_' not in m.text and 'fonts' not in m.text else None)
            return p
        host = newpage(); pages.append(host)
        host.goto(URL); host.fill('#nome', 'Ana'); shot(host, '01-home')
        host.click('.avbtn[data-i="3"]'); host.click('[data-act=create]'); wait_phase(host, 'lobby')
        code = st(host)['code']
        names = ['Bruno', 'Carla', 'Davi', 'Eva', 'Fabio', 'Gil']
        for i, n in enumerate(names):
            p = newpage(); pages.append(p); p.goto(f'{URL}/?sala={code}'); p.fill('#nome', n)
            p.click(f'.avbtn[data-i="{i+4}"]'); p.click('form[data-form=join] button'); wait_phase(p, 'lobby')
        host.wait_for_function('state.players.length === 7')
        host.click('[data-act=toggleQR]'); host.wait_for_selector('.qr svg'); shot(host, '02-lobby-host-qr')
        host.click('[data-act=toggleQR]')
        host.click('.chip[data-k=clueSecs][data-v="15"]'); host.click('.chip[data-k=voteSecs][data-v="30"]')
        host.wait_for_function('state.settings.clueSecs === 15 && state.settings.voteSecs === 30')
        shot(pages[1], '03-lobby-guest')
        # guest não pode editar
        assert pages[1].eval_on_selector('.chip[data-k=total]', 'e => e.disabled')
        host.click('[data-act=start]'); wait_phase(host, 'intro'); shot(host, '04-intro')
        assert st(host)['impostorCount'] == 2, 'com 7 devem ser 2 intrusos'
        for p in pages: wait_phase(p, 'clues')
        # jogador entra no meio da rodada
        late = newpage(); pages.append(late); late.goto(f'{URL}/?sala={code}'); late.fill('#nome', 'Hugo'); late.click('form[data-form=join] button'); wait_phase(late, 'clues')
        assert st(late)['role'] == 'spectator' and st(late)['word'] is None
        shot(late, '05-spectator')
        # dicas
        pages[1].click('[data-act=toggleRole]') if st(pages[1])['role'] != 'spectator' else None
        for t in range(14):
            cur = st(host)['order'][st(host)['turn'] % 7]
            pg = next(p for p in pages if st(p)['you'] == cur)
            pg.wait_for_selector('#dica'); 
            if t == 0: shot(pg, '06-clues-myturn')
            pg.fill('#dica', f'dica{t}'); pg.click('form[data-form=clue] button')
            host.wait_for_function(f'state.turn > {t} || state.phase !== "clues"')
        wait_phase(host, 'vote')
        pages[2].click('[data-act=toggleRole]')
        pages[2].click('.react[data-e="😂"]'); pages[3].click('.react[data-e="🔥"]'); time.sleep(.4)
        shot(pages[2], '07-vote')
        imps = st(host)['players']
        impset = None
        for p in pages[:7]:
            s = st(p)
        impset = [st(p)['you'] for p in pages[:7] if st(p)['role'] == 'impostor']
        assert len(impset) == 2
        # todos votam; tripulação nos 2 intrusos (os intrusos votam em alguém inocente)
        crew = [p for p in pages[:7] if st(p)['role'] == 'crew']
        for i, p in enumerate(pages[:7]):
            me = st(p)['you']; target = impset[i % 2] if me not in impset else crew[0] and st(crew[0])['you']
            if target == me: target = impset[0] if me != impset[0] else impset[1]
            p.click(f'.vcard[data-id="{target}"]')
        time.sleep(.6)
        wait_phase(host, st(host)['phase'] if st(host)['phase'] in ('guess', 'result') else 'guess')
        print('fase após votos:', st(host)['phase'])
        if st(host)['phase'] == 'guess':
            shot(host, '08-guess')
            for p in pages[:7]:
                if st(p)['role'] == 'impostor':
                    p.fill('#palpite', 'xxxx'); p.click('form[data-form=guess] button')
        wait_phase(host, 'result'); time.sleep(1.4); shot(host, '09-reveal-counting')
        time.sleep(4.5); shot(host, '10-reveal-suspense')
        host.wait_for_selector('.banner', timeout=20000); time.sleep(.8); shot(host, '11-result'); shot(pages[2], '12-result-guest')
        host.screenshot(path=f'{SHOTS}/13-result-full.png', full_page=True)
        host.click('[data-act=toggleTimes]'); shot(host, '14-result-times')
        # pula para o fim pelas ações restantes via API (rápido); UI já validada
        import urllib.request
        def api(pid, **kw):
            req = urllib.request.Request(f'{URL}/api/act', data=json.dumps(dict(code=code, pid=pid, **kw)).encode(), headers={'Content-Type': 'application/json'})
            try: return urllib.request.urlopen(req).read()
            except Exception as e: return e.read()
        hostpid = st(host)['you']
        for r in range(2, 6):
            host.click('[data-act=next]'); wait_phase(host, 'intro'); wait_phase(host, 'clues')
            s = st(host)
            for t in range(len(s['order']) * 2):
                s = st(host); api(s['order'][s['turn'] % len(s['order'])], type='clue', text=f'd{r}{t}'); time.sleep(.12)
            wait_phase(host, 'vote')
            for p in pages[:7]:
                s = st(p)
                api(s['you'], type='vote', target=next(x['id'] for x in s['players'] if x['id'] != s['you'] and not x['waiting']))
            time.sleep(.5)
            if st(host)['phase'] == 'guess':
                for p in pages[:7]:
                    if st(p)['role'] == 'impostor': api(st(p)['you'], type='guess', text='zzz')
            wait_phase(host, 'result')
            assert st(host)['matchRound'] == r
            time.sleep(.3)
        time.sleep(7)
        host.click('[data-act=next]'); wait_phase(host, 'final'); time.sleep(1.2)
        shot(host, '15-final'); host.screenshot(path=f'{SHOTS}/16-final-full.png', full_page=True)
        shot(pages[3], '17-final-guest')
        host.click('[data-act=toggleQR]') if False else None
        # perfil
        hp = newpage(); hp.goto(URL); hp.click('[data-act=profile]'); hp.wait_for_selector('.achs'); hp.screenshot(path=f'{SHOTS}/18-profile.png', full_page=True)
        host.goto(URL); host.screenshot(path=f'{SHOTS}/19-home-after.png', full_page=True)
        b.close()
    print('ERROS DE CONSOLE:', errors if errors else 'nenhum')
finally:
    srv.terminate()
