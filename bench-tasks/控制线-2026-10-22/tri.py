# the three sheets side by side at one scale (each cropped ±125 around its own frame centre, as the editing background)
import struct, subprocess, sys
kind = sys.argv[1]; HALF = 125.0; sc = 0.16550333333333334
panels = []
for yaw in (0, 45, 90):
    subprocess.run(['sips', '-s', 'format', 'bmp', f'{kind}-yaw{yaw}.png', '--out', f't{yaw}.bmp'], check=True, capture_output=True)
    b = open(f't{yaw}.bmp', 'rb').read(); off, = struct.unpack_from('<I', b, 10); W, H = struct.unpack_from('<ii', b, 18); H = abs(H); row = (W * 3 + 3) // 4 * 4
    panels.append((b, off, W, H, row))
PW = int(round(2 * HALF / sc)); OW = 3 * PW; H = panels[0][3]; orow = (OW * 3 + 3) // 4 * 4
rows = []
for y in range(H):
    line = b''
    for (b, off, W, Hh, row) in panels:
        x0 = int(round(W / 2 - PW / 2)); s = off + y * row; line += b[s + 3 * x0: s + 3 * (x0 + PW)]
    line = bytearray(line)
    for j in (1, 2): line[3 * j * PW: 3 * j * PW + 6] = b'\xc0' * 6
    rows.append(bytes(line) + b'\0' * (orow - 3 * OW))
hdr = b'BM' + struct.pack('<IHHI', 54 + orow * H, 0, 0, 54) + struct.pack('<IiiHHIIiiII', 40, OW, -H, 1, 24, 0, orow * H, 0, 0, 0, 0)
open('tri.bmp', 'wb').write(hdr + b''.join(rows))
subprocess.run(['sips', '-s', 'format', 'png', 'tri.bmp', '--out', f'{kind}-三联.png'], check=True, capture_output=True)
print(OW, H)
