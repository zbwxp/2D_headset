// Refusals carry a code and the objects (kind + id) besides the message (doc 22 §3.3;
// docs/interaction-plan.md work item 1). Nothing changes in what is refused.
import { describe, it, expect } from 'vitest'
import { Core, Refusal, type Vec } from '../src'

const P = (x: number, y: number): Vec => ({ x, y })
function refusal(f: () => void): Refusal {
  try { f() } catch (err) { if (err instanceof Refusal) return err; throw err }
  throw new Error('expected a refusal')
}
function scene() {
  const d = new Core({ axis: 0 })
  d.edit(e => {
    e.layer('L'); e.layer('K')
    e.line('l1', { id: 'a', layer: 'L', position: P(-30, 0) }, { id: 'b', layer: 'L', position: P(-10, 5) })
    e.line('l2', 'b', { id: 'c', layer: 'L', position: P(-20, 20) })
    e.line('l3', 'c', 'a')
    e.line('m1', { id: 'x', layer: 'K', position: P(10, 1) }, { id: 'y', layer: 'K', position: P(30, 2) })
  })
  return d
}
const objs = (r: Refusal) => r.objects.map(o => `${o.kind}:${o.id}`).sort()

describe('refusals', () => {
  it('a locked line the edit would change: code locked, the line', () => {
    const d = scene()
    d.edit(e => e.lineState('l1', { locked: true }))
    const r = refusal(() => d.edit(e => e.move([{ id: 'a', target: P(0, 0) }])))
    expect([r.code, objs(r)]).toEqual(['locked', ['line:l1']])
  })

  it('a cut of a group holding a locked line or fill: locked, those objects', () => {
    const d = scene()
    d.edit(e => e.fill(d.snapshot().loops[0]!.id, 'red'))
    const loop = d.snapshot().loops[0]!.id
    d.edit(e => { e.lineState('l2', { locked: true }); e.fillState(loop, { locked: true }) })
    const g = d.snapshot().groups.find(x => x.lines.includes('l1'))!.id
    const r = refusal(() => d.edit(e => e.moveGroup(g, 'K')))
    expect([r.code, objs(r)]).toEqual(['locked', [`fill:${loop}`, 'line:l2'].sort()])
  })

  it('a locked fill’s colour: locked, the fill', () => {
    const d = scene()
    d.edit(e => e.fill(d.snapshot().loops[0]!.id, 'red'))
    const loop = d.snapshot().loops[0]!.id
    d.edit(e => e.fillState(loop, { locked: true }))
    const r = refusal(() => d.edit(e => e.fill(loop, 'blue')))
    expect([r.code, objs(r)]).toEqual(['locked', [`fill:${loop}`]])
  })

  it('delete or copy with no lines selected: their codes, no objects', () => {
    const d = scene()
    d.edit(e => e.select([{ kind: 'point', id: 'a' }]))
    expect(refusal(() => d.edit(e => e.deleteSelection())).code).toBe('select-lines-to-delete')
    expect(refusal(() => d.copy()).code).toBe('select-lines-to-copy')
  })

  it('a mirror apply onto a different structure: topology-mismatch, the target lines', () => {
    const d = scene()
    const r = refusal(() => d.edit(e => e.mirrorApply(['l1', 'l2'], ['m1'])))
    expect([r.code, objs(r)]).toEqual(['topology-mismatch', ['line:m1']])
  })

  it('a locked mirror-apply target: locked, the target line', () => {
    const d = scene()
    d.edit(e => e.lineState('m1', { locked: true }))
    const r = refusal(() => d.edit(e => e.mirrorApply(['l1'], ['m1'])))
    expect([r.code, objs(r)]).toEqual(['locked', ['line:m1']])
  })

  it('a bind of a mirror-linked point to one without a counterpart: mirror-no-counterpart, the point without one', () => {
    const d = new Core({ axis: 0 })
    d.edit(e => {
      e.layer('L')
      e.line('s', { id: 's1', layer: 'L', position: P(-30, 0) }, { id: 's2', layer: 'L', position: P(-10, 5) })
      e.line('t', { id: 't1', layer: 'L', position: P(30, 0) }, { id: 't2', layer: 'L', position: P(10, 5) })
      e.line('o', { id: 'o1', layer: 'L', position: P(-50, 40) }, { id: 'o2', layer: 'L', position: P(-60, 50) })
    })
    const g = (l: string) => d.snapshot().groups.find(x => x.lines.includes(l))!.id
    d.edit(e => e.mirrorLink([g('s')], [g('t')]))
    const r = refusal(() => d.edit(e => e.bind('s1', 'o1')))
    expect([r.code, objs(r)]).toEqual(['mirror-no-counterpart', ['point:o1']])
  })

  it('a name in use: name-taken, its holder as kind + id', () => {
    const d = scene()
    d.edit(e => e.renameLine('l1', '睫毛'))
    const r = refusal(() => d.edit(e => e.renameLayer('K', '睫毛')))
    expect([r.code, objs(r)]).toEqual(['name-taken', ['line:l1']])
  })

  it('a point and a line with the same id are told apart by kind (dot 1791543494)', () => {
    const d = new Core()
    d.edit(e => { e.layer('L'); e.line('same', { id: 'same', layer: 'L', position: P(0, 0) }, { id: 'p2', layer: 'L', position: P(10, 0) }) })
    d.edit(e => e.lineState('same', { locked: true }))
    const r = refusal(() => d.edit(e => e.move([{ id: 'same', target: P(5, 5) }])))
    expect(r.objects).toEqual([{ kind: 'line', id: 'same' }])
  })

  it('the objects are a frozen copy', () => {
    const d = scene()
    d.edit(e => e.lineState('l1', { locked: true }))
    const r = refusal(() => d.edit(e => e.move([{ id: 'a', target: P(0, 0) }])))
    expect(Object.isFrozen(r.objects)).toBe(true)
    expect(Object.isFrozen(r.objects[0])).toBe(true)
  })
})
