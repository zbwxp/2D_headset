// Transforms with explicit targets (docs/interaction-plan.md work item 2; dot 1791543296):
// the same result as selecting those units and transforming, while the real selection is
// neither read nor changed.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'

const P = (x: number, y: number): Vec => ({ x, y })
type U = { kind: 'line'; id: string } | { kind: 'point'; id: string } | { kind: 'handle'; line: string; end: 'a' | 'b' }
function scene() {
  const d = new Core({ axis: 0 })
  d.edit(e => {
    e.layer('L'); e.layer('K')
    e.line('a1', { id: 'a', layer: 'L', position: P(-30, 0) }, { id: 'b', layer: 'L', position: P(-10, 5) })
    e.line('a2', 'b', { id: 'c', layer: 'L', position: P(-20, 20) })
    e.line('b1', { id: 'x', layer: 'K', position: P(10, 1) }, { id: 'y', layer: 'K', position: P(30, 2) })
    e.link('a', 'x')
  })
  return d
}
const geometry = (d: Core) => JSON.stringify({ ...d.snapshot(), selection: [] })
const cases: [string, U[], (e: any, u?: U[]) => void][] = [
  ['translate a line', [{ kind: 'line', id: 'a1' }], (e, u) => e.translate(7, -3, u)],
  ['rotate a point and a handle', [{ kind: 'point', id: 'c' }, { kind: 'handle', line: 'a1', end: 'a' }], (e, u) => e.rotate(P(0, 0), 0.4, u)],
  ['scale two lines sharing a point', [{ kind: 'line', id: 'a1' }, { kind: 'line', id: 'a2' }], (e, u) => e.scale(P(-20, 5), 1.5, 0.5, u)],
  ['flip a curve about its own centre', [{ kind: 'line', id: 'a1' }, { kind: 'line', id: 'a2' }], (e, u) => e.flip(u)],
]

describe('explicit-target transforms', () => {
  for (const [label, units, op] of cases) {
    it(`${label}: the same geometry as selecting and transforming; the selection untouched`, () => {
      const viaSelection = scene(), explicit = scene()
      viaSelection.edit(e => { e.select(units); op(e) })
      explicit.edit(e => e.select([{ kind: 'line', id: 'b1' }]))
      explicit.edit(e => op(e, units))
      expect(geometry(explicit)).toBe(geometry(viaSelection))
      expect(explicit.snapshot().selection).toEqual([{ kind: 'line', id: 'b1' }])
    })
  }

  it('dragging A while B is selected moves A, never B, and B stays selected (dot 1791543296)', () => {
    const d = scene()
    d.edit(e => e.select([{ kind: 'line', id: 'b1' }]))
    const before = d.snapshot()
    d.edit(e => e.translate(0, 40, [{ kind: 'line', id: 'a2' }]))
    const after = d.snapshot(), pos = (s: typeof after, id: string) => s.points.find(p => p.id === id)!.position
    expect(pos(after, 'c')).toEqual({ x: -20, y: 60 })
    expect(pos(after, 'y')).toEqual(pos(before, 'y'))
    expect(after.selection).toEqual([{ kind: 'line', id: 'b1' }])
  })

  it('targets that no longer exist are refused, and nothing changes', () => {
    const d = scene(), before = geometry(d)
    expect(() => d.edit(e => e.translate(5, 5, [{ kind: 'line', id: 'gone' }]))).toThrow(/Nothing to select/)
    expect(geometry(d)).toBe(before)
  })
})
