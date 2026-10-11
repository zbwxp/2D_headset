// A non-finite coordinate is a typed refusal wherever it arises (dot 1791694458, 1791694791): given
// by the caller, or computed by a settle step that overflows on finite input. The edit rolls back
// and the undo history is unchanged. The link averaging itself is not changed (ledger row 15).
import { describe, it, expect } from 'vitest'
import { Core, save, Refusal, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
function refusal(f: () => void): Refusal {
  try { f() } catch (x) { if (x instanceof Refusal) return x; throw x }
  throw new Error('no refusal')
}
/** The state before the last edit, read by undoing it and redoing it. */
function previous(d: Core): string { d.undo(); const s = save(d); d.redo(); return s }

describe('coordinates-not-finite', () => {
  it('a non-finite coordinate given to an operation', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }))
    const before = save(d), prior = previous(d)
    for (const bad of [P(NaN), P(Infinity), P(0, -Infinity)]) {
      expect(refusal(() => d.edit(e => e.move([{ id: 'a', target: bad }]))).code).toBe('coordinates-not-finite')
      expect(refusal(() => d.edit(e => e.moveHandle('ab', 'a', bad))).code).toBe('coordinates-not-finite')
    }
    expect(save(d)).toBe(before)
    expect(previous(d)).toBe(prior)
  })

  it('link alignment overflowing on finite input: two linked points at x = 1e308 moved in y', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.layer('M', 'M'); e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(1e308, 10) }); e.line('mn', { id: 'm', layer: 'M', position: P(1e308, 10) }, { id: 'n', layer: 'M', position: P(0, 50) }) })
    d.edit(e => e.link('b', 'm'))
    const before = save(d), prior = previous(d)
    const r = refusal(() => d.edit(e => e.move([{ id: 'b', target: P(1e308, 20) }, { id: 'm', target: P(1e308, 20) }])))
    expect([r.code, r.message]).toEqual(['coordinates-not-finite', 'coordinates-not-finite: Coordinates must be finite numbers'])
    expect(save(d)).toBe(before)
    expect(previous(d)).toBe(prior)
    // one member moved alone is averaged alone, and goes through
    d.edit(e => e.move([{ id: 'b', target: P(1e308, 20) }]))
    expect(d.snapshot().points.find(p => p.id === 'm')!.position).toEqual(P(1e308, 20))
  })

  it('a spring overflowing on finite input: a smooth join turning a handle whose length overflows', () => {
    const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(20, 10) }) })
    d.edit(e => e.moveHandle('bc', 'a', P(1.5e308, 1.5e308)))
    const before = save(d), prior = previous(d)
    // bc's handle turns to ab's; its length, hypot(1.5e308, 1.5e308), overflows
    expect(refusal(() => d.edit(e => e.join('b', 'ab', 'bc', { mode: 'smooth' }))).code).toBe('coordinates-not-finite')
    expect(save(d)).toBe(before)
    expect(previous(d)).toBe(prior)
  })
})
