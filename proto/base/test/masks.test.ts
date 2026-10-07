// Masks (doc 18 §1.7b / §29.2b): the write command, relation checks and the evaluation's mask resolution.
// Pixels and picking (which need a canvas) are checked in a real browser: e2e/masks.spec.ts.
import { describe, expect, it } from 'vitest'
import { Editor } from '../src/editor'
import { graphProblems } from '../src/model'
import { paintCases } from '../src/paintCases'

const M1 = () => paintCases['M1-mask-outside'].records().filter((r: any) => r.typeName !== 'mask')
const cmd = (more: Record<string, unknown> = {}) => ({ type: 'setMask', sources: { fills: ['fill:F'], strokes: [] }, targets: ['curve:C'], mode: 'outside', ...more }) as any

describe('setMask', () => {
  it('creates a mask (preview / commit / undo / redo / save → reopen); the evaluation resolves it for its targets only', () => {
    const e = new Editor(M1())
    const before = JSON.stringify(e.reader.allRecords())
    const op = e.prepare()
    const pv = op.preview(cmd())
    expect(pv.ok).toBe(true)
    expect(JSON.stringify(e.reader.allRecords())).toBe(before)
    const r = op.commit()
    expect(r.ok && r.written).toBe(true)
    expect(graphProblems(e.reader)).toEqual([])
    const ev = e.derived.evaluated()
    expect([...(ev.masks?.keys() ?? [])]).toEqual(['curve:C'])
    const m = ev.masks!.get('curve:C')![0]
    expect(m.mode).toBe('outside')
    expect(m.fills.map((f) => f.address)).toEqual(['fill:F'])
    const after = JSON.stringify(e.reader.allRecords())
    expect(e.undo()).toBe(true)
    expect(JSON.stringify(e.reader.allRecords())).toBe(before)
    expect(e.derived.evaluated().masks).toBeUndefined() // no masks: the evaluation is unchanged
    expect(e.redo()).toBe(true)
    expect(JSON.stringify(e.reader.allRecords())).toBe(after)
    const again = Editor.open(JSON.parse(JSON.stringify(e.save())))
    expect([...(again.derived.evaluated().masks?.keys() ?? [])]).toEqual(['curve:C'])
  })

  it('a container target covers everything drawn inside it; a mask switched off resolves to nothing; a hidden source still masks', () => {
    const e = new Editor(M1())
    expect(e.apply(cmd({ targets: ['container:L2'] })).ok).toBe(true)
    expect([...e.derived.evaluated().masks!.keys()]).toEqual(['curve:C'])
    const id = e.reader.allRecords().find((r: any) => r.typeName === 'mask')!.id
    expect(e.apply(cmd({ id, targets: ['container:L1'] })).ok).toBe(true)
    expect([...e.derived.evaluated().masks!.keys()].sort()).toEqual(['curve:F-boundary', 'fill:F'])
    expect(e.apply(cmd({ id, enabled: false })).ok).toBe(true)
    expect(e.derived.evaluated().masks).toBeUndefined()
    expect(e.apply(cmd({ id, enabled: true })).ok).toBe(true)
    expect(e.apply({ type: 'setContainerFlags', containerId: 'container:L1' as any, visible: false }).ok).toBe(true)
    const m = e.derived.evaluated().masks!.get('curve:C')![0]
    expect(m.fills.map((f) => [f.address, f.visible])).toEqual([['fill:F', false]]) // hidden, still a source
  })

  it('masks follow the angle evaluation and previews (each with its own source geometry)', () => {
    const e = new Editor(M1())
    expect(e.apply(cmd()).ok).toBe(true)
    expect(e.derived.atYaw(30).masks?.get('curve:C')?.length).toBe(1)
    const pv = e.preview({ type: 'moveAnchors', targets: [{ curveId: 'curve:F-boundary' as any, anchorId: 'a' }], delta: { x: -5, y: 0 } })
    if (!pv.ok) throw new Error(pv.error.message)
    const shown = e.derived.preview(pv.puts, e.derived.previewChanges(pv.puts, pv.removals))
    const f = shown.masks!.get('curve:C')![0].fills[0]
    expect(f.cubics[0][0].x).toBe(15) // the preview's moved source, not the committed one
  })

  it('refused: no source, a missing source, a target that is not a curve / fill / container, a bad mode, a locked target', () => {
    const e = new Editor(M1())
    const no = (c: any, re: RegExp) => {
      const r = e.apply(c)
      expect(r.ok === false && r.error.message).toMatch(re)
    }
    no(cmd({ sources: { fills: [], strokes: [] } }), /at least one source/)
    no(cmd({ sources: { fills: ['fill:nope'], strokes: [] } }), /fill:nope is not a fill/)
    no(cmd({ targets: ['mask:x'] }), /not a curve, fill or container/)
    no(cmd({ mode: 'sideways' }), /inside or outside/)
    expect(e.apply({ type: 'setContainerFlags', containerId: 'container:L2' as any, locked: true }).ok).toBe(true)
    const r = e.apply(cmd())
    expect(r.ok === false && r.error.code).toBe('LOCKED')
  })

  it('deleting a source or a target the mask still names is refused (the mask is named); deleting the mask is fine', () => {
    const e = new Editor(M1())
    expect(e.apply(cmd()).ok).toBe(true)
    const id = e.reader.allRecords().find((r: any) => r.typeName === 'mask')!.id
    const src = e.apply({ type: 'deleteRecords', ids: ['fill:F'] })
    expect(src.ok === false && src.error.objects).toContain(id)
    const tgt = e.apply({ type: 'deleteRecords', ids: ['curve:C'] })
    expect(tgt.ok === false && tgt.error.objects).toContain(id)
    expect(e.apply({ type: 'deleteRecords', ids: [id] }).ok).toBe(true)
    expect(e.apply({ type: 'deleteRecords', ids: ['curve:C'] }).ok).toBe(true)
  })

  it('a document whose mask names something missing is refused on open, with the field', () => {
    const rs: any[] = [...M1(), { typeName: 'mask', id: 'mask:m', name: 'm', sources: { fills: ['fill:gone'], strokes: [] }, targets: ['curve:C'], mode: 'outside', enabled: true }]
    expect(() => Editor.open({ store: Object.fromEntries(rs.map((r) => [r.id, r])), schema: (new Editor().save() as any).schema } as any)).toThrow(/invalid document: .*sources.fills\[0\].*fill:gone/)
  })
})

it('deleting a container a mask targets is refused and names the mask (dot, review of ce2736c M1: it was written and the file could not reopen)', () => {
  for (const empty of [true, false]) {
    const rs: any[] = paintCases['M1-mask-outside'].records()
    rs.find((r) => r.typeName === 'mask').targets = ['container:L2']
    if (empty) rs.splice(rs.findIndex((r) => r.id === 'curve:C'), 1)
    const e = new Editor(rs)
    const before = JSON.stringify(e.save())
    const r = e.apply({ type: 'deleteRecords', ids: empty ? ['container:L2'] : ['container:L2', 'curve:C'] })
    expect(r.ok === false && r.error.objects).toContain('mask:m')
    expect(JSON.stringify(e.save())).toBe(before)
    // removing the mask in the same command is fine, and the file reopens
    expect(e.apply({ type: 'deleteRecords', ids: empty ? ['container:L2', 'mask:m'] : ['container:L2', 'curve:C', 'mask:m'] }).ok).toBe(true)
    expect(() => Editor.open(JSON.parse(JSON.stringify(e.save())))).not.toThrow()
  }
})
