// Reference images (doc 18 §31): the record, its one validation, paint order, picking, transforms, copies, masks,
// type-based exclusions (export, K, snapping) and the position slots (bowen 1791365335; dot 1791365450).
import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import { Editor } from '../src/editor'
import { evaluate, hitStack } from '../src/evaluate'
import { drawingBounds, toSVG } from '../src/export'
import { bucketTarget, faceAt } from '../src/fills'
import { deletionSetOf } from '../src/selection'
import { snapPoint } from '../src/snap'
import { evaluateAtYaw } from '../src/pose'
import { contentOf } from '../src/clipboard'
import { Container, Curve, type DocRecord } from '../src/schema'

// a 4 × 2 PNG (any valid base64 body; decoding is the browser's, checked in e2e)
const SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP8z8DwnwEJMDEgAQBDZQIBcIqN6gAAAABJRU5ErkJggg=='
const run = (e: Editor, cmd: any): any => e.apply(cmd as Command)
const get = (e: Editor, id: string) => e.reader.get(id as any) as any
const recs = (e: Editor) => JSON.stringify(e.reader.allRecords().sort((a, b) => (a.id < b.id ? -1 : 1)))
const a = (id: string, x: number, y: number) => ({ id, p: { x, y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } })
const L = (id: string, index: string) => Container.create({ id: `container:${id}` as any, name: id, index })
const square = (n: string, parent: string, x0: number, y0: number, x1: number, y1: number, index = 'a1') =>
  Curve.create({ id: Curve.createId(n), name: n, parentId: parent as any, index, anchors: { a: a('a', x0, y0), b: a('b', x1, y0), c: a('c', x1, y1), d: a('d', x0, y1) }, segments: [{ id: 's1', from: 'a', to: 'b' }, { id: 's2', from: 'b', to: 'c' }, { id: 's3', from: 'c', to: 'd' }, { id: 's4', from: 'd', to: 'a' }], closed: true })
const T = (s: number, e: number, f: number) => ({ a: s, b: 0, c: 0, d: s, e, f })
const place = (e: Editor, extra: any = {}) => run(e, { type: 'placeImage', name: 'sheet', src: SRC, width: 4, height: 2, transform: T(10, 0, 0), ...extra })
const doc = () => new Editor([L('A', 'a1'), L('B', 'a2'), square('sq', 'container:A', 0, 0, 10, 10)])

describe('placing (doc 18 §31.3 step 1, §31.5)', () => {
  it('a new layer 「参考图」 below every layer, the image at its bottom, 50% — one write, one undo', () => {
    const e = doc()
    const before = recs(e)
    const r = place(e)
    expect(r.ok && r.written).toBe(true)
    const [img, layer] = r.affected
    expect(get(e, layer)).toMatchObject({ name: '参考图', parentId: null })
    expect(get(e, layer).index < get(e, 'container:A').index).toBe(true)
    expect(get(e, img)).toMatchObject({ parentId: layer, opacity: 0.5, width: 4, height: 2, slots: [] })
    expect(e.history.undo).toEqual(['placeImage'])
    e.undo()
    expect(recs(e)).toBe(before)
  })
  it('into a given layer: at its bottom', () => {
    const e = doc()
    const img = place(e, { layerId: 'container:A' }).affected[0]
    expect(get(e, img).parentId).toBe('container:A')
    expect(get(e, img).index < get(e, 'curve:sq').index).toBe(true)
  })
  it('only embedded PNG / JPEG / WebP data within the limits; a web or blob URL, an SVG, a bad size or placement is refused and nothing is written', () => {
    for (const bad of [
      { src: 'https://example.com/a.png' },
      { src: 'blob:http://127.0.0.1/abc' },
      { src: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { src: 'data:image/png;base64,***' },
      { width: 0 },
      { width: 2.5 },
      { width: 99999 },
      { transform: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 } },
      { transform: { a: 1, b: 0, c: 0, d: 1, e: Infinity, f: 0 } },
      { opacity: 2 },
    ]) {
      const e = doc()
      const before = recs(e)
      const r = place(e, bad)
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      expect(recs(e)).toBe(before)
    }
  })
})

describe('drawing order, picking, head-turn', () => {
  it('in the paint order like any object; the cached evaluation equals the full one; a head-turn leaves it as it is', () => {
    const e = doc()
    const img = place(e, { layerId: 'container:A' }).affected[0]
    expect(e.derived.evaluated().paint.map((p) => p.item.address)).toEqual([img, 'curve:sq'])
    expect(e.derived.evaluated()).toEqual(evaluate(e.reader))
    const yaw = evaluateAtYaw(e.reader, 30)
    expect(yaw.images).toEqual(evaluate(e.reader).images)
    expect(e.derived.atYaw(30).images).toEqual(evaluate(e.reader).images)
  })
  it('picked where it is drawn (inside its placed rectangle); not when its layer is locked or hidden; a line in front is picked first', () => {
    const e = doc()
    const img = place(e, { layerId: 'container:B' }).affected[0] // B is in front of A: the image over the square
    const at = (x: number, y: number) => hitStack(e.derived.evaluated(), { x, y }, 0.5).map((h) => h.address)
    expect(at(35, 15)).toEqual([img])
    expect(at(45, 25)).toEqual([]) // outside 40 × 20
    run(e, { type: 'arrange', ids: [img], to: 'back' })
    run(e, { type: 'setContainerFlags', containerId: 'container:B', locked: true })
    expect(at(35, 15)).toEqual([])
    run(e, { type: 'setContainerFlags', containerId: 'container:B', locked: false })
    run(e, { type: 'setContainerFlags', containerId: 'container:B', visible: false })
    expect(at(35, 15)).toEqual([])
  })
})

describe('editing like an object', () => {
  it('moved, scaled, mirrored through transformItems (its own, or its container); refused under a lock', () => {
    const e = doc()
    const img = place(e, { layerId: 'container:A' }).affected[0]
    expect(run(e, { type: 'transformItems', ids: [img], matrix: { a: -2, b: 0, c: 0, d: 2, e: 5, f: 1 } }).ok).toBe(true)
    expect(get(e, img).transform).toEqual({ a: -20, b: 0, c: 0, d: 20, e: 5, f: 1 })
    expect(run(e, { type: 'transformItems', ids: ['container:A'], matrix: { a: 1, b: 0, c: 0, d: 1, e: 3, f: 0 } }).ok).toBe(true)
    expect(get(e, img).transform.e).toBe(8)
    run(e, { type: 'setContainerFlags', containerId: 'container:A', locked: true })
    expect(run(e, { type: 'transformItems', ids: [img], matrix: { a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 } }).error.code).toBe('LOCKED')
  })
  it('properties: opacity and placement (setProps), checked', () => {
    const e = doc()
    const img = place(e).affected[0]
    expect(run(e, { type: 'setProps', id: img, opacity: 0.8 }).ok).toBe(true)
    expect(run(e, { type: 'setProps', id: img, transform: T(3, 1, 2) }).ok).toBe(true)
    expect(get(e, img)).toMatchObject({ opacity: 0.8, transform: T(3, 1, 2) })
    expect(run(e, { type: 'setProps', id: img, opacity: -1 }).ok).toBe(false)
    expect(run(e, { type: 'setProps', id: img, transform: T(0, 0, 0) }).ok).toBe(false)
    expect(run(e, { type: 'setProps', id: 'curve:sq', opacity: 0.5 }).ok).toBe(false)
  })
  it('grouped, arranged, duplicated, copied with its layer, deleted — undo restores', () => {
    const e = doc()
    const img = place(e, { layerId: 'container:A' }).affected[0]
    const before = recs(e)
    expect(run(e, { type: 'group', ids: [img, 'curve:sq'] }).ok).toBe(true)
    e.undo()
    expect(run(e, { type: 'arrange', ids: [img], to: 'front' }).ok).toBe(true)
    expect(e.derived.evaluated().paint.map((p) => p.item.address)).toEqual(['curve:sq', img])
    e.undo()
    const dup = run(e, { type: 'duplicate', ids: [img] })
    expect(dup.ok).toBe(true)
    expect(e.reader.allRecords().filter((r) => r.typeName === 'image').length).toBe(2)
    e.undo()
    const content = contentOf(e.reader, ['container:A'])
    expect('error' in content).toBe(false)
    const pasted = run(e, { type: 'pasteContent', content, parentId: 'container:B' })
    expect(pasted.ok).toBe(true)
    expect(e.reader.allRecords().filter((r) => r.typeName === 'image').length).toBe(2) // the image came with its layer
    e.undo()
    expect(run(e, { type: 'deleteRecords', ids: deletionSetOf(e.reader, ['container:A']) }).ok).toBe(true)
    expect(get(e, img)).toBeUndefined()
    e.undo()
    expect(recs(e)).toBe(before)
  })
  it('a mask target (and then a dependant: deleting the image alone is refused, by name); never a mask source', () => {
    const e = doc()
    const img = place(e, { layerId: 'container:B' }).affected[0]
    const m = run(e, { type: 'setMask', name: 'm', sources: { fills: [], strokes: ['curve:sq'] }, targets: [img], mode: 'inside' })
    expect(m.ok).toBe(true)
    const del = run(e, { type: 'deleteRecords', ids: [img] })
    expect(del.ok).toBe(false)
    expect(run(e, { type: 'setMask', name: 'm2', sources: { fills: [img], strokes: [] }, targets: ['curve:sq'], mode: 'inside' }).ok).toBe(false)
    // save → reopen keeps the mask on the image
    const re = new Editor()
    re.load(JSON.parse(JSON.stringify(e.save())))
    expect(recs(re)).toBe(recs(e))
  })
})

describe('left out by type: export, K, snapping (doc 18 §31.4)', () => {
  it('export: not in the bounds, not in the SVG — also inside a group with artwork, which is exported', () => {
    const e = doc()
    const img = place(e, { layerId: 'container:A', transform: T(100, -500, -500) }).affected[0] // 400 × 200 far away
    run(e, { type: 'group', ids: [img, 'curve:sq'] })
    const ev = e.derived.evaluated()
    const box = drawingBounds(ev, 0)!
    expect(box.x).toBeGreaterThan(-1)
    expect(box.x + box.w).toBeLessThan(11)
    const svg = toSVG(ev, box)
    expect(svg).not.toMatch(/<image|data:image/)
    expect(svg).toMatch(/<path/)
  })
  it('K: an image in front of a filled area does not block colouring it', () => {
    const e = doc()
    const fill = run(e, { type: 'paintRegion', boundary: (faceAt(e.reader, e.derived.evaluated(), { x: 5, y: 5 }) as any).boundary, color: '#ff0000' }).affected[1]
    place(e, { layerId: 'container:B' }) // in front, covering the square
    const t = bucketTarget(e.reader, e.derived.evaluated(), { x: 5, y: 5 }) as any
    expect(run(e, { type: 'paintRegion', boundary: t.boundary, color: '#00ff00' }).ok).toBe(true)
    expect(get(e, fill).color).toBe('#00ff00')
  })
  it('snapping: an image corner is no target', () => {
    const e = doc()
    place(e, { layerId: 'container:B', transform: T(10, 100, 100) }) // corners at (100,100) … (140,120)
    const s = snapPoint(e.derived.evaluated(), { x: 100.5, y: 100.5 }, 2)
    expect(s.kind).toBe('none')
  })
})

describe('position slots (bowen 1791365335; dot 1791365450)', () => {
  it('move → save to slot 5 → move elsewhere → recall 5 → back; save / reopen → recall 5 again → the same placement', () => {
    const e = doc()
    const img = place(e).affected[0]
    run(e, { type: 'setProps', id: img, transform: T(7, 11, 13) })
    expect(run(e, { type: 'saveImageSlot', id: img, n: 4 }).ok).toBe(true) // the fifth slot
    expect(get(e, img).slots).toEqual([{ n: 4, name: '位置 5', transform: T(7, 11, 13) }])
    run(e, { type: 'setProps', id: img, transform: T(2, -300, 900) })
    expect(run(e, { type: 'recallImageSlot', id: img, n: 4 }).ok).toBe(true)
    expect(get(e, img).transform).toEqual(T(7, 11, 13))
    run(e, { type: 'setProps', id: img, transform: T(2, -300, 900) })
    const re = new Editor()
    re.load(JSON.parse(JSON.stringify(e.save())))
    expect(run(re, { type: 'recallImageSlot', id: img, n: 4 }).ok).toBe(true)
    expect(get(re, img).transform).toEqual(T(7, 11, 13))
  })
  it('saving into a slot that holds a position overwrites it with the CURRENT one (v103 could not); undo restores; switching between two slots', () => {
    const e = doc()
    const img = place(e).affected[0]
    run(e, { type: 'setProps', id: img, transform: T(1, 1, 1) })
    run(e, { type: 'saveImageSlot', id: img, n: 0 })
    run(e, { type: 'setProps', id: img, transform: T(2, 2, 2) })
    run(e, { type: 'saveImageSlot', id: img, n: 1 })
    run(e, { type: 'setProps', id: img, transform: T(3, 3, 3) })
    expect(run(e, { type: 'saveImageSlot', id: img, n: 0 }).ok).toBe(true) // occupied: overwritten, the image stays where it is
    expect(get(e, img).transform).toEqual(T(3, 3, 3))
    expect(get(e, img).slots.find((s: any) => s.n === 0).transform).toEqual(T(3, 3, 3))
    e.undo()
    expect(get(e, img).slots.find((s: any) => s.n === 0).transform).toEqual(T(1, 1, 1))
    run(e, { type: 'recallImageSlot', id: img, n: 1 })
    expect(get(e, img).transform).toEqual(T(2, 2, 2))
    run(e, { type: 'recallImageSlot', id: img, n: 0 })
    expect(get(e, img).transform).toEqual(T(1, 1, 1))
    e.undo()
    expect(get(e, img).transform).toEqual(T(2, 2, 2))
  })
  it('recall of an empty slot is refused (nothing written); clear and rename', () => {
    const e = doc()
    const img = place(e).affected[0]
    const before = recs(e)
    expect(run(e, { type: 'recallImageSlot', id: img, n: 3 }).ok).toBe(false)
    expect(recs(e)).toBe(before)
    run(e, { type: 'saveImageSlot', id: img, n: 3 })
    expect(run(e, { type: 'renameImageSlot', id: img, n: 3, name: '正面' }).ok).toBe(true)
    expect(get(e, img).slots[0].name).toBe('正面')
    run(e, { type: 'saveImageSlot', id: img, n: 3 }) // saving again keeps the name
    expect(get(e, img).slots[0].name).toBe('正面')
    expect(run(e, { type: 'clearImageSlot', id: img, n: 3 }).ok).toBe(true)
    expect(get(e, img).slots).toEqual([])
  })
  it('under a layer lock: save and recall still work (the stated exemption: only these, only transform / slots); moving, clearing, renaming are refused', () => {
    const e = doc()
    const img = place(e).affected[0]
    run(e, { type: 'saveImageSlot', id: img, n: 0 })
    run(e, { type: 'setProps', id: img, transform: T(5, 5, 5) })
    const layer = get(e, img).parentId
    run(e, { type: 'setContainerFlags', containerId: layer, locked: true })
    expect(run(e, { type: 'recallImageSlot', id: img, n: 0 }).ok).toBe(true)
    expect(get(e, img).transform).toEqual(T(10, 0, 0))
    expect(run(e, { type: 'saveImageSlot', id: img, n: 1 }).ok).toBe(true)
    for (const cmd of [
      { type: 'setProps', id: img, transform: T(1, 0, 0) },
      { type: 'setProps', id: img, opacity: 0.3 },
      { type: 'transformItems', ids: [img], matrix: { a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 } },
      { type: 'clearImageSlot', id: img, n: 0 },
      { type: 'renameImageSlot', id: img, n: 0, name: 'x' },
    ])
      expect(run(e, cmd).error?.code, cmd.type).toBe('LOCKED')
  })
})
