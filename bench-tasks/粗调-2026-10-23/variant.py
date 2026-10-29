# Builds the 粗调 variant from rough.json: keyframes 0 / 45 / 90 (bowen's, unchanged) + one per picture at its matched
# yaw: the outline as interpolated with the slid locked points, the side sheet at its fitted angle; per variant a sheet
# table (yaw → θ) and an eye table (yaw → φ, ψ). Eye φ smoothed where single pictures disagree (dot 1792684703: shared
# trends over single-picture quirks): near φ = k·yaw (least squares over all rows, 45 / 90 included). Background = the
# picture, placed by its fit. Backup of turncheck.json first.
import json, math, shutil, time
T = '/Users/bowen/Documents/headset-face3d/bench-tasks/迁移/turncheck.json'
shutil.copy(T, '/Users/bowen/Documents/headset-face3d/bench-tasks/备份/turncheck-before-粗调-%s.json' % time.strftime('%H%M'))
all_ = json.load(open(T)); R = json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/粗调-2026-10-23/rough.json'))
# 75° (yaw60-07) dropped (bowen 1792685328: with it the 3-line side widens 60–75 and narrows again to 90; the picture is off)
DROP = {'yaw60-07'}; OUTLINE_KEEP = {'yaw30-09', 'yaw30-04'}; R = {n: r for n, r in R.items() if n not in DROP}
FITS = json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/控制线-30-60/fits.json'))
V0 = [n for n in all_['variants'] if n.startswith('侧脸平片')][0]
VN = '粗调 2026-10-23 · ' + V0; K0 = all_['variants'][V0]; SH0 = all_['sheet'][V0]; E = all_['eyes']
lerp = lambda a, b, t: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
SIZE = {'yaw30-09': (1121, 1403), 'yaw30-04': (1121, 1403), 'yaw60-08': (1032, 1523), 'yaw60-09': (1122, 1402), 'yaw60-07': (1121, 1403)}
keys = [K0[0], K0[1], K0[2]]
for name, r in R.items():
    ay = r['yaw']; i = 0 if ay <= 45 else 1; A, B = K0[i], K0[i + 1]; t = (ay - A['yaw']) / (B['yaw'] - A['yaw'])
    pts = {k: lerp(A['pts'][k], B['pts'][k], t) for k in A['pts']}
    # the far-side outline changes at 50 / 61 (one picture each) make the far edge dip 45 → 50 and rise again to 90; like 75
    # (bowen 1792685328) they are dropped — the outline there stays the 侧脸平片 interpolation; 25 / 34 kept
    if name in OUTLINE_KEEP:
        for k, p in r['outline']['after'].items(): pts[k] = p
    lines = [dict(l, ha=lerp(l['ha'], m['ha'], t), hb=lerp(l['hb'], m['hb'], t)) for l in A['lines'] for m in B['lines'] if m['a'] == l['a'] and m['b'] == l['b']]
    F = FITS[name]; W, H = SIZE[name]
    keys.append({'yaw': ay, 'pts': pts, 'lines': lines, 'ref': {'src': '/@fs/Users/bowen/Documents/headset-face3d/bench-tasks/' + '%E6%8E%A7%E5%88%B6%E7%BA%BF-30-60/%E5%80%99%E9%80%89/' + name + '.png',
                 'x': F['tx'] + F['s'] * W / 2, 'y': F['ty'] + F['s'] * H / 2, 'w': F['s'] * W, 'h': F['s'] * H}, 'from': name})
keys.sort(key=lambda k: k['yaw'])
sheet = [[0, 0.0]] + sorted([[r['yaw'], r['sheet']['after']] for r in R.values()] + [[45, SH0['theta45']]]) + [[90, 90.0]]
# eyes: ψ from the fits; near φ = k·yaw (smoothed), far φ from the fits where measured (else the old table)
# near φ: weakly determined (the near eye's width hardly changes with φ) and the pictures disagree; bowen's 0/45/90 rows are
# kept exactly (dot 1792685097: the trend must not overwrite hand-tuned keyframes) and the new rows take the old table's
# interpolation; only ψ comes from the fits. (The least-squares slope over all rows, ≈ 0.51, is reported, not applied.)
rows = [(r['yaw'], r['near']['after'][0]) for r in R.values()] + [(45, 16.0), (90, 46.0)]
k = sum(p * y for y, p in rows) / sum(y * y for y, p in rows)
def oldnear(ay):
    t = E['near']
    for j in range(1, len(t)):
        if t[j][0] >= ay: a, b = t[j - 1], t[j]; u = (ay - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * u
near = [[0, 0, 0]] + sorted([[r['yaw'], round(oldnear(r['yaw']), 2), r['near']['after'][1]] for r in R.values()] + [[45, 16.0, 43.35]]) + [[90, 46.0, 90]]
farfit = {r['yaw']: r['far']['after'] for r in R.values() if 'after' in r['far']}
def oldfar(ay):
    t = E['far']
    for j in range(1, len(t)):
        if t[j][0] >= ay: a, b = t[j - 1], t[j]; u = (ay - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
far = [[0, 0, 0]] + sorted([[r['yaw']] + (farfit[r['yaw']] if r['yaw'] in farfit else [round(v, 2) for v in oldfar(r['yaw'])]) for r in R.values()] + [[45, 63.8, 41.38]]) + [[90, 95.0, 90]]
all_['variants'] = {VN: keys, **{n: v for n, v in all_['variants'].items() if n != VN}}
all_['sheet'][VN] = {'theta45': SH0['theta45'], 'pts': SH0['pts'], 'table': sheet}
all_.setdefault('eyesBy', {})[VN] = {'near': near, 'far': far}
json.dump(all_, open(T, 'w'), ensure_ascii=False)
print('k', round(k, 4)); print('sheet', sheet); print('near', near); print('far', far); print([ (x['yaw'], x.get('from')) for x in keys])
