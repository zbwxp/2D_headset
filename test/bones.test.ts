// 骨骼线 / 绑骨, package B1 (docs/bone-lines-checklist.md): attaching moves nothing; a bone dragged at 0,0 carries its
// lines there and every view follows its own bone; derivation is idempotent and path-independent; side-view edits of
// attached lines are refused before the settle; placing a bone; stage 2 (never pending, broadcast / fit refuse);
// delete, split, links, apply-from-view, copy / paste; degenerate bones and fits refused; owners stored; the settle
// keeps ordinary lines' adjustments and the file reopens.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Core, save, open, Refusal, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0', UP = 'view:0,45'
const code = (f: () => void) => { try { f(); return undefined } catch (e) { return e instanceof Refusal ? e.code : (e as Error).message } }
type Cubic = [Vec, Vec, Vec, Vec]
const cubic = (d: Core, view: string, id: string): Cubic => {
  const s = d.in(view).snapshot(), l = s.lines.find(x => x.id === id)!, pos = (p: string) => s.points.find(x => x.id === p)!.position
  const a = pos(l.a), b = pos(l.b)
  return [a, P(a.x + l.ha.x, a.y + l.ha.y), P(b.x + l.hb.x, b.y + l.hb.y), b]
}
const at = (c: Cubic, t: number): Vec => { const u = 1 - t; return P(u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y) }
/** The largest distance from a point of `a` to the curve `b` (each sample projected onto b). */
const shapeDistance = (a: Cubic, b: Cubic) => {
  let worst = 0
  for (let i = 0; i <= 100; i++) {
    const p = at(a, i / 100)
    let best = Infinity
    for (let k = 0; k <= 400; k++) { const q = at(b, k / 400); best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y)) }
    worst = Math.max(worst, best)
  }
  return worst
}
const sim = (a: number, k: number, d: Vec) => (p: Vec) => P(k * (Math.cos(a) * p.x - Math.sin(a) * p.y) + d.x, k * (Math.sin(a) * p.x + Math.cos(a) * p.y) + d.y)

/** A bone B (an arch) with a band above (up) and below (lo) it, and a free line f far from it; all in layer L. */
function scene() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.line('B', { id: 'b0', layer: 'L', position: P(0, 0) }, { id: 'b1', layer: 'L', position: P(40, 0) }, { ha: P(10, -10), hb: P(-10, -10) })
    e.line('up', { id: 'u0', layer: 'L', position: P(2, -2) }, { id: 'u1', layer: 'L', position: P(38, -2) }, { ha: P(10, -12), hb: P(-10, -12) })
    e.line('lo', { id: 'l0', layer: 'L', position: P(2, 2) }, { id: 'l1', layer: 'L', position: P(38, 2) }, { ha: P(10, -8), hb: P(-10, -8) })
    e.line('f', { id: 'f0', layer: 'L', position: P(100, 0) }, { id: 'f1', layer: 'L', position: P(110, 0) })
  })
  d.edit(e => e.markBone(['B']))
  return d
}
const attached = (d: Core) => { d.edit(e => e.attach(['up', 'lo'], 'B')); return d }

describe('attaching', () => {
  it('moves nothing in any view (bit-equal), and lists the bone and its lines in the snapshot', () => {
    const d = scene(), before = d.views().map(v => JSON.stringify([cubic(d, v, 'up'), cubic(d, v, 'lo')]))
    attached(d)
    expect(d.views().map(v => JSON.stringify([cubic(d, v, 'up'), cubic(d, v, 'lo')]))).toEqual(before)
    expect(d.snapshot().bones).toEqual(['B'])
    expect(d.snapshot().attachments).toEqual([{ line: 'lo', bone: 'B' }, { line: 'up', bone: 'B' }])
  })

  it('refused: a bone onto itself or another bone, a line with links, a bone too short, a point ambiguous on a tight arch', () => {
    const d = scene()
    expect(code(() => d.edit(e => e.attach(['B'], 'B')))).toBe('bone-attached')
    expect(code(() => d.edit(e => e.attach(['up'], 'f')))).toBe('not-a-bone')
    d.edit(e => { e.layer('M', 'M'); e.line('m', { id: 'm0', layer: 'M', position: P(2, 5) }, { id: 'm1', layer: 'M', position: P(9, 5) }) })
    d.edit(e => e.link('l0', 'm0'))
    expect(code(() => d.edit(e => e.attach(['lo'], 'B')))).toBe('bone-linked')
    const t = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    t.edit(e => { e.line('T', { id: 't0', layer: 'L', position: P(0) }, { id: 't1', layer: 'L', position: P(0.0001) }); e.line('x', { id: 'x0', layer: 'L', position: P(5) }, { id: 'x1', layer: 'L', position: P(9) }) })
    t.edit(e => e.markBone(['T']))
    expect(code(() => t.edit(e => e.attach(['x'], 'T')))).toBe('bone-too-short')
    const a = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    a.edit(e => { e.line('A', { id: 'a0', layer: 'L', position: P(-10) }, { id: 'a1', layer: 'L', position: P(10) }, { ha: P(0, -27), hb: P(0, -27) }); e.line('c', { id: 'c0', layer: 'L', position: P(-1, 0) }, { id: 'c1', layer: 'L', position: P(1, 0) }) })
    a.edit(e => e.markBone(['A']))
    expect(code(() => a.edit(e => e.attach(['c'], 'A')))).toBe('bone-ambiguous')
  })
})

describe('a bone dragged at 0,0 (带动线稿)', () => {
  it('carries its lines at 0,0 by the same move / turn / scale as the bone; every other view follows its own bone', () => {
    const d = attached(scene()), T = sim(0.4, 1.2, P(3, -4)), B0 = cubic(d, FRONT, 'B'), U0 = cubic(d, FRONT, 'up')
    d.edit(e => { e.move([{ id: 'b0', target: T(B0[0]) }, { id: 'b1', target: T(B0[3]) }]); e.moveHandle('B', 'a', P(T(B0[1]).x - T(B0[0]).x, T(B0[1]).y - T(B0[0]).y)); e.moveHandle('B', 'b', P(T(B0[2]).x - T(B0[3]).x, T(B0[2]).y - T(B0[3]).y)) })
    const want = U0.map(T) as Cubic
    expect(shapeDistance(cubic(d, FRONT, 'up'), want)).toBeLessThan(1e-3)
    // the side views' bones did not move (record mode, no standard yet): their lines stay as they were
    expect(cubic(d, SIDE, 'up')).toEqual(U0)
  })

  it('a side view\'s bone edited (as when recording a standard): that view\'s lines follow it', () => {
    const d = attached(scene()), B0 = cubic(d, SIDE, 'B'), T = sim(-0.3, 0.8, P(5, 1))
    d.editIn(SIDE, e => { e.move([{ id: 'b0', target: T(B0[0]) }, { id: 'b1', target: T(B0[3]) }]); e.moveHandle('B', 'a', P(T(B0[1]).x - T(B0[0]).x, T(B0[1]).y - T(B0[0]).y)); e.moveHandle('B', 'b', P(T(B0[2]).x - T(B0[3]).x, T(B0[2]).y - T(B0[3]).y)) })
    expect(shapeDistance(cubic(d, SIDE, 'lo'), cubic(d, FRONT, 'lo').map(T) as Cubic)).toBeLessThan(1e-3)
    expect(cubic(d, UP, 'lo')).toEqual(cubic(d, FRONT, 'lo'))
  })

  it('the band stays on both sides of the bone when the arch is raised (bowen 1792295122)', () => {
    const d = attached(scene())
    d.edit(e => { e.moveHandle('B', 'a', P(10, -20)); e.moveHandle('B', 'b', P(-10, -20)) })
    const mid = (id: string) => at(cubic(d, FRONT, id), 0.5), b = at(cubic(d, FRONT, 'B'), 0.5)
    expect(mid('up').y).toBeLessThan(b.y)
    expect(mid('lo').y).toBeGreaterThan(b.y)
  })
})

describe('idempotent and path-independent (dot\'s tests 1, 2)', () => {
  const drag = (d: Core, steps: number) => { const start = cubic(d, FRONT, 'B')[3]; for (let k = 1; k <= steps; k++) d.edit(e => e.move([{ id: 'b1', target: P(start.x + (k / steps) * 6, start.y + (k / steps) * 4) }])) }
  it('an edit that changes nothing changes nothing; save and open gives the same file', () => {
    const d = attached(scene()); drag(d, 1)
    const text = save(d)
    d.edit(e => e.select([]))
    expect(save(d)).toBe(text)
    expect(save(open(text))).toBe(text)
  })
  it('one drag to the end and ten drags to the same end give the same drawing', () => {
    const one = attached(scene()), ten = attached(scene())
    drag(one, 1); drag(ten, 10)
    expect(save(ten)).toBe(save(one))
  })
  it('undo takes the bone and every carried line back', () => {
    const d = attached(scene()), text = save(d)
    drag(d, 1); d.undo()
    expect(save(d)).toBe(text)
  })
})

describe('side views (checklist §4)', () => {
  it('a direct geometry edit of an attached line there is refused before the settle; its stroke can change', () => {
    const d = attached(scene())
    expect(code(() => d.editIn(SIDE, e => e.move([{ id: 'u0', target: P(0, -9) }])))).toBe('bone-derived')
    expect(code(() => d.editIn(SIDE, e => e.moveHandle('lo', 'a', P(1, 1))))).toBe('bone-derived')
    expect(code(() => d.editIn(SIDE, e => e.lineStroke('lo', { width: 3, profile: 'uniform' })))).toBeUndefined()
  })
  it('从视角应用 there refuses attached lines; at 0,0 the derivation decides (the existing exactness check)', () => {
    const d = attached(scene())
    expect(code(() => d.editIn(SIDE, e => e.applyFromView(['L'], UP)))).toBe('bone-derived')
  })
})

describe('placing a bone (摆放骨骼)', () => {
  it('the attached lines stay at 0,0 (bit-equal); their bases renew, so the other views follow the new relation', () => {
    const d = attached(scene()), before = [cubic(d, FRONT, 'up'), cubic(d, FRONT, 'lo')]
    d.edit(e => { e.placeBones(); e.move([{ id: 'b0', target: P(0, -1) }, { id: 'b1', target: P(40, -1) }]) })
    expect([cubic(d, FRONT, 'up'), cubic(d, FRONT, 'lo')]).toEqual(before)
    // the side views' bones were not moved: the lines there are now one unit lower relative to the bone than at 0,0
    expect(at(cubic(d, SIDE, 'up'), 0.5).y).toBeCloseTo(at(before[0]!, 0.5).y + 1, 3)
  })
})

describe('stage 2 (同步广播基线)', () => {
  it('attached lines are never pending; broadcast and fit refuse them', () => {
    const d = attached(scene())
    d.edit(e => e.move([{ id: 'b1', target: P(44, 2) }]))
    expect(d.pendingLines().filter(id => id === 'up' || id === 'lo')).toEqual([])
    expect(code(() => d.edit(e => e.broadcastShape([{ kind: 'line', id: 'up' }])))).toBe('bone-derived')
    expect(code(() => d.edit(e => e.fit([{ kind: 'line', id: 'lo' }])))).toBe('bone-derived')
  })
})

describe('structure', () => {
  it('a deleted bone releases its lines where they are; a deleted attached line takes its record', () => {
    const d = attached(scene()); d.edit(e => e.move([{ id: 'b1', target: P(44, 2) }]))
    const kept = d.views().map(v => JSON.stringify(cubic(d, v, 'up')))
    d.edit(e => e.deleteLine('lo'))
    expect(d.snapshot().attachments).toEqual([{ line: 'up', bone: 'B' }])
    d.edit(e => e.deleteLine('B'))
    expect([d.snapshot().bones, d.snapshot().attachments]).toEqual([[], []])
    expect(d.views().map(v => JSON.stringify(cubic(d, v, 'up')))).toEqual(kept)
  })
  it('a split attached line: both pieces stay attached and nothing moves; a bone cannot be split', () => {
    const d = attached(scene()), before = d.views().map(v => JSON.stringify(cubic(d, v, 'B')))
    d.edit(e => e.split('up', 0.5, 'um', 'up1', 'up2'))
    expect(d.snapshot().attachments.map(a => a.line).sort()).toEqual(['lo', 'up1', 'up2'])
    expect(code(() => d.edit(e => e.split('B', 0.5, 'bm', 'B1', 'B2')))).toBe('bone-split')
    expect(d.views().map(v => JSON.stringify(cubic(d, v, 'B')))).toEqual(before)
  })
  it('no link on an attached line', () => {
    const d = attached(scene())
    d.edit(e => { e.layer('M', 'M'); e.line('m', { id: 'm0', layer: 'M', position: P(2, 9) }, { id: 'm1', layer: 'M', position: P(9, 9) }) })
    expect(code(() => d.edit(e => e.link('u0', 'm0')))).toBe('bone-linked')
  })
  it('copy and paste: a bone copied alone stays a bone; bone and line together keep the attachment; the paste moves nothing', () => {
    const d = attached(scene())
    const alone = d.copy(['B']), both = d.copy(['B', 'up'])
    d.edit(e => e.paste(alone, 'L', P(0, 50), 'k'))
    expect(d.snapshot().bones).toEqual(['B', 'k/B'])
    d.edit(e => e.paste(both, 'L', P(0, 100), 'p'))
    expect(d.snapshot().attachments).toContainEqual({ line: 'p/up', bone: 'p/B' })
    expect(shapeDistance(cubic(d, FRONT, 'p/up'), cubic(d, FRONT, 'up').map(p => P(p.x, p.y + 100)) as Cubic)).toBeLessThan(1e-9)
  })
})

describe('refusals during a derivation (checklist §2)', () => {
  it('a bone dragged too short: the whole step refused, the drawing unchanged, no NaN', () => {
    const d = attached(scene()), text = save(d)
    expect(code(() => d.edit(e => { e.move([{ id: 'b1', target: P(0.0001, 0) }]); e.moveHandle('B', 'a', P(0, 0)); e.moveHandle('B', 'b', P(0, 0)) }))).toBe('bone-too-short')
    expect(save(d)).toBe(text)
  })
  it('a line one cubic cannot follow: refused naming the line', () => {
    // a long straight bone with a line far above it; the bone then bent into a tight hook: the line would fold
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('S', { id: 's0', layer: 'L', position: P(0) }, { id: 's1', layer: 'L', position: P(100) }); e.line('w', { id: 'w0', layer: 'L', position: P(0, -30) }, { id: 'w1', layer: 'L', position: P(100, -30) }) })
    d.edit(e => e.markBone(['S'])); d.edit(e => e.attach(['w'], 'S'))
    const r = code(() => d.edit(e => { e.move([{ id: 's1', target: P(10, 5) }]); e.moveHandle('S', 'a', P(60, 60)); e.moveHandle('S', 'b', P(60, -60)) }))
    expect(['bone-fit', 'bone-ambiguous']).toContain(r)
  })
})

describe('owners of shared points (dot 1792297855)', () => {
  it('chosen when attaching (the nearest bone at 0,0) and kept on a drag', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => {
      e.line('U', { id: 'i', layer: 'L', position: P(0) }, { id: 'o', layer: 'L', position: P(40) }, { ha: P(10, -12), hb: P(-10, -12) })
      e.line('D', 'i', 'o', { ha: P(10, 12), hb: P(-10, 12) })
      // two lines meeting at q, near the upper bone: one hangs on U, the other on D
      e.line('p', { id: 'p0', layer: 'L', position: P(5, -6) }, { id: 'q', layer: 'L', position: P(20, -8) })
      e.line('r', 'q', { id: 'r1', layer: 'L', position: P(35, 6) })
    })
    d.edit(e => e.markBone(['U', 'D'])); d.edit(e => { e.attach(['p'], 'U'); e.attach(['r'], 'D') })
    const json = (x: unknown) => JSON.stringify(x)
    const owners = () => (JSON.parse(save(d)).document.bones.owners as { point: string; bone: string }[])
    expect(json(owners())).toBe(json([{ point: 'q', bone: 'U' }]))
    d.edit(e => e.moveHandle('D', 'a', P(10, -20)))
    expect(json(owners())).toBe(json([{ point: 'q', bone: 'U' }]))
  })
})

describe('the settle around derived lines (dot 1792298028: a real derivation, not an empty change)', () => {
  it('an ordinary line smoothly joined to an attached one adjusts; the result saves and reopens', () => {
    const d = scene()
    d.edit(e => e.line('tail', 'u1', { id: 't1', layer: 'L', position: P(50, -10) }))
    d.edit(e => e.join('u1', 'up', 'tail', { mode: 'smooth' }))
    d.edit(e => e.attach(['up', 'lo'], 'B'))
    d.edit(e => e.move([{ id: 'b1', target: P(44, 3) }]))
    d.editIn(SIDE, e => e.move([{ id: 'b1', target: P(36, -3) }]))
    const text = save(d)
    expect(save(open(text))).toBe(text)
  })
})

describe('标准tmp (bowen 165.json left eye; a test fixture, not a standard eye — bowen 1792297995)', () => {
  const eye = JSON.parse(readFileSync(new URL('./fixtures/eye-standard-tmp.json', import.meta.url), 'utf8'))
  /** The eye in all nine views, as drawn, plus an upper bone along the lid band's middle in each view. */
  function eyeDoc() {
    const d = Core.newDocument({ layer: { id: 'eye', name: 'eye' } })
    const V0 = eye.views[FRONT], pt = (v: string, id: string) => P(...(eye.views[v].points[id] as [number, number]))
    d.edit(e => {
      const made = new Set<string>(), end = (id: string) => (made.has(id) ? id : (made.add(id), { id, layer: 'eye', position: pt(FRONT, id) }))
      for (const l of eye.lines) e.line(l.id, end(l.a), end(l.b), { ha: P(...(V0.handles[l.id].ha as [number, number])), hb: P(...(V0.handles[l.id].hb as [number, number])) })
    })
    for (const v of d.views()) if (v !== FRONT && eye.views[v]) d.editIn(v, e => {
      e.move(Object.keys(eye.views[v].points).map(id => ({ id, target: pt(v, id) })))
      for (const l of eye.lines) { e.moveHandle(l.id, 'a', P(...(eye.views[v].handles[l.id].ha as [number, number]))); e.moveHandle(l.id, 'b', P(...(eye.views[v].handles[l.id].hb as [number, number]))) }
    })
    return d
  }
  it('the eye opens in nine views; the upper lid lines attached to a bone drawn on 上眼睑上 follow it in every view', () => {
    const d = eyeDoc(), top = eye.lines.find((l: { name: string }) => l.name === '上眼睑上').id
    d.edit(e => e.markBone([top]))
    const lash = eye.lines.filter((l: { group: string }) => l.group === '连续曲线1').map((l: { id: string }) => l.id)
    d.edit(e => e.attach(lash, top))
    // attaching moved nothing at 0,0; in each side view the lashes are now generated from that view's lid line —
    // close to what bowen drew there (the Slack sheets: within a few units on a lid about 31 wide), not equal to it
    const drawn = (v: string, id: string) => { const l = eye.lines.find((x: { id: string }) => x.id === id), V = eye.views[v], a = P(...(V.points[l.a] as [number, number])), b = P(...(V.points[l.b] as [number, number])); return [a, P(a.x + V.handles[id].ha[0], a.y + V.handles[id].ha[1]), P(b.x + V.handles[id].hb[0], b.y + V.handles[id].hb[1]), b] as Cubic }
    const worst = Math.max(...d.views().flatMap(v => lash.map((id: string) => shapeDistance(cubic(d, v, id), drawn(v, id)))))
    expect(worst).toBeLessThan(6)
    expect(lash.map((id: string) => JSON.stringify(cubic(d, FRONT, id)))).toEqual(lash.map((id: string) => JSON.stringify(drawn(FRONT, id))))
    const text = save(d)
    expect(save(open(text))).toBe(text)
  })
})
