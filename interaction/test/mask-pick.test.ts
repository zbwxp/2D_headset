// Picking follows what is drawn (docs/mask-p3-checklist.md §1–2): interaction asks `env.cut`; a line cut away at the
// pointer drops out so what lies under it is picked; the fill tool skips a cut fill; points stay editing marks.
import { describe, it, expect } from 'vitest'
import { Core, type Vec } from '../../src'
import { createInteraction } from '../index'

const P = (x: number, y: number): Vec => ({ x, y })
type Cut = NonNullable<Parameters<typeof createInteraction>[0]['cut']>

/** Line h (0,0)–(100,0) and line g (0,1)–(100,1), both in L: g lies under the pointer just below h. */
function setup(cut?: Cut, d = drawing()) {
  let n = 0
  const ix = createInteraction({ view: () => 'view:0,0', core: () => d, newId: p => `${p}${++n}`, layer: () => 'L', layers: () => ['L'], pixel: () => 0.3, ...(cut ? { cut } : {}) })
  return { ix, d }
}
function drawing() {
  const d = new Core()
  d.edit(e => {
    e.layer('L')
    e.line('h', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(100, 0) })
    e.line('g', { id: 'c', layer: 'L', position: P(0, 1) }, { id: 'e', layer: 'L', position: P(100, 1) })
  })
  return d
}
const click = (ix: ReturnType<typeof setup>['ix'], at: Vec) => { ix.pointerDown(at); ix.pointerUp(at) }
const sel = (d: Core) => d.snapshot().selection.map(u => `${u.kind}:${'id' in u ? u.id : ''}`)

describe('picking through masks', () => {
  it('without the hook: the nearest line, as before', () => {
    const { ix, d } = setup()
    ix.setTool('V'); click(ix, P(70, 0.2))
    expect(sel(d)).toEqual(['line:h'])
  })

  it('a line cut at the pointer drops out and the line under it is picked; where it is not cut it is picked', () => {
    const asked: [string, string, number][] = []
    const cut: Cut = (t, at, reach) => { asked.push([t.kind, t.id, reach]); return t.kind === 'line' && t.id === 'h' && at.x > 50 }
    const { ix, d } = setup(cut)
    ix.setTool('V'); click(ix, P(70, 0.2))
    expect(sel(d)).toEqual(['line:g'])
    click(ix, P(30, 0.2))
    expect(sel(d)).toEqual(['line:h'])
    expect(asked.some(([k, id, r]) => k === 'line' && id === 'h' && Math.abs(r - 8 * 0.3) < 1e-9)).toBe(true) // the line reach, in drawing units
  })

  it('points stay editing marks: A still picks the end point of a line cut there', () => {
    const { ix, d } = setup(t => t.kind === 'line')
    ix.setTool('A'); click(ix, P(100, 0))
    expect(sel(d)).toEqual(['point:b'])
  })

  it('the fill tool skips a fill cut at the click and takes the next loop under it', () => {
    const d = new Core()
    d.edit(e => {
      e.layer('L')
      e.line('b1', { id: 'b1', layer: 'L', position: P(0, 0) }, { id: 'b2', layer: 'L', position: P(100, 0) }); e.line('b2', 'b2', { id: 'b3', layer: 'L', position: P(50, 100) }); e.line('b3', 'b3', 'b1')
      e.line('s1', { id: 's1', layer: 'L', position: P(40, 20) }, { id: 's2', layer: 'L', position: P(60, 20) }); e.line('s2', 's2', { id: 's3', layer: 'L', position: P(50, 40) }); e.line('s3', 's3', 's1')
    })
    const small = d.snapshot().loops.find(l => l.route.some(u => u.line === 's1'))!.id
    const { ix } = setup((t, at) => t.kind === 'fill' && t.id === small && at.y > 25, d)
    ix.setTool('fill'); ix.pointerDown(P(50, 28)) // inside both; the small one is cut here
    expect(d.snapshot().loops.filter(l => l.filled).map(l => l.route.map(u => u.line).sort())).toEqual([['b1', 'b2', 'b3']])
  })
})
