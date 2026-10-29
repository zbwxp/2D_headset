# 透视三等分 per picture (bowen 1792766088): fit X(u) = c + u·a/(1 + u·b), u = -1.5 / -0.5 / 0.5 / 1.5 to the four measured
# eye corners (near_out, near_in, far_in, far_out), placed by the picture's own fit (fits.json, uniform scale + shift).
# a = L·cos ψ, b = k·L·sin ψ → L = a/cos ψ, k = b/(L_model·sin ψ). Prints per picture; usage: python3 thirds_fit.py [names]
import json, math, sys
HERE = '/Users/bowen/Documents/headset-face3d/bench-tasks/控制线-30-60/'
L = json.load(open(HERE + 'landmarks.json')); F = json.load(open(HERE + 'fits.json'))
U = [-1.5, -0.5, 0.5, 1.5]; K = ['near_out', 'near_in', 'far_in', 'far_out']; LM, D = 28.38, 70.34
for n in sys.argv[1:] or list(L):
    p = L[n]; f = F.get(n)
    if f is None or not all(k in p for k in K): print(n, 'skip'); continue
    x = [f['s'] * p[k][0] + f['tx'] for k in K]; best = None
    for i in range(400):
        b = i / 1000; g = [u / (1 + u * b) for u in U]; m = sum(g) / 4; mx = sum(x) / 4
        a = sum((gi - m) * (xi - mx) for gi, xi in zip(g, x)) / sum((gi - m) ** 2 for gi in g); c = mx - a * m
        r = math.sqrt(sum((c + a * gi - xi) ** 2 for gi, xi in zip(g, x)) / 4)
        if best is None or r < best[0]: best = (r, b, a, c)
    r, b, a, c = best; ps = math.radians(f['yaw'])
    print(n, 'yaw', f['yaw'], 'k', round(b / (LM * math.sin(ps)), 4), 'L', round(a / math.cos(ps), 1), 'c-Dsinψ', round(c - D * math.sin(ps), 1), 'rms', round(r, 2))
