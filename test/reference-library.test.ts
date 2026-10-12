// The picture library (docs/reference-images-plan.md §10; bowen 1791725516, 1791726456; dot 1791725852,
// 1791725888): one copy of each picture's content, placements naming it; version 6, and the one
// conversion from version 5.
import { widthsOnLines } from './old-files'
import { describe, it, expect } from 'vitest'
import { Core, save, open, Refusal, type ReferenceInput } from '../src'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
const img = (id: string, view: string, more: Partial<ReferenceInput> = {}): ReferenceInput => ({ id, view, src: PNG, width: 40, height: 20, x: 0, y: 0, scale: 1, angle: 0, opacity: 0.5, visible: true, ...more })
const code = (f: () => void) => { try { f() } catch (x) { return x instanceof Refusal ? x.code : (x as Error).message } return 'no refusal' }
function doc() {
  const d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => e.line('ab', { id: 'a', layer: 'L', position: { x: 0, y: 0 } }, { id: 'b', layer: 'L', position: { x: 10, y: 0 } }))
  return d
}
const VIEWS = ['view:0,0', 'view:-90,0', 'view:90,0', 'view:0,45', 'view:0,-45', 'view:-90,45', 'view:-90,-45', 'view:90,45', 'view:90,-45']
const all = (d: Core) => VIEWS.flatMap(v => d.in(v).references())
/** A version-5 file of the same drawing: every picture inline, no library. */
function asV5(text: string): string {
  const f = widthsOnLines(JSON.parse(text)) as ReturnType<typeof JSON.parse>, lib = new Map<string, string>(f.document.reference.library.map((a: { id: string; src: string }) => [a.id, a.src]))
  f.version = 5
  f.document.reference = { images: f.document.reference.images.map(({ asset, ...rest }: { asset: string }) => ({ ...rest, src: lib.get(asset) })) }
  return JSON.stringify(f)
}
const withoutReference = (text: string) => { const f = JSON.parse(text); delete f.document.reference; delete f.version; return JSON.stringify(f) }

describe('the library', () => {
  it('the same content placed twice is stored once; each placement keeps its own size; library() counts placements and views apart', () => {
    const d = doc()
    d.editIn('view:0,0', e => e.placeReference(img('r1', 'view:0,0')))
    d.editIn('view:-90,0', e => e.placeReference(img('r2', 'view:-90,0', { width: 80, height: 10, visible: false })))
    d.editIn('view:-90,0', e => e.placeReference(img('r3', 'view:-90,0')))
    expect(d.library()).toEqual([{ id: 'r1', name: 'r1', src: PNG, width: 40, height: 20, placements: 3, views: 2 }])
    expect(all(d).map(r => [r.id, r.asset, r.width, r.height, r.src === PNG])).toEqual([['r1', 'r1', 40, 20, true], ['r2', 'r1', 80, 10, true], ['r3', 'r1', 40, 20, true]])
    expect(JSON.parse(save(d)).document.reference.library).toHaveLength(1)
  })

  it('addAsset: an identical content returns the entry already there; a taken id with other content is refused; placing by asset takes its default size', () => {
    const d = doc()
    let a = '', b = ''
    d.edit(e => { a = e.addAsset({ id: 'sheet', name: '参考', src: PNG, width: 30, height: 30 }); b = e.addAsset({ id: 'other', name: 'x', src: PNG, width: 5, height: 5 }) })
    expect([a, b, d.library().length]).toEqual(['sheet', 'sheet', 1])
    expect(code(() => d.edit(e => e.addAsset({ id: 'sheet', name: 'y', src: WEBP, width: 1, height: 1 })))).toBe('reference-exists')
    d.edit(e => e.placeReference({ id: 'p', view: 'view:0,0', asset: 'sheet', x: 0, y: 0, scale: 1, angle: 0, opacity: 1, visible: true }))
    expect(d.in('view:0,0').references()[0]).toMatchObject({ asset: 'sheet', width: 30, height: 30, src: PNG })
    expect(code(() => d.edit(e => e.placeReference({ id: 'q', view: 'view:0,0', asset: 'nope', x: 0, y: 0, scale: 1, angle: 0, opacity: 1, visible: true })))).toBe('reference-unknown-asset')
    expect(code(() => d.edit(e => e.placeReference({ ...img('q', 'view:0,0'), asset: 'sheet' })))).toBe('reference-bad-value') // both
    const { src: _, ...neither } = img('q', 'view:0,0')
    expect(code(() => d.edit(e => e.placeReference(neither)))).toBe('reference-bad-value')
  })

  it('removeAsset is refused while any placement shows it — one hidden picture in another view is enough; unused, it goes; undo brings it back', () => {
    const d = doc()
    d.editIn('view:90,45', e => e.placeReference(img('r1', 'view:90,45', { visible: false })))
    expect(code(() => d.edit(e => e.removeAsset('r1')))).toBe('reference-asset-in-use')
    d.editIn('view:90,45', e => e.removeReference('r1'))
    expect(d.library()).toMatchObject([{ id: 'r1', placements: 0, views: 0 }]) // removing the picture keeps its library entry
    d.edit(e => e.removeAsset('r1'))
    expect(d.library()).toEqual([])
    d.undo()
    expect(d.library().map(a => a.id)).toEqual(['r1'])
    expect(code(() => d.edit(e => e.removeAsset('nope')))).toBe('reference-unknown')
  })

  it('an image removed, then another content placed under the same image id: a new entry with a fresh id, the old one kept (dot 1791727297)', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('r1', 'view:0,0')))
    d.edit(e => e.removeReference('r1'))
    d.edit(e => e.placeReference(img('r1', 'view:0,0', { src: WEBP })))
    expect(d.library().map(a => [a.id, a.src === WEBP, a.placements])).toEqual([['r1', false, 0], ['r1~2', true, 1]])
    expect(d.in('view:0,0').references()[0]).toMatchObject({ id: 'r1', asset: 'r1~2', src: WEBP })
    expect(open(save(d)).library().map(a => a.id)).toEqual(['r1', 'r1~2'])
  })

  it('renameAsset: a string of at most 100 characters; an unused entry survives save → open', () => {
    const d = doc()
    d.edit(e => e.addAsset({ id: 'sheet', name: 'a', src: PNG, width: 3, height: 3 }))
    d.edit(e => e.renameAsset('sheet', '正面参考'))
    expect(code(() => d.edit(e => e.renameAsset('sheet', 'x'.repeat(101))))).toBe('reference-bad-value')
    expect(open(save(d)).library()).toEqual([{ id: 'sheet', name: '正面参考', src: PNG, width: 3, height: 3, placements: 0, views: 0 }])
  })

  it('read copies: changing what library() or references() returned reaches nothing', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('r1', 'view:0,0')))
    ;(d.library()[0] as { name: string }).name = 'changed'
    ;(d.in('view:0,0').references()[0] as { src: string }).src = 'changed'
    expect([d.library()[0]!.name, d.in('view:0,0').references()[0]!.src]).toEqual(['r1', PNG])
  })
})

describe('opening a version-6 file: every reference checked (dot 1791725888)', () => {
  const base = () => { const d = doc(); d.edit(e => { e.placeReference(img('r1', 'view:0,0')); e.addAsset({ id: 'w', name: 'w', src: WEBP, width: 2, height: 2 }) }); return JSON.parse(save(d)) }
  const bad: [string, (f: { document: { reference: { images: Record<string, unknown>[]; library: Record<string, unknown>[] } } }) => void, RegExp][] = [
    ['an inline src', f => { f.document.reference.images[0]!.src = PNG }, /holds its picture inline/],
    ['both src and asset', f => { f.document.reference.images[0]!.src = PNG }, /inline/],
    ['neither', f => { delete f.document.reference.images[0]!.asset }, /must name its picture by asset/],
    ['asset empty', f => { f.document.reference.images[0]!.asset = '' }, /must name its picture by asset/],
    ['asset not a string', f => { f.document.reference.images[0]!.asset = 7 }, /must name its picture by asset/],
    ['a dangling asset', f => { f.document.reference.images[0]!.asset = 'gone' }, /reference-unknown-asset/],
    ['no own size', f => { delete f.document.reference.images[0]!.width }, /own width and height/],
    ['two entries with one id', f => { f.document.reference.library[1]!.id = 'r1' }, /two library pictures are named r1/],
    ['two entries with one content', f => { f.document.reference.library[1]!.src = PNG }, /hold the same picture/],
    ['a bad entry', f => { f.document.reference.library[1]!.width = 0 }, /reference-bad-size/],
    ['no library', f => { delete (f.document.reference as { library?: unknown }).library }, /library must be a list/],
  ]
  for (const [name, change, why] of bad) it(name, () => {
    const f = base(); change(f)
    expect(() => open(JSON.stringify(f))).toThrow(why)
  })
})

describe('the one conversion, version 5 → 6 (bowen 1791726456)', () => {
  it('nine views with the same inline sheet: one library entry, every placement, mirror and slot unchanged, the rest of the drawing unchanged, about one picture saved', () => {
    const d = doc()
    VIEWS.forEach((v, k) => d.editIn(v, e => e.placeReference(img(`r${k}`, v, { x: k * 10, y: 0 - k, scale: 1 + k / 10, angle: k, flipped: v.startsWith('view:90'), slots: [{ name: `s${k}`, placement: { x: k, y: k, scale: 2, angle: 0 } }] }))))
    const v6 = save(d), v5 = asV5(v6)
    expect(JSON.parse(v5).document.reference.images.filter((i: { src?: string }) => i.src === PNG)).toHaveLength(9)
    const c = open(v5)
    expect(c.library()).toEqual([{ id: 'r0', name: 'r0', src: PNG, width: 40, height: 20, placements: 9, views: 9 }])
    expect(all(c)).toEqual(all(d))
    expect(withoutReference(save(c))).toBe(withoutReference(v6))
    expect(save(c)).toBe(v6)
    expect(save(c).split(PNG).length - 1).toBe(1)
  })

  it('one content at different sizes: one entry, each placement drawn at its own size exactly as before (dot 1791725852)', () => {
    const d = doc()
    d.editIn('view:0,0', e => e.placeReference(img('big', 'view:0,0', { width: 100, height: 50 })))
    d.editIn('view:-90,0', e => e.placeReference(img('small', 'view:-90,0', { width: 30, height: 90 })))
    const c = open(asV5(save(d)))
    expect(c.library()).toMatchObject([{ id: 'big', width: 100, height: 50, placements: 2 }])
    expect(all(c).map(r => [r.id, r.width, r.height, r.width * r.scale, r.height * r.scale])).toEqual([['big', 100, 50, 100, 50], ['small', 30, 90, 30, 90]])
  })

  it('long image ids (no limit in version 5) open: the first image\'s id kept whole as the entry id, only its shown name cut to 100; a later image of the same content with a long id reuses it (dot 1791727284)', () => {
    const d = doc(), long1 = 'a'.repeat(101), long2 = 'b'.repeat(250)
    d.editIn('view:0,0', e => e.placeReference(img(long1, 'view:0,0')))
    d.editIn('view:90,0', e => e.placeReference(img(long2, 'view:90,0')))
    const c = open(asV5(save(d)))
    expect(c.library()).toMatchObject([{ id: long1, name: 'a'.repeat(100), placements: 2, views: 2 }])
    expect(all(c).map(r => [r.id.length, r.asset === long1])).toEqual([[101, true], [250, true]])
  })

  it('a version-5 file that fails today\'s checks still fails; a version-5 image naming an asset is refused; version 4 stays refused', () => {
    const d = doc()
    d.edit(e => e.placeReference(img('r1', 'view:0,0')))
    const v5 = JSON.parse(asV5(save(d)))
    const badSrc = structuredClone(v5); badSrc.document.reference.images[0].src = 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD='
    expect(() => open(JSON.stringify(badSrc))).toThrow(/open-failed: reference: reference-bad-image/)
    const named = structuredClone(v5); named.document.reference.images[0].asset = 'r1'
    expect(() => open(JSON.stringify(named))).toThrow(/open-failed: reference: reference-bad-value/)
    const v4 = structuredClone(v5); v4.version = 4
    expect(() => open(JSON.stringify(v4))).toThrow(/unsupported version 4/)
    expect(open(JSON.stringify(v5)).in('view:0,0').references()).toEqual(d.in('view:0,0').references())
  })
})
