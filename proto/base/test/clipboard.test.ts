// Editor skeleton block 3 — copy / paste content (src/clipboard.ts) and replacing the document from a file (Editor.load).
import { describe, expect, it } from 'vitest'
import { contentCentre, contentOf, parseContent, type Content } from '../src/clipboard'
import { Editor } from '../src/editor'
import { exampleRecords, ids } from '../src/fixture'
import { poseIdOf } from '../src/schema'

const content = (e: Editor, sel: string[]) => {
  const c = contentOf(e.reader, sel)
  if ('error' in c) throw new Error(c.error.message)
  return JSON.parse(JSON.stringify(c)) as Content // through the clipboard: plain JSON
}
const curvesIn = (e: Editor, parent: string) => e.reader.allRecords().filter((r: any) => r.typeName === 'curve' && r.parentId === parent) as any[]

describe('copy: the content of a selection', () => {
  it('a container brings its content; connections only when every end is copied; a track goes with its curve', () => {
    const e = new Editor(exampleRecords())
    e.apply({ type: 'setPoseKey', curveId: ids.E1, yaw: 30, offsets: { e1: { x: 1, y: 0 } } })
    const c = content(e, [ids.L3])
    expect(c.records.map((r) => r.id).sort()).toEqual([ids.E1, ids.L3, poseIdOf(ids.E1)].sort())
    const one = content(e, [ids.C1])
    expect(one.records.map((r) => r.id)).toEqual([ids.C1]) // J / J0 reach C2, which is not copied
    e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    const both = content(e, [ids.C1, ids.C2, ids.F])
    expect(both.records.map((r) => r.typeName).sort()).toEqual(['connection', 'connection', 'curve', 'curve', 'fill'])
    expect(parseContent(JSON.stringify(both))).toEqual(both)
    expect(parseContent('{"kind":"other"}')).toBe(null)
    expect(parseContent('not json')).toBe(null)
  })
  it('refused, by name: a fill without the curves it reads', () => {
    const e = new Editor(exampleRecords())
    const r = contentOf(e.reader, [ids.F])
    expect('error' in r && r.error.objects).toEqual([ids.F, ids.C1, ids.C2])
  })
})

describe('paste', () => {
  it('new ids, into the given layer on top, moved by the offset; one undo step; the originals untouched', () => {
    const e = new Editor(exampleRecords())
    const c = content(e, [ids.E1])
    const before = JSON.stringify(e.reader.serialize('document'))
    const r = e.apply({ type: 'pasteContent', content: c, parentId: ids.L1, offset: { x: 5, y: -2 } })
    expect(r.ok).toBe(true)
    const pasted = curvesIn(e, ids.L1).find((x) => x.id !== ids.C1)
    expect(pasted.id).not.toBe(ids.E1)
    expect(pasted.anchors.e1.p).toEqual({ x: -15, y: 18 })
    expect(pasted.index > (e.reader.get(ids.R1) as any).index).toBe(true)
    expect(e.history.undo).toEqual(['pasteContent'])
    e.undo()
    expect(JSON.stringify(e.reader.serialize('document'))).toBe(before)
  })
  it('works after the originals are deleted, and into another document (content, not ids)', () => {
    const e = new Editor(exampleRecords())
    const c = content(e, [ids.L3])
    e.apply({ type: 'deleteRecords', ids: [ids.R1] })
    e.apply({ type: 'deleteRecords', ids: [ids.L3, ids.E1] })
    expect(e.apply({ type: 'pasteContent', content: c, parentId: ids.L1 }).ok).toBe(true)
    const other = new Editor([exampleRecords()[0]]) // only L1
    expect(other.apply({ type: 'pasteContent', content: c, parentId: ids.L1 }).ok).toBe(true)
    expect(other.reader.allRecords().filter((r: any) => r.typeName === 'container').length).toBe(2)
  })
  it('two connected curves with their fill: the copies are connected to each other, never to the originals', () => {
    const e = new Editor(exampleRecords())
    e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    const c = content(e, [ids.C1, ids.C2, ids.F])
    expect(e.apply({ type: 'pasteContent', content: c, parentId: ids.L3, offset: { x: 100, y: 0 } }).ok).toBe(true)
    const copies = new Set(curvesIn(e, ids.L3).map((x) => x.id).filter((x) => x !== ids.E1))
    const conns = e.reader.allRecords().filter((r: any) => r.typeName === 'connection' && r.ends.some((x: any) => copies.has(x.curveId))) as any[]
    expect(conns.length).toBe(2)
    for (const cn of conns) expect(cn.ends.every((x: any) => copies.has(x.curveId))).toBe(true)
  })
  it('a reference pasted with its source: the instance moves by the offset too (the placement is re-centred)', () => {
    const e = new Editor(exampleRecords())
    const c = content(e, [ids.L3, ids.R1])
    const at = (ed: Editor, ref: string) => ed.derived.evaluated().curves.find((x) => x.referenceId === ref)!.anchors.e1.p
    const before = at(e, ids.R1)
    expect(e.apply({ type: 'pasteContent', content: c, parentId: ids.L1, offset: { x: 7, y: 3 } }).ok).toBe(true)
    const ref = e.reader.allRecords().find((r: any) => r.typeName === 'reference' && r.id !== ids.R1) as any
    expect(at(e, ref.id)).toEqual({ x: before.x + 7, y: before.y + 3 })
  })
  it('refused: a locked layer; content that does not validate; nothing written', () => {
    const e = new Editor(exampleRecords())
    const c = content(e, [ids.E1])
    const before = JSON.stringify(e.reader.serialize('document'))
    const r = e.apply({ type: 'pasteContent', content: c, parentId: ids.L2 })
    expect(r.ok === false && r.error.code).toBe('LOCKED')
    const bad = structuredClone(c)
    ;(bad.records[0] as any).anchors = 'nope'
    const r2 = e.apply({ type: 'pasteContent', content: bad, parentId: ids.L1 })
    expect(r2.ok === false && r2.error.message).toMatch(/clipboard content cannot be read/)
    expect(JSON.stringify(e.reader.serialize('document'))).toBe(before)
  })
  it('the centre of a content (for ⌘V at the centre of the view)', () => {
    const e = new Editor(exampleRecords())
    expect(contentCentre(content(e, [ids.E1]))).toEqual({ x: -25, y: 35 })
  })
})

describe('Editor.load (open a file into the running editor)', () => {
  it('replaces the document, history empty, clean; equal to opening the same file', () => {
    const a = new Editor(exampleRecords())
    a.apply({ type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e1' }], delta: { x: 3, y: 0 } })
    const file = JSON.parse(JSON.stringify(a.save()))
    const e = new Editor([])
    e.apply({ type: 'createFill', parentId: 'container:nope' as any, boundary: [] }) // refused, nothing
    const op = e.prepare()
    e.load(file)
    expect(e.history).toEqual({ undo: [], redo: [] })
    expect(e.isDirty).toBe(false)
    expect(e.reader.serialize('document')).toEqual(Editor.open(file).reader.serialize('document'))
    expect(e.derived.evaluated()).toEqual(Editor.open(file).derived.evaluated())
    const stale = op.preview({ type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e1' }], delta: { x: 1, y: 0 } })
    expect(stale.ok === false && stale.error.code).toBe('STALE')
    e.apply({ type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e1' }], delta: { x: 1, y: 0 } })
    expect(e.isDirty).toBe(true)
  })
  it('a bad file changes nothing', () => {
    const e = new Editor(exampleRecords())
    const before = JSON.stringify(e.reader.serialize('document'))
    const file: any = JSON.parse(JSON.stringify(e.save()))
    file.store[ids.F].boundary = [{ curveId: 'curve:none', segmentId: 's', dir: 1 }]
    expect(() => e.load(file)).toThrow(/invalid document/)
    expect(JSON.stringify(e.reader.serialize('document'))).toBe(before)
  })
})

describe('review of 6c59e19 (dot): C3–C6', () => {
  it('C3: after a load, an edit then its undo is clean again (the loaded revision is the base, not 0)', () => {
    const e = new Editor([])
    e.load(JSON.parse(JSON.stringify(new Editor(exampleRecords()).save())))
    expect(e.isDirty).toBe(false)
    e.apply({ type: 'moveAnchors', targets: [{ curveId: ids.E1, anchorId: 'e1' }], delta: { x: 1, y: 0 } })
    expect(e.isDirty).toBe(true)
    e.undo()
    expect(e.isDirty).toBe(false)
    e.redo()
    expect(e.isDirty).toBe(true)
  })
  it('C4: a reference copied without its source — same document keeps it; another document only with the same source, else refused by name', () => {
    const a = new Editor(exampleRecords())
    const c = contentOf(a.reader, [ids.R1], a.documentToken) as Content
    expect(c.context?.map((r) => r.id).sort()).toEqual([ids.E1, ids.L3].sort())
    expect(a.apply({ type: 'pasteContent', content: c, parentId: ids.L1, origin: a.documentToken }).ok).toBe(true)
    // another document with the same source: kept
    const same = new Editor(exampleRecords())
    expect(same.apply({ type: 'pasteContent', content: c, parentId: ids.L1, origin: same.documentToken }).ok).toBe(true)
    // another document whose L3 / E1 differ: refused, nothing written
    const other = new Editor(exampleRecords().map((r: any) => (r.id === ids.E1 ? { ...r, anchors: { ...r.anchors, e1: { ...r.anchors.e1, p: { x: 80, y: 20 } } } } : r)))
    const before = JSON.stringify(other.reader.serialize('document'))
    const r = other.apply({ type: 'pasteContent', content: c, parentId: ids.L1, origin: other.documentToken })
    expect(r.ok === false && r.error.code).toBe('BAD_REFERENCE')
    expect(r.ok === false && r.error.message).toMatch(/not the same: copy the source with it/)
    expect(JSON.stringify(other.reader.serialize('document'))).toBe(before)
  })
  it('C5: masks travel with a copy that holds their targets and sources; a masked object without its source is refused by name', () => {
    const e = new Editor(exampleRecords())
    e.apply({ type: 'setContainerFlags', containerId: ids.L2, locked: false })
    e.apply({ type: 'setMask', sources: { fills: [ids.F], strokes: [] }, targets: [ids.E1], mode: 'inside' })
    const c = contentOf(e.reader, [ids.L3, ids.F, ids.C1, ids.C2]) as Content
    expect(c.masks?.length).toBe(1)
    expect(e.apply({ type: 'pasteContent', content: c, parentId: ids.L1, offset: { x: 100, y: 0 } }).ok).toBe(true)
    const masks = e.reader.allRecords().filter((r: any) => r.typeName === 'mask') as any[]
    expect(masks.length).toBe(2)
    const copy = masks.find((m) => m.id !== 'mask:1')
    expect(copy.targets[0]).not.toBe(ids.E1)
    expect(copy.sources.fills[0]).not.toBe(ids.F)
    expect(e.reader.get(copy.targets[0])).toBeTruthy()
    const r = contentOf(e.reader, [ids.L3])
    expect('error' in r && r.error.message).toMatch(/masked by mask:1, whose source fill:F is not being copied/)
  })
  it('C6: malformed content never throws: the centre skips it and the paste refuses it', () => {
    const e = new Editor(exampleRecords())
    const bad: Content = { kind: 'contour/content', schema: (contentOf(e.reader, [ids.E1]) as Content).schema, records: [{ typeName: 'curve', id: 'curve:bad' } as any] }
    expect(() => contentCentre(bad)).not.toThrow()
    expect(contentCentre(bad)).toBe(null)
    const r = e.apply({ type: 'pasteContent', content: bad, parentId: ids.L1 })
    expect(r.ok === false && r.error.message).toMatch(/clipboard content cannot be read/)
  })
})
