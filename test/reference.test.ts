// Reference pictures (docs/reference-images-plan.md; dot 1791701244): a module in the one document
// state, its edits never settle the drawing, checked at placing and at open.
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type ReferenceImage } from '../src'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD'
const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
const img = (id: string, more: Partial<ReferenceImage> = {}): ReferenceImage => ({ id, view: 'view:0,0', src: PNG, width: 1, height: 1, x: 0, y: 0, scale: 10, angle: 0, opacity: 0.5, visible: true, ...more })
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
      [{ src: 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD' }, 'reference-bad-image'],
      [{ src: 'https://example.com/a.png' }, 'reference-bad-image'],
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

  it('mixed edits keep their own rules: with a move it settles fully; beside correct it is a settle-free companion (dot 1791701244)', () => {
    const d = doc()
    d.edit(e => e.line('cd', { id: 'c', layer: 'L', position: { x: 50, y: 50 } }, { id: 'e', layer: 'L', position: { x: 60, y: 50 } }))
    d.edit(e => { e.placeReference(img('r1')); e.move([{ id: 'c', target: { x: 10, y: 0 } }]) }) // full settle: c binds with b
    expect(d.snapshot().points.length).toBe(3)
    expect(d.in('view:0,0').references().map(r => r.id)).toEqual(['r1'])
    const d2 = doc()
    d2.editIn('view:90,0', e => e.move([{ id: 'b', target: { x: 20, y: 5 } }]))
    // a settle-free companion of an alone operation, as a selection is (the merge rule of package 1): allowed, both applied
    d2.edit(e => { e.placeReference(img('r2')); e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: 'b', position: { x: 15, y: 3 } }] }) })
    expect([d2.in('view:0,0').references().length, d2.atPose({ yaw: 45, pitch: 0 }).snapshot().points.find(p => p.id === 'b')!.position]).toEqual([1, { x: 15, y: 3 }])
    // with another non-settle-free operation beside correct it is refused as before
    expect(code(() => d2.edit(e => { e.placeReference(img('r3')); e.move([{ id: 'a', target: { x: 1, y: 1 } }]); e.correct({ yaw: 30, pitch: 0 }, { points: [] }) }))).toBe('stage2-alone')
  })

  it('a file keeps its pictures; a bad picture or an old version does not open; a clip carries none', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('r1')))
    const text = save(d)
    expect(open(text).in('view:0,0').references()).toEqual(d.in('view:0,0').references())
    const bad = JSON.parse(text); bad.document.reference.images[0].src = 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD'
    expect(() => open(JSON.stringify(bad))).toThrow(/open-failed: reference: reference-bad-image/)
    expect(() => open(text.replace('"version":5', '"version":4'))).toThrow(/unsupported version 4/)
    const pasted = doc()
    pasted.edit(e => e.paste(d.copy(['ab']), 'L', { x: 100, y: 0 }, 'p'))
    expect(pasted.in('view:0,0').references()).toEqual([])
  })
})
