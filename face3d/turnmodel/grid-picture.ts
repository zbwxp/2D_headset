// The model at the VRoid grid's angles (bowen 1793027986): rows 仰45 / 0 / 俯45, columns yaw 0 / 30 / 60 / 75 / 90, every
// line clipped by its show rule like the viewer. Run: npx vite-node face3d/turnmodel/grid-picture.ts <out.svg>
import { writeFileSync } from 'node:fs'
import { evaluate, type ModelData, type Cubic, type Show, type V, type Frame } from './index'
import model from '../../bench-tasks/转头模型/model.json'
const M = model as unknown as ModelData, out = process.argv[2]!
const YAWS = [0, 30, 60, 75, 90], PITCHES = [45, 0, -45], C = 400, Z = 1.55
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${C * YAWS.length}" height="${C * YAWS.length}" viewBox="0 0 ${C * YAWS.length} ${C * YAWS.length}"><rect width="100%" height="100%" fill="#fff"/>`
const d = (c: Cubic, tf: (q: V) => V) => { const q = c.map(tf); return `M${q[0]![0].toFixed(1)},${q[0]![1].toFixed(1)} C${q.slice(1).map(v => v.map(x => x.toFixed(1)).join(',')).join(' ')}` }
function region(cs: Cubic[], tf: (q: V) => V): string {
  const left = [...cs], first = left.shift()!, close = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5
  let p = d(first, tf), end = first[3]
  while (left.length) { const i = left.findIndex(c => close(c[0], end) || close(c[3], end)); if (i < 0) break
    const c = left.splice(i, 1)[0]!, dd = close(c[0], end) ? c : ([...c].reverse() as Cubic), q = dd.map(tf); p += ` C${q.slice(1).map(v => v.map(x => x.toFixed(1)).join(',')).join(' ')}`; end = dd[3] }
  return p + 'Z'
}
let n = 0
PITCHES.forEach((pitch, r) => YAWS.forEach((yaw, k) => {
  const f: Frame = evaluate(M, yaw, undefined, pitch), ox = k * C + C / 2, oy = r * C + C * 0.55, tf = (q: V): V => [ox + q[0] * Z, oy + q[1] * Z]
  const R = { face: region(f.outline.map(l => l.c), tf), side: region(f.side.map(l => l.c), tf) }, id = `c${n++}`
  svg += `<defs><clipPath id="${id}-face"><path d="${R.face}"/></clipPath><clipPath id="${id}-side"><path d="${R.side}"/></clipPath>`
  for (const o of ['face', 'side', 'both'] as const) svg += `<mask id="${id}-out-${o}"><rect x="${k * C}" y="${r * C}" width="${C}" height="${C}" fill="#fff"/>${o === 'both' ? `<path d="${R.face}" fill="#000"/><path d="${R.side}" fill="#000"/>` : `<path d="${R[o]}" fill="#000"/>`}</mask>`
  svg += '</defs>'
  const draw = (path: string, show: Show, col: string, w: number) => {
    const ins = show.inside ?? [], outs = show.outside ?? []
    const mask = outs.length === 2 ? `${id}-out-both` : outs.length ? `${id}-out-${outs[0]}` : ''
    svg += `<path d="${path}" fill="none" stroke="#ddd" stroke-width="0.8"/>`
    // inside ANY of the regions: one stroke per region (one merged clip path would cancel where the two overlap)
    for (const r of ins.length ? ins : [null]) svg += `<g ${r ? `clip-path="url(#${id}-${r})"` : ''} ${mask && `mask="url(#${mask})"`}><path d="${path}" fill="none" stroke="${col}" stroke-width="${w}"/></g>`
  }
  for (const l of [...f.outline, ...f.side]) draw(d(l.c, tf), l.show, '#111', 1.8)
  for (const e of [...f.eyes.near, ...f.eyes.far]) { let p = ''; e.pts.forEach((q, i) => { if (!e.seen[i]) return; const s = tf(q); p += (i && e.seen[i - 1] ? 'L' : 'M') + s[0].toFixed(1) + ',' + s[1].toFixed(1) }); if (p) draw(p, e.show, '#7a3b00', 1.4) }
  for (const l of [...f.ears.near, ...f.ears.far]) draw(d(l.c, tf), l.show, '#c2185b', 1.6)
  svg += `<text x="${k * C + 10}" y="${r * C + 22}" font-size="15" font-family="PingFang SC" fill="#555">${pitch > 0 ? '仰' : pitch < 0 ? '俯' : ''}${Math.abs(pitch) || 0} · 转 ${yaw}°</text>`
  svg += `<rect x="${k * C}" y="${r * C}" width="${C}" height="${C}" fill="none" stroke="#ccc"/>`
}))
writeFileSync(out, svg + '</svg>')
console.log('ok')
