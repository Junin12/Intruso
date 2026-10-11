# Confere o gerador de QR (public/qr.js) decodificando com OpenCV. Rode: python3 test/qr_check.py
import json, subprocess, numpy as np, cv2, os
here = os.path.dirname(os.path.abspath(__file__))
texts = ['x'*n for n in (5, 14, 20, 26, 40, 42, 55, 62, 70, 84, 100, 106)] + ['https://exemplo.com/?sala=ABCD', 'Olá, intruso! ç']
js = "const Q=require(process.argv[1]);console.log(JSON.stringify(JSON.parse(process.argv[2]).map(t=>Q.make(t))))"
out = subprocess.check_output(['node', '-e', js, os.path.join(here, '..', 'public', 'qr.js'), json.dumps(texts)])
det = cv2.QRCodeDetector(); bad = 0
for t, m in zip(texts, json.loads(out)):
    img = np.pad(np.where(np.array(m) == 1, 0, 255).astype(np.uint8), 4, constant_values=255)
    val, _, _ = det.detectAndDecode(cv2.resize(img, None, fx=10, fy=10, interpolation=cv2.INTER_NEAREST))
    ok = val == t; bad += not ok
    print('ok  ' if ok else 'FAIL', len(m), len(t.encode()))
raise SystemExit(1 if bad else 0)
