# 俯仰 by the model (bowen 1793023478): the side face sheet (90° profile: depth d, height y, bench-tasks/转头模型/model.json)
# turned rigidly about a horizontal axis, the eye line kept still (eye centre depth 65.34 → height 0).
# One angle per direction, set by bowen's two ear points (v3); then compared with his crown / chin (outline top / bottom
# = the turned profile's highest / lowest point) and the ear tip.  y' = y·cos φ ∓ (d − 65.34)·sin φ  (仰 −, 俯 +)
import json, math, os
H = os.path.dirname(os.path.abspath(__file__)) + '/'
m = json.load(open(H + '../转头模型/model.json')); S = m['sheet']; P = S['pts']
bez = lambda c, t: [(1-t)**3*c[0][k] + 3*(1-t)**2*t*c[1][k] + 3*(1-t)*t*t*c[2][k] + t**3*c[3][k] for k in (0, 1)]
prof = [bez([P[l['a']], [P[l['a']][0]+l['ha'][0], P[l['a']][1]+l['ha'][1]], [P[l['b']][0]+l['hb'][0], P[l['b']][1]+l['hb'][1]], P[l['b']]], i/200) for l in S['lines'] for i in range(201)]
ear = {'上耳点': (12.9062, 0.9702), '下耳点': (17.3907, 31.2331), '耳尖': (-8, 0)}
bowen = {'仰45': {'上耳点': 28.5, '下耳点': 44.4, '耳尖': 21.1, '颅顶': -62.2, '下巴': 48.4}, '俯45': {'上耳点': -13.4, '下耳点': 13.1, '耳尖': -13.9, '颅顶': -94.2, '下巴': 46.3}}
out = {}
for k, sg in (('仰45', -1), ('俯45', 1)):
    b = bowen[k]
    Y = lambda d, y, p: y*math.cos(p) + sg*(d - 65.34)*math.sin(p)
    deg = min((i/10 for i in range(901)), key=lambda a: sum((Y(*ear[n], math.radians(a)) - b[n])**2 for n in ('上耳点', '下耳点')))
    p = math.radians(deg); ys = [Y(d, y, p) for d, y in prof]
    model = {**{n: Y(*ear[n], p) for n in ear}, '颅顶': min(ys), '下巴': max(ys)}
    out[k] = {'angle': deg, 'points': {n: {'model': round(v, 1), 'bowen': b[n], 'diff': round(v - b[n], 1)} for n, v in model.items()}}
    print(k, f'转 {deg}°', ' · '.join(f"{n} 模型 {v['model']} 你 {v['bowen']} 差 {v['diff']}" for n, v in out[k]['points'].items()))
json.dump(out, open(H + 'rigid-pitch.json', 'w'), ensure_ascii=False, indent=1)
