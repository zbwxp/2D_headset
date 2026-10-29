# 眼睛面朝向 (bowen 1792769114 / 1792769283 / 1792769363: perspective + sphere frame, calibrated on dot's 12 pictures).
# heights.json: near / far eye top (upper lash band) and bottom (lower lid), measured by hand (the automatic search caught
# the bangs). Finding: near/far height ratio 0.97–1.09 (≈ no vertical perspective) while the near eye widens 15–45°.
# Width model: each eye's surface faces α off the camera at 0° (the drawn 0° eye already narrowed), so turning ψ the near
# eye faces ψ − α, the far ψ + α: w = W0·sc·cos(ψ ∓ α)/cos α. Fitted: α ≈ 20.8°, sc ≈ 1.08 (dot's eyes wider than bowen's), rms ≈ 1.1.
# Angles from one-k.json (eye-row spacing). Then: track centres (x0·cos ψ + z·sin ψ, bowen's z 65.34) + these widths vs thirds.
import json, math
D = '/Users/bowen/Documents/headset-face3d/bench-tasks/自由生成-2026-10-23/'
F = json.load(open(D + 'fit.json')); LM = json.load(open(D + 'landmarks.json')); OK = json.load(open(D + 'one-k.json'))['pics']; HT = json.load(open(D + 'heights.json'))
W0 = 27.94; data = []
for n, h in HT.items():
    s = F[n]['s']; P = LM[n]
    data.append((OK[n]['angle'], (P['near_in'][0] - P['near_out'][0]) * s, (P['far_out'][0] - P['far_in'][0]) * s, (h['near_bot'] - h['near_top']) / (h['far_bot'] - h['far_top'])))
best = None
for i in range(600):
    a = math.radians(i / 10)
    for j in range(80, 130):
        sc = j / 100; e = sum((W0 * sc * math.cos(math.radians(p) - a) / math.cos(a) - wn) ** 2 + (W0 * sc * math.cos(math.radians(p) + a) / math.cos(a) - wf) ** 2 for p, wn, wf, _ in data)
        if best is None or e < best[0]: best = (e, i / 10, sc)
print('alpha', best[1], 'scale', best[2], 'rms', round(math.sqrt(best[0] / (2 * len(data))), 2), 'height ratios', [round(d[3], 2) for d in data])
