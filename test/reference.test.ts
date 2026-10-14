// Reference pictures (docs/reference-images-plan.md; dot 1791701244): a module in the one document
// state, its edits never settle the drawing, checked at placing and at open.
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type ReferenceImage, type ReferenceInput } from '../src'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD='
const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
const img = (id: string, more: Partial<ReferenceImage> = {}): ReferenceInput => ({ id, view: 'view:0,0', src: PNG, width: 1, height: 1, x: 0, y: 0, scale: 10, angle: 0, opacity: 0.5, visible: true, ...more })
const code = (f: () => void) => { try { f() } catch (x) { return x instanceof Refusal ? x.code : (x as Error).message } return 'no refusal' }
function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => { e.line('ab', { id: 'a', layer: 'L', position: { x: 0, y: 0 } }, { id: 'b', layer: 'L', position: { x: 10, y: 0 } }) })
  return d
}
const drawing = (d: Core) => { const x = JSON.parse(save(d)).document; delete x.reference; return JSON.stringify(x) }

describe('reference pictures', () => {
  it('placed, changed and removed, each one undo step; read per view only', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('r1')))
    d.editIn('view:90,0', e => e.placeReference(img('r2', { view: 'view:90,0', src: JPEG })))
    expect(d.in('view:0,0').references().map(r => r.id)).toEqual(['r1'])
    expect(d.in('view:90,0').references().map(r => r.id)).toEqual(['r2'])
    d.edit(e => e.setReference('r1', { opacity: 0.9, x: 5 }))
    expect(d.in('view:0,0').references()[0]).toMatchObject({ opacity: 0.9, x: 5, y: 0 })
    d.edit(e => e.removeReference('r2'))
    expect(d.in('view:90,0').references()).toEqual([])
    d.undo(); expect(d.in('view:90,0').references().map(r => r.id)).toEqual(['r2'])
    d.undo(); expect(d.in('view:0,0').references()[0]!.opacity).toBe(0.5)
  })

  it('refusals: type, signature, size, values, drawable size, view, ids', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('ok', { src: WEBP })))
    const cases: [Partial<ReferenceImage>, string][] = [
      [{ src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }, 'reference-bad-image'],
      [{ src: 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD=' }, 'reference-bad-image'],
      [{ src: 'https://example.com/a.png' }, 'reference-bad-image'],
      [{ src: 'data:image/png;base64,iVBORw0KGgoAAAAN%%%' }, 'reference-bad-image'], [{ src: 'data:image/png;base64,iVBORw0KGgoAAAANS' }, 'reference-bad-image'],
      [{ width: 16385 }, 'reference-bad-size'], [{ width: 0 }, 'reference-bad-size'], [{ height: 1.5 }, 'reference-bad-size'],
      [{ x: NaN }, 'reference-bad-value'], [{ scale: 0 }, 'reference-bad-value'], [{ opacity: 1.5 }, 'reference-bad-value'],
      [{ width: 16384, scale: 1.7e308 }, 'reference-bad-value'], [{ view: 'view:45,0' }, 'reference-bad-value'],
      [{ id: 'ok' }, 'reference-exists'],
    ]
    for (const [more, c] of cases) expect([more, code(() => d.edit(e => e.placeReference(img('n', more))))]).toEqual([more, c])
    expect(code(() => d.edit(e => e.setReference('nope', { x: 1 })))).toBe('reference-unknown')
    expect(code(() => d.edit(e => e.setReference('ok', { scale: -1 })))).toBe('reference-bad-value')
    expect(code(() => d.edit(e => e.removeReference('nope')))).toBe('reference-unknown')
  })

  it('an edit of reference operations (and a selection) never settles: two coincident points from a file stay two (dot 1791700377)', () => {
    const d0 = doc()
    d0.edit(e => e.line('cd', { id: 'c', layer: 'L', position: { x: 50, y: 50 } }, { id: 'e', layer: 'L', position: { x: 60, y: 50 } }))
    const file = JSON.parse(save(d0))
    for (const l of file.document.network.shapes.layers) if (l.points.c) l.points.c = { x: 0, y: 0 } // c onto a in every layer
    const d = open(JSON.stringify(file)), before = drawing(d)
    d.edit(e => { e.select([{ kind: 'line', id: 'ab' }]); e.placeReference(img('r1')) })
    d.edit(e => e.setReference('r1', { angle: 30 }))
    expect(drawing(d).replace(/"selection":[^\]]*\]/, '')).toBe(before.replace(/"selection":[^\]]*\]/, ''))
    expect(d.snapshot().points.map(p => p.id).sort()).toEqual(['a', 'b', 'c', 'e'])
  })

  it('mixed edits keep their own rules: with a move it settles fully; beside correct it is refused, not a companion (dot 1791701744)', () => {
    const d = doc()
    d.edit(e => e.line('cd', { id: 'c', layer: 'L', position: { x: 50, y: 50 } }, { id: 'e', layer: 'L', position: { x: 60, y: 50 } }))
    d.edit(e => { e.placeReference(img('r1')); e.move([{ id: 'c', target: { x: 10, y: 0 } }]) }) // full settle: c binds with b
    expect(d.snapshot().points.length).toBe(3)
    expect(d.in('view:0,0').references().map(r => r.id)).toEqual(['r1'])
    const d2 = doc()
    d2.editIn('view:90,0', e => e.move([{ id: 'b', target: { x: 20, y: 5 } }]))
    // not a companion of an alone operation: refused (dot 1791701744), nothing published
    const before = save(d2)
    expect(code(() => d2.edit(e => { e.placeReference(img('r2')); e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: { x: 15, y: 3 } }] }) }))).toBe('stage2-alone')
    expect(save(d2)).toBe(before)
    // a selection still is one
    d2.edit(e => { e.select([]); e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: { x: 15, y: 3 } }] }) })
  })

  it('a file keeps its pictures; a bad picture or an old version does not open; a clip carries none', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('r1')))
    const text = save(d)
    expect(open(text).in('view:0,0').references()).toEqual(d.in('view:0,0').references())
    const bad = JSON.parse(text); bad.document.reference.library[0].src = 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD='
    expect(() => open(JSON.stringify(bad))).toThrow(/open-failed: reference: reference-bad-image/)
    expect(() => open(text.replace('"version":11', '"version":4'))).toThrow(/unsupported version 4/)
    const pasted = doc()
    pasted.edit(e => e.paste(d.copy(['ab']), 'L', { x: 100, y: 0 }, 'p'))
    expect(pasted.in('view:0,0').references()).toEqual([])
  })

  it('slots: save and recall through setReference, one undo step each; survive a file; a file without slots opens with none (dot 1791703489)', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('r1')))
    expect(d.in('view:0,0').references()[0]!.slots).toEqual([])
    const slot = { name: '正面', placement: { x: 5, y: 6, scale: 2, angle: 10 } }
    d.edit(e => e.setReference('r1', { slots: [slot, { name: '空', placement: null }] }))
    d.edit(e => e.setReference('r1', { x: 100, y: 100 }))
    d.edit(e => e.setReference('r1', { ...slot.placement })) // recall
    expect(d.in('view:0,0').references()[0]).toMatchObject({ x: 5, y: 6, scale: 2, angle: 10 })
    d.undo()
    expect(d.in('view:0,0').references()[0]).toMatchObject({ x: 100, y: 100 })
    const text = save(d)
    expect(open(text).in('view:0,0').references()[0]!.slots).toEqual([slot, { name: '空', placement: null }])
    const without = JSON.parse(text); delete without.document.reference.images[0].slots
    expect(open(JSON.stringify(without)).in('view:0,0').references()[0]!.slots).toEqual([])
  })

  it('flipped (§9): set and undone in one step; a file keeps it; a file without it opens unmirrored; slots unchanged by it', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('r1', { slots: [{ name: 's', placement: { x: 1, y: 2, scale: 3, angle: 4 } }] })))
    expect(d.in('view:0,0').references()[0]!.flipped).toBe(false)
    d.edit(e => e.setReference('r1', { flipped: true, angle: -30 }))
    expect(d.in('view:0,0').references()[0]).toMatchObject({ flipped: true, angle: -30, slots: [{ name: 's', placement: { x: 1, y: 2, scale: 3, angle: 4 } }] })
    const text = save(d)
    expect(open(text).in('view:0,0').references()[0]!.flipped).toBe(true)
    d.undo()
    expect(d.in('view:0,0').references()[0]).toMatchObject({ flipped: false, angle: 0 })
    const without = JSON.parse(text); delete without.document.reference.images[0].flipped
    expect(open(JSON.stringify(without)).in('view:0,0').references()[0]!.flipped).toBe(false)
    expect(drawing(open(text))).toBe(drawing(d)) // the drawing itself untouched
  })

  it('flipped must be true or false: refused when placing, in setReference and in a file', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('r1')))
    for (const v of [null, 0, 1, 'true', {}]) {
      expect([v, code(() => d.edit(e => e.placeReference(img('n', { flipped: v as never }))))]).toEqual([v, 'reference-bad-value'])
      expect([v, code(() => d.edit(e => e.setReference('r1', { flipped: v as never })))]).toEqual([v, 'reference-bad-value'])
    }
    expect(code(() => d.edit(e => e.setReference('r1', { flipped: undefined })))).toBe('reference-bad-value')
    const file = JSON.parse(save(d)); file.document.reference.images[0].flipped = 'yes'
    expect(() => open(JSON.stringify(file))).toThrow(/open-failed: reference: reference-bad-value/)
  })

  it('bad slots are refused, in an edit and in a file: null, an object, a bad slot, a scale whose drawn size overflows, too many', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('r1', { width: 16384 })))
    const bad: unknown[] = [null, {}, [{ name: 1, placement: null }], [{ name: 'a', placement: { x: 0, y: 0, scale: 0, angle: 0 } }],
      [{ name: 'a', placement: { x: 0, y: 0, scale: 1.7e308, angle: 0 } }], [{ name: 'a', placement: [] }], Array.from({ length: 1001 }, () => ({ name: '', placement: null }))]
    for (const v of bad) expect([v === null ? 'null' : JSON.stringify(v).slice(0, 30), code(() => d.edit(e => e.setReference('r1', { slots: v as never })))]).toEqual([v === null ? 'null' : JSON.stringify(v).slice(0, 30), 'reference-bad-slots'])
    const file = JSON.parse(save(d)); file.document.reference.images[0].slots = null
    expect(() => open(JSON.stringify(file))).toThrow(/open-failed: reference: reference-bad-slots/)
  })

  it('slots are copied in and out: changing the caller\'s list or a read copy does not reach the document or its undo', () => {
    const d = doc()
    const slots = [{ name: 'a', placement: { x: 1, y: 2, scale: 1, angle: 0 } }]
    d.edit(e => e.placeReference(img('r1', { slots })))
    ;(slots[0]!.placement as { x: number }).x = 999
    const read = d.in('view:0,0').references()[0]!
    ;(read.slots[0]!.placement as { x: number }).x = 777
    expect(d.in('view:0,0').references()[0]!.slots[0]!.placement!.x).toBe(1)
  })
})

describe('playback pictures (docs/playback-edit-checklist.md §5; bowen 1791970202)', () => {
  it('a picture placed at `playback` is read by playbackReferences, never by a view; another key is refused', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('pb', { view: 'playback' })))
    expect(d.playbackReferences().map(r => r.id)).toEqual(['pb'])
    for (const k of ['view:0,0', 'view:90,0', 'view:0,45']) expect(d.in(k).references()).toEqual([])
    expect(code(() => d.edit(e => e.placeReference(img('bad', { view: 'nowhere' }))))).toBe('reference-bad-value')
    d.edit(e => e.setReference('pb', { x: 7 }))
    expect(d.playbackReferences()[0]!.x).toBe(7)
  })

  it('saved as version 11 and opened again; a version 10 file opens as it is (bowen 1791976935)', () => {
    const d = doc()
    d.edit(e => { e.placeReference(img('pb', { view: 'playback' })); e.placeReference(img('v', { view: 'view:0,0' })) })
    const text = save(d)
    expect(JSON.parse(text).version).toBe(11)
    const back = open(text)
    expect(back.playbackReferences()).toEqual(d.playbackReferences())
    expect(back.in('view:0,0').references()).toEqual(d.in('view:0,0').references())
    const old = doc()
    old.edit(e => e.placeReference(img('v', { view: 'view:0,0' })))
    const v10 = save(old).replace('"version":11', '"version":10')
    expect(save(open(v10))).toBe(save(old))
  })
})
