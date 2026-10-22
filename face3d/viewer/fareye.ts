// 远侧眼两种弯法 (bowen 1792685735: explain with a picture): the far eye at 25 / 34 / 45° over its reference, the 0° eye
// moved along its track and bent by the sphere frame both ways — 往头转的方向弯 (+) and 反方向弯 (−), each fitted to the
// measured corners with the same base eye and radius (../bench-tasks/粗调-2026-10-23/far-branches.json). Glue.
type V = [number, number]
const BT = '/@fs/Users/bowen/Documents/headset-face3d/bench-tasks/'
const TC = await (await fetch(BT + '%E8%BF%81%E7%A7%BB/turncheck.json')).json(), E = TC.eyes
const BR: Record<string, [number, number, number]> = await (await fetch(BT + encodeURI('粗调-2026-10-23/far-branches.json') + '?t=' + Date.now())).json()
const FITS = await (await fetch(BT + encodeURI('控制线-30-60/fits.json'))).json(), REFS = await (await fetch(BT + encodeURI('控制线-30-60/src/refs.json'))).json()
const load = (src: string) => new Promise<HTMLImageElement>(r => { const i = new Image(); i.onload = () => r(i); i.src = src })
const eye = (phi: number, psi: number): V[][] => { const f = (phi * Math.PI) / 180, w = (psi * Math.PI) / 180, ax = -E.anchor[0] * Math.cos(w) + E.z * Math.sin(w)
  return (E.base as [V, V, V, V][]).map(c => Array.from({ length: 41 }, (_, i) => { const s = i / 40, u = 1 - s
    const p: V = [u * u * u * c[0][0] + 3 * u * u * s * c[1][0] + 3 * u * s * s * c[2][0] + s * s * s * c[3][0], u * u * u * c[0][1] + 3 * u * u * s * c[1][1] + 3 * u * s * s * c[2][1] + s * s * s * c[3][1]]
    const qx = -(p[0] - E.anchor[0]), qy = p[1] - E.anchor[1], z2 = Math.max(0, E.r * E.r - qx * qx - qy * qy); return [ax + Math.cos(f) * qx + Math.sin(f) * (Math.sqrt(z2) - E.r), p[1]] as V })) }
const cells: { yaw: number; key: string; img: string; place: { s: number; tx: number; ty: number } }[] = [
  { yaw: 25.1, key: '25.1', img: BT + encodeURI('控制线-30-60/候选/yaw30-09.png'), place: FITS['yaw30-09'] },
  { yaw: 34, key: '34.0', img: BT + encodeURI('控制线-30-60/候选/yaw30-04.png'), place: FITS['yaw30-04'] },
  { yaw: 45, key: '45', img: BT + encodeURI('控制线-30-60/src/yaw45-11.png'), place: { s: REFS['45'].s, tx: REFS['45'].cx - (REFS['45'].s * REFS['45'].W) / 2, ty: REFS['45'].cy - (REFS['45'].s * REFS['45'].H) / 2 } }]
const Z = 22, PW = 560, PH = 520, cv = document.createElement('canvas'); cv.width = PW * 3; cv.height = PH * 2 + 70; const g = cv.getContext('2d')!
g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height)
g.fillStyle = '#111'; g.font = 'bold 26px "PingFang SC", system-ui'; g.fillText('远侧眼：同一只 0° 眼，沿轨道挪 + 用球面框弯。上排 = 往头转的方向弯，下排 = 反方向弯；背景 = 该角度的参考图', 16, 42)
for (const [col, c] of cells.entries()) {
  const img = await load(c.img)
  for (const [row, br] of (['+', '-'] as const).entries()) {
    const [phi, psi, rms] = BR[c.key + br]!, shape = eye(phi, psi), xs = shape.flat().map(p => p[0]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = 4
    const ox = col * PW, oy = 70 + row * PH, P = (p: V): V => [ox + PW / 2 + (p[0] - cx) * Z, oy + PH / 2 + (p[1] - cy) * Z]
    g.save(); g.beginPath(); g.rect(ox, oy, PW, PH); g.clip(); g.globalAlpha = 0.6
    const [x0, y0] = P([c.place.tx, c.place.ty]); g.drawImage(img, x0, y0, img.width * c.place.s * Z, img.height * c.place.s * Z); g.globalAlpha = 1
    g.strokeStyle = row ? '#0a8f3c' : '#c05a00'; g.lineWidth = 4; for (const l of shape) { g.beginPath(); l.forEach((p, i) => (i ? g.lineTo(...P(p)) : g.moveTo(...P(p)))); g.stroke() }
    g.restore(); g.strokeStyle = '#bbb'; g.strokeRect(ox, oy, PW, PH)
    g.fillStyle = row ? '#0a8f3c' : '#c05a00'; g.font = 'bold 22px "PingFang SC", system-ui'
    g.fillText(`${c.yaw}° · ${row ? '反方向弯' : '往头转的方向弯'}`, ox + 10, oy + 30); g.font = '20px "PingFang SC", system-ui'
    g.fillText(`轨道 ${psi}°（头 ${c.yaw}°），平均差 ${rms}`, ox + 10, oy + PH - 14)
  }
}
await fetch('http://127.0.0.1:5199/save?name=' + encodeURIComponent('远侧眼两种弯法.png'), { method: 'POST', body: cv.toDataURL('image/png') })
const v = document.getElementById('view') as HTMLImageElement; v.src = cv.toDataURL(); document.getElementById('status')!.textContent = 'saved'
