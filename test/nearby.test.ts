// The read-only distance query (docs/interaction-plan.md work item 3; doc 22 §3.1).
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../src'

const P = (x: number, y: number): Vec => ({ x, y })
function scene() {
  const d = new Core()
  d.edit(e => {
    e.layer('L')
    e.line('h', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(30, 0) })
    e.line('v', 'b', { id: 'c', layer: 'L', position: P(30, 30) })
  })
  return d
}
const short = (d: Core, at: Vec, r: number) => d.nearby(at, r).map(x => x.kind === 'handle' ? `handle:${x.line}.${x.end}` : `${x.kind}:${x.id}`)

describe('nearby', () => {
  it('finds points, handle tips and lines within the radius, nearest first, with distances', () => {
    const d = scene()
    // h runs (0,0)→(30,0) with default handles ±(10,0): tips at (10,0) and (20,0)
    const onLine = d.nearby(P(15, 1), 2)
    expect(onLine.map(x => x.kind)).toEqual(['line'])
    expect(onLine[0]!.distance).toBeCloseTo(1, 9)
    const nearTip = d.nearby(P(12, 3), 4)
    expect(nearTip.map(x => x.kind === 'handle' ? `handle:${x.line}.${x.end}` : `${x.kind}:${x.id}`)).toEqual(['line:h', 'handle:h.a'])
    expect(short(d, P(30, 0), 0.5)).toEqual(['point:b', 'line:h', 'line:v'])
    expect(short(d, P(100, 100), 5)).toEqual([])
  })

  it('a line is measured as drawn: an arc join trims it, and t is on the drawn piece', () => {
    const d = scene()
    d.edit(e => e.join('b', 'h', 'v', { mode: 'arc', radius: 8 }))
    const corner = d.nearby(P(30, 0), 0.5)
    expect(corner.map(x => x.kind)).toEqual(['point'])
    const onH = d.nearby(P(5, 0), 0.01).find(x => x.kind === 'line')!
    expect(onH.kind === 'line' && onH.t).toBeGreaterThan(0)
  })

  it('reports whether each is shown; a point is shown when one of its lines is (picking rules stay with interaction)', () => {
    const d = scene()
    d.edit(e => e.lineState('v', { visible: false }))
    const at = (x: Vec) => d.nearby(x, 0.5)
    expect(at(P(30, 30)).find(x => x.kind === 'point')).toMatchObject({ id: 'c', visible: false })
    expect(at(P(30, 0)).find(x => x.kind === 'point')).toMatchObject({ id: 'b', visible: true })
    expect(at(P(30, 15)).find(x => x.kind === 'line')).toMatchObject({ id: 'v', visible: false })
  })

  it('reads only, and refuses a non-finite position or a negative radius', () => {
    const d = scene(), before = JSON.stringify([d.snapshot(), d.geometry(), d.canUndo])
    d.nearby(P(10, 1), 100)
    expect(JSON.stringify([d.snapshot(), d.geometry(), d.canUndo])).toBe(before)
    expect(() => d.nearby(P(NaN, 0), 1)).toThrow()
    expect(() => d.nearby(P(0, 0), -1)).toThrow()
  })
})
