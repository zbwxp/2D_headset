// shared by ctrlsheet / overlay — 控制线图 30° / 60° (bowen 1792682677): the current model drawn at a head yaw in the control-sheet frame of the 0/45/90
// sheets (canvas units 0.16550333 per px, a panel ±125 units around its centre, 1890 px tall) — the face outline (keyframes
// blended as in 转头检视), the side-face sheet, both eyes (track + sphere frame), the near ear-hole bottom, height lines and
// the turning axis; only what shows (outer edge, the far eye where the side face does not hide it), the hidden part of the
// side face kept as the face middle line. Also a strip 0 · 30 · 45 · 60 · 90 with the chosen generated pictures at 0/45/90.
// Sheets go to bench-tasks/控制线-30-60 through the local receiver (127.0.0.1:5199). Glue, throwaway.
type V = [number, number]
type Line = { name: string; a: string; b: string; ha: V; hb: V; side?: boolean }
type Key = { yaw: number; pts: Record<string, V>; lines: Line[] }
const TC = await (await fetch('/@fs/Users/bowen/Documents/headset-face3d/bench-tasks/%E8%BF%81%E7%A7%BB/turncheck.json')).json()
export const SRC = '/@fs/Users/bowen/Documents/headset-face3d/bench-tasks/' + encodeURI('控制线-30-60/src/')
export const REFS: Record<string, { W: number; H: number; s: number; cx: number; cy: number }> = await (await fetch(SRC + 'refs.json')).json()
const VAR = Object.keys(TC.variants).find((n: string) => n.startsWith('侧脸平片'))!, KEYS: Key[] = TC.variants[VAR], SH = TC.sheet[VAR], E = TC.eyes
export const S = 0.16550333333333334, Y0 = -15.491112 - 945 * S, PW = 1511, PH = 1890
const CX0: [number, number][] = [[0, 0], [45, 13.481686576394216], [90, 19.065984]]
/** the panel centre at a yaw: the 0/45/90 sheets' centres, linear between */
export const centreAt = (yaw: number) => { const k = yaw <= 45 ? 0 : 1, [a, ca] = CX0[k]!, [b, cb] = CX0[k + 1]!; return ca + ((cb - ca) * (yaw - a)) / (b - a) }
const CX: Record<number, number> = new Proxy({}, { get: (_, k) => (k === '30' ? 8.99 : k === '60' ? 15.34 : centreAt(+String(k))) })
const EAR = { x0: -43.91, z: 21.81, y: 25 }
const HEIGHTS: [number, string, string][] = [[-82.2, '#7a00ff', '颅顶'], [-5.67, '#3a7bd5', '太阳穴 · 眉心'], [1.0, '#e07000', '眼角'], [19.9, '#c0392b', '鼻尖'], [25, '#e00078', '耳朵眼下端 · 颧骨点'], [38.8, '#c87800', '嘴'], [62.3, '#00a651', '下巴']]
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const rad = (d: number) => (d * Math.PI) / 180

/** the model at head yaw ay ≥ 0, canvas units: outline / side Béziers, eye polylines, the near ear-hole bottom */
export function model(ay: number) {
  const i = ay <= 45 ? 0 : 1, A = KEYS[i]!, B = KEYS[i + 1]!, t = (ay - A.yaw) / (B.yaw - A.yaw), K90 = KEYS[KEYS.length - 1]!
  const pts: Record<string, V> = {}; for (const k in A.pts) pts[k] = lerp(A.pts[k]!, B.pts[k]!, t)
  const th = rad(ay <= 45 ? (ay * SH.theta45) / 45 : SH.theta45 + ((ay - 45) * (90 - SH.theta45)) / 45)
  for (const [id, [d, y]] of Object.entries(SH.pts as Record<string, V>)) pts[id] = [d * Math.sin(th), y]
  const onSheet = (id: string) => id in SH.pts, sq = (h: V): V => [h[0] * Math.sin(th), h[1]]
  const lines = A.lines.map(l => { const m = B.lines.find(x => x.a === l.a && x.b === l.b)!, n = K90.lines.find(x => x.a === l.a && x.b === l.b)!, a = pts[l.a]!, b = pts[l.b]!
    const ha = onSheet(l.a) ? sq(n.ha) : lerp(l.ha, m.ha, t), hb = onSheet(l.b) ? sq(n.hb) : lerp(l.hb, m.hb, t)
    return { side: !!l.side, c: [a, [a[0] + ha[0], a[1] + ha[1]], [b[0] + hb[0], b[1] + hb[1]], b] as [V, V, V, V] } })
  const at = (tab: [number, number, number][]) => { const k = tab.findIndex(r => r[0] >= ay); if (k <= 0) return [tab[0]![1], tab[0]![2]]
    const a = tab[k - 1]!, b = tab[k]!, u = (ay - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u] }
  const eye = (far: boolean): V[][] => {
    const [phi, psi] = at(far ? E.far : E.near), f = rad(phi), w = rad(psi), m = far ? -1 : 1, ax = m * E.anchor[0] * Math.cos(w) + E.z * Math.sin(w)
    return (E.base as [V, V, V, V][]).map(c => Array.from({ length: 41 }, (_, i) => { const s = i / 40, u = 1 - s
      const p: V = [u * u * u * c[0][0] + 3 * u * u * s * c[1][0] + 3 * u * s * s * c[2][0] + s * s * s * c[3][0], u * u * u * c[0][1] + 3 * u * u * s * c[1][1] + 3 * u * s * s * c[2][1] + s * s * s * c[3][1]]
      const qx = m * (p[0] - E.anchor[0]), qy = p[1] - E.anchor[1], z2 = Math.max(0, E.r * E.r - qx * qx - qy * qy)
      return [ax + Math.cos(f) * qx + Math.sin(f) * (Math.sqrt(z2) - E.r), p[1]] as V }))
  }
  return { lines, near: eye(false), far: eye(true), ear: [EAR.x0 * Math.cos(rad(ay)) + EAR.z * Math.sin(rad(ay)), EAR.y] as V, chin: pts['cmv3m1am1-6/pmv3m1am1-2']!, crown: pts['cmv3m1am1-6/pmv3m1am1-4']! }
}

/** one control panel at yaw into g, panel origin (ox, 0) */
export function panel(g: CanvasRenderingContext2D, ox: number, yaw: number, bg?: (g: CanvasRenderingContext2D, P: (p: V) => V) => void) {
  const cx = CX[yaw]!, P = (p: V): V => [ox + (p[0] - (cx - 125)) / S, (p[1] - Y0) / S], M = model(yaw)
  g.save(); g.beginPath(); g.rect(ox, 0, PW, PH); g.clip(); g.fillStyle = '#fff'; g.fillRect(ox, 0, PW, PH)
  g.font = '30px "PingFang SC", system-ui'
  if (bg) { g.save(); g.globalAlpha = 0.55; bg(g, P); g.restore() }
  for (const [y, c, lab] of HEIGHTS) { g.strokeStyle = c; g.lineWidth = 2; g.setLineDash([14, 14]); g.beginPath(); g.moveTo(ox, P([0, y])[1]); g.lineTo(ox + PW, P([0, y])[1]); g.stroke(); g.fillStyle = c; g.fillText(lab, ox + 12, P([0, y])[1] - 8) }
  g.strokeStyle = '#8c8c8c'; g.setLineDash([10, 10]); g.beginPath(); g.moveTo(...P([0, -95])); g.lineTo(...P([0, 85])); g.stroke(); g.setLineDash([]); g.fillStyle = '#787878'; g.fillText('转轴（固定）', P([0, 84])[0] + 8, P([0, 84])[1])
  const path = (c: [V, V, V, V]) => { const p = new Path2D(); p.moveTo(...P(c[0])); p.bezierCurveTo(...P(c[1]), ...P(c[2]), ...P(c[3])); return p }
  const near = (p: V, q: V) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05
  const region = (cs: [V, V, V, V][]) => { const left = [...cs], first = left.shift()!, r = new Path2D(); r.moveTo(...P(first[0])); r.bezierCurveTo(...P(first[1]), ...P(first[2]), ...P(first[3])); let end = first[3]
    while (left.length) { const i = left.findIndex(c => near(c[0], end) || near(c[3], end)); if (i < 0) return null; const c0 = left.splice(i, 1)[0]!, c = near(c0[0], end) ? c0 : ([...c0].reverse() as [V, V, V, V]); r.bezierCurveTo(...P(c[1]), ...P(c[2]), ...P(c[3])); end = c[3] }
    r.closePath(); return r }
  const faceR = region(M.lines.filter(l => !l.side).map(l => l.c)), sideR = region(M.lines.filter(l => l.side).map(l => l.c))
  const outside = (other: Path2D | null, draw: () => void) => { g.save(); if (other) { const clip = new Path2D(); clip.rect(ox, 0, PW, PH); clip.addPath(other); g.clip(clip, 'evenodd') } draw(); g.restore() }
  // the face middle line: the side face where the face hides it (teal, thin); the outer edge black
  // (not the sheet's closing back line, crown → chin: it bounds the region only, nothing is drawn there)
  const back = (l: (typeof M.lines)[number]) => l.side && near(l.c[0], M.crown) && near(l.c[3], M.chin)
  for (const l of M.lines.filter(l => l.side && !back(l))) { g.strokeStyle = '#009696'; g.lineWidth = 3; g.stroke(path(l.c)) }
  for (const l of M.lines.filter(l => !back(l))) { const other = l.side ? faceR : sideR; outside(other, () => { g.strokeStyle = '#111'; g.lineWidth = 6; g.stroke(path(l.c)) }) }
  const poly = (pts: V[]) => { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(...P(q)) : p.moveTo(...P(q)))); return p }
  g.strokeStyle = '#7a3b00'; g.lineWidth = 5; for (const c of M.near) g.stroke(poly(c))
  outside(sideR, () => { g.strokeStyle = '#7a3b00'; g.lineWidth = 5; for (const c of M.far) g.stroke(poly(c)) })
  const mark = (p: V, c: string, lab: string, dx = 14) => { const [x, y] = P(p); g.fillStyle = c; g.beginPath(); g.arc(x, y, 11, 0, 7); g.fill(); g.fillText(lab, x + dx, y - 14) }
  mark(M.ear, '#e00078', '耳朵眼下端（近侧）'); mark(M.crown, '#7a00ff', '颅顶'); mark(M.chin, '#00a651', '下巴')
  g.fillStyle = '#111'; g.font = 'bold 44px "PingFang SC", system-ui'; g.fillText(bg ? `模型 ${yaw}°` : `yaw ${yaw}°（控制线）`, ox + 20, 60)
  g.restore()
}
export function refPanel(g: CanvasRenderingContext2D, ox: number, yaw: number, img: HTMLImageElement) {
  const r = REFS[String(yaw)]!, cx = CX[yaw]!
  g.save(); g.beginPath(); g.rect(ox, 0, PW, PH); g.clip(); g.fillStyle = '#fff'; g.fillRect(ox, 0, PW, PH)
  const x0 = r.cx - (r.s * r.W) / 2, y0 = r.cy - (r.s * r.H) / 2
  g.drawImage(img, ox + (x0 - (cx - 125)) / S, (y0 - Y0) / S, (r.W * r.s) / S, (r.H * r.s) / S)
  g.fillStyle = '#111'; g.font = 'bold 44px "PingFang SC", system-ui'; g.fillText(`yaw ${yaw}°（已选生成图）`, ox + 20, 60); g.restore()
}
