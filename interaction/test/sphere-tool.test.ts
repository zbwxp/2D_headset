// The 球面变形框 session (docs/sphere-frame-checklist.md §3–4; dot 1792054665): one frozen source per session, nothing
// commits by itself, apply() commits once, invalid values disable apply, every cancel case writes nothing.
import { describe, it, expect } from 'vitest'
import { Core, save, open, type Vec } from '../../src'
import { createInteraction } from '../index'
import { sphereOp, planLines } from '../flows/deform'
import { reachOf, SPHERE_R, dragSphere } from '../flows/sphere'

const P = (x: number, y: number): Vec => ({ x, y })
const FRONT = 'view:0,0', SIDE = 'view:90,0'

function setup(select = true) {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => {
    e.layer('M', 'M')
    e.line('ab', { id: 'a', layer: 'L', position: P(0, 0) }, { id: 'b', layer: 'L', position: P(50, 40) }, { ha: P(10, 20), hb: P(-15, 0) })
    e.line('bc', 'b', { id: 'c', layer: 'L', position: P(100, 20) }, { ha: P(15, 0), hb: P(-10, 15) })
    e.line('mn', { id: 'm', layer: 'M', position: P(0, 100) }, { id: 'n', layer: 'M', position: P(100, 100) })
  })
  if (select) d.edit(e => e.select([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }]))
  let view = FRONT, core = d
  const ix = createInteraction({ view: () => view, core: () => core, newId: p => `${p}${Math.random()}`, layer: () => 'L', layers: () => ['L', 'M'], pixel: () => 1 })
  const sp = () => ix.preview().sphere
  return { d, ix, sp, setView: (k: string) => { view = k; ix.viewChanged() }, setCore: (c: Core) => { core = c; ix.drawingChanged() } }
}
const every = (d: Core) => JSON.stringify(d.views().map(k => d.in(k).snapshot()))
/** The anchor and reach the session uses: the selection box's centre, the largest sampled distance from it. */
function frameOf(d: Core) {
  const b = d.in(FRONT).selectionBounds([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }])!
  const anchor = P((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2)
  return { anchor, reach: reachOf(planLines(d, FRONT, ['ab', 'bc']), anchor) }
}
/** What one op from the original curves with these values writes, on a copy of `start`. */
function expected(start: string, v: { yaw: number; pitch: number; r: number; roll: number; scale: number; offset: Vec }) {
  const c = open(start), { anchor } = frameOf(c)
  c.edit(sphereOp(c, FRONT, ['ab', 'bc'], { anchor, ...v }).run)
  return c.snapshot().points
}

describe('the sphere frame session', () => {
  it('opens on the selected lines: at rest, 「弧度」 at 1.5 × reach, a valid frame; nothing selected → a note, no frame', () => {
    const t = setup(), { reach } = frameOf(t.d)
    t.ix.setTool('sphere')
    const s = t.sp()!
    expect(s.values).toEqual({ yaw: 0, pitch: 0, r: SPHERE_R.start * reach, roll: 0, scale: 1, offset: P(0, 0) })
    expect(s.range.rMin).toBeCloseTo(SPHERE_R.min * reach, 12)
    expect([s.valid, s.frame.corners.length]).toEqual([true, 4])
    const u = setup(false)
    u.ix.setTool('sphere')
    expect(u.sp()).toBeUndefined()
    expect(u.ix.preview().refusal?.code).toBe('sphere-select-lines')
  })

  it('yaw, then pitch, then 「弧度」 recompute from the frozen source: apply writes what one op with the final values writes, once', () => {
    const t = setup(), start = save(t.d), history = t.d.canUndo
    t.ix.setTool('sphere')
    t.ix.sphereSet({ yaw: 40 }); t.ix.sphereSet({ pitch: -20 })
    const r = t.sp()!.range.rMin * 2
    t.ix.sphereSet({ r })
    expect(save(t.d)).toBe(start) // sliders only preview
    t.ix.sphereApply()
    expect(t.d.snapshot().points).toEqual(expected(start, { yaw: 40, pitch: -20, r, roll: 0, scale: 1, offset: P(0, 0) }))
    t.d.undo()
    expect(save(t.d)).toBe(start) // one undo step
    expect(history).toBe(t.d.canUndo)
  })

  it('frame drags (move, corner scale, rotate) only preview; releasing commits nothing; Enter commits', () => {
    const t = setup(), start = save(t.d)
    t.ix.setTool('sphere')
    const f = t.sp()!.frame, mid = P((f.corners[0]!.x + f.corners[2]!.x) / 2, (f.corners[0]!.y + f.corners[2]!.y) / 2)
    t.ix.pointerDown(mid); t.ix.pointerMove(P(mid.x + 10, mid.y + 5)); t.ix.pointerUp(P(mid.x + 10, mid.y + 5))
    const c = t.sp()!.frame.corners[2]!
    t.ix.pointerDown(c); t.ix.pointerMove(P(c.x + 20, c.y + 16)); t.ix.pointerUp(P(c.x + 20, c.y + 16))
    const rot = t.sp()!.frame.rotate
    t.ix.pointerDown(rot); t.ix.pointerMove(P(rot.x + 30, rot.y + 10)); t.ix.pointerUp(P(rot.x + 30, rot.y + 10))
    const v = t.sp()!.values
    expect(v.offset).toEqual(P(10, 5))
    expect(v.scale).toBeGreaterThan(1)
    expect(v.roll).not.toBe(0)
    expect(save(t.d)).toBe(start)
    t.ix.key('Enter')
    expect(t.d.snapshot().points).toEqual(expected(start, v))
  })

  it('after apply the frame reopens on the result: scale 1, 「弧度」 at the new default, the rest 0', () => {
    const t = setup()
    t.ix.setTool('sphere')
    t.ix.sphereSet({ yaw: 30, scale: 1.4 })
    t.ix.sphereApply()
    const s = t.sp()!, { reach } = frameOf(t.d)
    expect(s.values).toEqual({ yaw: 0, pitch: 0, r: SPHERE_R.start * reach, roll: 0, scale: 1, offset: P(0, 0) })
  })

  it('an invalid value keeps the last valid ghost but disables apply: nothing is written, not even the older value', () => {
    // the panel cannot leave the sphere (「弧度」 stays ≥ 1.05 × reach) and a fold is not refused (bowen 1792056346):
    // the refusal here is a lock the turned lines would change
    const t = setup()
    t.d.edit(e => { e.link('a', 'm') })
    t.d.edit(e => e.lineState('mn', { locked: true }))
    t.d.edit(e => e.select([{ kind: 'line', id: 'ab' }, { kind: 'line', id: 'bc' }]))
    const start = save(t.d)
    t.ix.setTool('sphere')
    const ghost = t.sp()!.lines
    t.ix.sphereSet({ yaw: 30 })
    const s = t.sp()!
    expect([s.valid, typeof s.refused]).toEqual([false, 'string'])
    expect(s.lines).toEqual(ghost)
    t.ix.sphereApply(); t.ix.key('Enter')
    expect(save(t.d)).toBe(start)
    expect(t.ix.preview().refusal?.code).toBe('sphere-invalid')
  })

  it('a lock reached by the edit: the values are refused alike, apply writes nothing', () => {
    const t = setup()
    t.d.edit(e => e.lineState('bc', { locked: true }))
    t.d.edit(e => e.select([{ kind: 'line', id: 'ab' }]))
    const start = save(t.d)
    t.ix.setTool('sphere')
    t.ix.sphereSet({ yaw: 25 })
    expect(t.sp()!.valid).toBe(false)
    t.ix.sphereApply()
    expect(save(t.d)).toBe(start)
  })

  it('the turn reaches ±90° and a fold is previewed and applied like any other turn (bowen 1792056346)', () => {
    const t = setup(), start = save(t.d)
    t.ix.setTool('sphere')
    t.ix.sphereSet({ r: t.sp()!.range.rMin, yaw: 120 })
    expect(t.sp()!.values.yaw).toBe(90)
    expect(t.sp()!.valid).toBe(true)
    t.ix.sphereApply()
    expect(save(t.d)).not.toBe(start)
  })

  it('cancels, writing nothing: Esc, another view, another tool, another drawing, a selection change, an edit or undo elsewhere', () => {
    const cases: [string, (t: ReturnType<typeof setup>) => void][] = [
      ['Esc', t => t.ix.key('Escape')],
      ['view', t => t.setView(SIDE)],
      ['tool', t => t.ix.setTool('V')],
      ['drawing', t => t.setCore(Core.newDocument())],
      ['selection', t => { t.d.edit(e => e.select([{ kind: 'line', id: 'ab' }])); t.ix.historyChanged() }],
      ['edit', t => { t.d.edit(e => e.lineState('mn', { visible: false })); t.ix.historyChanged() }],
      ['undo', t => t.ix.undo()],
    ]
    for (const [name, act] of cases) {
      const t = setup(), start = every(t.d)
      t.ix.setTool('sphere')
      t.ix.sphereSet({ yaw: 30 })
      act(t)
      expect(t.sp(), name).toBeUndefined()
      t.ix.sphereApply(); t.ix.key('Enter')
      if (name !== 'edit' && name !== 'selection' && name !== 'undo') expect(every(t.d), name).toBe(start)
    }
  })

  it('a selection change without a history event still ends the session on the next read', () => {
    const t = setup()
    t.ix.setTool('sphere')
    t.d.edit(e => e.select([{ kind: 'line', id: 'mn' }]))
    expect(t.sp()).toBeUndefined()
  })

  it('works in another view, writing only that view', () => {
    const t = setup(), front = JSON.stringify(t.d.snapshot())
    t.setView(SIDE)
    t.ix.setTool('sphere')
    t.ix.sphereSet({ yaw: 30 })
    t.ix.sphereApply()
    expect(JSON.stringify(t.d.snapshot())).toBe(front)
    expect(JSON.stringify(t.d.in(SIDE).snapshot())).not.toBe(JSON.stringify(t.d.in(FRONT).snapshot()))
  })

  it('dragSphere: move adds the pointer motion; a corner scales by the distance ratio about the moved anchor; rotate turns by the angle', () => {
    const a = P(0, 0), v = { yaw: 0, pitch: 0, r: 10, roll: 0, scale: 1, offset: P(0, 0) }
    expect(dragSphere(a, v, 'move', P(1, 1), P(4, 5)).offset).toEqual(P(3, 4))
    expect(dragSphere(a, v, { corner: 2 }, P(2, 0), P(4, 0)).scale).toBeCloseTo(2, 12)
    expect(dragSphere(a, v, 'rotate', P(0, -5), P(5, 0)).roll).toBeCloseTo(90, 12)
  })
})

describe('the sphere frame session at rest (dot 1792055264)', () => {
  it('opening and applying without a change, or after setting the values back, writes nothing and adds no undo step', () => {
    const t = setup()
    t.d.edit(e => e.lineState('mn', { visible: false }))
    const text = save(t.d)
    t.ix.setTool('sphere')
    t.ix.sphereApply()
    t.ix.sphereSet({ yaw: 30 }); t.ix.sphereSet({ yaw: 0 })
    t.ix.key('Enter')
    expect(save(t.d)).toBe(text)
    t.ix.undo()
    expect(t.d.snapshot().lines.find(l => l.id === 'mn')!.state.visible).toBe(true)
  })
})
