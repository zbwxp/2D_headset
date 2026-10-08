// Operations that read geometry read the edit so far as settled (docs/edit-model.md §1.3;
// dot, review after 6aaaee6). Each case has an explicit expected result. The fixture
// moves q earlier in the same edit; a is endpoint-linked to q, so a settles to (0, 10)
// although the draft still holds it at (0, 0) until commit.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'
import { sk } from './sketch'

const P = (x: number, y = 0): Vec => ({ x, y })
const s = (d: Core) => d.snapshot()
const line = (d: Core, id: string) => s(d).lines.find(l => l.id === id)!
const point = (d: Core, id: string) => s(d).points.find(p => p.id === id)
const close = (a: Vec | undefined, b: Vec) => !!a && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9

function fixture() {
  const d = new Core()
  d.edit(e => {
    e.layer('A'); e.layer('B'); e.layer('C')
    sk(e).point('a', 'A', P(0)); sk(e).point('a2', 'A', P(-5)); sk(e).line('la', 'a2', 'a')
    sk(e).point('q', 'B', P(0)); sk(e).point('q2', 'B', P(5)); sk(e).line('lq', 'q', 'q2')
    e.link('a', 'q')
  })
  return d
}
const moveQ = { id: 'q', target: P(0, 10) }

describe('reads see the edit so far as settled', () => {
  it('S1. merge position onto a point a link has moved earlier in the edit merges with it (dot)', () => {
    const d = fixture()
    d.edit(e => { sk(e).point('x', 'A', P(20, 20)); sk(e).point('x2', 'A', P(25, 25)); sk(e).line('lx', 'x', 'x2') })
    d.edit(e => { e.move([moveQ]); e.mergePosition('a', 'x') })
    expect(point(d, 'a')!.position).toEqual(P(0, 10))
    expect(point(d, 'x')).toBeUndefined()
    expect(line(d, 'lx').a).toBe('a')
  })

  it('S2. a new endpoint link moves the second point to where the first point settles', () => {
    const d = fixture()
    d.edit(e => { sk(e).point('r', 'C', P(30)); sk(e).point('r2', 'C', P(35)); sk(e).line('lr', 'r', 'r2') })
    d.edit(e => { e.move([moveQ]); e.link('a', 'r') })
    expect(point(d, 'r')!.position).toEqual(P(0, 10))
  })

  it('S3. a split cuts the settled curve: the mid point lies on the curve as it ends up', () => {
    const d = fixture()
    d.edit(e => { e.move([moveQ]); e.split('la', 0.5, 'm', 'la1', 'la2') })
    // la runs a2 (-5, 0) → a (0, 10) with handles (5/3, 0) and (-5/3, 0)
    expect(close(point(d, 'm')!.position, P(-2.5, 5))).toBe(true)
  })

  it('S4. unbind offsets the new point from where the point settles', () => {
    const d = fixture()
    d.edit(e => { sk(e).point('b', 'A', P(0, -6)); sk(e).line('lb', 'a', 'b', { ha: P(0, -2), hb: P(0, 2) }) })
    d.edit(e => { e.move([moveQ]); e.unbind('a', ['lb'], 'n') })
    expect(close(point(d, 'n')!.position, P(0, 9.5))).toBe(true) // 0.5 back along lb's handle
  })

  it('S5. a layer copied in the edit copies where its points settle', () => {
    const d = fixture()
    d.edit(e => { e.move([moveQ]); e.copyLayer('A', 'A2') })
    expect(point(d, 'A2/a')!.position).toEqual(P(0, 10))
  })

  it('S6. a transform reads where its points settle: a half turn about a’s settled position keeps a there', () => {
    const d = fixture()
    d.edit(e => { e.move([moveQ]); e.select([{ kind: 'line', id: 'la' }]); e.rotate(P(0, 10), Math.PI) })
    expect(close(point(d, 'a')!.position, P(0, 10))).toBe(true)
    expect(close(point(d, 'a2')!.position, P(5, 20))).toBe(true)
  })

  it('S8. a new line from an existing point gets default handles from where that point settles (dot)', () => {
    const d = fixture()
    d.edit(e => { e.move([moveQ]); e.line('ln', 'a', { id: 'z', layer: 'A', position: P(9, 10) }) })
    // a settles to (0, 10): the chord to z (9, 10) is (9, 0), so the default handles are ±(3, 0)
    expect(close(line(d, 'ln').ha, P(3, 0))).toBe(true)
    expect(close(line(d, 'ln').hb, P(-3, 0))).toBe(true)
  })

  it('S9. reading is not an intent: a read for a merge stays what it was, later moves of the read point still win (dot 1791475696)', () => {
    const d = fixture()
    d.edit(e => { sk(e).point('x', 'C', P(20, 20)); sk(e).point('x2', 'C', P(25, 25)); sk(e).line('lx', 'x', 'x2') })
    d.edit(e => { e.move([moveQ]); e.mergePosition('a', 'x'); e.move([{ id: 'q', target: P(0, 20) }]) })
    expect(point(d, 'q')!.position).toEqual(P(0, 20))
    expect(point(d, 'a')!.position).toEqual(P(0, 20))
    expect(point(d, 'x')!.position).toEqual(P(0, 10))
  })

  it('S10. a read does not drop earlier intents: q to 10, then a moved +2 from its settled 10 → both average to 11 (dot 1791475696)', () => {
    const d = fixture()
    d.edit(e => { e.move([moveQ]); e.select([{ kind: 'point', id: 'a' }]); e.translate(0, 2) })
    expect(point(d, 'a')!.position).toEqual(P(0, 11))
    expect(point(d, 'q')!.position).toEqual(P(0, 11))
  })

  it('S7. a mirror apply reflects the source as it settles', () => {
    const d = fixture()
    // the target is on C: a sits on the axis, so a target end reflected onto it in A would bind into it
    d.edit(e => { sk(e).point('t1', 'C', P(4, 1)); sk(e).point('t2', 'C', P(6, 1)); sk(e).line('lt', 't1', 't2') })
    d.edit(e => { e.move([moveQ]); e.mirrorApply(['la'], ['lt']) })
    // la settles to a2 (-5, 0) → a (0, 10); lt is matched reversed or not by least change, either way its ends are the reflections
    const ends = [point(d, 't1')!.position, point(d, 't2')!.position].map(p => JSON.stringify(p)).sort()
    expect(ends).toEqual([JSON.stringify(P(0, 10)), JSON.stringify(P(5, 0))].sort())
  })
})
