# Which head yaw a generated picture matches, relative to the CURRENT model (dot 1792682726: a best match, not a measured
# truth; parts that disagree are kept). Placement = one uniform scale s and a shift (canvas = s·image + t), never a deform:
# s, ty from the heights (eye corners, lower-lid middle, mouth 38.8, chin 62.3, ear-hole bottom 25 — all fixed in yaw);
# then tx and yaw by scanning yaw against the sideways positions the model gives each landmark (chin: outline keyframes;
# nose tip: side sheet; eye corners: track + sphere frame table; ear-hole bottom: rotation). Per landmark: residual at the
# best yaw, and the yaw it alone would take with that tx.
import json, math, sys
TC = json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/迁移/turncheck.json'))
E = TC['eyes']; V = [n for n in TC['variants'] if n.startswith('侧脸平片')][0]; SH = TC['sheet'][V]
def sheet_th(ay): return math.radians(ay * SH['theta45'] / 45 if ay <= 45 else SH['theta45'] + (ay - 45) * (90 - SH['theta45']) / 45)
def tab(t, ay):
    for k in range(1, len(t)):
        if t[k][0] >= ay: a, b = t[k - 1], t[k]; u = (ay - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u
    return t[-1][1], t[-1][2]
def eye_pt(far, which, ay):   # which: 'in' = curve 0 start, 'out' = curve 0 end, 'mid' = curve 1 end
    c = E['base'][0 if which != 'mid' else 1]; p = c[0] if which == 'in' else c[3]
    phi, psi = tab(E['far'] if far else E['near'], ay); f, w = math.radians(phi), math.radians(psi); m = -1 if far else 1
    ax = m * E['anchor'][0] * math.cos(w) + E['z'] * math.sin(w); qx = m * (p[0] - E['anchor'][0]); qy = p[1] - E['anchor'][1]
    return ax + math.cos(f) * qx + math.sin(f) * (math.sqrt(max(0, E['r'] ** 2 - qx * qx - qy * qy)) - E['r']), p[1]
def chin_x(ay): return 50.6108 * ay / 45 if ay <= 45 else 50.6108 + (73.4184 - 50.6108) * (ay - 45) / 45
MODEL = {   # landmark → (x(ay) or None, height)
    'chin': (chin_x, 62.3), 'nose': (lambda ay: 92.79 * math.sin(sheet_th(ay)), None), 'mouth': (None, 38.8),
    'ear': (lambda ay: -43.91 * math.cos(math.radians(ay)) + 21.81 * math.sin(math.radians(ay)), 25.0),
    **{f'{e}_{w}': ((lambda ay, e=e, w=w: eye_pt(e == 'far', w, ay)[0]), eye_pt(e == 'far', w, 0)[1]) for e in ('near', 'far') for w in ('in', 'out', 'mid')}}
def fit(L):
    # (the lower-lid middle is left out of the heights: this batch draws the eyes less open, dot 1792684892)
    rows = [(L[k][1], MODEL[k][1]) for k in L if MODEL[k][1] is not None and not k.endswith('_mid')]   # y_model = s·y + ty
    n = len(rows); my = sum(r[0] for r in rows) / n; mm = sum(r[1] for r in rows) / n
    s = sum((r[0] - my) * (r[1] - mm) for r in rows) / sum((r[0] - my) ** 2 for r in rows); ty = mm - s * my
    vres = {k: round(s * L[k][1] + ty - MODEL[k][1], 2) for k in L if MODEL[k][1] is not None}
    xs = [k for k in L if MODEL[k][0] is not None]; best = None
    for i in range(0, 901):
        ay = i / 10; d = [MODEL[k][0](ay) - s * L[k][0] for k in xs]; tx = sum(d) / len(d); e = sum((v - tx) ** 2 for v in d)
        if best is None or e < best[0]: best = (e, ay, tx)
    e, ay, tx = best
    own = {}
    for k in xs:   # the yaw this landmark alone would take with the fitted tx
        target = s * L[k][0] + tx; o = min((abs(MODEL[k][0](j / 10) - target), j / 10) for j in range(0, 901)); own[k] = o[1]
    return {'s': round(s, 5), 'ty': round(ty, 2), 'tx': round(tx, 2), 'yaw': ay, 'rms_x': round(math.sqrt(e / len(xs)), 2),
            'x_res': {k: round(s * L[k][0] + tx - MODEL[k][0](ay), 2) for k in xs}, 'y_res': vres, 'own_yaw': own}
L = json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/控制线-30-60/landmarks.json'))
out = {}
for name in (sys.argv[1:] or L):
    out[name] = fit(L[name]); print(name, json.dumps(out[name], ensure_ascii=False))
if not sys.argv[1:]: json.dump(out, open('/Users/bowen/Documents/headset-face3d/bench-tasks/控制线-30-60/fits.json', 'w'), ensure_ascii=False, indent=1)
