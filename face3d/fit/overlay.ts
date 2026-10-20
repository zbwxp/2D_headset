// The reference sheet (ref/sheet-draft02.png) with the rough head's visible outline drawn over each of its 25 cells:
// blue = the head before the fit (defaultShape), red = after (ref/fit-level.json). For bowen / dot to judge the shape.
// Run: npx vite-node face3d/fit/overlay.ts <out.svg>
import { readFileSync, writeFileSync } from 'node:fs'
import { defaultShape, makeHead } from '../src/head'
import { type Model, visibleOutline } from '../src/model'
import { rotate } from '../src/view'
import { type Params, shapeOf } from './sheet-fit'

const img = readFileSync(new URL('./ref/sheet-draft02.png', import.meta.url)).toString('base64')
const k = 1254 / 1610, R = 78 * k, cols = [0, 30, 45, 60, 90], rows = [45, 30, 0, -30, -45]
const fitted: Params = JSON.parse(readFileSync(new URL('./ref/fit-level.json', import.meta.url), 'utf8'))
const heads = [{ head: makeHead(defaultShape), col: '#1e63d6', w: 1.2 }, { head: makeHead(shapeOf(fitted)), col: '#e53935', w: 1.6 }]
let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1254" height="1254"><image x="0" y="0" width="1254" height="1254" opacity="0.75" xlink:href="data:image/png;base64,${img}"/>`
rows.forEach((pitch, ri) => cols.forEach((yaw, ci) => {
  const cx = (ci * 320 + 160 + 5 * 1610 / 1600) * k, cy = (ri * 300 + 148) * k, view = { yaw, pitch: -pitch }
  for (const h of heads) for (const run of visibleOutline({ head: h.head } as Model, view)) {
    svg += `<polyline fill="none" stroke="${h.col}" stroke-width="${h.w}" points="${run.map(p => { const r = rotate(p, view); return `${(cx + r[0] * R).toFixed(1)},${(cy - r[1] * R).toFixed(1)}` }).join(' ')}"/>`
  }
}))
svg += `<rect x="6" y="1222" width="560" height="26" fill="white" opacity="0.85"/><text x="12" y="1240" font-size="14" font-family="sans-serif"><tspan fill="#1e63d6">蓝 = 现在的头模</tspan>　<tspan fill="#e53935">红 = 按平视一行拟合后的头模</tspan>　（只画外轮廓，五官和头发不在模型里）</text>`
writeFileSync(process.argv[2] ?? 'overlay.svg', svg + '</svg>')
console.log('ok')
