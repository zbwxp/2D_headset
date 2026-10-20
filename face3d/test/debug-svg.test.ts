import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { defaultShape, makeHead, CHIN_Y } from '../src/head'
import { traceKey, YAW_KEYS, PITCH_KEYS } from '../src/contour'
import { candidates, mask, visible } from '../src/outline'
import { rotate } from '../src/view'
it('debug svg', () => {
  const head = makeHead(defaultShape), C = 220, S = 70
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${C * 5}" height="${C * 5}" viewBox="0 0 ${C * 5} ${C * 5}" font-family="sans-serif"><rect width="100%" height="100%" fill="white"/>`
  const cols = ['#e91e63', '#3f51b5', '#009688', '#ff9800', '#795548']
  PITCH_KEYS.slice().reverse().forEach((pitch, r) => YAW_KEYS.forEach((yaw, c) => {
    const v = { yaw, pitch }, ox = c * C + C / 2, oy = r * C + C / 2 - 10, P = (p: readonly number[]) => { const q = rotate(p as [number, number, number], v); return [ox + q[0] * S, oy - q[1] * S] }
    s += `<text x="${c * C + 6}" y="${r * C + 14}" font-size="12">yaw ${yaw} pitch ${pitch}</text>`
    const m = mask(head, v); for (const l of candidates(head, v)) for (const q of l.pts) if (visible(m, q.p, v, head.normal(q.u, q.y))) { const pp = P(q.p); s += `<circle cx="${pp[0].toFixed(1)}" cy="${pp[1].toFixed(1)}" r="1.6" fill="#999"/>` }
    candidates(head, v).forEach((l, i) => { s += `<polyline fill="none" stroke="${cols[i % 5]}" stroke-width="0.8" stroke-dasharray="2 1" points="${l.pts.map(q => P(q.p).map(n => n.toFixed(1)).join(',')).join(' ')}"/>` })
    const t = traceKey(head, v)
    for (const side of ['pos', 'neg'] as const) t[side].forEach(seg => { if (seg) s += `<polyline fill="none" stroke="${side === 'pos' ? 'red' : 'blue'}" stroke-width="2" points="${seg.map(q => P(head.at(q.u, q.y)).map(n => n.toFixed(1)).join(',')).join(' ')}"/>` })
    const ch = P(head.at(0, CHIN_Y)); s += `<circle cx="${ch[0]}" cy="${ch[1]}" r="3" fill="black"/>`
  }))
  writeFileSync(process.env.F3D_DEBUG_SVG ?? 'face3d-debug.svg', s + '</svg>')
})
