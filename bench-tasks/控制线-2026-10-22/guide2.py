# 控制图 v3 (bowen 1792638684: as much information as possible): v2 + labelled height lines, the axis and the face
# middle line, both ears and the front-view nose / mouth marks cut from dot's generated drawing and moved onto the model
# positions (ear-hole bottom on the turn; nose and mouth on their lines). Labels are drawn afterwards (labels.swift).
import json, math, struct, subprocess
exec(open('guide.py').read().split("import sys\nCLEAN")[0])   # the v2 constants, keys, readbmp
G = open('gen1.bmp', 'rb').read(); goff, = struct.unpack_from('<I', G, 10); GW, GH = struct.unpack_from('<ii', G, 18); GH = abs(GH); grow = (GW * 3 + 3) // 4 * 4
GS = GW / 4533; GK = GS / 0.16550333333333334; GPW = 1511 * GS; GREFX = {0: 0.0, 45: 13.481686576394216, 90: 19.065984}; GY0 = -15.491112 - 945 * 0.16550333333333334
def gen(yaw, x, y):   # the generated drawing at canvas (x, y) of view yaw, nearest pixel
    j = [0, 45, 90].index(yaw); px = int(j * GPW + (x - (GREFX[yaw] - 125)) * GK); py = int((y - GY0) * GK)
    if not (j * GPW <= px < (j + 1) * GPW - 1 and 0 <= py < GH): return 255
    i = goff + py * grow + 3 * px; return (G[i] + G[i + 1] + G[i + 2]) / 3
# pieces cut from the generated drawing: (centre, radii, shift) in canvas units; ear shift puts its ear-hole bottom on the turn
# pieces: (dst centre, radii, (s, tx, ty)) with dst = s·src + t — ears moved (s 1); the lower face (nose, mouth, side
# nose-lip line, neck) scaled evenly so the generated chin lands on the outline's chin (dot 1792638727: keep the shapes'
# proportions; the liquify squashed only vertically)
L0 = (62.3 / 69.8, 0.0, 0.0); L45 = (62.3 / 68.1, 50.45 - 62.3 / 68.1 * 45.6, 0.0); L90 = (62.3 / 70.6, 72.4 - 62.3 / 70.6 * 80.0, 62.3 - 62.3 / 70.6 * 68.3)
PIECES = {0: [((-51, 13), (19, 25), (1, 8.3, 0)), ((51, 13), (19, 25), (1, -8.3, 0)), ((0, 24), (3.5, 4.5), L0), ((0, 39), (10, 5), L0), ((0, 74), (34, 12), L0)],
          45: [((-21.8, 11.4), (19, 25), (1, 7.2, -0.6)), ((64.2, 24.4), (5, 9), (1, -3.0, -2.1)), ((55, 39), (11, 5), L45), ((57, 74), (30, 12), L45)],
          90: [((10.9, 8.9), (21, 27), (1, 5.9, -1.1)), ((88, 32), (10, 34), L90), ((63, 74), (22, 12), L90)]}
labels = {}
for yaw, k in keys.items():
    W, H, px = readbmp(REF % yaw); im = k['ref']; sc = im['w'] / W; X0 = im['x'] - im['w'] / 2; Y0 = im['y'] - im['h'] / 2
    img = bytearray(b'\xff' * (W * H * 3)); P = lambda x, y: ((x - X0) / sc, (y - Y0) / sc)
    def dot(cx, cy, r, c):
        for yy in range(int(cy - r), int(cy + r) + 1):
            for xx in range(int(cx - r), int(cx + r) + 1):
                if 0 <= xx < W and 0 <= yy < H and (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r: i = 3 * (yy * W + xx); img[i:i + 3] = bytes(c)
    def seg(a, b, w, c, dash=0):
        (x1, y1), (x2, y2) = P(*a), P(*b); n = int(max(abs(x2 - x1), abs(y2 - y1))) + 1
        for i in range(n + 1):
            if dash and (i // dash) % 2: continue
            t = i / n; dot(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w / 2, c)
    lab = []
    # height lines with their labels at the panel's left
    for y, c, name in ((CROWN, (122, 0, 255), '颅顶'), (EYE, (224, 112, 0), '眼'), (EAR, (230, 0, 120), '鼻 · 耳朵眼下端 · 颧骨点'), (MOUTH, (200, 120, 0), '嘴'), (CHIN, (0, 166, 81), '下巴')):
        seg((im['x'] - 118, y), (im['x'] + 118, y), 2, c, 14); lab.append((im['x'] - 117, y - 1.2, name, c))
    # the axis (fixed) and the face middle line (moves with the turn)
    r = math.radians(yaw); seg((0, CROWN - 12), (0, CHIN + 20), 2, (140, 140, 140), 10); lab.append((0.8, CHIN + 19, '转轴（固定）', (120, 120, 120)))
    chin = k['pts']['cmv3m1am1-6/pmv3m1am1-2']; mouth = (MOUTH_Z * math.sin(r), MOUTH); nose = (NOSE_Z * math.sin(r), NOSE)
    seg(tuple(chin), mouth, 3, (0, 150, 150)); seg(mouth, nose, 3, (0, 150, 150))
    if yaw: lab.append((nose[0] + 2, nose[1] - 2, '脸中线', (0, 130, 130)))
    # eyes from the current references (moved to 0°'s height), pieces from the generated drawing
    for (ex, ey, rx, ry) in EYES[yaw]:
        cx, cy = P(ex, ey)
        for yy in range(int(cy - ry / sc), int(cy + ry / sc) + 1):
            for xx in range(int(cx - rx / sc), int(cx + rx / sc) + 1):
                if ((xx - cx) * sc / rx) ** 2 + ((yy - cy) * sc / ry) ** 2 > 1: continue
                rr, g, b = px(xx, yy)[::-1]; ty = yy - int(round(EYE_UP[yaw] / sc))
                if 0.299 * rr + 0.587 * g + 0.114 * b < 205 and 0 <= ty < H: i = 3 * (ty * W + xx); img[i:i + 3] = b'\x55\x55\x55'
    for (dc, rad, (ss, tx, ty)) in PIECES[yaw]:
        cx, cy = P(*dc)
        for yy in range(int(cy - rad[1] / sc), int(cy + rad[1] / sc) + 1):
            for xx in range(int(cx - rad[0] / sc), int(cx + rad[0] / sc) + 1):
                x = X0 + xx * sc; y = Y0 + yy * sc
                if ((x - dc[0]) / rad[0]) ** 2 + ((y - dc[1]) / rad[1]) ** 2 > 1 or not (0 <= xx < W and 0 <= yy < H): continue
                l = gen(yaw, (x - tx) / ss, (y - ty) / ss)
                if l < 200:
                    for dy in (-2, -1, 0, 1, 2):
                        for dx in (-2, -1, 0, 1, 2):
                            if 0 <= xx + dx < W and 0 <= yy + dy < H: i = 3 * ((yy + dy) * W + xx + dx); img[i:i + 3] = b'\x33\x33\x33'
    ex = EAR_X0 * math.cos(r) + EAR_Z * math.sin(r); dot(*P(ex, EAR), 12, (230, 0, 120)); lab.append((ex - 14, EAR + 6, '耳点', (230, 0, 120)))
    pts = k['pts']
    for l in k['lines']:
        a, b = pts[l['a']], pts[l['b']]; c = [a, (a[0] + l['ha'][0], a[1] + l['ha'][1]), (b[0] + l['hb'][0], b[1] + l['hb'][1]), b]; prev = None
        for i in range(81):
            t = i / 80; u = 1 - t; q = tuple(u * u * u * c[0][j] + 3 * u * u * t * c[1][j] + 3 * u * t * t * c[2][j] + t * t * t * c[3][j] for j in range(2))
            if prev: seg(prev, q, 7, (17, 17, 17))
            prev = q
    for id, col, name in (('cmv3m1am1-6/pmv3m1am1-4', (122, 0, 255), '颅顶'), ('cmv3m1am1-6/pmv3m1am1-2', (0, 166, 81), '下巴'), ('pmv3m1am1-1', (40, 40, 40), '颧骨点'), ('pm03-skf', (58, 123, 213), '太阳穴点')):
        dot(*P(*pts[id]), 11, col)
    for q in (nose, mouth): dot(*P(*q), 10, (0, 150, 150))
    lab.append((pts['pm03-skf'][0] + 2, pts['pm03-skf'][1] - 2, '太阳穴点', (58, 123, 213))); lab.append((pts['pmv3m1am1-1'][0] + 2, pts['pmv3m1am1-1'][1] + 5, '颧骨点', (40, 40, 40)))
    lab.append((chin[0] - 6, chin[1] + 6, '下巴', (0, 166, 81))); lab.append((pts['cmv3m1am1-6/pmv3m1am1-4'][0] + 2, CROWN - 2, '颅顶', (122, 0, 255)))
    labels[yaw] = [(P(x, y), t, c) for (x, y, t, c) in lab]
    row = (W * 3 + 3) // 4 * 4
    hdr = b'BM' + struct.pack('<IHHI', 54 + row * H, 0, 0, 54) + struct.pack('<IiiHHIIiiII', 40, W, -H, 1, 24, 0, row * H, 0, 0, 0, 0)
    body = b''.join(bytes(b for i in range(W) for b in img[3 * (y * W + i): 3 * (y * W + i) + 3][::-1]) + b'\0' * (row - 3 * W) for y in range(H))
    open(f'v3-{yaw}.bmp', 'wb').write(hdr + body)
    subprocess.run(['sips', '-s', 'format', 'png', f'v3-{yaw}.bmp', '--out', f'v3-yaw{yaw}.png'], check=True, capture_output=True)
# labels in three-panel pixels (each panel cropped ±125 around its centre, as tri.py)
PW = int(round(250 / 0.16550333333333334)); out = []
for j, yaw in enumerate((0, 45, 90)):
    x0 = int(round(1890 / 2 - PW / 2))
    for ((x, y), t, c) in labels[yaw]: out.append({'x': j * PW + x - x0, 'y': y, 't': t, 'c': c})
json.dump(out, open('v3-labels.json', 'w'), ensure_ascii=False); print(len(out), 'labels')
