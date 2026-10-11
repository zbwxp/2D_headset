// The picture library in the bench (docs/reference-images-plan.md §10; bowen 1791725516; dot 1791725888):
// the list, placing from it, adding without placing, removing an unused entry; every picture and library
// control acts through the one ending (bound at render, gesture cancelled, preview ended, values re-read).
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG = `data:image/png;base64,${B64}`, WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='
const pending: { done(w: number, h: number): void }[] = []
class StubImage { width = 0; height = 0; onload: null | (() => void) = null; onerror: null | (() => void) = null
  set src(_: string) { pending.push({ done: (w, h) => { this.width = w; this.height = h; this.onload?.() } }) } }
const realImage = globalThis.Image
beforeEach(() => { pending.length = 0; (globalThis as { Image: unknown }).Image = StubImage })
const roots: { unmount(): void }[] = []
afterEach(async () => { (globalThis as { Image: unknown }).Image = realImage; await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; chooseView(k: string): void }
const bench = () => (window as unknown as { bench: B }).bench
const setValue = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
const key = (k: string, target: EventTarget) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
let n = 0

/** A drawing: one sheet placed in three views (one hidden), a second picture in the library unplaced. */
function drawing(src = PNG) {
  const k = ++n, d = Core.newDocument({ layer: { id: 'L', name: 'L' } })
  d.edit(e => e.line(`l${k}`, { id: `a${k}`, layer: 'L', position: { x: 0, y: 0 } }, { id: `b${k}`, layer: 'L', position: { x: 10, y: 0 } }))
  const at = (id: string, view: string, visible = true) => ({ id, view, src, width: 400, height: 300, x: 0, y: 0, scale: 1, angle: 0, opacity: 0.5, visible, slots: [{ name: 's', placement: { x: 1, y: 1, scale: 1, angle: 0 } }] })
  d.editIn('view:0,0', e => e.placeReference(at(`p${k}`, 'view:0,0')))
  d.editIn('view:-90,0', e => e.placeReference(at(`q${k}`, 'view:-90,0', false)))
  d.editIn('view:90,0', e => e.placeReference(at(`r${k}`, 'view:90,0')))
  d.edit(e => e.addAsset({ id: `spare${k}`, name: 'spare', src: WEBP, width: 2, height: 2 }))
  return { d, k, sheet: `p${k}`, spare: `spare${k}` }
}
async function mount() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('svg')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  const openDoc = async (d: Core) => {
    const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
    await act(async () => { bench().chooseView('view:0,0') })
  }
  const row = (asset: string) => host.querySelector(`[data-asset="${asset}"]`)!
  const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll('button')].find(b => b.textContent === label)! as HTMLButtonElement
  const chooseFile = async (testid: string, bytes: Uint8Array, name: string, type = 'image/png') => {
    const input = host.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File([bytes], name, { type })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(30) })
  }
  return { host, root, svg, openDoc, row, button, chooseFile }
}
const lib = () => bench().core.library()
const pngBytes = () => Uint8Array.from(atob(B64), c => c.charCodeAt(0))

describe('the library list', () => {
  it('one row per picture with its use (placements · views, the hidden one counted); × only for the unused one, which it removes in one undo step', async () => {
    const t = await mount(), { d, sheet, spare } = drawing()
    await t.openDoc(d)
    expect([...t.host.querySelectorAll('[data-asset]')].map(r => r.getAttribute('data-asset'))).toEqual([sheet, spare])
    expect(t.row(sheet).querySelector('[data-uses]')!.textContent).toBe('3 · 3v')
    expect([t.button('×', t.row(sheet)).disabled, t.button('×', t.row(spare)).disabled]).toEqual([true, false])
    await act(async () => { t.button('×', t.row(spare)).click() })
    expect(lib().map(a => a.id)).toEqual([sheet])
    await act(async () => { t.button('Undo').click() })
    expect(lib().map(a => a.id)).toEqual([sheet, spare])
  })

  it('放到当前视角 places that picture into the view shown, by asset, one undo step', async () => {
    const t = await mount(), { d, spare } = drawing()
    await t.openDoc(d)
    await act(async () => { bench().chooseView('view:0,45') })
    await act(async () => { t.button('放到当前视角', t.row(spare)).click() })
    expect(bench().core.in('view:0,45').references()).toMatchObject([{ asset: spare, src: WEBP, width: 2, height: 2 }])
    await act(async () => { t.button('Undo').click() })
    expect(bench().core.in('view:0,45').references()).toEqual([])
  })

  it('＋ 加图片 adds without placing; an identical file adds nothing; Place… keeps the file name and reuses an identical picture', async () => {
    const t = await mount(), { d, sheet } = drawing()
    await t.openDoc(d)
    const placed = () => ['view:0,0', 'view:-90,0', 'view:90,0'].reduce((m, v) => m + bench().core.in(v).references().length, 0)
    await t.chooseFile('lib-file', pngBytes(), 'same.png')
    await act(async () => { pending.shift()!.done(400, 300) })
    expect([lib().length, placed()]).toEqual([2, 3]) // identical content: the sheet's entry, nothing added
    await t.chooseFile('ref-file', pngBytes(), 'again.png')
    await act(async () => { pending.shift()!.done(400, 300) })
    expect([lib().length, bench().core.in('view:0,0').references().at(-1)!.asset]).toEqual([2, sheet])
    const other = Uint8Array.from(atob(WEBP.split(',')[1]!), c => c.charCodeAt(0))
    await t.chooseFile('lib-file', other, 'new.webp')
    expect(pending.length).toBe(1)
  })

  it('a picture still being read when another drawing is opened is dropped', async () => {
    const t = await mount(), first = drawing()
    const second = Core.newDocument({ layer: { id: 'L', name: 'L' } }) // nothing in its library: the late picture would be new there
    await t.openDoc(first.d)
    await t.chooseFile('lib-file', Uint8Array.from(atob(WEBP.split(',')[1]!), c => c.charCodeAt(0)), 'late.webp', 'image/webp')
    await t.openDoc(second)
    const before = save(bench().core)
    await act(async () => { pending.shift()!.done(400, 300) })
    expect(save(bench().core)).toBe(before)
  })
})

describe('the one ending for every picture and library control (dot 1791725888, ledger row 16)', () => {
  it('an angle previewed, then 存: the slot saves the angle just written', async () => {
    const t = await mount(), { d, sheet } = drawing()
    await t.openDoc(d)
    const angle = t.host.querySelector(`[data-ref="${sheet}"] [data-field="angle"]`) as HTMLInputElement
    await act(async () => { setValue(angle, '33') }) // previewing
    await act(async () => { t.button('存', t.host.querySelector(`[data-ref="${sheet}"] [data-slots]`)!).click() })
    expect(bench().core.in('view:0,0').references()[0]).toMatchObject({ angle: 33, slots: [{ name: 's', placement: { angle: 33 } }] })
  })

  // each control of App A, drawn for A's drawing, clicked after App B opened a drawing with the same ids and another content
  const CONTROLS: [string, (t: Awaited<ReturnType<typeof mount>>, ids: ReturnType<typeof drawing>) => Element | (() => void)][] = [
    ['Remove', (t, x) => t.button('Remove', t.host.querySelector(`[data-ref="${x.sheet}"]`)!)],
    ['visibility', (t, x) => () => (t.host.querySelector(`[data-ref="${x.sheet}"] input[type="checkbox"]`) as HTMLInputElement).click()],
    ['存', (t, x) => t.button('存', t.host.querySelector(`[data-ref="${x.sheet}"]`)!)],
    ['slot ×', (t, x) => t.button('×', t.host.querySelector(`[data-ref="${x.sheet}"] [data-slot]`)!)],
    ['＋ 加一格', (t, x) => t.button('＋ 加一格', t.host.querySelector(`[data-ref="${x.sheet}"]`)!)],
    ['调出', (t, x) => t.button('调出', t.host.querySelector(`[data-ref="${x.sheet}"]`)!)],
    ['Mirror ⇆', (t, x) => t.button('Mirror ⇆', t.host.querySelector(`[data-ref="${x.sheet}"]`)!)],
    ['library 放到当前视角', (t, x) => t.button('放到当前视角', t.row(x.spare))],
    ['library ×', (t, x) => t.button('×', t.row(x.spare))],
  ]
  for (const [name, control] of CONTROLS) it(`${name}: a control drawn for another drawing changes nothing`, async () => {
    const a = await mount(), ids = drawing()
    await a.openDoc(ids.d)
    const old = control(a, ids)
    // App B opens a drawing whose pictures have the same ids and another content
    const other = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    // its slot holds a placement, so clearing or saving it would show; its picture is visible and unmirrored
    other.editIn('view:0,0', e => e.placeReference({ id: ids.sheet, view: 'view:0,0', src: WEBP, width: 400, height: 300, x: 0, y: 0, scale: 1, angle: 5, opacity: 0.5, visible: true, slots: [{ name: 's', placement: { x: 9, y: 9, scale: 2, angle: 1 } }] }))
    other.edit(e => e.addAsset({ id: ids.spare, name: 'spare', src: PNG, width: 2, height: 2 }))
    const b = await mount()
    await b.openDoc(other)
    const before = save(bench().core)
    await act(async () => { if (typeof old === 'function') old(); else (old as HTMLElement).click() })
    expect(save(bench().core)).toBe(before)
  })

  for (const [name, field] of [['slot rename', (t: Awaited<ReturnType<typeof mount>>, x: ReturnType<typeof drawing>) => t.host.querySelector(`[data-ref="${x.sheet}"] [data-slot] [data-name]`)!],
    ['library rename', (t: Awaited<ReturnType<typeof mount>>, x: ReturnType<typeof drawing>) => t.row(x.spare).querySelector('[data-name]')!]] as const) it(`${name}: an edit started before another drawing was opened writes nothing`, async () => {
    const a = await mount(), ids = drawing()
    await a.openDoc(ids.d)
    await act(async () => { field(a, ids).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    const f = a.host.querySelector('[data-rename]') as HTMLInputElement
    await act(async () => { setValue(f, 'stale') })
    const other = Core.newDocument({ layer: { id: 'L', name: 'L' } })
    other.editIn('view:0,0', e => e.placeReference({ id: ids.sheet, view: 'view:0,0', src: WEBP, width: 400, height: 300, x: 0, y: 0, scale: 1, angle: 0, opacity: 0.5, visible: true, slots: [{ name: 's', placement: null }] }))
    other.edit(e => e.addAsset({ id: ids.spare, name: 'spare', src: PNG, width: 2, height: 2 }))
    const b = await mount()
    await b.openDoc(other)
    const before = save(bench().core)
    await act(async () => { key('Enter', f) })
    expect(save(bench().core)).toBe(before)
  })

  it('a slot renamed and a library picture renamed through the same ending, each one undo step', async () => {
    const t = await mount(), { d, sheet, spare } = drawing()
    await t.openDoc(d)
    const rename = async (el: Element, to: string) => {
      await act(async () => { el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
      await act(async () => { const f = t.host.querySelector('[data-rename]') as HTMLInputElement; setValue(f, to); key('Enter', f) })
    }
    await rename(t.row(spare).querySelector('[data-name]')!, '侧面参考')
    await rename(t.host.querySelector(`[data-ref="${sheet}"] [data-slot] [data-name]`)!, '正面')
    expect([lib().find(a => a.id === spare)!.name, bench().core.in('view:0,0').references()[0]!.slots[0]!.name]).toEqual(['侧面参考', '正面'])
    await act(async () => { t.button('Undo').click() })
    expect(bench().core.in('view:0,0').references()[0]!.slots[0]!.name).toBe('s')
  })
})
