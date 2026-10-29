# 透视三等分 on dot's free batch (bowen 1792766088; dot 1792766778: front reference only, no rules fed, not deformed).
# Landmarks measured by Claude from zoomed crops (landmarks.json, image px; corners = ends of the upper lash line).
# 1) placement: uniform scale + shift from the heights (eye corners, mouth, chin, ear) as in ../控制线-30-60/angle.py;
#    yaw from the sideways positions of chin, nose and ear ONLY (eyes left out so they don't decide their own angle)
# 2) per picture, fit X(u) = c + u·a/(1 + u·b), u = -1.5/-0.5/0.5/1.5 to the four corners; k = b/(L0·sin ψ), L = a/cos ψ
import json, math, sys
src = open('/Users/bowen/Documents/headset-face3d/bench-tasks/控制线-30-60/angle.py').read(); exec(src[:src.index('L = json.load')])
HERE = '/Users/bowen/Documents/headset-face3d/bench-tasks/自由生成-2026-10-23/'
LM = json.load(open(HERE + 'landmarks.json')); U = [-1.5, -0.5, 0.5, 1.5]; K = ['near_out', 'near_in', 'far_in', 'far_out']; L0, D0 = 28.38, 70.34
out = {}
for n, P in LM.items():
    rows = [(P[k][1], MODEL[k][1]) for k in P if MODEL[k][1] is not None and not k.endswith('_mid')]
    m1 = sum(r[0] for r in rows) / len(rows); m2 = sum(r[1] for r in rows) / len(rows)
    s = sum((r[0] - m1) * (r[1] - m2) for r in rows) / sum((r[0] - m1) ** 2 for r in rows); ty = m2 - s * m1
    xs = ['chin', 'nose', 'ear']; best = None
    for i in range(0, 901):
        ay = i / 10; d = [MODEL[k][0](ay) - s * P[k][0] for k in xs]; tx = sum(d) / 3; e = sum((v - tx) ** 2 for v in d)
        if best is None or e < best[0]: best = (e, ay, tx)
    e, ay, tx = best; x = [s * P[k][0] + tx for k in K]; bb = None
    for i in range(0, 600):
        b = i / 1000; g = [u / (1 + u * b) for u in U]; m = sum(g) / 4; mx = sum(x) / 4
        a = sum((gi - m) * (xi - mx) for gi, xi in zip(g, x)) / sum((gi - m) ** 2 for gi in g); c = mx - a * m
        r = math.sqrt(sum((c + a * gi - xi) ** 2 for gi, xi in zip(g, x)) / 4)
        if bb is None or r < bb[0]: bb = (r, b, a, c)
    r, b, a, c = bb; ps = math.radians(ay)
    wn, wf = x[1] - x[0], x[3] - x[2]
    hn = s * (P['near_mid'][1] - (P['near_out'][1] + P['near_in'][1]) / 2); hf = s * (P['far_mid'][1] - (P['far_out'][1] + P['far_in'][1]) / 2) if 'far_mid' in P else None
    res = {'yaw': ay, 'face_rms': round(math.sqrt(e / 3), 2), 's': round(s, 4), 'k': round(b / (L0 * math.sin(ps)), 4) if ay > 3 else None, 'b': b,
           'L': round(a / math.cos(ps), 2), 'c_minus_Dsin': round(c - D0 * math.sin(ps), 2), 'thirds_rms': round(r, 2),
           'parts': [round(x[1] - x[0], 1), round(x[2] - x[1], 1), round(x[3] - x[2], 1)], 'w_ratio': round(wn / wf, 2), 'h_ratio': round(hn / hf, 2) if hf else None}
    out[n] = res; print(n, json.dumps(res, ensure_ascii=False))
json.dump(out, open(HERE + 'fit.json', 'w'), ensure_ascii=False, indent=1)
