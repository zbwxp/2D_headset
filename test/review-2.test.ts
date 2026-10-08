// Regression tests for dot's re-run of 4d65d61 (1791427267, 1791427515, 1791427637,
// 1791427693). Each block is one mechanism, not one patched example.
import { describe, it, expect } from 'vitest'
import { Core, type Vec, type Editor } from '../src'
import * as geo from '../src/geometry'

const P = (x: number, y = 0): Vec => ({ x, y })

describe('transaction lifecycle and state isolation (dot 1791427515)', () => {
  it('a caller object changed after the edit does not change the document', () => {
    const d = new Core(), pos = { x: 1, y: 1 }, h = { ha: { x: 1, y: 0 }, hb: { x: -1, y: 0 } }
    d.edit(e => { e.layer('L'); e.point('a', 'L', pos); e.point('b', 'L', P(5)); e.line('ab', 'a', 'b', h) })
    pos.x = 50; h.ha.x = 50
    expect(d.snapshot().points[0]!.position).toEqual({ x: 1, y: 1 })
    expect(d.snapshot().lines[0]!.ha).toEqual({ x: 1, y: 0 })
  })

  it('an editor kept after its edit cannot change anything', () => {
    const d = new Core()
    let kept: Editor | undefined
    d.edit(e => { e.layer('L'); kept = e })
    const before = d.snapshot()
    expect(() => kept!.point('x', 'L', P(0))).toThrow(/finished edit/)
    expect(() => kept!.cancel()).toThrow(/finished edit/)
    expect(d.snapshot()).toEqual(before)
  })

  it('edit inside edit is refused, and the outer edit then publishes nothing', () => {
    const d = new Core()
    d.edit(e => e.layer('L'))
    const before = d.snapshot()
    expect(() => d.edit(e => { e.point('a', 'L', P(0)); d.edit(f => f.point('b', 'L', P(1))) })).toThrow(/in progress/)
    expect(d.snapshot()).toEqual(before)
  })

  it('undo / redo inside an edit are refused; a cancel afterwards leaves the state as it was', () => {
    const d = new Core()
    d.edit(e => e.layer('L'))
    d.edit(e => e.point('a', 'L', P(0)))
    const before = d.snapshot()
    d.edit(e => {
      expect(() => d.undo()).toThrow(/in progress/)
      expect(() => d.redo()).toThrow(/in progress/)
      e.cancel()
    })
    expect(d.snapshot()).toEqual(before)
  })
})

describe('identity and keys (dot 1791427637, 1791427693)', () => {
  function lemon(ids = ['x', 'y']) {
    const d = new Core()
    d.edit(e => { e.layer('L'); e.point('a', 'L', P(0)); e.point('b', 'L', P(10)); e.line(ids[0]!, 'a', 'b'); e.line(ids[1]!, 'a', 'b', { ha: P(3, 4), hb: P(-3, 4) }) })
    return d
  }

  it('line ids are never reused, so a filled loop and a new loop cannot share an id', () => {
    const d = lemon(), id = d.snapshot().loops[0]!.id
    d.edit(e => e.fill(id, 'red'))
    d.edit(e => e.split('x', 0.5, 'm', 'x1', 'x2'))
    expect(() => d.edit(e => { e.point('c', 'L', P(0, 9)); e.line('x', 'a', 'c') })).toThrow(/never reused/)
    expect(d.snapshot().loops.find(l => l.id === id)?.color).toBe('red')
  })

  it('loop keys cannot collide through a separator', () => {
    const one = lemon(['a', 'b|c']).snapshot().loops[0]!.id
    const two = lemon(['a|b', 'c']).snapshot().loops[0]!.id
    expect(one).not.toBe(two)
  })

  it('any string works as an id, including names on the object prototype', () => {
    const d = new Core()
    d.edit(e => { e.layer('constructor'); e.point('__proto__', 'constructor', P(0)); e.point('toString', 'constructor', P(1)); e.line('valueOf', '__proto__', 'toString') })
    expect(d.snapshot().groups).toHaveLength(1)
    expect(d.snapshot().groups[0]!.layer).toBe('constructor')
  })

  it('a handle dragged before its line is split in the same edit stays held on the matching piece', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L'); e.point('a', 'L', P(0)); e.point('b', 'L', P(10)); e.point('c', 'L', P(20, 5))
      e.line('ab', 'a', 'b'); e.line('bc', 'b', 'c'); e.join('b', 'ab', 'bc', { mode: 'smooth' })
    })
    d.edit(e => { e.moveHandle('bc', 'a', P(0, 3)); e.split('bc', 0.5, 'm', 'bc1', 'bc2') })
    const s = d.snapshot(), bc1 = s.lines.find(l => l.id === 'bc1')!, ab = s.lines.find(l => l.id === 'ab')!
    expect(Math.atan2(bc1.ha.y, bc1.ha.x)).toBeCloseTo(Math.PI / 2, 9) // kept as dragged (direction)
    expect(Math.atan2(ab.hb.y, ab.hb.x)).toBeCloseTo(-Math.PI / 2, 6) // partner turned opposite
  })
})

describe('one outline for fills and picking (dot 1791427637, 1791427693)', () => {
  function square() {
    const d = new Core()
    d.edit(e => {
      e.layer('L')
      e.point('a', 'L', P(0)); e.point('b', 'L', P(10)); e.point('c', 'L', P(10, 10)); e.point('d', 'L', P(0, 10))
      e.line('ab', 'a', 'b'); e.line('bc', 'b', 'c'); e.line('cd', 'c', 'd'); e.line('da', 'd', 'a')
      e.join('a', 'ab', 'da', { mode: 'arc', radius: 4 })
    })
    return d
  }

  it('picking a point in the arc-trimmed corner gives the same answer before and after filling', () => {
    const d = square(), id = d.snapshot().loops[0]!.id
    const inside = P(1.6, 1.6) // inside the arc, outside the chord between the trim points
    const outsideArc = P(0.3, 0.3) // between the arc and the old corner
    const before = [d.pickLoop(inside), d.pickLoop(outsideArc)]
    d.edit(e => e.fill(id, 'red'))
    expect([d.pickLoop(inside), d.pickLoop(outsideArc)]).toEqual(before)
    expect(before).toEqual([id, undefined])
  })

  it('a loop through a point twice is measured as the sum of its lobes, so one lobe is smaller', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L')
      e.point('a', 'L', P(0)); e.point('u', 'L', P(5, 5)); e.point('b', 'L', P(10)); e.point('v', 'L', P(5, -5))
      // Handles chosen so that after binding b onto a each lobe is a clean lens around a
      // diagonal, and the two lobes are walked in opposite directions (a true figure-eight):
      // their signed areas cancel, which is exactly what a signed-area size check gets wrong.
      e.line('au', 'a', 'u', { ha: P(-1, 3), hb: P(-3, 1) })
      e.line('ub', 'u', 'b', { ha: P(2, -2), hb: P(3, 1) })
      e.line('bv', 'b', 'v', { ha: P(-1, -3), hb: P(-3, -1) })
      e.line('va', 'v', 'a', { ha: P(2, 2), hb: P(3, -1) })
      e.line('mid', 'a', 'b')
    })
    const outer = d.snapshot().loops.find(l => l.route.length === 4)!.id
    d.edit(e => e.fill(outer, 'red'))
    d.edit(e => e.bind('a', 'b')) // outer now passes a twice: two mirror-image lobes
    const upper = d.snapshot().loops.find(l => !l.color && l.route.some(u => u.line === 'au'))!.id
    const lower = d.snapshot().loops.find(l => !l.color && l.route.some(u => u.line === 'va'))!.id
    expect(d.snapshot().loops.find(l => l.id === outer)?.color).toBe('red')
    expect(d.pickLoop(P(2.5, 2.5))).toBe(upper)
    expect(d.pickLoop(P(2.5, -2.5))).toBe(lower)
  })
})

describe('fill order is per group (dot 1791427693)', () => {
  it('reorderFill moves a fill among the fills of its own group only', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L')
      for (const [g, x] of [['A', 0], ['B', 20]] as const) {
        e.point(g + 'p', 'L', P(x)); e.point(g + 'q', 'L', P(x + 10))
        e.line(g + '1', g + 'p', g + 'q'); e.line(g + '2', g + 'p', g + 'q', { ha: P(3, 4), hb: P(-3, 4) }); e.line(g + '3', g + 'p', g + 'q', { ha: P(3, -4), hb: P(-3, -4) })
      }
    })
    const loops = d.snapshot().loops
    const ofGroup = (g: string) => loops.filter(l => l.route.every(u => u.line.startsWith(g))).map(l => l.id)
    const [b1] = ofGroup('B'), [a1, a2] = ofGroup('A')
    d.edit(e => { e.fill(b1!, 'b'); e.fill(a1!, 'x'); e.fill(a2!, 'y') })
    expect(d.snapshot().fillOrder).toEqual([b1, a1, a2])
    d.edit(e => e.reorderFill(a1!, 1)) // to the top of A's fills
    expect(d.snapshot().fillOrder).toEqual([b1, a2, a1])
  })
})

describe('arc geometry (dot 1791427267)', () => {
  // Rays from p: toward s along −x, toward t at (180° − interior) — the interior angle at p is `interior`.
  function corner(interior: number, curved = false) {
    const d = new Core(), a = (180 - interior) * Math.PI / 180
    d.edit(e => {
      e.layer('L'); e.point('p', 'L', P(0)); e.point('s', 'L', P(-10)); e.point('t', 'L', P(10 * Math.cos(a), 10 * Math.sin(a)))
      e.line('sp', 's', 'p', curved ? { ha: P(3, 3), hb: P(-3, 1) } : undefined)
      e.line('pt', 'p', 't')
      e.join('p', 'sp', 'pt', { mode: 'arc', radius: 3 })
    })
    return d
  }
  const unit = (v: Vec) => geo.normalize(v)
  const cross = (u: Vec, v: Vec) => Math.abs(unit(u).x * unit(v).y - unit(u).y * unit(v).x)
  const near = (u: Vec, v: Vec) => geo.length(geo.sub(u, v)) < 1e-9

  it('a 60° corner gets a circular arc: points on it are at one radius from the true centre', () => {
    const g = corner(60).geometry(), arc = g.arcs[0]!.curve
    const half = 30 * Math.PI / 180, tangentLen = 3, R = tangentLen * Math.tan(half)
    const rayT = P(Math.cos(120 * Math.PI / 180), Math.sin(120 * Math.PI / 180))
    const centre = geo.scale(unit(geo.add(P(-1, 0), rayT)), tangentLen / Math.cos(half))
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const q = geo.evaluate(arc, t)
      expect(Math.abs(geo.length(geo.sub(q, centre)) - R) / R).toBeLessThan(0.005)
    }
  })

  it('the arc is tangent to both lines at the trim points, also for a curved source line', () => {
    for (const [interior, curved] of [[60, false], [100, false], [100, true], [150, true]] as const) {
      const g = corner(interior, curved).geometry(), arc = g.arcs[0]!.curve
      const sp = g.lines.find(l => l.id === 'sp')!.curve, pt = g.lines.find(l => l.id === 'pt')!.curve
      // the arc may run either way; match its ends to the trimmed ends
      const [atSp, atPt] = near(arc[0], sp[3]) ? [0, 1] : [1, 0]
      expect(near(geo.evaluate(arc, atSp), sp[3])).toBe(true)
      expect(near(geo.evaluate(arc, atPt), pt[0])).toBe(true)
      expect(cross(geo.derivative(arc, atSp), geo.derivative(sp, 1))).toBeLessThan(1e-9)
      expect(cross(geo.derivative(arc, atPt), geo.derivative(pt, 0))).toBeLessThan(1e-9)
    }
  })
})

describe('second re-run (dot 1791427941)', () => {
  it('an async edit callback is refused and publishes nothing', async () => {
    const d = new Core()
    d.edit(e => e.layer('L'))
    const before = d.snapshot()
    expect(() => d.edit((async (e: Editor) => { e.point('a', 'L', P(0)); await Promise.resolve() }) as unknown as (e: Editor) => void)).toThrow(/synchronous/)
    await Promise.resolve()
    expect(d.snapshot()).toEqual(before)
  })
})
