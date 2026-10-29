# 粗调 (bowen 1792684661, dot 1792684703): a rough model pass from the generated in-between pictures, bowen's 0/45/90 kept.
# For each picture (placed by its own fit, uniform scale + shift; ../控制线-30-60/fits.json) at the yaw it matches best:
#   eyes   — per eye the track angle ψ and sphere-frame yaw φ that put its measured corners best (near eye always; far eye
#            where it was measured), the 0° base eye and radius unchanged
#   sheet  — the side sheet's angle θ from the nose tip's sideways position (x = 92.79·sin θ)
#   outline— the locked points (chin, near ear point, 颧骨点, 太阳穴点) slid sideways only, heights kept, so the jaw / cheek
#            lines lie on the picture's dark lines (a distance map of the picture), samples below the eye line only (hair
#            hides the skull); crown and handles stay as interpolated
# Writes rough.json (per picture: before / after values) for the trends; nothing of bowen's is touched.
import json, math, struct, sys
HERE = '/Users/bowen/Documents/headset-face3d/bench-tasks/粗调-2026-10-23/'
TC = json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/迁移/turncheck.json'))
V = [n for n in TC['variants'] if n.startswith('侧脸平片')][0]; KEYS = TC['variants'][V]; SH = TC['sheet'][V]; E = TC['eyes']
FITS = json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/控制线-30-60/fits.json'))
LM = json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/控制线-30-60/landmarks.json'))
PICK = sys.argv[1:] or ['yaw30-09', 'yaw30-04', 'yaw60-08', 'yaw60-09', 'yaw60-07']
CHIN, EARJ, ZYG, TEMP, CROWN = 'cmv3m1am1-6/pmv3m1am1-2', 'cmv3m1am1-6/pmv3m1am1-1', 'pmv3m1am1-1', 'pm03-skf', 'cmv3m1am1-6/pmv3m1am1-4'
lerp = lambda a, b, t: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
def at(ay):
    i = 0 if ay <= 45 else 1; A, B = KEYS[i], KEYS[i + 1]; t = (ay - A['yaw']) / (B['yaw'] - A['yaw'])
    pts = {k: lerp(A['pts'][k], B['pts'][k], t) for k in A['pts']}
    lines = [dict(l, ha=lerp(l['ha'], m['ha'], t), hb=lerp(l['hb'], m['hb'], t)) for l in A['lines'] for m in B['lines'] if m['a'] == l['a'] and m['b'] == l['b']]
    return pts, lines
def sheet_th(ay): return ay * SH['theta45'] / 45 if ay <= 45 else SH['theta45'] + (ay - 45) * (90 - SH['theta45']) / 45
def tab(t, ay):
    for k in range(1, len(t)):
        if t[k][0] >= ay: a, b = t[k - 1], t[k]; u = (ay - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u
    return t[-1][1], t[-1][2]
def eye_x(far, which, phi, psi):
    c = E['base'][0 if which != 'mid' else 1]; p = c[0] if which == 'in' else c[3]
    f, w = math.radians(phi), math.radians(psi); m = -1 if far else 1
    ax = m * E['anchor'][0] * math.cos(w) + E['z'] * math.sin(w); qx = m * (p[0] - E['anchor'][0]); qy = p[1] - E['anchor'][1]
    return ax + math.cos(f) * qx + math.sin(f) * (math.sqrt(max(0, E['r'] ** 2 - qx * qx - qy * qy)) - E['r'])
def readbmp(f):
    b = open(f, 'rb').read(); off, = struct.unpack_from('<I', b, 10); W, H = struct.unpack_from('<ii', b, 18); bpp, = struct.unpack_from('<H', b, 28)
    Hs = H; H = abs(H); row = ((W * bpp + 31) // 32) * 4; st = bpp // 8
    dark = bytearray(W * H)
    for y in range(H):
        yy = y if Hs < 0 else H - 1 - y; base = off + yy * row
        for x in range(W):
            i = base + x * st
            if b[i] + b[i + 1] + b[i + 2] < 3 * 110: dark[y * W + x] = 1
    return W, H, dark
def dt(W, H, dark):   # two-pass chamfer distance to the nearest dark pixel (px)
    INF = 1e9; d = [0.0 if dark[i] else INF for i in range(W * H)]
    for y in range(H):
        for x in range(W):
            i = y * W + x; v = d[i]
            if v == 0: continue
            if x > 0 and d[i - 1] + 1 < v: v = d[i - 1] + 1
            if y > 0:
                if d[i - W] + 1 < v: v = d[i - W] + 1
                if x > 0 and d[i - W - 1] + 1.414 < v: v = d[i - W - 1] + 1.414
                if x < W - 1 and d[i - W + 1] + 1.414 < v: v = d[i - W + 1] + 1.414
            d[i] = v
    for y in range(H - 1, -1, -1):
        for x in range(W - 1, -1, -1):
            i = y * W + x; v = d[i]
            if v == 0: continue
            if x < W - 1 and d[i + 1] + 1 < v: v = d[i + 1] + 1
            if y < H - 1:
                if d[i + W] + 1 < v: v = d[i + W] + 1
                if x < W - 1 and d[i + W + 1] + 1.414 < v: v = d[i + W + 1] + 1.414
                if x > 0 and d[i + W - 1] + 1.414 < v: v = d[i + W - 1] + 1.414
            d[i] = v
    return d
def bz(c, t): u = 1 - t; return [u ** 3 * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t ** 3 * c[3][i] for i in (0, 1)]
out = {}
for name in PICK:
    F = FITS[name]; s, tx, ty, ay = F['s'], F['tx'], F['ty'], F['yaw']; L = LM[name]; X = lambda px: s * px + tx
    pts, lines = at(ay); res = {'yaw': ay}
    # eyes: (φ, ψ) per eye from its measured corners (in, out, mid)
    for eye in ('near', 'far'):
        keys = [k for k in ('in', 'out', 'mid') if f'{eye}_{k}' in L]
        phi0, psi0 = tab(E[eye], ay); res[eye] = {'before': [round(phi0, 1), round(psi0, 1)]}
        if len(keys) < 2: continue
        best = None
        for i in range(0, 191):
            for j in range(0, 191):
                phi, psi = i / 2, j / 2; e = sum((eye_x(eye == 'far', k, phi, psi) - X(L[f'{eye}_{k}'][0])) ** 2 for k in keys)
                if best is None or e < best[0]: best = (e, phi, psi)
        res[eye]['after'] = [best[1], best[2]]; res[eye]['rms'] = round(math.sqrt(best[0] / len(keys)), 2)
    # sheet: θ from the nose tip
    xn = X(L['nose'][0]); res['sheet'] = {'before': round(sheet_th(ay), 2), 'after': round(math.degrees(math.asin(max(-1, min(1, xn / 92.79)))), 2)}
    # outline: slide chin, near ear point, 颧骨点, 太阳穴点 sideways onto the picture's dark lines
    W, H, dark = readbmp(HERE + 'bmp/' + name + '.bmp'); D = dt(W, H, dark)
    def dist(p):   # canvas point → distance to the nearest dark pixel, canvas units (capped)
        x = (p[0] - tx) / s; y = (p[1] - ty) / s
        if not (0 <= x < W - 1 and 0 <= y < H - 1): return 8.0
        return min(8.0, D[int(y) * W + int(x)] * s)
    def cost(P):
        c = n = 0
        for l in lines:
            if l.get('side'): continue
            a, b = P[l['a']], P[l['b']]; cv = [a, [a[0] + l['ha'][0], a[1] + l['ha'][1]], [b[0] + l['hb'][0], b[1] + l['hb'][1]], b]
            for k in range(1, 40):
                q = bz(cv, k / 40)
                if q[1] > 5: c += dist(q); n += 1
        return c / max(1, n)
    P = {k: list(v) for k, v in pts.items()}; moved = {}
    c0 = cost(P)
    for rnd in range(3):
        # the near ear point stays on its turn (the ear-hole bottom anchor, decided 2026-10-22): it slid onto the ear's
        # front edge at 75°
        for k in (CHIN, ZYG, TEMP):
            bx = P[k][0]; best = (cost(P), bx)
            for d in [i * 0.5 for i in range(-24, 25)]:
                P[k][0] = bx + d; c = cost(P)
                if c < best[0] - 1e-9: best = (c, bx + d)
            P[k][0] = best[1]
    res['outline'] = {'cost_before': round(c0, 3), 'cost_after': round(cost(P), 3), 'dx': {k: round(P[k][0] - pts[k][0], 2) for k in (CHIN, EARJ, ZYG, TEMP)},
                      'before': {k: [round(v, 2) for v in pts[k]] for k in (CHIN, EARJ, ZYG, TEMP, CROWN)}, 'after': {k: [round(v, 2) for v in P[k]] for k in (CHIN, EARJ, ZYG, TEMP, CROWN)}}
    out[name] = res; print(name, json.dumps(res, ensure_ascii=False)[:600], flush=True)
json.dump(out, open(HERE + 'rough.json', 'w'), ensure_ascii=False, indent=1)
