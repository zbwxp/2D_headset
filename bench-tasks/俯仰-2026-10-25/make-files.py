# 俯仰手调文件 (bowen 1792861597 「好」 to: 0 / ±45 keyframes hand-tuned like the turn). Copies of his latest 0° file
# (01-正脸 … 耳朵骨线) with one of dot's pitch pictures as the visible reference, placed by uniform scale + shift only:
# the picture's eye width (outer lash-wing tips) = his eyes' outer-corner distance, its eye line on his eye line (the eyes are
# taken as the fixed part, as in the overlays bowen saw; to be confirmed). His 0° picture stays in the file, hidden.
# New files; nothing of his is changed.
import base64, copy, json, os
H = os.path.dirname(os.path.abspath(__file__)) + '/'
D = '/Users/bowen/Documents/headset-face3d/脸轮廓手调/'
SRC = D + '01-正脸-yaw0-pitch0.近2远3.耳朵骨线.json'
L = json.load(open(H + 'landmarks.json'))
EYE_W, EYE_Y = 2 * 42.5678, 1.6763          # his 0° eye: outer corners at ±42.57, height 1.68
jobs = [('pitch-up45-02', '12-仰45-yaw0-pitch45.近2远3.耳朵骨线.json', '仰 45（dot 生成 pitch-up45-02，按眼宽和两眼外角对齐）'),
        ('pitch-down45-03', '13-俯45-yaw0-pitch-45.近2远3.耳朵骨线.json', '俯 45（dot 生成 pitch-down45-03，按眼宽和两眼外角对齐）')]
base = json.load(open(SRC))
for pic, out, label in jobs:
    if os.path.exists(D + out): raise SystemExit('exists ' + out)
    p = L[pic.replace('pitch-', '')]; W = H_ = 1254
    s = EYE_W / (p['Ro'][0] - p['Lo'][0]); cx = (p['Lo'][0] + p['Ro'][0]) / 2; cy = (p['Lo'][1] + p['Ro'][1]) / 2
    x, y = 0 - (cx - W / 2) * s, EYE_Y - (cy - H_ / 2) * s     # the picture's centre in canvas units
    d = copy.deepcopy(base); r = d['document']['reference']
    for im in r['images']: im['visible'] = False
    src = 'data:image/png;base64,' + base64.b64encode(open(H + 'pics/' + pic + '.png', 'rb').read()).decode()
    aid, iid = 'ref-' + pic, 'img-' + pic
    r['library'].append({'id': aid, 'name': label, 'src': src, 'width': W, 'height': H_})
    r['images'].append({'id': iid, 'view': 'view:0,0', 'asset': aid, 'width': W, 'height': H_, 'x': x, 'y': y, 'scale': s, 'angle': 0, 'opacity': 0.85, 'visible': True, 'flipped': False, 'slots': []})
    json.dump(d, open(D + out, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(out, 'scale', round(s, 5), 'centre', round(x, 2), round(y, 2))
