// bowen's drawn outline (black) against the fitted head's outline (red: solid = outer boundary, dashed = visible
// lines inside it) at the poses yaw −90 … 90 × pitch −45 / 0 / 45, each pose's drawing moved onto the model as in the
// fit. Run: npx vite-node face3d/fit/bench-overlay.ts <archive.json> <fit.json> <out.svg> [pitchSign]
import { readFileSync, writeFileSync } from 'node:fs'
import { makeHead } from '../src/head'
import { type Model, visibleOutline } from '../src/model'
import { mask, onBoundary } from '../src/outline'
import { rotate } from '../src/view'
import { type BParams, drawn, placed, poseCost, shapeOfB } from './bench-fit'

const [file, fit, out, sign] = process.argv.slice(2)
const p: BParams = JSON.parse(readFileSync(fit!, 'utf8')), shape = shapeOfB(p), head = makeHead(shape)
const YAWS = [-90, -60, -30, 0, 30, 60, 90], PITCHES = [-45, 0, 45]
const poses = PITCHES.flatMap(pitch => YAWS.map(yaw => ({ yaw, pitch })))
const D = drawn(file!, poses, Number(sign ?? 1))
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
svg += `<text x="10" y="20" font-size="14">黑 = bowen 在 bench 画的脸轮廓（各角度整体平移对齐）；红 = 一个对称头模转到同一角度的轮廓（实线 = 外边界，虚线 = 外边界内可见线）。数字 = 平均偏差（头球半径）</text>`
poses.forEach((v, i) => {
  const col = YAWS.indexOf(v.yaw), row = PITCHES.indexOf(v.pitch), ox = col * 214 + 107, oy = row * 300 + 190, S = 72
  const X = (x: number, y: number) => `${(ox + x * S).toFixed(1)},${(oy - y * S).toFixed(1)}`
  const pl = placed(D, shape, i), c = poseCost(D, shape, i)
  svg += `<text x="${ox - 100}" y="${oy - 140}" font-size="12">yaw ${v.yaw} pitch ${v.pitch}  ${(c.cost / 2).toFixed(3)}</text>`
  for (const l of pl.lines) svg += `<polyline fill="none" stroke="#111" stroke-width="1.4" points="${l.map(([x, y]) => X(x, y)).join(' ')}"/>`
  const mk = mask(head, v)
  for (const run of visibleOutline({ head } as Model, v)) {
    let cur: string[] = [], outer: boolean | undefined
    const flush = () => { if (cur.length > 1) svg += `<polyline fill="none" stroke="#e53935" stroke-width="1.3" ${outer ? '' : 'stroke-dasharray="3 2"'} points="${cur.join(' ')}"/>` }
    for (const q of run) { const o = onBoundary(mk, q, v), r = rotate(q, v), s = X(r[0], r[1]); if (outer !== undefined && o !== outer) { cur.push(s); flush(); cur = [] } outer = o; cur.push(s) }
    flush()
  }
})
writeFileSync(out!, svg + '</svg>'); console.log('ok')
