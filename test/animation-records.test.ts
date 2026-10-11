// Stage 2, package 1 (docs/stage2-plan.md rules 1–2; dot 1791680403): the angle baseline
// record layer `base:angle`, owned by animation. Its role rules: what is new takes the drawn
// values; an existing end point keeps its baseline; split / bind / unbind / delete follow the
// kind-independent rules; a paste takes the clip's baseline, else the clip's front; open
// checks it for integrity only.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../src'

const P = (x: number, y = 0): Vec => ({ x, y })
const SIDE = 'view:90,0'
type Layer = { key: string; kind: string; copyNew?: boolean; points: Record<string, Vec>; lines: Record<string, { ha: Vec; hb: Vec; stroke: { width: number } }>; radius: Record<string, number> }
const layerOf = (d: Core, key: string): Layer => (JSON.parse(save(d)).document.network.shapes.layers as Layer[]).find(l => l.key === key)!
const base = (d: Core) => layerOf(d, 'base:angle')
const front = (d: Core) => layerOf(d, 'view:0,0')

function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => e.line('ab', { id: 'a', layer: 'L', position: P(0) }, { id: 'b', layer: 'L', position: P(10) }))
  return d
}

describe('the angle baseline record layer', () => {
  it('every document has it from creation: a record, owned, equal to the front', () => {
    const d = doc()
    const b = base(d)
    expect([b.kind, b.copyNew]).toEqual(['record', true])
    expect(b.points).toEqual(front(d).points)
    expect(b.lines).toEqual(front(d).lines)
    expect(d.views()).not.toContain('base:angle')
    expect(() => d.editIn('base:angle', () => {})).toThrow(/not-a-view/)
  })

  it('a new line\'s new points and handles take the drawn values; an existing end point keeps its baseline', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(12, 3) }])) // b now has a pending change at the front
    d.editIn(SIDE, e => e.line('bc', 'b', { id: 'c', layer: 'L', position: P(30, 30) }))
    const b = base(d)
    expect(b.points.c).toEqual(P(30, 30))
    expect(b.points.b).toEqual(P(10)) // its baseline stays: the front's pending change is not swallowed
    expect(front(d).points.b).toEqual(P(12, 3))
    expect(b.lines.bc!.ha).toEqual(layerOf(d, SIDE).lines.bc!.ha)
  })

  it('a split re-expresses the baseline at the same t; it is never set to the current front', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(20, 20) }]))
    d.edit(e => e.split('ab', 0.5, 'm', 'p1', 'p2'))
    expect(base(d).points.m).toEqual(P(5)) // the middle of the baseline's a(0,0)–b(10,0)
    expect(front(d).points.m).not.toEqual(P(5))
  })

  it('a new arc gives the baseline the same radius, as views without one get', () => {
    const d = doc()
    d.edit(e => e.line('bc', 'b', { id: 'c', layer: 'L', position: P(10, 10) }))
    d.editIn(SIDE, e => e.join('b', 'ab', 'bc', { mode: 'arc', radius: 3 }))
    expect(Object.values(base(d).radius)).toEqual([3])
  })

  it('paste: the clip\'s baseline is carried as is (a pending change comes along)', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(15, 5) }]))
    const clip = d.copy(['ab'])
    d.edit(e => e.paste(clip, 'L', P(0, 100), 'p'))
    expect(base(d).points['p/b']).toEqual(P(10, 100))
    expect(front(d).points['p/b']).toEqual(P(15, 105))
  })

  it('paste: a clip without a baseline layer gives the baseline the clip\'s front (nothing pending)', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(15, 5) }]))
    const clip = d.copy(['ab']) as unknown as { network: { layers: { key: string }[] }; joins: { layers: { key: string }[] } }
    clip.network.layers = clip.network.layers.filter(l => l.key !== 'base:angle')
    clip.joins.layers = clip.joins.layers.filter(l => l.key !== 'base:angle')
    d.edit(e => e.paste(clip as never, 'L', P(0, 100), 'p'))
    expect(base(d).points['p/b']).toEqual(front(d).points['p/b'])
  })

  it('the baseline is never settled: a link moves front points, not the baseline', () => {
    const d = doc()
    d.edit(e => { e.layer('M', 'M'); e.line('qr', { id: 'q', layer: 'M', position: P(0, 40) }, { id: 'r', layer: 'M', position: P(10, 40) }) })
    d.edit(e => e.link('a', 'q'))
    expect(front(d).points.q).toEqual(P(0))
    expect(base(d).points.q).toEqual(P(0, 40))
  })

  it('undo restores the baseline with everything else', () => {
    const d = doc(), before = JSON.stringify(base(d))
    d.edit(e => e.split('ab', 0.5, 'm', 'p1', 'p2'))
    d.undo()
    expect(JSON.stringify(base(d))).toBe(before)
  })
})

describe('open checks the baseline for integrity only', () => {
  const edit = (d: Core, f: (layers: Layer[]) => void) => { const x = JSON.parse(save(d)); f(x.document.network.shapes.layers); return JSON.stringify(x) }
  it('a file without it, or with it not an owned record, or missing a point there, is refused; a pending change opens fine', () => {
    const d = doc()
    d.edit(e => e.move([{ id: 'b', target: P(15, 5) }]))
    expect(() => open(save(d))).not.toThrow()
    expect(() => open(edit(d, ls => { ls.splice(ls.findIndex(l => l.key === 'base:angle'), 1) }))).toThrow(/no record layer base:angle/)
    expect(() => open(edit(d, ls => { delete ls.find(l => l.key === 'base:angle')!.copyNew }))).toThrow(/not an owned record layer/)
    expect(() => open(edit(d, ls => { delete ls.find(l => l.key === 'base:angle')!.points.b }))).toThrow(/has no position for point b/)
  })
})
