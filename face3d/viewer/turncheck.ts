// 转头检视 (dot 1792555714, bowen 1792555645): drag yaw −90 → 90 (the negative side mirrored) over bowen's level keyframes (0 / 45 / 90, the
// references re-aligned to one scale and 01's eye line, his lines carried over); in between the outline is the linear
// blend of the neighbouring keyframes and their references cross-fade. Fixed lines: 01's eye line, chin, crown — eyes and
// face must not jump up and down while turning. Data: bench-tasks/迁移/turncheck.json (made from the archives).
type V = [number, number]
type Key = { yaw: number; pts: Record<string, V>; lines: { name: string; a: string; b: string; ha: V; hb: V; side?: boolean }[]; ref: { src: string; x: number; y: number; w: number; h: number } }
const all: { eye: number; chin: number; crown: number; ear?: number; temple?: number; variants: Record<string, Key[]>; circ?: Record<string, Record<string, [number, number, number]>>; circErr?: Record<string, Record<string, [number, number]>>; sheet?: Record<string, { theta45: number; pts: Record<string, V> }> } = await (await fetch('/@fs/Users/bowen/Documents/headset-face3d/bench-tasks/%E8%BF%81%E7%A7%BB/turncheck.json')).json()
// variants: 原始迁移 (the migrated copies) and 颅顶统一到 01 (level crowns at 01's height, x / cheeks / jaw kept; dot 1792556341)
const varSel = document.getElementById('var') as HTMLSelectElement
for (const n of Object.keys(all.variants)) varSel.add(new Option(n, n))
let data = { ...all, keys: all.variants[varSel.value]! }
// each variant brings its own references (the shared-scale version re-aligned them): images per variant
const load = (keys: Key[]) => Promise.all(keys.map(k => new Promise<HTMLImageElement>(r => { const i = new Image(); i.onload = () => r(i); i.src = k.ref.src })))
const imgsBy: Record<string, HTMLImageElement[]> = {}
for (const [n, keys] of Object.entries(all.variants)) imgsBy[n] = await load(keys)
let imgs = imgsBy[varSel.value]!
const cv = document.getElementById('c') as HTMLCanvasElement, g = cv.getContext('2d')!
const outerIn = document.getElementById('outer') as HTMLInputElement, yawIn = document.getElementById('yaw') as HTMLInputElement, refIn = document.getElementById('ref') as HTMLInputElement, marksIn = document.getElementById('marks') as HTMLInputElement
const Z = 3.4, OX = cv.width / 2, OY = cv.height * 0.55 // canvas units → screen
const P = (p: V): V => [OX + p[0] * Z, OY + p[1] * Z]
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
// −90 … 90 (bowen 1792603165, 1792634536): a turn to the other side is the mirror of the same turn — near (the ear side,
// two lines) and far (three lines) change sides at 0°, where the symmetric 01 makes them meet
const MX = (p: V): V => [-p[0], p[1]]
function draw() {
  const yaw = +yawIn.value, ay = Math.abs(yaw), flip = yaw < 0, i = ay <= 45 ? 0 : 1, A = data.keys[i]!, B = data.keys[i + 1]!, t = (ay - A.yaw) / (B.yaw - A.yaw)
  const F = (p: V): V => (flip ? MX(p) : p)
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height)
  if (refIn.checked) for (const [k, a] of [[i, 1 - t], [i + 1, t]] as const) {
    if (a < 0.02) continue
    const r = data.keys[k]!.ref, x = F([r.x, r.y])[0]
    g.save(); g.globalAlpha = 0.55 * a; g.translate(OX + x * Z, OY + r.y * Z); if (flip) g.scale(-1, 1)
    g.drawImage(imgs[k]!, (-r.w / 2) * Z, (-r.h / 2) * Z, r.w * Z, r.h * Z); g.restore()
  }
  g.globalAlpha = 1
  const fixed: [number, string, string][] = [[data.crown, '#7a00ff', '颅顶 −82.2'], [data.eye, '#e07000', '01 眼线'], [data.chin, '#00a651', '下巴 65']]
  if (all.ear !== undefined) fixed.push([all.ear, '#e00078', `耳根 / 颧骨点 ${all.ear}`])
  if (all.temple !== undefined) fixed.push([all.temple, '#3a7bd5', `太阳穴点 ${all.temple.toFixed(1)}`])
  for (const [y, c, lab] of fixed) { g.strokeStyle = c; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(0, OY + y * Z); g.lineTo(cv.width, OY + y * Z); g.stroke(); g.fillStyle = c; g.fillText(lab, 6, OY + y * Z - 4) }
  g.setLineDash([]); g.strokeStyle = '#111'; g.lineWidth = 2.5
  const pts: Record<string, V> = {}; for (const k in A.pts) pts[k] = lerp(A.pts[k]!, B.pts[k]!, t)
  // the circular variant (bowen 1792601957, dot 1792602067): a point at front offset x0 and depth R turning about the
  // vertical axis: x = x0·cos + R·sin, its height kept (dot 1792602159) — instead of the piecewise blend
  for (const [id, [x0, R, y]] of Object.entries(all.circ?.[varSel.value] ?? {})) { const r = (ay * Math.PI) / 180; pts[id] = [x0 * Math.cos(r) + R * Math.sin(r), y] }
  // 侧脸平片 (bowen 1792674653): the side face is one flat sheet in the middle plane — a sheet point is its depth d (its x at
  // 90°) and its height; at yaw it sits at x = d·sin θ, θ the sheet's angle (θ45 from bowen's 45°, piecewise linear 0 → θ45 → 90);
  // a handle at a sheet point is 90°'s handle with its x squeezed the same way. Crown and chin follow the outline
  const sh = data.sheet?.[varSel.value], th = sh ? ((ay <= 45 ? (ay * sh.theta45) / 45 : sh.theta45 + ((ay - 45) * (90 - sh.theta45)) / 45) * Math.PI) / 180 : 0
  if (sh) for (const [id, [d, y]] of Object.entries(sh.pts)) pts[id] = [d * Math.sin(th), y]
  const K90 = data.keys[data.keys.length - 1]!
  // lines matched by their end points across the keys (the names follow the files); each as its screen Bézier
  type Bz = { side: boolean; a: string; b: string; c: [V, V, V, V] }
  const bz: Bz[] = A.lines.map(l => { const m = B.lines.find(x => x.a === l.a && x.b === l.b)!, n = K90.lines.find(x => x.a === l.a && x.b === l.b)!, a = pts[l.a]!, b = pts[l.b]!
    const onSheet = (id: string) => !!sh && id in sh.pts, sq = (h: V): V => [h[0] * Math.sin(th), h[1]]
    const ha = onSheet(l.a) ? sq(n.ha) : lerp(l.ha, m.ha, t), hb = onSheet(l.b) ? sq(n.hb) : lerp(l.hb, m.hb, t)
    return { side: !!l.side, a: l.a, b: l.b, c: [P(F(a)), P(F([a[0] + ha[0], a[1] + ha[1]])), P(F([b[0] + hb[0], b[1] + hb[1]])), P(F(b))] } })
  const stroke = (q: Bz) => { g.beginPath(); g.moveTo(...q.c[0]); g.bezierCurveTo(...q.c[1], ...q.c[2], ...q.c[3]); g.stroke() }
  // 真·外轮廓 (bowen 1792671397, 1792675303): the same implicit rule as bench — the outline's lines and the side face's lines
  // each closed into a region; each is drawn only outside the other's region, the hidden part thin grey
  const near = (p: V, q: V) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.5
  const region = (ls: Bz[]): Path2D | null => {
    if (ls.length < 2) return null
    const left = [...ls], first = left.shift()!, path = new Path2D(); path.moveTo(...first.c[0]); path.bezierCurveTo(...first.c[1], ...first.c[2], ...first.c[3])
    let end = first.c[3]
    while (left.length) { const i = left.findIndex(q => near(q.c[0], end) || near(q.c[3], end)); if (i < 0) return null
      const q = left.splice(i, 1)[0]!, c = near(q.c[0], end) ? q.c : ([...q.c].reverse() as Bz['c']); path.bezierCurveTo(...c[1], ...c[2], ...c[3]); end = c[3] }
    path.closePath(); return near(end, first.c[0]) ? path : null
  }
  const faceR = region(bz.filter(q => !q.side)), sideR = region(bz.filter(q => q.side)), outer = outerIn.checked && faceR && sideR
  for (const q of bz) {
    const other = q.side ? faceR : sideR, colour = q.side && !outer ? '#1565ff' : '#111'
    if (!outer || !other) { g.strokeStyle = colour; g.lineWidth = q.side ? 1.8 : 2.5; stroke(q); continue }
    g.strokeStyle = '#b8b8b8'; g.lineWidth = 1; stroke(q)
    // outside the other region: a clip of the whole canvas minus that region (even-odd)
    const clip = new Path2D(); clip.rect(0, 0, cv.width, cv.height); clip.addPath(other)
    g.save(); g.clip(clip, 'evenodd'); g.strokeStyle = colour; g.lineWidth = 2.5; stroke(q); g.restore()
  }
  g.strokeStyle = '#111'; g.lineWidth = 2.5
  // the endpoints (bowen 1792602867; names bowen 1792634536): crown, chin, near ear root; far 颧骨点, 太阳穴点
  const marks: [string, string, string][] = [['cmv3m1am1-6/pmv3m1am1-4', '#7a00ff', '颅顶'], ['cmv3m1am1-6/pmv3m1am1-2', '#00a651', '下巴'], ['cmv3m1am1-6/pmv3m1am1-1', '#e00078', '耳根'], ['pmv3m1am1-1', '#333', '颧骨点'], ['pm03-skf', '#3a7bd5', '太阳穴点'], ['pm03-skb', '#e00', '后切点']]
  if (marksIn.checked) for (const [id, c, lab] of marks) { const p = pts[id]; if (!p) continue; const [x, y] = P(F(p)); g.fillStyle = c; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); g.font = '12px system-ui'; g.fillText(lab, x + 7, y - 6) }
  const cr = pts['cmv3m1am1-6/pmv3m1am1-4']!, ch = pts['cmv3m1am1-6/pmv3m1am1-2']!
  const sheetText = sh ? ` · 侧脸平片 θ ${((th * 180) / Math.PI).toFixed(1)}°` : ''
  const err = all.circErr?.[varSel.value], errText = err ? ' · 圆周与关键帧之差（45° / 90°）' + Object.entries(err).map(([n, [a, b]]) => `${n} ${a.toFixed(1)} / ${b.toFixed(1)}`).join('，') : ''
  document.getElementById('yv')!.textContent = `${yaw}°`
  document.getElementById('info')!.textContent = `颅顶 y ${cr[1].toFixed(1)} · 下巴 y ${ch[1].toFixed(1)} · 关键帧 ${flip ? '−' : ''}${A.yaw}° / ${flip ? '−' : ''}${B.yaw}°（${(t * 100).toFixed(0)}%${flip ? '，镜像' : ''}）${sheetText}${errText}`
}
yawIn.oninput = draw; refIn.onchange = draw; marksIn.onchange = draw; outerIn.onchange = draw
varSel.onchange = () => { data = { ...all, keys: all.variants[varSel.value]! }; imgs = imgsBy[varSel.value]!; draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-k]')) b.onclick = () => { yawIn.value = b.dataset.k!; draw() }
draw()
