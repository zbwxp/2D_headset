# The angle each of dot's pictures really shows (bowen 1793072003): bowen's 3D points (俯仰-2026-10-25/points3d.json: x at 0°,
# height, depth = x at 90°; the far eye mirrored; a picture without the far eye is turned at least 70°), nodded by p (仰 > 0) then turned by y (face to +x), projected in parallel,
# scaled and moved: u = s·X + tx, v = s·Y + ty. Grid over y, p; s, tx, ty by least squares. The chin is a contour point, used as if fixed.
import json, math, os
H = os.path.dirname(os.path.abspath(__file__)) + '/'
P3 = json.load(open(H + '../俯仰-2026-10-25/points3d.json'))['points']
g = lambda n: (P3[n]['x'], P3[n]['y'], P3[n]['depth'])
mir = lambda p: (-p[0], p[1], p[2])
lip = tuple((a + b) / 2 for a, b in zip(g('lipUp'), g('lipLow')))
D3 = {'nO': g('eyeOut'), 'nI': g('eyeIn'), 'nIris': g('iris'), 'fO': mir(g('eyeOut')), 'fI': mir(g('eyeIn')), 'fIris': mir(g('iris')), 'nose': g('noseTip'), 'mouth': lip, 'chin': g('chin')}
L = {k: v for k, v in json.load(open(H + 'landmarks.json')).items() if not k.startswith('_')}
def project(p3, y, p):
    x, h, d = p3; cp, sp, cy, sy = math.cos(p), math.sin(p), math.cos(y), math.sin(y)
    h1, d1 = h * cp - d * sp, d * cp + h * sp
    return x * cy + d1 * sy, h1
def fit(obs, y, p):
    ks = list(obs); X = [project(D3[k], y, p) for k in ks]
    # u = s X + tx, v = s Y + ty: least squares in (s, tx, ty)
    n = len(ks); mx = sum(a for a, _ in X) / n; my = sum(b for _, b in X) / n; mu = sum(obs[k][0] for k in ks) / n; mv = sum(obs[k][1] for k in ks) / n
    num = sum((a - mx) * (obs[k][0] - mu) + (b - my) * (obs[k][1] - mv) for k, (a, b) in zip(ks, X)); den = sum((a - mx) ** 2 + (b - my) ** 2 for a, b in X)
    s = num / den; tx, ty = mu - s * mx, mv - s * my
    err = math.sqrt(sum((s * a + tx - obs[k][0]) ** 2 + (s * b + ty - obs[k][1]) ** 2 for k, (a, b) in zip(ks, X)) / n)
    return err, s, tx, ty
out = {}
for name, obs in L.items():
    best = None
    # no far eye in the picture: it is hidden behind the nose, which in the turn model happens past about 70°
    lo = 140 if 'fI' not in obs and 'fO' not in obs else -20
    for yi in range(lo, 211):
        for pi in range(-140, 141):
            y, p = math.radians(yi / 2), math.radians(pi / 2)
            e = fit(obs, y, p)
            if best is None or e[0] < best[0][0]: best = (e, yi / 2, pi / 2)
    (err, s, tx, ty), yd, pd = best
    out[name] = {'yaw': yd, 'pitch': pd, 'rms_px': round(err, 1), 'scale_px_per_unit': round(s, 4), 'tx': round(tx, 1), 'ty': round(ty, 1), 'points': len(obs)}
    print(f'{name:14s} 转 {yd:5.1f}°  俯仰 {pd:+5.1f}°  (仰为正)  误差 {err:5.1f}px  点 {len(obs)}')
json.dump(out, open(H + 'fit-angles.json', 'w'), ensure_ascii=False, indent=1)
