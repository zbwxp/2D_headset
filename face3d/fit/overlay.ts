// The reference sheet (ref/sheet-draft02.png) with the rough head's visible outline drawn over each of its 25 cells:
// blue = the head before the fit (defaultShape), red = after (ref/fit-level.json); each head's visible outline split
// into the OUTER boundary of the projected head (solid) and visible lines inside it (dashed, e.g. a jaw line seen
// from below), tested per point against the projected head's edge (onBoundary). Green dots: the drawn points the fit
// actually used (ref/level-picks.json, level row). For bowen / dot to judge the shape.
// Run: npx vite-node face3d/fit/overlay.ts <out.svg>
import { readFileSync, writeFileSync } from 'node:fs'
import { defaultShape, makeHead } from '../src/head'
import { type Model, visibleOutline } from '../src/model'
import { mask, onBoundary } from '../src/outline'
import { rotate } from '../src/view'
import { type Params, shapeOf } from './sheet-fit'

const img = readFileSync(new URL('./ref/sheet-draft02.png', import.meta.url)).toString('base64')
const k = 1254 / 1610, R = 78 * k, cols = [0, 30, 45, 60, 90], rows = [45, 30, 0, -30, -45]
const picks: Record<string, { bottom: number[][]; right: number[][]; left: number[][] }> = JSON.parse(readFileSync(new URL('./ref/level-picks.json', import.meta.url), 'utf8'))
const fitted: Params = JSON.parse(readFileSync(new URL('./ref/fit-level.json', import.meta.url), 'utf8'))
const heads = [{ head: makeHead(defaultShape), col: '#1e63d6', w: 1.2 }, { head: makeHead(shapeOf(fitted)), col: '#e53935', w: 1.6 }]
let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1254" height="1254"><image x="0" y="0" width="1254" height="1254" opacity="0.75" xlink:href="data:image/png;base64,${img}"/>`
rows.forEach((pitch, ri) => cols.forEach((yaw, ci) => {
  const cx = (ci * 320 + 160 + 5 * 1610 / 1600) * k, cy = (ri * 300 + 148) * k, view = { yaw, pitch: -pitch }
  const X = (r: readonly number[]) => `${(cx + r[0]! * R).toFixed(1)},${(cy - r[1]! * R).toFixed(1)}`
  for (const h of heads) {
    const mk = mask(h.head, view)
    for (const run of visibleOutline({ head: h.head } as Model, view)) {
      // split the run where it leaves / joins the outer boundary
      let cur: string[] = [], outer: boolean | undefined
      const flush = () => { if (cur.length > 1) svg += `<polyline fill="none" stroke="${h.col}" stroke-width="${h.w}" ${outer ? '' : 'stroke-dasharray="4 3"'} points="${cur.join(' ')}"/>` }
      for (const p of run) { const o = onBoundary(mk, p, view), q = X(rotate(p, view)); if (outer !== undefined && o !== outer) { cur.push(q); flush(); cur = [] } outer = o; cur.push(q) }
      flush()
    }
  }
  const pk = picks[`${yaw},${pitch}`]
  if (pk) for (const p of [...pk.bottom, ...pk.right, ...pk.left]) { const [x, y] = X(p).split(','); svg += `<circle cx="${x}" cy="${y}" r="0.9" fill="#00a651"/>` }
}))
svg += `<rect x="6" y="1222" width="900" height="26" fill="white" opacity="0.85"/><text x="12" y="1240" font-size="14" font-family="sans-serif"><tspan fill="#1e63d6">蓝 = 现在的头模</tspan>　<tspan fill="#e53935">红 = 按平视一行拟合后的头模</tspan>　实线 = 头模外边界，虚线 = 外边界以内的可见线　<tspan fill="#00a651">绿点 = 拟合实际用的画稿点</tspan></text>`
writeFileSync(process.argv[2] ?? 'overlay.svg', svg + '</svg>')
console.log('ok')
