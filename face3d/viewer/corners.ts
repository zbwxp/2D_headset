// 眼角轨道检验 (bowen 1792686945, dot 1792686989 / 1792687064): each eye corner as a point on a circle about the turning
// axis — x = x0·cos θ + z·sin θ. Curves: z from bowen's 90° (solid) and z fitted to 25–61° (dashed); points: bowen's
// hand-tuned corners (filled) and the generated pictures (rings). The far eye is drawn mirrored as the near eye at −yaw. Glue.
const BT = '/@fs/Users/bowen/Documents/headset-face3d/bench-tasks/'
const D = await (await fetch(BT + encodeURI('粗调-2026-10-23/corners.json') + '?t=' + Date.now())).json()
const W = 1300, H = 820, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d')!
g.fillStyle = '#fff'; g.fillRect(0, 0, W, H)
const X = (t: number) => 90 + ((t + 90) / 180) * 1150, Y = (x: number) => 410 - x * 4.3
g.font = '15px "PingFang SC", system-ui'; g.strokeStyle = '#e4e4e4'; g.fillStyle = '#666'
for (let t = -90; t <= 90; t += 15) { g.beginPath(); g.moveTo(X(t), 50); g.lineTo(X(t), 770); g.stroke(); g.fillText(t + '°', X(t) - 14, 792) }
for (let x = -80; x <= 80; x += 20) { g.beginPath(); g.moveTo(90, Y(x)); g.lineTo(1240, Y(x)); g.stroke(); g.fillText(String(x), 50, Y(x) + 5) }
g.fillText('头 yaw（负 = 远侧眼镜像成近侧眼）', 520, 815)
g.fillStyle = '#111'; g.font = 'bold 21px "PingFang SC", system-ui'; g.fillText('眼角横坐标随转头：实线 = 用你 0° + 90° 定的轨道，虚线 = 只用 25–61° 拟合的轨道；实心点 = 你手调，空心圈 = 生成图', 20, 32)
const C = { in: '#d33', out: '#1565ff' }
for (const w of ['in', 'out'] as const) {
  for (const [z, dash] of [[D.z90[w], []], [D.zfit[w], [8, 6]]] as [number, number[]][]) {
    g.strokeStyle = C[w]; g.lineWidth = 2; g.setLineDash(dash); g.beginPath()
    for (let t = -90; t <= 90; t++) { const r = (t * Math.PI) / 180, x = D.x0[w] * Math.cos(r) + z * Math.sin(r); t === -90 ? g.moveTo(X(t), Y(x)) : g.lineTo(X(t), Y(x)) } g.stroke(); g.setLineDash([])
  }
}
for (const [src, t, w, x] of D.pts as [string, number, 'in' | 'out', number][]) { g.strokeStyle = g.fillStyle = C[w]; g.lineWidth = 2; g.beginPath(); g.arc(X(t), Y(x), 6, 0, 7); src === 'bowen' ? g.fill() : g.stroke() }
g.font = '16px "PingFang SC", system-ui'; [['in', '内眼角', 70], ['out', '外眼角', 95]].forEach(([w, n, y]) => { g.fillStyle = C[w as 'in']; g.fillRect(110, (y as number) - 6, 24, 4); g.fillText(n as string, 142, y as number) })
await fetch('http://127.0.0.1:5199/save?name=' + encodeURIComponent('眼角轨道检验.png'), { method: 'POST', body: cv.toDataURL('image/png') })
const v = document.getElementById('view') as HTMLImageElement; v.src = cv.toDataURL(); document.getElementById('status')!.textContent = 'saved'
