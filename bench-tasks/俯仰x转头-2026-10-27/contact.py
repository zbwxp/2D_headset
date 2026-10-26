# dot's pitch × turn pictures (bowen 1793028573) as one sheet: rows 仰45 / 0 / 俯45, columns turn 30 / 60 / 75, two samples
# per cell. The filename's angle is dot's target, not measured (dot 1793033054). Writes contact.svg (thumbnails embedded).
import base64, os
H = os.path.dirname(os.path.abspath(__file__)) + '/'
ROWS, COLS, T = [('up45', '仰45'), ('zero', '0'), ('down45', '俯45')], [30, 60, 75], 360
W = len(COLS) * 2 * T; Hh = len(ROWS) * (T + 30)
s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{W}" viewBox="0 0 {W} {W}" font-family="PingFang SC"><rect width="100%" height="100%" fill="#fff"/>']
for r, (key, lab) in enumerate(ROWS):
    for c, yaw in enumerate(COLS):
        for k in (1, 2):
            f = H + f'thumbs/{key}-yaw{yaw}-{k}.png'; x = (c * 2 + k - 1) * T; y = r * (T + 30) + 30
            s.append(f'<text x="{x + 8}" y="{y - 8}" font-size="18" fill="#333">{lab} · 转 {yaw}° · {k}</text>')
            if os.path.exists(f): s.append(f'<image x="{x}" y="{y}" width="{T}" height="{T}" href="data:image/png;base64,{base64.b64encode(open(f, "rb").read()).decode()}"/>')
            else: s.append(f'<text x="{x + T / 2}" y="{y + T / 2}" font-size="20" fill="#bbb" text-anchor="middle">还没有</text>')
            s.append(f'<rect x="{x}" y="{y}" width="{T}" height="{T}" fill="none" stroke="#ccc"/>')
open(H + 'contact.svg', 'w').write(''.join(s) + '</svg>')
print('ok', W, Hh)
