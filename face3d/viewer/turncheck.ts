// 转头检视 (dot 1792555714, bowen 1792555645): drag yaw 0 → 90 over bowen's level keyframes (0 / 45 / 90, the
// references re-aligned to one scale and 01's eye line, his lines carried over); in between the outline is the linear
// blend of the neighbouring keyframes and their references cross-fade. Fixed lines: 01's eye line, chin, crown — eyes and
// face must not jump up and down while turning. Data: bench-tasks/迁移/turncheck.json (made from the archives).
type V = [number, number]
type Key = { yaw: number; pts: Record<string, V>; lines: { name: string; a: string; b: string; ha: V; hb: V }[]; ref: { src: string; x: number; y: number; w: number; h: number } }
const all: { eye: number; chin: number; crown: number; variants: Record<string, Key[]> } = await (await fetch('/@fs/Users/bowen/Documents/headset-face3d/bench-tasks/%E8%BF%81%E7%A7%BB/turncheck.json')).json()
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
const yawIn = document.getElementById('yaw') as HTMLInputElement, refIn = document.getElementById('ref') as HTMLInputElement
const Z = 3.4, OX = cv.width / 2 - 10 * Z, OY = cv.height * 0.55 // canvas units → screen
const P = (p: V): V => [OX + p[0] * Z, OY + p[1] * Z]
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
function draw() {
  const yaw = +yawIn.value, i = yaw <= 45 ? 0 : 1, A = data.keys[i]!, B = data.keys[i + 1]!, t = (yaw - A.yaw) / (B.yaw - A.yaw)
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height)
  if (refIn.checked) for (const [k, a] of [[i, 1 - t], [i + 1, t]] as const) { if (a < 0.02) continue; const r = data.keys[k]!.ref; g.globalAlpha = 0.55 * a; g.drawImage(imgs[k]!, OX + (r.x - r.w / 2) * Z, OY + (r.y - r.h / 2) * Z, r.w * Z, r.h * Z) }
  g.globalAlpha = 1
  for (const [y, c, lab] of [[data.crown, '#7a00ff', '颅顶 −82.2'], [data.eye, '#e07000', '01 眼线'], [data.chin, '#00a651', '下巴 65']] as const) { g.strokeStyle = c; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(0, OY + y * Z); g.lineTo(cv.width, OY + y * Z); g.stroke(); g.fillStyle = c; g.fillText(lab, 6, OY + y * Z - 4) }
  g.setLineDash([]); g.strokeStyle = '#111'; g.lineWidth = 2.5
  const pts: Record<string, V> = {}; for (const k in A.pts) pts[k] = lerp(A.pts[k]!, B.pts[k]!, t)
  A.lines.forEach((l, n) => { const m = B.lines[n]!, ha = lerp(l.ha, m.ha, t), hb = lerp(l.hb, m.hb, t), a = pts[l.a]!, b = pts[l.b]!
    g.beginPath(); g.moveTo(...P(a)); g.bezierCurveTo(...P([a[0] + ha[0], a[1] + ha[1]]), ...P([b[0] + hb[0], b[1] + hb[1]]), ...P(b)); g.stroke() })
  const cr = pts['cmv3m1am1-6/pmv3m1am1-4']!, ch = pts['cmv3m1am1-6/pmv3m1am1-2']!
  document.getElementById('yv')!.textContent = `${yaw}°`
  document.getElementById('info')!.textContent = `颅顶 y ${cr[1].toFixed(1)} · 下巴 y ${ch[1].toFixed(1)} · 关键帧 ${A.yaw}° / ${B.yaw}°（${(t * 100).toFixed(0)}%）`
}
yawIn.oninput = draw; refIn.onchange = draw
varSel.onchange = () => { data = { ...all, keys: all.variants[varSel.value]! }; imgs = imgsBy[varSel.value]!; draw() }
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-k]')) b.onclick = () => { yawIn.value = b.dataset.k!; draw() }
draw()
