# Testa a integração com a nuvem usando um Firebase falso (módulos substituídos no navegador). Rode: python3 test/cloud_test.py
import os, subprocess, time, json
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); PORT = 3298
srv = subprocess.Popen(['node', os.path.join(HERE, '..', 'server.js')], env=dict(os.environ, PORT=str(PORT)))
time.sleep(1)
APP = "export const initializeApp = (c) => c;"
AUTH = """let cb=null,u=null; export const getAuth=()=>({}); export class GoogleAuthProvider{}
export const onAuthStateChanged=(a,f)=>{cb=f; f(window.__u||null)};
export const signInWithPopup=async()=>{u={uid:'u1',displayName:'Ana Teste',email:'ana@x.com'}; window.__u=u; cb(u)};
export const signOut=async()=>{window.__u=null; cb(null)};"""
FS = """window.__db=window.__db||{'users/u1':{p:{xp:777,wins:5,ach:{win:'2026-09-01'}}}};
export const getFirestore=()=>({}); export const serverTimestamp=()=>'ts';
export const doc=(d,c,i)=>c+'/'+i; export const collection=(d,c)=>c;
export const getDoc=async(k)=>({exists:()=>k in window.__db,data:()=>window.__db[k]});
export const setDoc=async(k,v)=>{window.__db[k]=v};
export const query=(c)=>c; export const orderBy=()=>0; export const limit=()=>0;
export const getDocs=async()=>({docs:[{id:'a',data:()=>({name:'Zé',avatar:2,xp:900,level:4,impWins:3})},{id:'u1',data:()=>({name:'Ana',avatar:1,xp:777,level:3,impWins:0})}]});"""
errs = []
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}); p = ctx.new_page()
        p.on('pageerror', lambda e: errs.append(str(e)))
        mods = {'firebase-app.js': APP, 'firebase-auth.js': AUTH, 'firebase-firestore.js': FS}
        p.route('https://www.gstatic.com/firebasejs/**', lambda r: r.fulfill(body=mods[r.request.url.split('/')[-1]], content_type='text/javascript', headers={'access-control-allow-origin': '*'}))
        p.route('**/firebase-config.js', lambda r: r.fulfill(body="window.FIREBASE_CONFIG={apiKey:'k',projectId:'p'};", content_type='text/javascript'))
        p.goto(f'http://localhost:{PORT}/')
        p.wait_for_selector('[data-act=signIn]')
        p.click('[data-act=signIn]'); p.wait_for_selector('[data-act=signOut]')
        time.sleep(.5)
        prof = p.evaluate('prof'); assert prof['xp'] == 777 and prof['ach'].get('win'), prof  # mesclou perfil da nuvem
        db = p.evaluate('window.__db'); assert db['board/u1']['xp'] == 777 and db['users/u1']['p']['xp'] == 777
        p.click('[data-act=rank]'); p.wait_for_selector('.screen.rank .row')
        assert p.locator('.screen.rank .row').count() == 2 and 'você' in p.inner_text('.screen.rank')
        p.click('[data-act=home]'); p.click('[data-act=signOut]'); p.wait_for_selector('[data-act=signIn]')
        # sem configuração: nada de conta
        p2 = ctx.new_page(); p2.goto(f'http://localhost:{PORT}/'); p2.wait_for_selector('[data-act=create]')
        assert p2.locator('[data-act=signIn]').count() == 0
        b.close()
    print('ERROS:', errs or 'nenhum'); print('OK' if not errs else 'FALHOU')
finally:
    srv.terminate()
