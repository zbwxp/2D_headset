// Shape groups (src/shapes.ts, doc 18 §30.22) — dot 1791354232's four conditions as tests:
// 1. group + re-parenting + face are ONE write; a refusal leaves nothing; one undo restores everything;
// 2. lines already in a shape group: further faces reuse that group (no new group);
// 3. before re-parenting: locks, the masks of the containers that held the lines, family identity;
// 4. after clearing / cutting: still editable, copyable, saved and reopened; a closed line cut into pieces stays one
//    shape (the group holds every piece).
// And the paint rule: inside a shape group the faces are drawn below its other children.
import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { existingFillAt, faceAt } from '../src/fills'
import { contentOf } from '../src/clipboard'
import { layerRows } from '../src/ui/layerTree'
import { deletionSetOf, unitOf } from '../src/selection'
import { Container, Curve, Family, Mask, type DocRecord } from '../src/schema'

const anchor = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
const line = (n: string, x1: number, y1: number, x2: number, y2: number, parent = 'container:L', index = `a${n}`) =>
  Curve.create({ id: Curve.createId(n), name: n, parentId: parent as any, index, anchors: { p: anchor('p', x1, y1), q: anchor('q', x2, y2) }, segments: [{ id: 's', from: 'p', to: 'q' }] })
const layer = (id = 'L', index = 'a1') => Container.create({ id: `container:${id}` as any, name: id, index })
/** a triangle of three separate lines a, b, c meeting at their ends, and a line z between them in the paint order */
const triangle = (): DocRecord[] => [layer(), line('a', 0, 0, 10, 0, 'container:L', 'a1'), line('z', 50, 50, 60, 60, 'container:L', 'a2'), line('b', 10, 0, 5, 10, 'container:L', 'a3'), line('c', 5, 10, 0, 0, 'container:L', 'a4')]
const face = (e: Editor, x: number, y: number) => {
  const f = faceAt(e.reader, e.derived.evaluated(), { x, y })
  if ('error' in f) throw new Error(f.error)
  return f.boundary
}
/** apply, typed loosely: a refused result has no `affected` */
const run = (e: Editor, cmd: any): any => e.apply(cmd as Command)
const recs = (e: Editor) => JSON.stringify(e.reader.allRecords().sort((a, b) => (a.id < b.id ? -1 : 1)))
const get = (e: Editor, id: string) => e.reader.get(id as any) as any
const solid = (e: Editor, id: string) => JSON.stringify(e.derived.evaluated().fills.find((f) => f.address === id)!.cubics.filter((c) => !(c[0].x === c[3].x && c[0].y === c[3].y)))
const paintOrder = (e: Editor) => e.derived.evaluated().paint.map((p) => p.item.address)

describe('paintRegion (K / 建立填充)', () => {
  it('three lines → one new shape group at the front-most line\'s place; the lines keep ids and order; the face below them; one undo', () => {
    const e = new Editor(triangle())
    const before = recs(e)
    const r = run(e, { type: 'paintRegion', boundary: face(e, 5, 3), color: '#ff0000' })
    expect(r.ok && r.written).toBe(true)
    expect(e.history.undo).toEqual(['paintRegion'])
    const [gid, fid] = r.affected
    expect(get(e, gid)).toMatchObject({ typeName: 'container', shape: true, name: '形状', parentId: 'container:L' })
    for (const c of ['a', 'b', 'c']) expect(get(e, `curve:${c}`).parentId).toBe(gid)
    expect(get(e, 'curve:z').parentId).toBe('container:L')
    expect(get(e, fid)).toMatchObject({ typeName: 'fill', parentId: gid, color: '#ff0000' })
    // the group sits where c (front-most) was: z (between a and b before) is now below the group, like ⌘G
    expect(paintOrder(e)).toEqual(['curve:z', fid, 'curve:a', 'curve:b', 'curve:c'])
    e.undo()
    expect(recs(e)).toBe(before)
  })

  it('a second area of the same lines reuses the group; the same area again only recolours', () => {
    // a square with a diagonal: two triangles
    const e = new Editor([layer(), line('1', 0, 0, 10, 0), line('2', 10, 0, 10, 10), line('3', 10, 10, 0, 10), line('4', 0, 10, 0, 0), line('5', 0, 0, 10, 10)])
    const first = run(e, { type: 'paintRegion', boundary: face(e, 7, 3), color: '#ff0000' })
    const gid = first.affected[0]
    const second = run(e, { type: 'paintRegion', boundary: face(e, 3, 7), color: '#00ff00' })
    expect(second.ok).toBe(true)
    expect(second.affected[0]).toBe(gid)
    expect(e.reader.allRecords().filter((r) => r.typeName === 'container').length).toBe(2) // L and the one group
    expect(e.reader.allRecords().filter((r: any) => r.typeName === 'fill' && r.parentId === gid).length).toBe(2)
    const again = run(e, { type: 'paintRegion', boundary: face(e, 3, 7), color: '#0000ff' })
    expect(again.ok && again.written).toBe(true)
    expect(e.reader.allRecords().filter((r) => r.typeName === 'fill').length).toBe(2)
    expect(get(e, again.affected[1]).color).toBe('#0000ff')
    // the same colour again: nothing written, no undo step
    const steps = e.history.undo.length
    const same = run(e, { type: 'paintRegion', boundary: face(e, 3, 7), color: '#0000ff' })
    expect(same.ok && !same.written).toBe(true)
    expect(e.history.undo.length).toBe(steps)
  })

  it('a line beside the group (same parent) joins it; lines of two groups, or of two layers, are refused and nothing is written', () => {
    const e = new Editor([layer(), line('1', 0, 0, 10, 0), line('2', 10, 0, 10, 10), line('3', 10, 10, 0, 10), line('4', 0, 10, 0, 0), line('5', 10, 0, 20, 0), line('6', 20, 0, 20, 10), line('7', 20, 10, 10, 10)])
    const left = run(e, { type: 'paintRegion', boundary: face(e, 5, 5), color: '#ff0000' })
    const gid = left.affected[0]
    // the right square shares line 2 with the group: 5, 6, 7 join it
    const right = run(e, { type: 'paintRegion', boundary: face(e, 15, 5), color: '#00ff00' })
    expect(right.ok).toBe(true)
    for (const n of ['5', '6', '7']) expect(get(e, `curve:${n}`).parentId).toBe(gid)
    // two layers
    const x = new Editor([layer('L'), layer('M', 'a2'), line('1', 0, 0, 10, 0), line('2', 10, 0, 5, 10, 'container:M'), line('3', 5, 10, 0, 0)])
    const cross = run(x, { type: 'paintRegion', boundary: face(x, 5, 3), color: '#ff0000' })
    expect(cross.ok).toBe(false)
    if (!cross.ok) expect(cross.error.message).toMatch(/跨层/)
    expect(x.history.undo).toEqual([])
  })

  it('lines of two shape groups are refused (merging is not supported); nothing is written', () => {
    const g = (id: string, index: string) => ({ ...Container.create({ id: `container:${id}` as any, name: id, parentId: 'container:L' as any, index }), shape: true as const })
    // the left square in S1, the right square's other three lines in S2; the right area needs line 2 of S1
    const e = new Editor([layer(), g('S1', 'a1'), g('S2', 'a2'), line('1', 0, 0, 10, 0, 'container:S1'), line('2', 10, 0, 10, 10, 'container:S1'), line('3', 10, 10, 0, 10, 'container:S1'), line('4', 0, 10, 0, 0, 'container:S1'), line('5', 10, 0, 20, 0, 'container:S2'), line('6', 20, 0, 20, 10, 'container:S2'), line('7', 20, 10, 10, 10, 'container:S2')])
    const before = recs(e)
    const r = run(e, { type: 'paintRegion', boundary: face(e, 15, 5), color: '#00ff00' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toMatch(/不同的形状组.*合并形状组暂不支持/)
    expect(recs(e)).toBe(before)
    // each square alone is fine: its own group is reused
    expect(run(e, { type: 'paintRegion', boundary: face(e, 5, 5), color: '#ff0000' }).affected[0]).toBe('container:S1')
  })

  it('a locked layer refuses the whole paint (nothing written)', () => {
    const recs0 = triangle().map((r) => (r.id === 'container:L' ? { ...r, locked: true } : r)) as DocRecord[]
    const e = new Editor(recs0)
    const before = recs(e)
    const r = run(e, { type: 'paintRegion', boundary: face(e, 5, 3), color: '#ff0000' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('LOCKED')
    expect(recs(e)).toBe(before)
  })

  it('the masks that covered the lines (on their layer, on a line) still cover them and the face; family membership is unchanged', () => {
    const m = Mask.create({ id: Mask.createId('m'), name: 'm', sources: { fills: [], strokes: ['curve:z' as any] }, targets: ['container:L'], mode: 'outside', enabled: true })
    const own = Mask.create({ id: Mask.createId('own'), name: 'own', sources: { fills: [], strokes: ['curve:z' as any] }, targets: ['curve:a'], mode: 'outside', enabled: true })
    const fam = Family.create({ id: Family.createId('f'), name: 'f', curves: ['curve:a' as any, 'curve:b' as any] })
    const e = new Editor([...triangle(), m, own, fam])
    const r = run(e, { type: 'paintRegion', boundary: face(e, 5, 3), color: '#ff0000' })
    expect(r.ok).toBe(true)
    const masks = e.derived.evaluated().masks!
    for (const a of ['curve:a', 'curve:b', 'curve:c', r.affected[1]]) expect(masks.get(a)?.map((x) => x.id)).toEqual(expect.arrayContaining([m.id]))
    expect(masks.get('curve:a')!.map((x) => x.id).sort()).toEqual([m.id, own.id].sort()) // the layer's and its own
    expect(get(e, fam.id)).toEqual(fam)
    expect(get(e, m.id)).toEqual(m)
  })

  it('paint rule: a face is drawn below the group\'s lines whatever its index', () => {
    const e = new Editor(triangle())
    const r = run(e, { type: 'paintRegion', boundary: face(e, 5, 3), color: '#ff0000' })
    const [gid, fid] = r.affected
    // put the face on top of the group's children by index: still drawn first in the group
    const moved = run(e, { type: 'arrange', ids: [fid], to: 'front' })
    expect(moved.ok).toBe(true)
    expect(get(e, fid).index > get(e, 'curve:c').index).toBe(true)
    const order = paintOrder(e)
    expect(order.indexOf(fid)).toBeLessThan(order.indexOf('curve:a'))
    expect(gid).toBeTruthy()
  })
})

describe('after painting: clear, cut, delete, ungroup, copy, save / reopen', () => {
  it('clearing the face keeps the face (colour none, not drawn), the group and its lines; ungroup then works (refused while a face has a colour) and takes the colourless face with it', () => {
    const e = new Editor(triangle())
    const [gid, fid] = run(e, { type: 'paintRegion', boundary: face(e, 5, 3), color: '#ff0000' }).affected
    const no = run(e, { type: 'ungroup', ids: [gid] })
    expect(no.ok).toBe(false)
    if (!no.ok) expect(no.error.message).toMatch(/先在属性里清除/)
    expect(run(e, { type: 'setProps', id: fid, color: 'none' }).ok).toBe(true)
    expect(get(e, fid)).toMatchObject({ color: 'none', parentId: gid })
    expect(e.derived.evaluated().fills.find((f) => f.address === fid)!.visible).toBe(false)
    for (const c of ['a', 'b', 'c']) expect(get(e, `curve:${c}`).parentId).toBe(gid)
    expect(run(e, { type: 'ungroup', ids: [gid] }).ok).toBe(true)
    for (const c of ['a', 'b', 'c']) expect(get(e, `curve:${c}`).parentId).toBe('container:L')
    expect(get(e, fid)).toBeUndefined()
  })

  it("dot 1791358732: lines pulled apart (the face held by bridges) → clear → K colours the SAME face again; deleting a line then takes the colourless face along", () => {
    const e = new Editor(triangle())
    const [, fid] = run(e, { type: 'paintRegion', boundary: face(e, 5, 3), color: '#ff0000' }).affected
    const area0 = solid(e, fid)
    // A drags a's end away from b's start: they no longer meet, the face keeps its bridge there
    expect(run(e, { type: 'moveAnchors', targets: [{ curveId: 'curve:a', anchorId: 'q' }], delta: { x: 2, y: -2 } }).ok).toBe(true)
    expect('error' in faceAt(e.reader, e.derived.evaluated(), { x: 5, y: 3 })).toBe(true) // the face search alone no longer finds it
    expect(run(e, { type: 'setProps', id: fid, color: 'none' }).ok).toBe(true)
    // K at the same place: the existing (colourless) area wins
    const old = existingFillAt(e.reader, e.derived.evaluated(), { x: 5, y: 3 })!
    expect(old.id).toBe(fid)
    const again = run(e, { type: 'paintRegion', boundary: old.boundary, color: '#00ff00' })
    expect(again.ok && again.written).toBe(true)
    expect(get(e, fid).color).toBe('#00ff00')
    expect(e.reader.allRecords().filter((r) => r.typeName === 'fill').length).toBe(1)
    expect(solid(e, fid)).not.toBe(area0) // the moved end, through the bridge
    // a coloured face still names the line on delete; colourless, it goes with it
    expect(run(e, { type: 'deleteRecords', ids: deletionSetOf(e.reader, ['curve:b']) }).ok).toBe(false)
    run(e, { type: 'setProps', id: fid, color: 'none' })
    expect(run(e, { type: 'deleteRecords', ids: deletionSetOf(e.reader, ['curve:b']) }).ok).toBe(true)
    expect(get(e, fid)).toBeUndefined()
  })

  it('a line the face uses is not deleted on its own (the face is named)', () => {
    const e = new Editor(triangle())
    const fid = run(e, { type: 'paintRegion', boundary: face(e, 5, 3), color: '#ff0000' }).affected[1]
    const r = run(e, { type: 'deleteRecords', ids: ['curve:b'] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.objects).toContain(fid)
  })

  it('copy / paste the shape group: a new shape group with its own face on the new lines; save and reopen keep it', () => {
    const e = new Editor(triangle())
    const [gid] = run(e, { type: 'paintRegion', boundary: face(e, 5, 3), color: '#ff0000' }).affected
    const content = contentOf(e.reader, [gid])
    expect('error' in content).toBe(false)
    const pasted = run(e, { type: 'pasteContent', content: content as any, parentId: 'container:L' as any, offset: { x: 30, y: 0 } })
    expect(pasted.ok).toBe(true)
    const groups = e.reader.allRecords().filter((r: any) => r.typeName === 'container' && r.shape)
    expect(groups.length).toBe(2)
    const copy = groups.find((g) => g.id !== gid)!
    const copyFace = e.reader.allRecords().find((r: any) => r.typeName === 'fill' && r.parentId === copy.id) as any
    expect(copyFace.color).toBe('#ff0000')
    expect(copyFace.boundary.every((b: any) => ('bridge' in b ? get(e, b.bridge.from.curveId).parentId === copy.id : get(e, b.curveId).parentId === copy.id))).toBe(true)
    // save → reopen
    const reopened = new Editor()
    reopened.load(JSON.parse(JSON.stringify(e.save())))
    expect(recs(reopened)).toBe(recs(e))
    expect(paintOrder(reopened)).toEqual(paintOrder(e))
  })
})

const square = (parent = 'container:L') =>
  Curve.create({
    id: Curve.createId('sq'),
    name: 'sq',
    parentId: parent as any,
    index: 'a1',
    anchors: { a: anchor('a', 0, 0), b: anchor('b', 10, 0), c: anchor('c', 10, 10), d: anchor('d', 0, 10) },
    segments: [{ id: 's1', from: 'a', to: 'b' }, { id: 's2', from: 'b', to: 'c' }, { id: 's3', from: 'c', to: 'd' }, { id: 's4', from: 'd', to: 'a' }],
    closed: true,
  })

describe("a path's own fill (doc 18 §30.18; dot 1791356669: one closed path is filled as its attribute, no group)", () => {
  it('K inside one closed path: the fill is the path\'s own — no group, drawn just below it, selected / listed / deleted with it', () => {
    const e = new Editor([layer(), line('z', 50, 50, 60, 60, 'container:L', 'a0'), square(), line('y', 70, 70, 80, 80, 'container:L', 'a2')])
    const r = run(e, { type: 'paintRegion', boundary: face(e, 5, 5), color: '#ff0000' })
    expect(r.ok).toBe(true)
    const [cid, fid] = r.affected
    expect(cid).toBe('curve:sq')
    expect(get(e, fid)).toMatchObject({ parentId: 'container:L', owner: { kind: 'path', curveId: 'curve:sq' } })
    expect(e.reader.allRecords().filter((x) => x.typeName === 'container').length).toBe(1)
    expect(paintOrder(e)).toEqual(['curve:z', fid, 'curve:sq', 'curve:y'])
    // arranged to the front: the fill comes along, still just below
    run(e, { type: 'arrange', ids: ['curve:sq'], to: 'front' })
    expect(paintOrder(e)).toEqual(['curve:z', 'curve:y', fid, 'curve:sq'])
    expect(unitOf(e.reader as any, fid)).toBe('curve:sq')
    expect(layerRows(e.reader, () => true).map((x) => x.id)).not.toContain(fid)
    expect(deletionSetOf(e.reader, ['curve:sq'])).toContain(fid)
    expect(run(e, { type: 'deleteRecords', ids: deletionSetOf(e.reader, ['curve:sq']) }).ok).toBe(true)
    expect(get(e, fid)).toBeUndefined()
  })

  it('the path grouped (⌘G): its fill moves into the group with it in the same write; the fill alone cannot leave its path', () => {
    const e = new Editor([layer(), square()])
    const fid = run(e, { type: 'paintRegion', boundary: face(e, 5, 5), color: '#ff0000' }).affected[1]
    const g = run(e, { type: 'group', ids: ['curve:sq'] })
    expect(g.ok).toBe(true)
    expect(get(e, fid).parentId).toBe(get(e, 'curve:sq').parentId)
    e.undo()
    expect(get(e, fid).parentId).toBe('container:L')
    const alone = run(e, { type: 'group', ids: [fid] })
    expect(alone.ok).toBe(false)
    if (!alone.ok) expect(alone.error.code).toBe('BAD_REFERENCE')
  })

  it('copy / paste the path: the copy has its own fill on the copied path', () => {
    const e = new Editor([layer(), square()])
    const fid = run(e, { type: 'paintRegion', boundary: face(e, 5, 5), color: '#ff0000' }).affected[1]
    const content = contentOf(e.reader, ['curve:sq'])
    const pasted = run(e, { type: 'pasteContent', content, parentId: 'container:L' as any, offset: { x: 30, y: 0 } })
    expect(pasted.ok).toBe(true)
    const fills = e.reader.allRecords().filter((x) => x.typeName === 'fill') as any[]
    expect(fills.length).toBe(2)
    const copy = fills.find((f) => f.id !== fid)
    expect(copy.owner.curveId).not.toBe('curve:sq')
    expect(copy.boundary.every((b: any) => b.curveId === copy.owner.curveId)).toBe(true)
  })

  it('cut once (opened): still the path\'s own fill, same area; cut again into two pieces: a shape group carries the whole shape', () => {
    const e = new Editor([layer(), square()])
    const fid = run(e, { type: 'paintRegion', boundary: face(e, 5, 5), color: '#ff0000' }).affected[1]
    const before = solid(e, fid)
    expect(run(e, { type: 'breakAt', curveId: 'curve:sq', anchorId: 'a' }).ok).toBe(true)
    expect(get(e, fid).owner).toEqual({ kind: 'path', curveId: 'curve:sq' })
    expect(solid(e, fid)).toBe(before)
    const cut = run(e, { type: 'breakAt', curveId: 'curve:sq', anchorId: 'c' })
    expect(cut.ok).toBe(true)
    expect(e.history.undo.at(-1)).toBe('breakAt') // one step
    const group = e.reader.allRecords().find((x: any) => x.typeName === 'container' && x.shape) as any
    expect(group).toMatchObject({ parentId: 'container:L', name: '形状' })
    const pieces = e.reader.allRecords().filter((x) => x.typeName === 'curve') as any[]
    expect(pieces.length).toBe(2)
    for (const p of pieces) expect(p.parentId).toBe(group.id)
    expect(get(e, fid).owner).toBeUndefined()
    expect(get(e, fid).parentId).toBe(group.id)
    expect(solid(e, fid)).toBe(before)
    expect(paintOrder(e)[0]).toBe(fid) // the face below both pieces
    // V moves the whole shape as one unit
    expect(unitOf(e.reader as any, pieces[1].id)).toBe(group.id)
    // undo: one closed… opened path with its own fill again
    e.undo()
    expect(get(e, fid).owner).toEqual({ kind: 'path', curveId: 'curve:sq' })
    expect(e.reader.allRecords().some((x: any) => x.typeName === 'container' && x.shape)).toBe(false)
  })

  it('无 keeps the path\'s own fill as colourless (not drawn); cut once, ends pulled apart, K colours the same fill again', () => {
    const e = new Editor([layer(), square()])
    const fid = run(e, { type: 'paintRegion', boundary: face(e, 5, 5), color: '#ff0000' }).affected[1]
    run(e, { type: 'breakAt', curveId: 'curve:sq', anchorId: 'a' })
    run(e, { type: 'moveAnchors', targets: [{ curveId: 'curve:sq', anchorId: 'a' }], delta: { x: -2, y: -2 } })
    expect(run(e, { type: 'setProps', id: fid, color: 'none' }).ok).toBe(true)
    expect(get(e, fid).owner).toEqual({ kind: 'path', curveId: 'curve:sq' })
    const old = existingFillAt(e.reader, e.derived.evaluated(), { x: 5, y: 5 })!
    expect(old.id).toBe(fid)
    expect(run(e, { type: 'paintRegion', boundary: old.boundary, color: '#0000ff' }).ok).toBe(true)
    expect(get(e, fid).color).toBe('#0000ff')
  })

  it('save and reopen keep the path\'s own fill and its order', () => {
    const e = new Editor([layer(), square()])
    run(e, { type: 'paintRegion', boundary: face(e, 5, 5), color: '#ff0000' })
    const reopened = new Editor()
    reopened.load(JSON.parse(JSON.stringify(e.save())))
    expect(recs(reopened)).toBe(recs(e))
    expect(paintOrder(reopened)).toEqual(paintOrder(e))
  })
})
