// Before / after bowen's turn-and-pitch keyframes (bowen 1793073663 「之前没有加上这几个关键帧和加上之后…各个角度的对比线稿图加上
// 背景」): for each of dot's 15 pictures (sample 1), the model at the angle where it best fits the picture's eye corners, nose,
// mouth and chin (uniform scale + shift), drawn on the picture with each line's show rule. Run with KEYS=0 (rules only) and
// KEYS=1 (with the keyframes): npx vite-node …/compare-sheet.ts <out.svg>
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, type ModelData, type V, type Cubic, type Frame, type Show } from '../../face3d/turnmodel/index'
const H = dirname(fileURLToPath(import.meta.url)), REPO = join(H, '../..'), out = process.argv[2]!
const M = JSON.parse(readFileSync(join(REPO, 'bench-tasks/转头模型/model.json'), 'utf8')) as ModelData
if (process.env.KEYS === '0') M.pitch.corners = []
const LM = JSON.parse(readFileSync(join(H, 'landmarks.json'), 'utf8')) as Record<string, Record<string, V>>
// the pictures bowen tuned: their angle from his bones (fit-tuned.json, eyes + outline + ear) — the marks alone pull these front-on views to small pitches
const TUNED = JSON.parse(readFileSync(join(H, 'fit-tuned.json'), 'utf8')) as Record<string, { all: { yaw: number; pitch: number } }>
const tunedAngle = (name: string) => { const k = Object.keys(TUNED).find(f => f.startsWith(({ 'up45-yaw0': '20-', 'up45-yaw30': '21-', 'down45-yaw0': '30-', 'down45-yaw30': '31-' } as Record<string, string>)[name] ?? '#')); return k ? TUNED[k]!.all : null }
const ROWS = ['up45', 'zero', 'down45'], COLS = [0, 30, 60, 75, 90], LABEL: Record<string, string> = { up45: '仰45', zero: '平视', down45: '俯45' }
const PIC = 1254, C = 400, k = C / PIC

function modelMarks(f: Frame): Record<string, V> {
  const ne = f.eyes.near[0]!.pts, fe = f.eyes.far[0]!.pts, p = f.points
  return { nI: ne[0]!, nO: ne[ne.length - 1]!, fI: fe[0]!, fO: fe[fe.length - 1]!, nose: p.noseTip!, mouth: [(p.lipUp![0] + p.lipLow![0]) / 2, (p.lipUp![1] + p.lipLow![1]) / 2], chin: p.chin! }
}
/** picture ≈ a·model + b over the read marks; the rms left in picture px. */
function fitAt(f: Frame, lm: Record<string, V>) {
  const MP = modelMarks(f), ks = Object.keys(lm).filter(x => MP[x]), n = ks.length
  const mm = [0, 0], mu = [0, 0]
  for (const x of ks) { mm[0] += MP[x]![0] / n; mm[1] += MP[x]![1] / n; mu[0] += lm[x]![0] / n; mu[1] += lm[x]![1] / n }
  let num = 0, den = 0
  for (const x of ks) { num += (MP[x]![0] - mm[0]) * (lm[x]![0] - mu[0]) + (MP[x]![1] - mm[1]) * (lm[x]![1] - mu[1]); den += (MP[x]![0] - mm[0]) ** 2 + (MP[x]![1] - mm[1]) ** 2 }
  const a = num / den, b: V = [mu[0] - a * mm[0], mu[1] - a * mm[1]]
  const rms = Math.sqrt(ks.reduce((s, x) => s + (a * MP[x]![0] + b[0] - lm[x]![0]) ** 2 + (a * MP[x]![1] + b[1] - lm[x]![1]) ** 2, 0) / n)
  return { a, b, rms }
}
function best(lm: Record<string, V>) {
  let r = { yaw: 0, pitch: 0, rms: Infinity, a: 1, b: [0, 0] as V }
  const at = (yaw: number, pitch: number) => { if (yaw < 0 || yaw > 90 || Math.abs(pitch) > 45) return; const q = fitAt(evaluate(M, yaw, undefined, pitch), lm); if (q.rms < r.rms) r = { yaw, pitch, ...q } }
  for (let y = 0; y <= 90; y += 2) for (let p = -44; p <= 44; p += 2) at(y, p)
  const r0 = { ...r }; for (let y = r0.yaw - 2; y <= r0.yaw + 2; y += 0.5) for (let p = r0.pitch - 2; p <= r0.pitch + 2; p += 0.5) at(y, p)
  return r
}
const d = (c: Cubic, tf: (q: V) => V) => { const q = c.map(tf); return `M${q[0]![0].toFixed(1)},${q[0]![1].toFixed(1)} C${q.slice(1).map(v => v.map(x => x.toFixed(1)).join(',')).join(' ')}` }
function region(cs: Cubic[], tf: (q: V) => V): string {
  const left = [...cs], first = left.shift()!, close = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5
  let p = d(first, tf), end = first[3]
  while (left.length) { const i = left.findIndex(c => close(c[0], end) || close(c[3], end)); if (i < 0) break
    const c = left.splice(i, 1)[0]!, dd = close(c[0], end) ? c : ([...c].reverse() as Cubic), q = dd.map(tf); p += ` C${q.slice(1).map(v => v.map(x => x.toFixed(1)).join(',')).join(' ')}`; end = dd[3] }
  return p + 'Z'
}
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${C * 5}" height="${C * 5}" viewBox="0 0 ${C * 5} ${C * 5}" font-family="PingFang SC"><rect width="100%" height="100%" fill="#fff"/>`
let n = 0
const table: string[] = []
ROWS.forEach((row, r) => COLS.forEach((yawLabel, c) => {
  const name = `${row}-yaw${yawLabel}`, lm = LM[name]!, ta = tunedAngle(name), fit = ta ? { ...ta, ...fitAt(evaluate(M, ta.yaw, undefined, ta.pitch), lm) } : best(lm), f = evaluate(M, fit.yaw, undefined, fit.pitch)
  const ox = c * C, oy = r * (C + 24) + 24, tf = (q: V): V => [ox + (fit.a * q[0] + fit.b[0]) * k, oy + (fit.a * q[1] + fit.b[1]) * k], id = `c${n++}`
  const pic = readFileSync(join(H, 'thumbs', name + '-1.png')).toString('base64')
  svg += `<image x="${ox}" y="${oy}" width="${C}" height="${C}" href="data:image/png;base64,${pic}" opacity="0.45"/>`
  const R = { face: region(f.outline.map(l => l.c), tf), side: region(f.side.map(l => l.c), tf) }
  svg += `<defs><clipPath id="${id}-cell"><rect x="${ox}" y="${oy}" width="${C}" height="${C}"/></clipPath><clipPath id="${id}-face"><path d="${R.face}"/></clipPath><clipPath id="${id}-side"><path d="${R.side}"/></clipPath>`
  for (const o of ['face', 'side', 'both'] as const) svg += `<mask id="${id}-out-${o}"><rect x="${ox}" y="${oy}" width="${C}" height="${C}" fill="#fff"/>${o === 'both' ? `<path d="${R.face}" fill="#000"/><path d="${R.side}" fill="#000"/>` : `<path d="${R[o]}" fill="#000"/>`}</mask>`
  svg += `</defs><g clip-path="url(#${id}-cell)">`
  const draw = (path: string, show: Show, col: string, w: number) => {
    const outs = show.outside ?? [], mask = outs.length === 2 ? `${id}-out-both` : outs.length ? `${id}-out-${outs[0]}` : ''
    for (const reg of show.inside?.length ? show.inside : [null]) svg += `<g ${reg ? `clip-path="url(#${id}-${reg})"` : ''} ${mask && `mask="url(#${mask})"`}><path d="${path}" fill="none" stroke="${col}" stroke-width="${w}"/></g>`
  }
  for (const l of [...f.outline, ...f.side]) draw(d(l.c, tf), l.show, '#d0103a', 2)
  for (const e of [...f.eyes.near, ...f.eyes.far]) { let p = ''; e.pts.forEach((q, i) => { if (!e.seen[i]) return; const s = tf(q); p += (i && e.seen[i - 1] ? 'L' : 'M') + s[0].toFixed(1) + ',' + s[1].toFixed(1) }); if (p) draw(p, e.show, '#1060d0', 1.8) }
  for (const l of [...f.ears.near, ...f.ears.far]) draw(d(l.c, tf), l.show, '#0a9040', 2)
  svg += `</g><text x="${ox + 6}" y="${oy - 6}" font-size="15" fill="#333">${LABEL[row]}转${yawLabel}→ ${ta ? '★' : ''}转${fit.yaw}° ${fit.pitch >= 0 ? '仰' : '俯'}${Math.abs(fit.pitch)}° 差${fit.rms.toFixed(0)}px</text><rect x="${ox}" y="${oy}" width="${C}" height="${C}" fill="none" stroke="#bbb"/>`
  table.push(`${name}\t${fit.yaw}\t${fit.pitch}\t${fit.rms.toFixed(1)}`)
}))
svg += `<text x="10" y="${3 * (C + 24) + 40}" font-size="22" fill="#111">${process.env.KEYS === '0' ? '不加新关键帧（只有规则）' : '加上 21 / 31 两个新关键帧'}　★ = 你调过的图，角度按你的骨线定　其余按眼角/鼻/嘴/下巴对齐定　红 = 脸轮廓 + 侧脸片　蓝 = 眼　绿 = 耳　底 = dot 的参考图</text>`
writeFileSync(out, svg + '</svg>')
console.log(table.join('\n'))
