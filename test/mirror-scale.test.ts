// Mirror correspondence at real size (dot 1791480800): the v2 right eye, 19 lines in four
// layers with two corner links, mirror-linked in one go. And the pruned search still finds
// the exact least-change correspondence: checked against brute force on small random cases.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Core, type Vec } from '../src'
import * as net from '../src/network'
import * as links from '../src/links'
import * as apply from '../src/apply'

interface Fixture {
  axis: number
  layers: { id: string; name: string }[]
  lines: { id: string; layer: string; a: string; b: string; pa: Vec; pb: Vec; ha: Vec; hb: Vec }[]
  links: [string, string][]
}
const eye = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'v2-right-eye.json'), 'utf8')) as Fixture

function build() {
  const d = new Core({ axis: eye.axis })
  d.edit(e => {
    for (const L of eye.layers) e.layer(L.id, L.name)
    const made = new Set<string>()
    const end = (id: string, layer: string, position: Vec) => { if (made.has(id)) return id; made.add(id); return { id, layer, position } }
    for (const l of eye.lines) e.line(l.id, end(l.a, l.layer, l.pa), end(l.b, l.layer, l.pb), { ha: l.ha, hb: l.hb })
    for (const [a, b] of eye.links) e.link(a, b)
  })
  return d
}

describe('mirror correspondence at real size', () => {
  it('the v2 right eye (19 lines, 4 layers, 2 corner links) mirror-links to its copy in one go', () => {
    const d = build()
    d.edit(e => { for (const L of eye.layers) e.copyLayer(L.id, `C${L.id}`) })
    d.edit(e => { for (const [a, b] of eye.links) e.link(`C${eye.lines.find(l => l.a === a || l.b === a)!.layer}/${a}`, `C${eye.lines.find(l => l.a === b || l.b === b)!.layer}/${b}`) })
    const groupsIn = (layers: string[]) => d.snapshot().groups.filter(g => layers.includes(g.layer)).map(g => g.id)
    const src = groupsIn(eye.layers.map(L => L.id)), tgt = groupsIn(eye.layers.map(L => `C${L.id}`))
    const t0 = Date.now()
    d.edit(e => e.mirrorLink(src, tgt))
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(d.snapshot().mirrorPairs).toHaveLength(19)
  })

  it('the same with the copy first flipped into place (dot 1791480882): every pair is an exact reflection', () => {
    const d = build()
    d.edit(e => { for (const L of eye.layers) e.copyLayer(L.id, `C${L.id}`) })
    const copies = d.snapshot().lines.filter(l => l.id.startsWith('C')).map(l => ({ kind: 'line' as const, id: l.id }))
    d.edit(e => { e.select(copies); e.scale({ x: eye.axis, y: 0 }, -1, 1) })
    d.edit(e => { for (const [a, b] of eye.links) e.link(`C${eye.lines.find(l => l.a === a || l.b === a)!.layer}/${a}`, `C${eye.lines.find(l => l.a === b || l.b === b)!.layer}/${b}`) })
    const groupsIn = (layers: string[]) => d.snapshot().groups.filter(g => layers.includes(g.layer)).map(g => g.id)
    d.edit(e => e.mirrorLink(groupsIn(eye.layers.map(L => L.id)), groupsIn(eye.layers.map(L => `C${L.id}`))))
    const s = d.snapshot(), pos = (id: string) => s.points.find(p => p.id === id)!.position
    for (const p of s.mirrorPairs) {
      const a = s.lines.find(l => l.id === p.a)!, b = s.lines.find(l => l.id === p.b)!
      const [b0, b1] = p.reversed ? [b.b, b.a] : [b.a, b.b]
      for (const [x, y] of [[a.a, b0], [a.b, b1]] as const) {
        expect(pos(y!).x).toBeCloseTo(2 * eye.axis - pos(x).x, 9)
        expect(pos(y!).y).toBeCloseTo(pos(x).y, 9)
      }
    }
    expect(s.mirrorPairs).toHaveLength(19)
  })
})

/** Brute force: every bijection and orientation that keeps shared points and in-set links; the least total squared distance. */
function bruteMin(n: net.NetworkState, l: links.LinksState, ax: number, src: string[], tgt: string[]): number {
  const ends = (id: string) => { const x = net.line(n, id); return [x.a, x.b] }
  const ctrl = (id: string) => { const x = net.line(n, id), a = net.point(n, x.a).position, b = net.point(n, x.b).position; return [a, { x: a.x + x.ha.x, y: a.y + x.ha.y }, { x: b.x + x.hb.x, y: b.y + x.hb.y }, b] }
  const key = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a)
  const pts = (ids: string[]) => new Set(ids.flatMap(ends))
  const sp = pts(src), tp = pts(tgt)
  const sl = links.pairs(l).filter(p => sp.has(p.a) && sp.has(p.b)), tl = new Set(links.pairs(l).filter(p => tp.has(p.a) && tp.has(p.b)).map(p => key(p.a, p.b)))
  let best = Infinity
  const perm = (i: number, used: Set<string>, map: Map<string, string>, cost: number) => {
    if (i === src.length) {
      if (sl.length === tl.size && sl.every(p => tl.has(key(map.get(p.a)!, map.get(p.b)!)))) best = Math.min(best, cost)
      return
    }
    const s = src[i]!, [sa, sb] = ends(s)
    for (const t of tgt) {
      if (used.has(t)) continue
      for (const rev of [false, true]) {
        const [ta, tb] = ends(t), want: [string, string][] = rev ? [[sa!, tb!], [sb!, ta!]] : [[sa!, ta!], [sb!, tb!]]
        const m = new Map(map), inv = new Set(m.values())
        let ok = true
        for (const [p, q] of want) { const h = m.get(p); if (h !== undefined) { if (h !== q) ok = false } else if (inv.has(q)) ok = false; else { m.set(p, q); inv.add(q) } }
        if (!ok) continue
        const cs = ctrl(s).map(p => ({ x: 2 * ax - p.x, y: p.y })), ct = ctrl(t), order = rev ? [3, 2, 1, 0] : [0, 1, 2, 3]
        const c = order.reduce((sum, k, j) => sum + (cs[k]!.x - ct[j]!.x) ** 2 + (cs[k]!.y - ct[j]!.y) ** 2, 0)
        perm(i + 1, new Set([...used, t]), m, cost + c)
      }
    }
  }
  perm(0, new Set(), new Map(), 0)
  return best
}

describe('the pruned search finds the exact least-change correspondence', () => {
  it('equals brute force on 40 random small cases (chains, loops, links)', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    for (let k = 0; k < 40; k++) {
      const n = net.create({ key: 'view:0,0', kind: 'view' }), l = links.create(), ch = net.emptyChanges()
      net.addLayer(n, 'S'); net.addLayer(n, 'T'); net.addLayer(n, 'U')
      const size = 2 + Math.floor(rnd() * 4), closed = rnd() < 0.5
      const make = (side: string, layer: string, sign: number) => {
        const ids: string[] = []
        const pos = (i: number) => ({ x: sign * (10 + rnd() * 20), y: i * 5 + rnd() * 3 })
        const count = closed ? size : size + 1
        const pid = (i: number) => `${side}p${i % count}`
        for (let i = 0; i < size; i++) {
          const a: net.EndSpec = i === 0 ? { id: pid(0), layer, position: pos(0) } : pid(i)
          const bi = i + 1, b: net.EndSpec = closed && bi === size ? pid(0) : { id: pid(bi), layer, position: pos(bi) }
          net.addLine(n, ch, `${side}l${i}`, a, b, { ha: { x: rnd() * 4 - 2, y: rnd() * 4 - 2 }, hb: { x: rnd() * 4 - 2, y: rnd() * 4 - 2 } })
          ids.push(`${side}l${i}`)
        }
        return ids
      }
      const src = make('s', 'S', -1), tgt = make('t', 'T', 1)
      if (!closed && rnd() < 0.5) {
        // a link from each side's first point to a lone line in a third layer, same structure on both sides
        net.addLine(n, ch, 'su', { id: 'su0', layer: 'U', position: { x: -5, y: 0 } }, { id: 'su1', layer: 'U', position: { x: -6, y: 1 } })
        net.addLine(n, ch, 'tu', { id: 'tu0', layer: 'U', position: { x: 5, y: 0 } }, { id: 'tu1', layer: 'U', position: { x: 6, y: 1 } })
        links.link(l, n, 'sp0', 'su0'); links.link(l, n, 'tp0', 'tu0')
        src.push('su'); tgt.push('tu')
      }
      const m = apply.match(n, l, 0, src, tgt)
      const ctrl = (id: string) => { const x = net.line(n, id), a = net.point(n, x.a).position, b = net.point(n, x.b).position; return [a, { x: a.x + x.ha.x, y: a.y + x.ha.y }, { x: b.x + x.hb.x, y: b.y + x.hb.y }, b] }
      let cost = 0
      for (const [s, { to, reversed }] of m.lines) {
        const cs = ctrl(s).map(p => ({ x: -p.x, y: p.y })), ct = ctrl(to), order = reversed ? [3, 2, 1, 0] : [0, 1, 2, 3]
        cost += order.reduce((sum, q, j) => sum + (cs[q]!.x - ct[j]!.x) ** 2 + (cs[q]!.y - ct[j]!.y) ** 2, 0)
      }
      expect(cost).toBeCloseTo(bruteMin(n, l, 0, src, tgt), 9)
    }
  })
})
