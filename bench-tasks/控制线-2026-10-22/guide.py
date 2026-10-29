# 控制线图 (bowen 1792636672, dot 1792636713): 0° / 45° / 90° in each reference's own frame — the chosen face outline
# (symmetric keyframes, 03 with the ear point on the turn), the turning axis, the fixed heights, nose / mouth / ear by the
# axis, the eyes cut from the current references (their anime offset kept). No head-ball circle.
import json, math, struct, subprocess
TC = json.load(open('/Users/bowen/Documents/headset-face3d/bench-tasks/迁移/turncheck.json'))
keys = {k['yaw']: k for k in TC['variants']['近2远3 · 对称 · 45° 近侧耳点按旋转（对照）']}
REF = '/private/tmp/claude-501/-Users-bowen-Documents-headset/87c94b45-bc1a-4505-a0ba-5c153d4e1470/scratchpad/n23/r%d.bmp'
def readbmp(f):
    b = open(f, 'rb').read(); off, = struct.unpack_from('<I', b, 10); W, H = struct.unpack_from('<ii', b, 18); row = (W * 3 + 3) // 4 * 4
    return W, -H, (lambda x, y: b[off + y * row + 3 * x: off + y * row + 3 * x + 3])
CROWN, EYE, TEMPLE, EAR, NOSE, MOUTH, CHIN = -82.2, -1.8, -2.67, 25.0, 24.4, 38.8, 62.3
EAR_X0, EAR_Z, NOSE_Z, MOUTH_Z = -43.91, 21.81, 90.8, 85.0
EAR_TOP, EAR_LOBE = -1.6, 33.3
# each eye moved up to 0°'s height (bowen 1792637037: a pure yaw keeps the eyes' height; the anime offset is sideways only)
EYE_UP = {0: 0.0, 45: 1.0, 90: 2.5}
EYES = {0: [(-29, 2, 16, 15), (29, 2, 16, 15)], 45: [(27.5, 4, 17, 13), (68, 8, 10, 12)], 90: [(65, 5.5, 12, 13)]}
import sys
CLEAN = sys.argv[1] == 'clean'
for yaw, k in keys.items():
    W, H, px = readbmp(REF % yaw); im = k['ref']; sc = im['w'] / W; X0 = im['x'] - im['w'] / 2; Y0 = im['y'] - im['h'] / 2
    img = bytearray(b'\xff' * (W * H * 3))
    P = lambda x, y: ((x - X0) / sc, (y - Y0) / sc)
    def dot(cx, cy, r, c):
        for yy in range(int(cy - r), int(cy + r) + 1):
            for xx in range(int(cx - r), int(cx + r) + 1):
                if 0 <= xx < W and 0 <= yy < H and (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r: i = 3 * (yy * W + xx); img[i:i + 3] = bytes(c)
    def seg(a, b, w, c, dash=0):
        (x1, y1), (x2, y2) = P(*a), P(*b); n = int(max(abs(x2 - x1), abs(y2 - y1))) + 1
        for i in range(n + 1):
            if dash and (i // dash) % 2: continue
            t = i / n; dot(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w / 2, c)
    def hline(y, c, w=3, dash=0): seg((X0, y), (X0 + W * sc, y), w, c, dash)
    # the eyes: dark pixels of the current reference inside an ellipse around each eye, as they are drawn
    for (ex, ey, rx, ry) in EYES[yaw]:
        cx, cy = P(ex, ey)
        for yy in range(int(cy - ry / sc), int(cy + ry / sc) + 1):
            for xx in range(int(cx - rx / sc), int(cx + rx / sc) + 1):
                if ((xx - cx) * sc / rx) ** 2 + ((yy - cy) * sc / ry) ** 2 > 1: continue
                r, g, b = px(xx, yy)[::-1]
                ty = yy - int(round(EYE_UP[yaw] / sc))
                if 0.299 * r + 0.587 * g + 0.114 * b < 205 and 0 <= ty < H: i = 3 * (ty * W + xx); img[i:i + 3] = b'\x55\x55\x55'
    # the fixed heights
    for y, c in ((CROWN, (122, 0, 255)), (EYE, (224, 112, 0)), (TEMPLE, (58, 123, 213)), (EAR, (230, 0, 120)), (NOSE, (0, 150, 150)), (MOUTH, (200, 120, 0)), (CHIN, (0, 166, 81))):
        if not CLEAN: hline(y, c, 3, 14)
    # the turning axis (fixed on the page) and the face's middle line through chin, mouth, nose
    r = math.radians(yaw)
    if not CLEAN: seg((0, CROWN - 10), (0, CHIN + 15), 3, (150, 150, 150), 10)
    chin = k['pts']['cmv3m1am1-6/pmv3m1am1-2']; mouth = (MOUTH_Z * math.sin(r), MOUTH); nose = (NOSE_Z * math.sin(r), NOSE)
    seg(tuple(chin), mouth, 4, (0, 150, 150)); seg(mouth, nose, 4, (0, 150, 150))
    for q in (nose, mouth): dot(*P(*q), 12, (0, 150, 150))
    # the ear: ear-hole bottom on the turn, its top and lobe heights as short ticks
    ex = EAR_X0 * math.cos(r) + EAR_Z * math.sin(r)
    dot(*P(ex, EAR), 14, (230, 0, 120))
    for y in (EAR_TOP, EAR_LOBE): seg((ex - 8, y), (ex + 8, y), 5, (230, 0, 120))
    seg((ex - 8, EAR_TOP), (ex - 8, EAR_LOBE), 3, (230, 0, 120), 8)
    # the face outline, the chosen keyframe
    pts = k['pts']
    for l in k['lines']:
        a, b = pts[l['a']], pts[l['b']]; c = [a, (a[0] + l['ha'][0], a[1] + l['ha'][1]), (b[0] + l['hb'][0], b[1] + l['hb'][1]), b]
        prev = None
        for i in range(81):
            t = i / 80; u = 1 - t; q = tuple(u * u * u * c[0][j] + 3 * u * u * t * c[1][j] + 3 * u * t * t * c[2][j] + t * t * t * c[3][j] for j in range(2))
            if prev: seg(prev, q, 7, (17, 17, 17))
            prev = q
    for id, col in (('cmv3m1am1-6/pmv3m1am1-4', (122, 0, 255)), ('cmv3m1am1-6/pmv3m1am1-2', (0, 166, 81)), ('pmv3m1am1-1', (40, 40, 40)), ('pm03-skf', (58, 123, 213))):
        dot(*P(*pts[id]), 12, col)
    row = (W * 3 + 3) // 4 * 4
    hdr = b'BM' + struct.pack('<IHHI', 54 + row * H, 0, 0, 54) + struct.pack('<IiiHHIIiiII', 40, W, -H, 1, 24, 0, row * H, 0, 0, 0, 0)
    body = b''.join(bytes(b for i in range(W) for b in img[3 * (y * W + i): 3 * (y * W + i) + 3][::-1]) + b'\0' * (row - 3 * W) for y in range(H))
    open(f'g{yaw}{CLEAN}.bmp', 'wb').write(hdr + body)
    subprocess.run(['sips', '-s', 'format', 'png', f'g{yaw}{CLEAN}.bmp', '--out', (f'控制线-yaw{yaw}.png' if CLEAN else f'说明-yaw{yaw}.png')], check=True, capture_output=True)
    print(yaw, 'ear x', round(ex, 2), 'nose x', round(nose[0], 2), 'mouth x', round(mouth[0], 2), 'chin', chin)
