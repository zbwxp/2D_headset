// One arc radius per join, in every view and at every pose (bowen 1791985326; docs/arc-radius-shared-checklist.md):
// set from any view it is the row's one value; an old file (version 11) takes the front's, after version 11's own checks.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'
import { radiiPerView } from './old-files'

const P = (x: number, y = 0): Vec => ({ x, y })
const SIDE = 'view:90,0'
const POSES = [{ yaw: 30, pitch: 0 }, { yaw: -60, pitch: 45 }, { yaw: 17, pitch: -20 }]
const radiusIn = (d: Core, k: string) => d.in(k).snapshot().joins.find(r => r.mode === 'arc')?.radius
const radiusAt = (d: Core, pose: { yaw: number; pitch: number }) => d.atPose(pose).snapshot().joins.find(r => r.mode === 'arc')?.radius

/** ab and bc at b, with the side view moved so poses differ; an arc of radius 10 set at the front. */
function corner() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }); e.line('bc', 'b', { id: 'c', layer: 'L', position: P(10, 10) }) })
  d.editIn(SIDE, e => e.move([{ id: 'c', target: P(20, 12) }]))
  d.edit(e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 10 }))
  return d
}
type V11 = { version: number; document: { network: { shapes: { layers: { key: string; radius: Record<string, number> }[] } }; joins: { rows: Record<string, unknown>[] } } }
const asV11 = (d: Core): V11 => { const f = radiiPerView(JSON.parse(save(d))) as V11; f.version = 11; return f }
const layer = (f: V11, k: string) => f.document.network.shapes.layers.find(L => L.key === k)!
const KEY = JSON.stringify(['b', 'ab', 'bc'])

describe('one radius in every view and at every pose', () => {
  it('changed in the side view: the nine views and the poses between read it; the drawn arcs use it; one undo step', () => {
    const d = corner()
    d.editIn(SIDE, e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 4 }))
    for (const k of d.views()) expect([k, radiusIn(d, k)]).toEqual([k, 4])
    for (const p of POSES) expect([p, radiusAt(d, p)]).toEqual([p, 4])
    // the posed reader draws the arc from the row's radius: equal to a view drawn with it where the pose is a view
    expect(d.atPose({ yaw: 90, pitch: 0 }).geometry().arcs).toEqual(d.in(SIDE).geometry().arcs)
    d.undo()
    for (const k of d.views()) expect(radiusIn(d, k)).toBe(10)
    for (const p of POSES) expect(radiusAt(d, p)).toBe(10)
  })

  it('saved as version 12: the radius is in the row, no shape layer holds one; opened equal', () => {
    const d = corner()
    const f = JSON.parse(save(d))
    expect(f.version).toBe(12)
    expect(f.document.joins.rows).toEqual([{ point: 'b', lines: ['ab', 'bc'], mode: 'arc', radius: 10 }])
    for (const L of f.document.network.shapes.layers) expect(Object.hasOwn(L, 'radius')).toBe(false)
    expect(save(open(save(d)))).toBe(save(d))
  })
})

describe('a version 11 file (dot 1791985599)', () => {
  it('views that disagree: every view and pose takes the front\'s radius (bowen 1791985326)', () => {
    const f = asV11(corner())
    layer(f, SIDE).radius[KEY] = 4
    layer(f, 'view:0,45').radius[KEY] = 7
    const d = open(JSON.stringify(f))
    for (const k of d.views()) expect([k, radiusIn(d, k)]).toEqual([k, 10])
    for (const p of POSES) expect(radiusAt(d, p)).toBe(10)
    expect(JSON.parse(save(d)).version).toBe(12)
  })

  it('views that agree: opens as the same drawing', () => {
    const d = corner()
    expect(save(open(JSON.stringify(asV11(d))))).toBe(save(d))
  })

  it('invalid old radii are refused, not dropped: one missing, not above zero or not a number in any view; one on no arc; a row carrying one; no default for the front', () => {
    const bad = (f: (x: V11) => void) => { const x = asV11(corner()); f(x); return JSON.stringify(x) }
    expect(() => open(bad(x => { delete layer(x, SIDE).radius[KEY] }))).toThrow(/open-failed: arc join .* has no radius in view:90,0/)
    expect(() => open(bad(x => { delete layer(x, 'view:0,0').radius[KEY] }))).toThrow(/open-failed: arc join .* has no radius in view:0,0/)
    expect(() => open(bad(x => { layer(x, SIDE).radius[KEY] = 0 }))).toThrow(/is not a finite number above zero/)
    expect(() => open(bad(x => { (layer(x, SIDE).radius as Record<string, unknown>)[KEY] = 'wide' }))).toThrow(/is not a finite number above zero/)
    expect(() => open(bad(x => { layer(x, SIDE).radius[JSON.stringify(['b', 'ab', 'zz'])] = 3 }))).toThrow(/belongs to no arc join/)
    expect(() => open(bad(x => { x.document.joins.rows[0]!.radius = 3 }))).toThrow(/join 0 carries an extra value/)
    expect(() => open(bad(x => { delete (layer(x, SIDE) as { radius?: unknown }).radius }))).toThrow(/radius is not an object/)
  })
})
