// Experiment (bowen 1791819630): a bound / smooth join as "cut back and bridge" — each line is cut back from the joint
// by half the transition zone with a flat end perpendicular to its direction there; the two cuts' corners are joined by
// two Bézier curves (outer and inner) whose handles follow each line's direction at its cut (handle length: a third of
// the corners' distance — a placeholder). Compared side by side with the current one-S-curve easing (9df09a5).
// Run: node_modules/.bin/vite-node bench/experiments/j-section/section.ts <out dir> [125.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { Core, open, type Vec } from '../../../src'
import { build, sweep, merge, type Cubic, type InkPiece } from '../../../ink'

const out = process.argv[2] ?? '.', file = process.argv[3]
const P = (x: number, y = 0): Vec => ({ x, y })
const add = (a: Vec, b: Vec) => P(a.x + b.x, a.y + b.y), sub = (a: Vec, b: Vec) => P(a.x - b.x, a.y - b.y), mul = (a: Vec, k: number) => P(a.x * k, a.y * k)
const len = (a: Vec) => Math.hypot(a.x, a.y), unit = (a: Vec) => mul(a, 1 / (len(a) || 1))
const bez = (c: Cubic, t: number): Vec => { const u = 1 - t; return P(u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y) }
const der = (c: Cubic, t: number): Vec => { const u = 1 - t; return P(3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x), 3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y)) }
const lerp = (a: Vec, b: Vec, t: number) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
const splitAt = (c: Cubic, t: number): [Cubic, Cubic] => {
  const ab = lerp(c[0], c[1], t), bc = lerp(c[1], c[2], t), cd = lerp(c[2], c[3], t), abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t)
  return [[c[0], ab, abc, m], [m, bcd, cd, c[3]]]
}
/** t at arc length s from the start (sampled). */
const tAt = (c: Cubic, s: number) => {
  let acc = 0, prev = c[0]
  for (let i = 1; i <= 1000; i++) { const p = bez(c, i / 1000), d = len(sub(p, prev)); if (acc + d >= s) return (i - 1 + (s - acc) / (d || 1)) / 1000; acc += d; prev = p }
  return 1
}
const arcLen = (c: Cubic) => { let acc = 0, prev = c[0]; for (let i = 1; i <= 1000; i++) { const p = bez(c, i / 1000); acc += len(sub(p, prev)); prev = p } return acc }

interface LineIn { id: string; a: string; b: string; curve: Cubic; w: number; wB: number }
interface JoinIn { point: string; lines: [string, string]; zone: number }
/** The section model: lines cut back by zone / 2 at each joined end (flat), bridged by two Béziers per joint. */
function section(lines: LineIn[], joins: JoinIn[]): (readonly Vec[])[] {
  const cut = new Map<string, { start: number; end: number }>()
  for (const j of joins) for (const id of j.lines) {
    const l = lines.find(x => x.id === id)!, c = cut.get(id) ?? { start: 0, end: 0 }
    if (l.a === j.point) c.start = Math.max(c.start, j.zone / 2); else c.end = Math.max(c.end, j.zone / 2)
    cut.set(id, c)
  }
  const pieces: InkPiece[] = [], at = new Map<string, { c: Vec; d: Vec; h: number }>()
  for (const l of lines) {
    const L = arcLen(l.curve), cs = cut.get(l.id) ?? { start: 0, end: 0 }
    const t0 = cs.start ? tAt(l.curve, cs.start) : 0, t1 = cs.end ? tAt(l.curve, L - cs.end) : 1
    const mid = splitAt(splitAt(l.curve, t1)[0], t1 > 0 ? t0 / t1 : 0)[1]
    const wAt = (s: number) => l.w + (l.wB - l.w) * s / L, h0 = wAt(cs.start) / 2, h1 = wAt(L - cs.end) / 2
    const r = sweep({ kind: 'line', id: l.id }, mid, { h: h0, ...(h1 !== h0 ? { hEnd: h1 } : {}) }, {}, { start: cs.start > 0, end: cs.end > 0 })
    if (r.piece) pieces.push(r.piece)
    // each cut: its point, the direction toward the joint, its half-width
    if (cs.start) at.set(`${l.id}|${l.a}`, { c: mid[0], d: unit(mul(der(l.curve, t0), -1)), h: h0 })
    if (cs.end) at.set(`${l.id}|${l.b}`, { c: mid[3], d: unit(der(l.curve, t1)), h: h1 })
  }
  for (const j of joins) {
    const A = at.get(`${j.lines[0]}|${j.point}`)!, B = at.get(`${j.lines[1]}|${j.point}`)!
    const nA = P(-A.d.y, A.d.x), nB = P(-B.d.y, B.d.x)
    const curveOf = (p0: Vec, d0: Vec, p3: Vec, d3: Vec): Vec[] => {
      const k = len(sub(p3, p0)) / 3, c: Cubic = [p0, add(p0, mul(d0, k)), add(p3, mul(d3, k)), p3]
      return Array.from({ length: 41 }, (_, i) => bez(c, i / 40))
    }
    // A's left (+nA) meets B's right (−nB): both travel toward the joint
    const aL = add(A.c, mul(nA, A.h)), aR = sub(A.c, mul(nA, A.h)), bL = add(B.c, mul(nB, B.h)), bR = sub(B.c, mul(nB, B.h))
    const one = curveOf(aL, A.d, bR, B.d), two = curveOf(bL, B.d, aR, A.d)
    const s = pieces[0]?.scale ?? 1024
    // the bridge reaches 4 grid units back into each line's body, so the union has no seam at the cut faces
    const back = (v: Vec, d: Vec) => sub(v, mul(d, 4 / s))
    const poly = [back(aR, A.d), back(aL, A.d), ...one, back(bR, B.d), back(bL, B.d), ...two]
    // the same orientation as the bodies' outer loops (the union is non-zero: opposite windings would cancel where they overlap)
    const area = (l: readonly Vec[]) => l.reduce((t, v, i) => { const w = l[(i + 1) % l.length]!; return t + v.x * w.y - w.x * v.y }, 0)
    const ref = pieces[0] ? Math.sign(area(pieces[0].loops.reduce((m, l) => Math.abs(area(l)) > Math.abs(area(m)) ? l : m))) : 1
    pieces.push({ source: { kind: 'tip', id: 'bridge:' + j.point, lines: j.lines }, loops: [Math.sign(area(poly)) === ref ? poly : [...poly].reverse()], scale: s })
  }
  return merge(pieces).loops
}

/** The current product ink (one S-curve, 9df09a5) for the same lines, all joints bound. */
function current(lines: LineIn[], joins: JoinIn[]): (readonly Vec[])[] {
  const d = new Core()
  d.edit(e => {
    e.layer('L')
    const pts = new Map<string, Vec>()
    for (const l of lines) { pts.set(l.a, l.curve[0]); pts.set(l.b, l.curve[3]) }
    const made = new Set<string>()
    for (const l of lines) {
      const end = (id: string, v: Vec) => (made.has(id) ? id : (made.add(id), { id, layer: 'L', position: v }))
      e.line(l.id, end(l.a, l.curve[0]) as never, end(l.b, l.curve[3]) as never, { ha: sub(l.curve[1], l.curve[0]), hb: sub(l.curve[2], l.curve[3]) })
      e.lineStroke(l.id, { width: l.w, ...(l.wB !== l.w ? { widthB: l.wB } : {}), profile: 'uniform' })
    }
    for (const j of joins) { e.join(j.point, j.lines[0], j.lines[1], { mode: 'bound' }); e.zone(j.point, j.lines[0], j.lines[1], j.zone) }
  })
  const r = d.in('view:0,0'), ink = build(r.geometry(), { ...r.snapshot(), zones: r.zones() })
  return ink.groups.length ? ink.groups.flatMap(g => g.loops) : ink.pieces.flatMap(p => p.loops)
}

const straight = (x0: number, x1: number, y = 0): Cubic => [P(x0, y), P(x0 + (x1 - x0) / 3, y), P(x0 + 2 * (x1 - x0) / 3, y), P(x1, y)]
const seg = (a: Vec, b: Vec): Cubic => [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b]
const auto = (w0: number, w1: number) => Math.max(w0, w1) ** 2 / Math.min(w0, w1)
const cases: { title: string; lines: LineIn[]; joins: JoinIn[]; box: [number, number, number, number] }[] = [
  { title: '直线 4 → 2（过渡区 8）', lines: [{ id: 'l0', a: 'a', b: 'p', curve: straight(-20, 0), w: 4, wB: 4 }, { id: 'l1', a: 'p', b: 'c', curve: straight(0, 20), w: 2, wB: 2 }], joins: [{ point: 'p', lines: ['l0', 'l1'], zone: 8 }], box: [-22, -6, 44, 12] },
  { title: '转 60°，等宽 3（过渡区 3）', lines: [{ id: 'l0', a: 'a', b: 'p', curve: straight(-20, 0), w: 3, wB: 3 }, { id: 'l1', a: 'p', b: 'c', curve: seg(P(0), P(10, 17.32)), w: 3, wB: 3 }], joins: [{ point: 'p', lines: ['l0', 'l1'], zone: auto(3, 3) }], box: [-22, -4, 36, 24] },
  { title: '转 90°，4 → 2（过渡区 8）', lines: [{ id: 'l0', a: 'a', b: 'p', curve: straight(-20, 0), w: 4, wB: 4 }, { id: 'l1', a: 'p', b: 'c', curve: seg(P(0), P(0, 20)), w: 2, wB: 2 }], joins: [{ point: 'p', lines: ['l0', 'l1'], zone: 8 }], box: [-22, -6, 30, 28] },
]
if (file) {
  const d = open(readFileSync(file, 'utf8')), r = d.in('view:0,0'), s = r.snapshot(), g = r.geometry()
  const ids = ['lmv4pq8rt-5', 'lmv4pq8rt-7', 'lmv4pq8rt-9', 'lmv4pq8rt-11'], widths = [2, 4, 3, 2]
  const lines = ids.map((id, i) => { const l = s.lines.find(x => x.id === id)!; return { id, a: l.a, b: l.b, curve: g.lines.find(x => x.id === id)!.curve as Cubic, w: widths[i]!, wB: widths[i]! } })
  const jp: [string, string, string, number][] = [['pmv4pq8rt-4', 'lmv4pq8rt-5', 'lmv4pq8rt-7', 4], ['pmv4pq8rt-6', 'lmv4pq8rt-7', 'lmv4pq8rt-9', auto(4, 3)], ['pmv4pq8rt-8', 'lmv4pq8rt-11', 'lmv4pq8rt-9', auto(3, 2)]]
  // limited like the core: at most a third of each line per side
  const L = new Map(lines.map(l => [l.id, arcLen(l.curve)]))
  cases.push({ title: '125.json 左眼，全仅绑定，宽 2/4/3/2', lines, joins: jp.map(([point, a, b, z]) => ({ point, lines: [a, b], zone: 2 * Math.min(z / 2, L.get(a)! / 3, L.get(b)! / 3) })), box: [16, -16, 38, 22] })
}

const W = 560, H = 300
let svg = ''
cases.forEach((c, row) => {
  const [bx, by, bw, bh] = c.box, sc = Math.min((W - 20) / bw, (H - 50) / bh), y0 = 50 + row * (H + 20)
  svg += `<text x="20" y="${y0 - 8}" font-size="17" fill="#222">${c.title}</text>`
  ;[['现在：一条 S 曲线（9df09a5）', current(c.lines, c.joins)], ['新：回缩截断 + Bézier 连接', section(c.lines, c.joins)]].forEach(([label, loops], col) => {
    const x0 = 20 + col * (W + 20)
    svg += `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#fff" stroke="#ccc"/><text x="${x0 + 8}" y="${y0 + 20}" font-size="14" fill="#555">${label}</text>`
    svg += `<g transform="translate(${x0 + 10 - bx * sc} ${y0 + 36 - by * sc}) scale(${sc})"><path d="${(loops as (readonly Vec[])[]).map(l => 'M' + l.map(v => `${v.x.toFixed(3)} ${v.y.toFixed(3)}`).join(' L') + ' Z').join(' ')}" fill="#111" fill-rule="nonzero"/>`
    for (const j of c.joins) { const l = c.lines.find(x => x.id === j.lines[0])!, p = l.a === j.point ? l.curve[0] : l.curve[3]; svg += `<circle cx="${p.x}" cy="${p.y}" r="${3 / sc}" fill="#e80"/>` }
    svg += `</g>`
  })
})
const Wt = 20 + 2 * (W + 20), Ht = 50 + cases.length * (H + 20), side = Math.max(Wt, Ht)
writeFileSync(`${out}/section.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" font-family="PingFang SC, Helvetica"><rect width="${Wt}" height="${Ht}" fill="#f6f6f6"/>${svg}</svg>`)
console.log('wrote', `${out}/section.svg`, Wt, Ht, side)
