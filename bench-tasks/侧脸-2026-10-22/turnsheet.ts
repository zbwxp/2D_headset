// 转头检视 + 侧脸平片: a variant = the 19:52 outline keys plus the side face lines from the 平片 copies (0° from 侧脸初稿, its
// middle line). `sheet[variant]` = the sheet points (depth d = x at 90°, height): the viewer places them at x = d·sin θ, θ the
// sheet's own angle (43.6° at the 45° key, bowen's drawing; piecewise linear 0 → 43.6 → 90); crown / chin follow the outline.
import { readFileSync, writeFileSync } from 'node:fs'
import { open } from '/Users/bowen/Documents/headset-core/src/archive/index'
const D = '/Users/bowen/Documents/headset-face3d/脸轮廓手调/', T = '/Users/bowen/Documents/headset-face3d/bench-tasks/迁移/turncheck.json'
const files: Record<number, string> = { 0: '01-正脸-yaw0-pitch0.近2远3.侧脸初稿.json', 45: '03-转头45-yaw45-pitch0.近2远3.侧脸平片.json', 90: '02-侧脸-yaw90-pitch0.近2远3.侧脸平片.json' }
const SIDE = ['lmv6kklw1-4', 'lmv6kklw1-6', 'lmv6kklw1-8', 'lmv6kklw1-10', 'lmv6kklw1-12', 'lmv6kklw1-13'], SHEET = ['pmv6kklw1-3', 'pmv6kklw1-5', 'pmv6kklw1-7', 'pmv6kklw1-9']
const all = JSON.parse(readFileSync(T, 'utf8'))
const base = Object.keys(all.variants).find(n => n.includes('19:52'))!, name = '侧脸平片 · ' + base
const keys = all.variants[base].map((k: { yaw: number; pts: Record<string, [number, number]>; lines: unknown[] }) => {
  const s = open(readFileSync(D + files[k.yaw]!, 'utf8')).snapshot(), pts = { ...k.pts }, lines = [...k.lines] as { name: string; a: string; b: string; ha: number[]; hb: number[]; side?: boolean }[]
  for (const id of SIDE) { const l = s.lines.find(x => x.id === id)!
    for (const p of [l.a, l.b]) { const q = s.points.find(x => x.id === p)!.position; pts[p] = [q.x, q.y] }
    lines.push({ name: '侧脸·' + (l.name ?? id), a: l.a, b: l.b, ha: [l.ha.x, l.ha.y], hb: [l.hb.x, l.hb.y], side: true }) }
  return { ...k, pts, lines }
})
const k90 = keys.find((k: { yaw: number }) => k.yaw === 90)!, k45 = keys.find((k: { yaw: number }) => k.yaw === 45)!
all.variants = { [name]: keys, ...all.variants }
all.sheet = { ...(all.sheet ?? {}), [name]: { theta45: +(Math.asin(k45.pts['pmv6kklw1-2'][0] / k90.pts['pmv6kklw1-2'][0]) * 180 / Math.PI).toFixed(3), pts: Object.fromEntries(SHEET.map(id => [id, k90.pts[id]])) } }
writeFileSync(T, JSON.stringify(all)); console.log(name, JSON.stringify(all.sheet[name]), keys.map((k: { yaw: number; lines: unknown[] }) => k.yaw + ':' + k.lines.length).join(' '))
