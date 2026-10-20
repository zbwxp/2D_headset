// Drawn face outline picks per level cell from dark.json: bottom = lowest dark pixel per pixel column in [b0, b1];
// right / left = right-most / left-most dark pixel per pixel row in [r0, r1] (x beyond rx / lx). Head screen units.
import { readFileSync, writeFileSync } from 'node:fs'
const here = new URL('.', import.meta.url).pathname
const { R, cells } = JSON.parse(readFileSync(here + 'dark.json', 'utf8'))
const step = 1 / R
export const BANDS = {
  '0,0': { b: [-0.85, 0.85], right: [-0.95, -0.62, 0.5], left: [-0.95, -0.62, -0.5] },
  '30,0': { b: [-0.5, 0.6], right: [-1.2, -0.35, 0.3] },
  '45,0': { b: [-0.45, 0.75], right: [-1.2, -0.4, 0.4] },
  '60,0': { b: [-0.35, 0.85], right: [-1.2, -0.55, 0.5] },
  '90,0': { b: [-0.1, 0.85], right: [-1.25, -1.0, 0.5] },
}
export function picks(key) {
  const pts = cells[key], B = BANDS[key], out = []
  const colKey = x => Math.round(x / step), rowKey = y => Math.round(y / step)
  const low = new Map(), right = new Map(), left = new Map()
  for (const [x, y] of pts) {
    if (x >= B.b[0] && x <= B.b[1] && y < -0.6) { const k = colKey(x); if (!low.has(k) || y < low.get(k)[1]) low.set(k, [x, y]) }
    if (B.right && y >= B.right[0] && y <= B.right[1] && x > B.right[2]) { const k = rowKey(y); if (!right.has(k) || x > right.get(k)[0]) right.set(k, [x, y]) }
    if (B.left && y >= B.left[0] && y <= B.left[1] && x < B.left[2]) { const k = rowKey(y); if (!left.has(k) || x < left.get(k)[0]) left.set(k, [x, y]) }
  }
  // the bottom line is one stroke: drop picks off it (a mouth or nose mark in a column where the outline has a gap)
  const b = [...low.values()].sort((p, q) => p[0] - q[0]), med = i => { const ys = b.slice(Math.max(0, i - 4), i + 5).map(p => p[1]).sort((p, q) => p - q); return ys[ys.length >> 1] }
  return { bottom: b.filter((p, i) => Math.abs(p[1] - med(i)) < 0.04), right: [...right.values()], left: [...left.values()] }
}
if (process.argv[2] === 'draw') {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1500" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
  Object.keys(BANDS).forEach((key, ci) => {
    const S = 100, ox = ci * 300 + 150, oy = 140, p = picks(key)
    svg += `<text x="${ci * 300 + 8}" y="16" font-size="12">${key}</text>`
    for (const [x, y] of cells[key]) svg += `<rect x="${(ox + x * S).toFixed(1)}" y="${(oy - y * S).toFixed(1)}" width="1.3" height="1.3" fill="#bbb"/>`
    for (const [nm, col] of [['bottom', '#d32f2f'], ['right', '#1565c0'], ['left', '#2e7d32']]) for (const [x, y] of p[nm]) svg += `<circle cx="${(ox + x * S).toFixed(1)}" cy="${(oy - y * S).toFixed(1)}" r="1.4" fill="${col}"/>`
  })
  writeFileSync(here + 'picks.svg', svg + '</svg>'); console.log('ok')
}
if (process.argv[2] === 'json') { const o = {}; for (const k of Object.keys(BANDS)) o[k] = picks(k); writeFileSync(here + 'picks.json', JSON.stringify(o)); console.log('ok') }
