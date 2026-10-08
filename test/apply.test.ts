// Acceptance for the apply module (docs/editing-apply-plan.md, Phase A; graph Mirror table).
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'
import { sk } from './sketch'

const P = (x: number, y = 0): Vec => ({ x, y })
const s = (d: Core) => d.snapshot()
const line = (d: Core, id: string) => s(d).lines.find(l => l.id === id)!
const point = (d: Core, id: string) => s(d).points.find(p => p.id === id)!
const close = (a: Vec, b: Vec, eps = 1e-9) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
const R = (p: Vec): Vec => ({ x: -p.x, y: p.y }) // axis at x = 0
const groupOf = (d: Core, l: string) => s(d).groups.find(g => g.lines.includes(l))!.id

/**
 * Left "eye": a closed triangle l1 (p1→p2), l2 (p2→p3), l3 (p3→p1), left of the axis.
 * Right "eye": the same topology, roughly mirrored but off; `reverse` draws it the other way round.
 */
function eyes(reverse = false, layerB = 'A') {
  const d = new Core()
  d.edit(e => {
    e.layer('A'); if (layerB !== 'A') e.layer(layerB)
    sk(e).point('p1', 'A', P(-10, 0)); sk(e).point('p2', 'A', P(-6, 4)); sk(e).point('p3', 'A', P(-2, 0))
    sk(e).line('l1', 'p1', 'p2'); sk(e).line('l2', 'p2', 'p3'); sk(e).line('l3', 'p3', 'p1')
    sk(e).point('q1', layerB, P(11, 1)); sk(e).point('q2', layerB, P(5, 5)); sk(e).point('q3', layerB, P(3, -1))
    if (!reverse) { sk(e).line('r1', 'q1', 'q2'); sk(e).line('r2', 'q2', 'q3'); sk(e).line('r3', 'q3', 'q1') }
    else { sk(e).line('r1', 'q2', 'q1'); sk(e).line('r2', 'q3', 'q2'); sk(e).line('r3', 'q1', 'q3') }
  })
  return d
}
/** Every target line is the reflection of its source (by the correspondence l_i ↔ r_i). */
function mirrored(d: Core, pairs: [string, string][]) {
  for (const [a, b] of pairs) {
    const la = line(d, a), lb = line(d, b)
    const ca = [point(d, la.a).position, point(d, la.b).position]
    const cb = [point(d, lb.a).position, point(d, lb.b).position]
    const same = close(R(ca[0]!), cb[0]!, 1e-6) && close(R(ca[1]!), cb[1]!, 1e-6)
    const swapped = close(R(ca[0]!), cb[1]!, 1e-6) && close(R(ca[1]!), cb[0]!, 1e-6)
    if (!same && !swapped) return false
    const hs = same ? [la.ha, la.hb] : [la.hb, la.ha]
    if (!close(R(hs[0]!), lb.ha, 1e-6) || !close(R(hs[1]!), lb.hb, 1e-6)) return false
  }
  return true
}
const PAIRS: [string, string][] = [['l1', 'r1'], ['l2', 'r2'], ['l3', 'r3']]

describe('mirror apply', () => {
  it('A1. gives an exact mirror, keeps target ids, and copies stroke, state, end strokes, joins and fill', () => {
    const d = eyes()
    const loopL = s(d).loops.find(l => l.route.some(u => u.line === 'l1'))!.id
    d.edit(e => {
      e.lineStroke('l1', { width: 3, profile: 'taper' }); e.join('p2', 'l1', 'l2', { mode: 'cusp' }); e.fill(loopL, 'red')
    })
    d.edit(e => e.mirrorApply(['l1', 'l2', 'l3'], ['r1', 'r2', 'r3']))
    expect(mirrored(d, PAIRS)).toBe(true)
    expect(s(d).lines.map(l => l.id).sort()).toEqual(['l1', 'l2', 'l3', 'r1', 'r2', 'r3'])
    expect(line(d, 'r1').stroke).toEqual({ width: 3, profile: 'taper' })
    expect(s(d).joins.find(j => j.point === 'q2')).toMatchObject({ lines: ['r1', 'r2'], mode: 'cusp' })
    expect(s(d).loops.find(l => l.route.some(u => u.line === 'r1'))!.color).toBe('red')
    expect(s(d).mirrorPairs).toEqual([]) // an apply stores no relation
  })

  it('A1b. a target drawn the other way round is matched reversed, handles mapped correctly', () => {
    const d = eyes(true)
    d.edit(e => e.mirrorApply(['l1', 'l2', 'l3'], ['r1', 'r2', 'r3']))
    expect(mirrored(d, PAIRS)).toBe(true)
  })

  it('A2. a different topology is refused; overlapping source and target are refused', () => {
    const d = eyes()
    expect(() => d.edit(e => e.mirrorApply(['l1', 'l2'], ['r1', 'r2', 'r3']))).toThrow(/topology-mismatch/)
    expect(() => d.edit(e => e.mirrorApply(['l1', 'l2'], ['l2', 'r2']))).toThrow(/different lines/)
  })

  it('A3. the correspondence is the least total change, and a symmetric source gives a stable choice', () => {
    // two separate single lines: both orientations fit topologically; the nearer one wins
    const d = new Core()
    d.edit(e => {
      e.layer('A')
      sk(e).point('a', 'A', P(-10, 0)); sk(e).point('b', 'A', P(-2, 6)); sk(e).line('s', 'a', 'b')
      sk(e).point('c', 'A', P(2.5, 6)); sk(e).point('d', 'A', P(9, 0.5)); sk(e).line('t', 'c', 'd')
    })
    d.edit(e => e.mirrorApply(['s'], ['t']))
    // s runs a → b; t runs c (near R(b)) → d (near R(a)): matched reversed, so d = R(a), c = R(b)
    expect(point(d, 'd').position).toEqual(R(P(-10, 0)))
    expect(point(d, 'c').position).toEqual(R(P(-2, 6)))
    // a symmetric source (a square loop of four equal sides) matched twice gives the same result
    const sq = () => {
      const x = new Core()
      x.edit(e => {
        e.layer('A')
        const pts: [string, Vec][] = [['a', P(-6, 0)], ['b', P(-6, 4)], ['c', P(-2, 4)], ['d', P(-2, 0)]]
        for (const [id, p] of pts) sk(e).point(id, 'A', p)
        sk(e).line('s1', 'a', 'b'); sk(e).line('s2', 'b', 'c'); sk(e).line('s3', 'c', 'd'); sk(e).line('s4', 'd', 'a')
        const qs: [string, Vec][] = [['e', P(2, 0)], ['f', P(2, 4)], ['g', P(6, 4)], ['h', P(6, 0)]]
        for (const [id, p] of qs) sk(e).point(id, 'A', p)
        sk(e).line('t1', 'e', 'f'); sk(e).line('t2', 'f', 'g'); sk(e).line('t3', 'g', 'h'); sk(e).line('t4', 'h', 'e')
      })
      x.edit(e => e.mirrorApply(['s1', 's2', 's3', 's4'], ['t1', 't2', 't3', 't4']))
      return JSON.stringify(x.snapshot())
    }
    expect(sq()).toBe(sq())
  })

  it('A3b. matching tells a shared point from two points joined by an endpoint link', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('A'); e.layer('B')
      // source: two lines sharing one point m
      sk(e).point('a', 'A', P(-10)); sk(e).point('m', 'A', P(-5, 3)); sk(e).point('b', 'A', P(-1))
      sk(e).line('s1', 'a', 'm'); sk(e).line('s2', 'm', 'b')
      // target: two lines in two layers whose middle points are only endpoint-linked
      sk(e).point('c', 'A', P(10)); sk(e).point('n1', 'A', P(5, 3)); sk(e).line('t1', 'c', 'n1')
      sk(e).point('n2', 'B', P(5, 3)); sk(e).point('d', 'B', P(1)); sk(e).line('t2', 'n2', 'd')
      e.link('n1', 'n2')
    })
    expect(() => d.edit(e => e.mirrorApply(['s1', 's2'], ['t1', 't2']))).toThrow(/topology-mismatch/)
  })

  it('A4b. later commands in the same edit see the state an apply wrote (dot, review of d5e2704)', () => {
    const d = eyes()
    d.edit(e => { sk(e).point('u1', 'A', P(20, 20)); sk(e).point('u2', 'A', P(24, 24)); sk(e).point('u3', 'A', P(28, 20))
      sk(e).line('t1', 'u1', 'u2'); sk(e).line('t2', 'u2', 'u3'); sk(e).line('t3', 'u3', 'u1') })
    d.edit(e => e.lineState('l1', { visible: false }))
    d.edit(e => { e.mirrorApply(['l1', 'l2', 'l3'], ['r1', 'r2', 'r3']); e.lineState('r1', { visible: true }) })
    expect(line(d, 'r1').state.visible).toBe(true)
    // apply, then use the target as the source of a second apply in the same edit
    const d2 = eyes()
    d2.edit(e => { sk(e).point('u1', 'A', P(-30, 0)); sk(e).point('u2', 'A', P(-26, 4)); sk(e).point('u3', 'A', P(-22, 0))
      sk(e).line('t1', 'u1', 'u2'); sk(e).line('t2', 'u2', 'u3'); sk(e).line('t3', 'u3', 'u1') })
    d2.edit(e => e.lineState('l1', { locked: true, visible: false }))
    d2.edit(e => { e.mirrorApply(['l1', 'l2', 'l3'], ['r1', 'r2', 'r3']); e.mirrorApply(['r1', 'r2', 'r3'], ['t1', 't2', 't3']) })
    expect(line(d2, 'r1').state).toEqual({ visible: false, locked: true })
    expect(s(d2).lines.filter(l => l.id.startsWith('t')).some(l => l.state.locked && !l.state.visible)).toBe(true)
  })

  it('A4c. joins across an endpoint link inside the selection are copied, and cleared when the source has none (dot, review of d5e2704)', () => {
    const build = () => {
      const d = new Core()
      d.edit(e => {
        e.layer('U'); e.layer('L')
        sk(e).point('lu1', 'U', P(-10)); sk(e).point('lu2', 'U', P(-2)); sk(e).line('lu', 'lu1', 'lu2', { ha: P(2, 3), hb: P(-2, 3) })
        sk(e).point('ll1', 'L', P(-10)); sk(e).point('ll2', 'L', P(-2)); sk(e).line('ll', 'll1', 'll2', { ha: P(2, -2), hb: P(-2, -2) })
        sk(e).point('ru1', 'U', P(10)); sk(e).point('ru2', 'U', P(2)); sk(e).line('ru', 'ru1', 'ru2', { ha: P(-2, 3), hb: P(2, 3) })
        sk(e).point('rl1', 'L', P(10)); sk(e).point('rl2', 'L', P(2)); sk(e).line('rl', 'rl1', 'rl2', { ha: P(-2, -2), hb: P(2, -2) })
        e.link('lu1', 'll1'); e.link('ru1', 'rl1')
      })
      return d
    }
    const d = build()
    d.edit(e => e.linkJoin('lu1', 'll1', 'lu', 'll', { mode: 'smooth' }))
    d.edit(e => e.mirrorApply(['lu', 'll'], ['ru', 'rl']))
    expect(s(d).linkJoins.map(j => [j.a, j.b].sort().join('|')).sort()).toEqual(['ll1|lu1', 'rl1|ru1'])
    const d2 = build()
    d2.edit(e => e.linkJoin('ru1', 'rl1', 'ru', 'rl', { mode: 'smooth' }))
    d2.edit(e => e.mirrorApply(['lu', 'll'], ['ru', 'rl']))
    expect(s(d2).linkJoins).toEqual([])
  })

  it('A4. a locked target refuses the apply; a locked source applied onto an unlocked target gives a locked target', () => {
    const d = eyes()
    d.edit(e => e.lineState('r1', { locked: true }))
    expect(() => d.edit(e => e.mirrorApply(['l1', 'l2', 'l3'], ['r1', 'r2', 'r3']))).toThrow(/Locked/)
    const d2 = eyes()
    d2.edit(e => e.lineState('l1', { locked: true }))
    d2.edit(e => e.mirrorApply(['l1', 'l2', 'l3'], ['r1', 'r2', 'r3']))
    expect(line(d2, 'r1').state.locked).toBe(true)
    expect(mirrored(d2, PAIRS)).toBe(true)
  })
})

describe('mirror link', () => {
  const linked = (reverse = false, layerB = 'A') => {
    const d = eyes(reverse, layerB)
    d.edit(e => e.mirrorLink([groupOf(d, 'l1')], [groupOf(d, 'r1')]))
    return d
  }

  it('A5. creating it mirrors the target and stores the pairs; dragging either side moves the other to the mirror position', () => {
    const d = linked()
    expect(mirrored(d, PAIRS)).toBe(true)
    expect(s(d).mirrorPairs).toHaveLength(3)
    d.edit(e => e.move([{ id: 'p2', target: P(-7, 6) }]))
    expect(point(d, 'q2').position).toEqual(P(7, 6))
    d.edit(e => e.move([{ id: 'q1', target: P(12, -1) }]))
    expect(point(d, 'p1').position).toEqual(P(-12, -1))
    expect(mirrored(d, PAIRS)).toBe(true)
  })

  it('A5b. both sides dragged the same way across the axis cancel; dragged inward (mirrored) they move', () => {
    const d = linked()
    d.edit(e => e.move([{ id: 'p2', target: P(-3, 4) }, { id: 'q2', target: P(9, 4) }])) // both +3 in x
    expect(point(d, 'p2').position).toEqual(P(-6, 4))
    d.edit(e => e.move([{ id: 'p2', target: P(-5, 5) }, { id: 'q2', target: P(5, 5) }])) // both inward by 1, up by 1
    expect(point(d, 'p2').position).toEqual(P(-5, 5))
    expect(point(d, 'q2').position).toEqual(P(5, 5))
  })

  it('A5c. a handle dragged on one side is mirrored on the other', () => {
    const d = linked()
    d.edit(e => e.moveHandle('l1', 'b', P(1, 2)))
    expect(mirrored(d, PAIRS)).toBe(true)
  })

  it('A6. eyelids on two layers with corner endpoint links: dragging a left corner keeps the right side a mirror; per-layer and at-once build the same pairs', () => {
    const build = (atOnce: boolean) => {
      const d = new Core()
      d.edit(e => {
        e.layer('U'); e.layer('L')
        // left upper / lower lid, corners linked across layers
        sk(e).point('lu1', 'U', P(-10)); sk(e).point('lu2', 'U', P(-2)); sk(e).line('lu', 'lu1', 'lu2', { ha: P(2, 3), hb: P(-2, 3) })
        sk(e).point('ll1', 'L', P(-10)); sk(e).point('ll2', 'L', P(-2)); sk(e).line('ll', 'll1', 'll2', { ha: P(2, -2), hb: P(-2, -2) })
        // right side drawn off-mirror
        sk(e).point('ru1', 'U', P(11, 1)); sk(e).point('ru2', 'U', P(3)); sk(e).line('ru', 'ru1', 'ru2')
        sk(e).point('rl1', 'L', P(11, 1)); sk(e).point('rl2', 'L', P(3)); sk(e).line('rl', 'rl1', 'rl2')
        e.link('lu1', 'll1'); e.link('lu2', 'll2'); e.link('ru1', 'rl1'); e.link('ru2', 'rl2')
      })
      const g = (l: string) => groupOf(d, l)
      if (atOnce) d.edit(e => e.mirrorLink([g('lu'), g('ll')], [g('ru'), g('rl')]))
      else { d.edit(e => e.mirrorLink([g('lu')], [g('ru')])); d.edit(e => e.mirrorLink([g('ll')], [g('rl')])) }
      d.edit(e => e.move([{ id: 'lu1', target: P(-12, 1) }]))
      return d
    }
    const a = build(true), b = build(false)
    expect(s(a).mirrorPairs).toEqual(s(b).mirrorPairs)
    expect(JSON.stringify(s(a).points)).toBe(JSON.stringify(s(b).points))
    expect(point(a, 'ru1').position).toEqual(P(12, 1))
    expect(point(a, 'rl1').position).toEqual(P(12, 1))
  })

  it('A7. paired delete removes both; paired split gives paired pieces (crossed on a reversed pair); stroke, state and fill sync; undo restores', () => {
    for (const reverse of [false, true]) {
      const d = linked(reverse)
      d.edit(e => e.split('l1', 0.25, 'm', 'l1a', 'l1b'))
      expect(s(d).lines.map(l => l.id)).toContain('l1a′')
      const pairs = s(d).mirrorPairs.map(p => [p.a, p.b].sort().join('|'))
      expect(pairs).toContain(['l1a', 'l1a′'].sort().join('|'))
      expect(pairs).toContain(['l1b', 'l1b′'].sort().join('|'))
      expect(mirrored(d, [['l1a', 'l1a′'], ['l1b', 'l1b′'], ['l2', 'r2'], ['l3', 'r3']])).toBe(true)
      d.edit(e => { e.lineStroke('l2', { width: 5, profile: 'uniform' }); e.lineState('l3', { visible: false }) })
      expect(line(d, 'r2').stroke.width).toBe(5)
      expect(line(d, 'r3').state.visible).toBe(false)
      const loopL = s(d).loops.find(l => l.route.some(u => u.line === 'l2'))!.id
      d.edit(e => e.fill(loopL, 'blue'))
      expect(s(d).loops.find(l => l.route.some(u => u.line === 'r2'))!.color).toBe('blue')
      d.edit(e => e.deleteLine('l2'))
      expect(s(d).lines.map(l => l.id)).not.toContain('r2')
      d.undo(); d.undo(); d.undo(); d.undo()
      expect(s(d).lines.map(l => l.id).sort()).toEqual(['l1', 'l2', 'l3', 'r1', 'r2', 'r3'])
    }
  })

  it('A8. matching end points dragged onto the axis in one layer bind, and the pairs survive', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('A')
      sk(e).point('a', 'A', P(-10)); sk(e).point('b', 'A', P(-1, 2)); sk(e).line('left', 'a', 'b')
      sk(e).point('c', 'A', P(10)); sk(e).point('dd', 'A', P(1, 2)); sk(e).line('right', 'c', 'dd')
    })
    d.edit(e => e.mirrorLink([groupOf(d, 'left')], [groupOf(d, 'right')]))
    d.edit(e => e.move([{ id: 'b', target: P(0, 2) }]))
    expect(s(d).groups).toHaveLength(1)
    expect(s(d).mirrorPairs).toHaveLength(1)
    d.edit(e => e.move([{ id: 'a', target: P(-12, 1) }]))
    expect(point(d, 'c').position).toEqual(P(12, 1))
  })

  it('A8b. after mirrored ends bind on the axis, unbinding one line unbinds its counterpart too, to a new point ′ (dot, review of 1fa7462)', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('A')
      sk(e).point('a', 'A', P(-10)); sk(e).point('b', 'A', P(-1, 2)); sk(e).line('left', 'a', 'b')
      sk(e).point('c', 'A', P(10)); sk(e).point('dd', 'A', P(1, 2)); sk(e).line('right', 'c', 'dd')
    })
    d.edit(e => e.mirrorLink([groupOf(d, 'left')], [groupOf(d, 'right')]))
    d.edit(e => e.move([{ id: 'b', target: P(0, 2) }]))
    const shared = line(d, 'left').b
    expect(line(d, 'right').b).toBe(shared)
    d.edit(e => e.unbind(shared, ['left'], 'n'))
    expect(line(d, 'left').b).toBe('n')
    expect(line(d, 'right').b).toBe('n′')
    expect(point(d, 'n′').position).toEqual(R(point(d, 'n').position))
    expect(s(d).mirrorPairs).toHaveLength(1)
  })

  it('A8c. binding away a point both sides share on the axis is refused explicitly, not with a stale id (dot, review of 1fa7462)', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('A')
      sk(e).point('a', 'A', P(-10)); sk(e).point('b', 'A', P(-1, 2)); sk(e).line('left', 'a', 'b')
      sk(e).point('c', 'A', P(10)); sk(e).point('dd', 'A', P(1, 2)); sk(e).line('right', 'c', 'dd')
    })
    d.edit(e => e.mirrorLink([groupOf(d, 'left')], [groupOf(d, 'right')]))
    d.edit(e => e.move([{ id: 'b', target: P(0, 2) }]))
    const shared = line(d, 'left').b
    expect(() => d.edit(e => e.bind('a', shared))).toThrow(/mirror-shared-point/)
    // keeping the shared point is fine: each side binds its own point onto it
    expect(s(d).lines).toHaveLength(2)
  })

  it('A9. binding or linking a paired point to an outside point without counterpart is refused', () => {
    const d = linked()
    d.edit(e => { sk(e).point('x', 'A', P(0, 20)); sk(e).point('y', 'A', P(0, 30)); sk(e).line('nose', 'x', 'y') })
    expect(() => d.edit(e => e.bind('x', 'p2'))).toThrow(/mirror-no-counterpart/)
  })

  it('A10. a locked counterpart refuses a paired edit; a third-party locked line moved by the mirror stays protected', () => {
    const d = linked()
    // locking r1 also locks its counterpart l1 (state syncs under a mirror link)
    d.edit(e => e.lineState('r1', { locked: true }))
    expect(line(d, 'l1').state.locked).toBe(true)
    expect(() => d.edit(e => e.move([{ id: 'p2', target: P(-7, 6) }]))).toThrow(/Locked/)
    const d2 = linked()
    d2.edit(e => { sk(e).point('z', 'A', P(20, 20)); sk(e).line('third', 'q2', 'z') })
    d2.edit(e => e.lineState('third', { locked: true }))
    expect(() => d2.edit(e => e.move([{ id: 'p2', target: P(-7, 6) }]))).toThrow(/Locked lines would change \(third\)/)
  })

  it('A11. unmirror keeps the shapes; afterwards edits no longer pair', () => {
    const d = linked()
    d.edit(e => e.unmirror(['l1', 'l2', 'l3']))
    expect(s(d).mirrorPairs).toEqual([])
    expect(mirrored(d, PAIRS)).toBe(true)
    d.edit(e => e.move([{ id: 'p2', target: P(-7, 6) }]))
    expect(point(d, 'q2').position).toEqual(R(P(-6, 4)))
  })

  it('A12. a counterpart id that is already used refuses the whole operation', () => {
    const d = linked()
    d.edit(e => { sk(e).point('x', 'A', P(0, 20)); sk(e).point('m′', 'A', P(0, 30)); sk(e).line('other', 'x', 'm′') })
    expect(() => d.edit(e => e.split('l1', 0.5, 'm', 'l1a', 'l1b'))).toThrow(/already used/)
    expect(s(d).lines.map(l => l.id)).not.toContain('l1a')
  })

  it('A14. endpoint links and joins across a link between paired points are set and removed in pairs', () => {
    const d = linked(false, 'B')
    d.edit(e => { e.layer('C'); sk(e).point('u', 'C', P(-6, 4)); sk(e).point('v', 'C', P(-6, 9)); sk(e).line('lu', 'u', 'v') })
    expect(() => d.edit(e => e.link('p2', 'u'))).toThrow(/mirror-no-counterpart/)
    // a second mirror pair in layer C gives u a counterpart, so the link can be paired
    d.edit(e => { sk(e).point('u2', 'C', P(6, 4)); sk(e).point('v2', 'C', P(6, 9)); sk(e).line('ru', 'u2', 'v2') })
    d.edit(e => e.mirrorLink([groupOf(d, 'lu')], [groupOf(d, 'ru')]))
    d.edit(e => e.link('p2', 'u'))
    expect(s(d).links.map(k => [k.a, k.b].sort().join('|')).sort()).toEqual(['p2|u', 'q2|u2'])
    d.edit(e => e.unlink('p2', 'u'))
    expect(s(d).links).toEqual([])
  })

  it('A13. the axis is a fixed document setting', () => {
    const d = Core.newDocument({ axis: 5 })
    expect(s(d).axis).toBe(5)
    expect(new Core().snapshot().axis).toBe(0)
  })
})

describe('mirror link under random edits', () => {
  function rng(seed: number) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  /** Every stored pair is an exact mirror (positions and handles). */
  function pairsMirrored(d: Core): string[] {
    const bad: string[] = []
    for (const p of s(d).mirrorPairs) {
      const la = line(d, p.a), lb = line(d, p.b)
      const A = [point(d, la.a).position, point(d, la.b).position], B = [point(d, lb.a).position, point(d, lb.b).position]
      const [b0, b1, h0, h1] = p.reversed ? [B[1]!, B[0]!, lb.hb, lb.ha] : [B[0]!, B[1]!, lb.ha, lb.hb]
      if (!close(R(A[0]!), b0, 1e-6) || !close(R(A[1]!), b1, 1e-6) || !close(R(la.ha), h0, 1e-6) || !close(R(la.hb), h1, 1e-6)) bad.push(`${p.a}|${p.b} not mirrored`)
    }
    return bad
  }

  it('A15. random moves, handle drags, splits, deletes, strokes and transforms keep every pair an exact mirror', () => {
    const failures: string[] = [], ok: Record<string, number> = {}
    for (let seed = 1; seed <= 25; seed++) {
      const r = rng(seed), d = eyes(seed % 2 === 0)
      d.edit(e => e.mirrorLink([groupOf(d, 'l1')], [groupOf(d, 'r1')]))
      let k = 0
      for (let step = 0; step < 40; step++) {
        const snap = s(d), ids = snap.lines.map(l => l.id), pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!
        const roll = r(), num = () => Math.round((r() - 0.5) * 30)
        const kind = roll < 0.3 ? 'move' : roll < 0.5 ? 'handle' : roll < 0.62 ? 'split' : roll < 0.7 ? 'delete' : roll < 0.78 ? 'stroke' : roll < 0.92 ? 'rotate' : 'history'
        try {
          if (roll < 0.3) { const p = pick(snap.points); d.edit(e => e.move([{ id: p.id, target: P(num(), num()) }])) }
          else if (roll < 0.5) { const l = pick(ids); d.edit(e => e.moveHandle(l, r() < 0.5 ? 'a' : 'b', P(num() / 3, num() / 3))) }
          else if (roll < 0.62) { const l = pick(ids), n = `s${k++}`; d.edit(e => e.split(l, 0.2 + r() * 0.6, `${n}m`, `${n}a`, `${n}b`)) }
          else if (roll < 0.7 && ids.length > 2) { const l = pick(ids); d.edit(e => e.deleteLine(l)) }
          else if (roll < 0.78) { const l = pick(ids); d.edit(e => e.lineStroke(l, { width: 1 + Math.floor(r() * 4), profile: 'uniform' })) }
          else if (roll < 0.92) { const l = pick(ids); d.edit(e => { e.selectGroup(l); e.rotate(P(num(), num()), r() - 0.5) }) }
          else if (roll < 0.96) d.undo()
          else d.redo()
          ok[kind] = (ok[kind] ?? 0) + 1
        } catch { /* refused edits are fine */ }
        for (const f of pairsMirrored(d)) failures.push(`seed ${seed} step ${step}: ${f}`)
        for (const p of s(d).mirrorPairs) if (line(d, p.a).stroke.width !== line(d, p.b).stroke.width) failures.push(`seed ${seed} step ${step}: ${p.a}|${p.b} widths differ`)
      }
    }
    expect(failures.slice(0, 8)).toEqual([])
    // the run must really exercise paired edits, not only refusals
    for (const kind of ['move', 'handle', 'split', 'delete', 'stroke', 'rotate']) expect(ok[kind] ?? 0).toBeGreaterThan(10)
  }, 60000)
})
