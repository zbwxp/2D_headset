// The angle estimate drawn: each hand-tuned drawing (black: outline 脸轮廓, middle line 侧脸) against the head at the
// angle found for it (red: outer boundary solid, inside lines dashed; its front middle line thin), labelled nominal →
// estimated. Run: npx vite-node face3d/fit/angles-overlay.ts <archive.json> <angles.json> <out.svg>
import { readFileSync, writeFileSync } from 'node:fs'
import { makeHead } from '../src/head'
import { type Model, visibleOutline } from '../src/model'
import { mask, onBoundary } from '../src/outline'
import { type View, rotate } from '../src/view'
import { drawn, modelMid, placed, poseCost, shapeOfB } from './bench-fit'

const [file, anglesFile, out] = process.argv.slice(2)
const A: { nominal: View[]; angles: View[]; shape: any; cues?: string } = JSON.parse(readFileSync(anglesFile!, 'utf8'))
const shape = shapeOfB(A.shape), head = makeHead(shape), D = drawn(file!, A.nominal, 1)
const cols = 5, cw = 300, ch = 330
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500" font-family="PingFang SC, sans-serif"><rect width="100%" height="100%" fill="white"/>`
svg += `<text x="10" y="22" font-size="15">黑 = 你在 bench 的手调（脸轮廓 + 侧脸中线）；红 = 对称头模转到「估计角度」时的轮廓和脸中线。标题：标称角度 → 估计角度（yaw, pitch），括号里是平均偏差。线索：${A.cues ?? ''}</text>`
A.nominal.forEach((nv, i) => {
  const v = A.angles[i]!, ox = (i % cols) * cw, oy = 36 + Math.floor(i / cols) * ch, cx = ox + cw / 2, cy = oy + ch / 2 + 6, S = 92
  const X = (x: number, y: number) => `${(cx + x * S).toFixed(1)},${(cy - y * S).toFixed(1)}`
  const pl = placed(D, shape, i, v), c = poseCost(D, shape, i, v, true)
  svg += `<rect x="${ox + 2}" y="${oy}" width="${cw - 4}" height="${ch - 4}" fill="none" stroke="#eee"/><text x="${ox + 8}" y="${oy + 18}" font-size="13">${nv.yaw},${nv.pitch} → ${v.yaw},${v.pitch}（${(c.cost / 2).toFixed(3)}）</text>`
  for (const l of pl.lines) svg += `<polyline fill="none" stroke="#111" stroke-width="1.6" points="${l.map(([x, y]) => X(x, y)).join(' ')}"/>`
  svg += `<polyline fill="none" stroke="#111" stroke-width="1" stroke-dasharray="3 2" points="${pl.mid.map(([x, y]) => X(x, y)).join(' ')}"/>`
  const mk = mask(head, v)
  for (const run of visibleOutline({ head } as Model, v)) {
    let cur: string[] = [], outer: boolean | undefined
    const flush = () => { if (cur.length > 1) svg += `<polyline fill="none" stroke="#e53935" stroke-width="1.4" ${outer ? '' : 'stroke-dasharray="3 2"'} points="${cur.join(' ')}"/>` }
    for (const q of run) { const o = onBoundary(mk, q, v), r = rotate(q, v), s = X(r[0], r[1]); if (outer !== undefined && o !== outer) { cur.push(s); flush(); cur = [] } outer = o; cur.push(s) }
    flush()
  }
  svg += `<polyline fill="none" stroke="#e53935" stroke-width="1" points="${modelMid(shape, v).map(([x, y]) => X(x, y)).join(' ')}"/>`
})
writeFileSync(out!, svg + '</svg>'); console.log('ok')
