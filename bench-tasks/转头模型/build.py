# 转头模型 data (bowen 1792849247: 打包). One file, the final version only, readable names; the reference pictures as files.
# Sources: bench-tasks/迁移/turncheck.json variant 「侧脸平片 · 90° 远侧脸收 5」 (bowen's 0 / 45 / 90° keyframes, his 90° far face
# pulled in 5 (1792811015), chin handle (1792764100)); its 侧脸平片 sheet; turncheck.json eyes (his 0° eye, track, sphere r);
# bench-tasks/耳朵-2026-10-24/ear-keys.json (his hand-tuned near ear, the 90° shape). Read only; writes model.json and ref-*.png.
import base64, json, os
BT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..') + '/'   # the repo's bench-tasks/, wherever the repo is
OUT = BT + '转头模型/'
# the inputs, archived beside this script (sources/: the final variant of 迁移/turncheck.json, its sheet and eyes; the ear keys)
T = json.load(open(OUT + 'sources/turncheck-final.json'))
K, SH, E = T['keys'], T['sheet'], T['eyes']
EAR = json.load(open(OUT + 'sources/ear-keys.json'))['keys']
ID = {'cmv3m1am1-6/pmv3m1am1-4': 'crown', 'cmv3m1am1-6/pmv3m1am1-2': 'chin', 'cmv3m1am1-6/pmv3m1am1-1': 'nearRoot',
      'pmv3m1am1-1': 'zyg', 'pm03-skf': 'temple',
      'pmv6kklw1-11': 'crown', 'pmv6kklw1-2': 'chin', 'pmv6kklw1-3': 'lipLow', 'pmv6kklw1-5': 'lipUp', 'pmv6kklw1-7': 'noseTip', 'pmv6kklw1-9': 'brow'}
NAME = {'右下颌': 'nearJaw', '右颅': 'nearSkull', '左下颌': 'farJaw', '左颊': 'farCheek', '左颅': 'farSkull'}
r = lambda v: [round(v[0], 4), round(v[1], 4)]
outlineLines = [{'name': NAME[l['name']], 'label': l['name'], 'a': ID[l['a']], 'b': ID[l['b']]} for l in K[0]['lines'] if not l.get('side')]
keys = []
for k in K:
    keys.append({'yaw': k['yaw'], 'pts': {ID[p]: r(k['pts'][p]) for p in ('cmv3m1am1-6/pmv3m1am1-1', 'pmv3m1am1-1', 'pm03-skf')},
                 'handles': {NAME[l['name']]: {'ha': r(l['ha']), 'hb': r(l['hb'])} for l in k['lines'] if not l.get('side')}})
k90 = K[-1]
sheetPts = {ID[p]: r(v) for p, v in SH['pts'].items()}
sheetPts['crown'] = r(k90['pts']['pmv6kklw1-11']); sheetPts['chin'] = r(k90['pts']['pmv6kklw1-2'])
sideLines = [{'name': 'side' + str(i + 1), 'label': l['name'], 'a': ID[l['a']], 'b': ID[l['b']], 'ha': r(l['ha']), 'hb': r(l['hb'])} for i, l in enumerate(x for x in k90['lines'] if x.get('side'))]
refs = [{'yaw': k['yaw'], 'file': k['ref']['src'], **{q: round(k['ref'][q], 4) for q in ('x', 'y', 'w', 'h')}} for k in K]
e90 = EAR['90']
model = {
  'note': '转头模型 — the final turning-head model (bowen 1792849247). Build: bench-tasks/转头模型/build.py. Rules: face3d/turnmodel/README.md',
  'outline': {'lines': outlineLines, 'keys': keys},
  'sheet': {'theta45': SH['theta45'], 'pts': sheetPts, 'lines': sideLines},
  'eyes': {'base': [[r(p) for p in c] for c in E['base']], 'anchor': r(E['anchor']), 'z': E['z'], 'r': E['r']},
  'ear': {'up': r(e90['up']), 'tip': r(e90['tip']), 'low': r(e90['low']), 'upLine': {k: r(v) for k, v in e90['upLine'].items()}, 'lowLine': {k: r(v) for k, v in e90['lowLine'].items()}},
  'params': {
    'eyeAlpha': {'value': 28, 'source': 'each eye faces 28° off the camera at 0° — fit to the thirds 0–50° + bowen 90° near-eye width (1792770380 refit)'},
    'eyeRate': {'value': 0.76, 'source': 'sphere frame turns 0.76 × the head — same fit'},
    'eyeKappa': {'value': 0.003, 'source': '近大远小 on depth, across and up — near/far height 1.12 at 45° (his 45° reference 1.08–1.16)'},
    'earFacing0': {'value': 46.3, 'source': 'the ear plate faces 46.3° away at 0° — bowen 0° ear width 14.4 = 20.9·cos 46.3° (1792814046)'},
    'earUp': {'value': 1.6, 'source': '上耳点 height — mean of bowen 0/45/90 ear keys'},
    'earLow': {'value': 30.2, 'source': '下耳点 height — mean of bowen 0/45/90 ear keys'},
    'fakePush': {'value': 0.4, 'source': '假线 ear root slides out by 0.4 × the far 颧骨点 move — a little far ear at 30°, gone at 32° (bowen 1792846244; dot pictures 25–30°)'},
  },
  'refs': refs,
}
json.dump(model, open(OUT + 'model.json', 'w'), ensure_ascii=False, indent=1)
print('ok', len(keys), len(sideLines), os.path.getsize(OUT + 'model.json'))
