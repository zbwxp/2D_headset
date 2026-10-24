# 俯仰辅助点 (bowen 1792858677, dot 1792858723): the semantic points as 3D (x at 0°, height, depth = x at 90°), from the
# packaged turn model's sources and bowen's eye bones; rotated about a horizontal axis (pitch φ, 俯 > 0: the face goes down):
# height' = (y − yc)·cos φ + d·sin φ + yc, x kept. yc (the axis height) only shifts the whole picture — fitted per picture later.
# Silhouette points (crown, chin, temple, 颧骨点) are contour points, not fixed on the head: marked, rotated as if fixed (a guide only).
import json, math, os
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
M = json.load(open(HERE + '../转头模型/model.json'))
k0, k90 = M['outline']['keys'][0]['pts'], M['outline']['keys'][-1]['pts']
S = M['sheet']['pts']
P = {}
for n in ('brow', 'noseTip', 'lipUp', 'lipLow', 'chin', 'crown'): P[n] = (0.0, S[n][1], S[n][0], n in ('chin', 'crown'))
P['nearRoot'] = (k0['nearRoot'][0], k0['nearRoot'][1], k90['nearRoot'][0], False)
P['zyg'] = (-k0['zyg'][0], k0['zyg'][1], k90['zyg'][0], True)   # mirrored to the near side, a silhouette point
P['temple'] = (-k0['temple'][0], k0['temple'][1], k90['temple'][0], True)
# eyes (bowen's 3D eye bones, 2026-10-22): inner, outer, lower-lid middle; the iris centre at 65 % outer → inner, half-width 22.5 %
eye = {'eyeIn': (-15.47, -0.69, 73.18), 'eyeOut': (-45.27, 1.38, 51.2), 'eyeMid': (-26.41, 14.21, 65.79)}
for n, v in eye.items(): P[n] = (*v, False)
ei, eo = eye['eyeIn'], eye['eyeOut']
lerp3 = lambda a, b, t: tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
P['iris'] = (*lerp3(eo, ei, 0.65), False); P['irisL'] = (*lerp3(eo, ei, 0.65 - 0.225), False); P['irisR'] = (*lerp3(eo, ei, 0.65 + 0.225), False)
# ear (bowen's tuned ear at 0° and 90°: x at 0° and depth = x at 90°)
E = json.load(open(HERE + '../转头模型/sources/ear-keys.json'))['keys']
for n, key in (('earUp', 'up'), ('earTip', 'tip'), ('earLow', 'low')): P[n] = (E['0'][key][0], (E['0'][key][1] + E['90'][key][1]) / 2, E['90'][key][0], False)
out = {'note': open(__file__).read().split('\n')[0][2:], 'points': {n: {'x': round(v[0], 3), 'y': round(v[1], 3), 'depth': round(v[2], 3), 'silhouette': v[3]} for n, v in P.items()}, 'pitch': {}}
for ph in (-45, -30, -15, 0, 15, 30, 45):
    r = math.radians(ph)
    out['pitch'][str(ph)] = {n: [round(v[0], 2), round(v[1] * math.cos(r) + v[2] * math.sin(r), 2)] for n, v in P.items()}
json.dump(out, open(HERE + 'points3d.json', 'w'), ensure_ascii=False, indent=1)
for ph in ('0', '30', '-30'): print(ph, {n: v[1] for n, v in out['pitch'][ph].items() if n in ('crown', 'brow', 'eyeIn', 'iris', 'noseTip', 'nearRoot', 'earTip', 'chin')})
