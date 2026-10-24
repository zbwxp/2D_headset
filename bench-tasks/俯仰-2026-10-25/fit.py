# 俯仰 fit (dot 1792859761: the fitted angle is the model's angle, not a measurement; one set of points sets it, others test).
# Every picture scaled to the 0° group's eye width (outer-tip distance; pitch keeps x). Heights relative to the eye line
# (mean of the two outer tips). Each feature: its height at 0° from the 0° group's mean, its depth from bowen's model
# (points3d.json; 0° pictures and bowen's head differ in proportion, depth is the only borrowed quantity).
# Rotation (俯 > 0): Δ(φ) = Δ0·cos φ + Δd·sin φ, Δd = feature depth − eye-tip depth, converted with the 0° px ↔ model scale.
# φ is fitted per picture from nose + mouth only; iris, lower lid, ear top / bottom and chin are the test.
import json, math, os
H = os.path.dirname(os.path.abspath(__file__)) + '/'
L = json.load(open(H + 'landmarks.json')); P3 = json.load(open(H + 'points3d.json'))['points']
names = [k for k in L if not k.startswith('_')]
W0 = sum(L[n]['Ro'][0] - L[n]['Lo'][0] for n in names if n.startswith('zero')) / 4
S = 2 * 45.27 / W0                       # model units per 0° px: bowen's outer-corner distance over the 0° group's
D = {'eyeTip': 51.2, 'iris': P3['iris']['depth'], 'lid': P3['eyeMid']['depth'], 'nose': P3['noseTip']['depth'], 'mouth': P3['lipUp']['depth'],
     'chin': P3['chin']['depth'], 'earT': P3['earUp']['depth'], 'earB': P3['earLow']['depth']}
F = ['iris', 'lid', 'nose', 'mouth', 'chin', 'earT', 'earB']
def rel(n):
    p = L[n]; k = W0 / (p['Ro'][0] - p['Lo'][0]); eye = (p['Lo'][1] + p['Ro'][1]) / 2
    return {f: (p[f] - eye) * k * S for f in F}     # model units, + = below the eye line
R = {n: rel(n) for n in names}
Z0 = {f: sum(R[n][f] for n in names if n.startswith('zero')) / 4 for f in F}
dd = {f: D[f] - D['eyeTip'] for f in F}
pred = lambda f, ph: Z0[f] * math.cos(math.radians(ph)) + dd[f] * math.sin(math.radians(ph))
SET, TEST = ['nose', 'mouth'], ['iris', 'lid', 'earT', 'earB', 'chin']
out = {}
for n in names:
    best = min((sum((pred(f, ph / 2) - R[n][f]) ** 2 for f in SET), ph / 2) for ph in range(-120, 121))
    ph = best[1]; res = {f: round(R[n][f] - pred(f, ph), 1) for f in F}
    out[n] = {'label': n.split('-')[0], 'fitted': ph, 'setRms': round(math.sqrt(best[0] / 2), 2), 'res': res}
    print(f"{n:10s} fitted {ph:6.1f}°  set rms {out[n]['setRms']:4.1f} | test residuals " + ' '.join(f"{f} {res[f]:+5.1f}" for f in TEST))
print('0° group (model units below the eye line):', {f: round(v, 1) for f, v in Z0.items()}, '· depth differences', {f: round(v, 1) for f, v in dd.items()})
json.dump({'note': open(__file__).read().split('\n')[0][2:], 'scale': S, 'zero': Z0, 'depthDiff': dd, 'pictures': out}, open(H + 'fit.json', 'w'), ensure_ascii=False, indent=1)

# each feature alone: the angle its own height implies (the rigid model, bowen's depths); per label group, mean ± spread
def implied(f, v):
    best = min((abs(pred(f, ph / 2) - v), ph / 2) for ph in range(-180, 181)); return best[1] if best[0] < 1.0 else None
groups = {}
for n in names: groups.setdefault(n.split('-')[0], []).append(n)
print('\nangle each feature implies (°, 俯 +), group mean [min … max]; — = no angle in −90…90 reaches it')
FE = ['nose', 'mouth', 'chin', 'iris', 'lid', 'earT', 'earB']
rows = {}
for g in ['up45', 'up30', 'up15', 'zero', 'down15', 'down30', 'down45']:
    row = {}
    for f in FE:
        vs = [implied(f, R[n][f]) for n in groups[g]]; ok = [v for v in vs if v is not None]
        row[f] = (round(sum(ok) / len(ok), 1), min(ok), max(ok), len(vs) - len(ok)) if ok else None
    rows[g] = row
    print(f"{g:7s} " + ' '.join(f"{f} {('—' if r is None else f'{r[0]:+.0f}[{r[1]:+.0f}…{r[2]:+.0f}]' + ('*' if r[3] else ''))}" for f, r in row.items()))
json.dump({'implied': rows}, open(H + 'implied.json', 'w'), ensure_ascii=False, indent=1)
