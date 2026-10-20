// Read dot02 (the 25-cell reference sheet, 1254²), find the black line art per cell, and take per pixel row the
// right-most / left-most dark pixel in the lower face band as the drawn outline. Coordinates: head screen units,
// ball centre = 0, ball radius = 1, y up. Writes outlines.json and check.svg (dark pixels grey, picks coloured).
import { readFileSync, writeFileSync } from 'node:fs'
const here = new URL('.', import.meta.url).pathname
const buf = readFileSync(here + '../dot02.bmp')
const off = buf.readUInt32LE(10), W = buf.readInt32LE(18), H = Math.abs(buf.readInt32LE(22)), stride = Math.ceil((W * 3) / 4) * 4
const px = (x, y) => { const i = off + y * stride + x * 3; return [buf[i + 2], buf[i + 1], buf[i]] }
const dark = (x, y) => { const [r, g, b] = px(x, y), lum = 0.299 * r + 0.587 * g + 0.114 * b; return lum < 110 && Math.max(r, g, b) - Math.min(r, g, b) < 70 }
const k = 1254 / 1610, R = 78 * k
const cols = [0, 30, 45, 60, 90], rows = [45, 30, 0, -30, -45]
const cell = (ri, ci) => ({ cx: (ci * 320 + 160 + 1610 / 1600 * 5) * k, cy: (ri * 300 + 148) * k })
const out = {}
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="${rows.length * 330}" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
rows.forEach((pitch, ri) => cols.forEach((yaw, ci) => {
  const { cx, cy } = cell(ri, ci), S = 100, ox = ci * 300 + 150, oy = ri * 330 + 140
  const pts = []
  for (let y = Math.floor(cy - 1.5 * R); y < Math.min(H, cy + 1.7 * R); y++) for (let x = Math.max(0, Math.floor(cx - 1.6 * R)); x < Math.min(W, cx + 1.6 * R); x++) if (dark(x, y)) pts.push([(x - cx) / R, -(y - cy) / R])
  svg += `<rect x="${ci * 300 + 2}" y="${ri * 330 + 2}" width="296" height="326" fill="none" stroke="#eee"/><text x="${ci * 300 + 8}" y="${ri * 330 + 16}" font-size="12">sheet yaw ${yaw} pitch ${pitch}</text>`
  svg += `<circle cx="${ox}" cy="${oy}" r="${S}" fill="none" stroke="#f0c" stroke-width="0.6"/>`
  for (const [x, y] of pts) svg += `<rect x="${(ox + x * S).toFixed(1)}" y="${(oy - y * S).toFixed(1)}" width="1.3" height="1.3" fill="#999"/>`
  out[`${yaw},${pitch}`] = pts
}))
writeFileSync(here + 'dark.json', JSON.stringify({ R, cols, rows, cells: out }))
writeFileSync(here + 'check.svg', svg + '</svg>')
console.log('ok', Object.values(out).map(p => p.length).join(' '))
