// Autosave in the bench (docs/autosave-plan.md; dot 1791704242, 1791704319): the stored drawing is
// restored on mount and every write entry is locked until then; a late restore after unmount changes
// nothing; a playback correction is saved, moving the sliders is not; leaving while unsaved asks.
// A store is injected (window.benchStore); the IndexedDB adapter is verified in a real browser.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save, open, type Editor } from '../../src'
import { App } from '../src/app'
import { resetPage, CURRENT, type Store } from '../../autosave'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }); delete (window as { benchStore?: Store }).benchStore; resetPage() })
type B = { core: Core; edit(fn: (e: Editor) => void): void; chooseView(k: string): void; pose(): unknown }
const bench = () => (window as unknown as { bench: B }).bench
let n = 0

/** A store holding `initial`; its read waits for `release()`, its writes are recorded and land at once. */
function memoryStore(initial?: string) {
  const data: Record<string, string> = initial === undefined ? {} : { [CURRENT]: initial }
  const writes: string[] = []
  let open!: () => void
  const gate = new Promise<void>(r => { open = r })
  const store: Store = { async get(k) { await gate; return data[k] }, async put(k, v) { writes.push(k); data[k] = v } }
  return { store, data, writes, release: async () => { await act(async () => { open(); await wait(10) }) } }
}
/** A drawing with one line, saved: what a refresh should bring back. */
function storedDrawing() {
  const k = ++n, d = Core.newDocument({ layer: { id: 'layer-1', name: 'L' } })
  d.edit(e => e.line(`s${k}`, { id: `sa${k}`, layer: 'layer-1', position: { x: 0, y: 0 } }, { id: `sb${k}`, layer: 'layer-1', position: { x: 100, y: 0 } }))
  d.editIn('view:90,0', e => e.move([{ id: `sb${k}`, target: { x: 60, y: 30 } }]))
  return { text: save(d), line: `s${k}`, a: `sa${k}`, b: `sb${k}` }
}
async function mount(store: Store) {
  ;(window as { benchStore?: Store }).benchStore = store
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  const status = () => host.querySelector('[data-testid="autosave"]')!.textContent!
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
  return { host, root, svg, status, button }
}

describe('autosave in the bench', () => {
  it('the stored drawing is restored on mount; until then nothing writes: logged edits, undo, tool keys, the canvas, Open', async () => {
    const st = storedDrawing(), m = memoryStore(st.text)
    const t = await mount(m.store)
    expect(t.status()).toBe('autosave: restoring…')
    const cursor = () => (t.host.querySelector('[data-testid="canvas"]') as SVGSVGElement).style.cursor
    expect(cursor()).toBe('default') // the canvas takes no press while restoring: the arrow, not the Pen (dot 1791710244)
    expect(() => bench().edit(e => e.line('x', { id: 'x1', layer: 'layer-1', position: { x: 1, y: 1 } }, { id: 'x2', layer: 'layer-1', position: { x: 9, y: 9 } }))).toThrow(/restoring/)
    const before = save(bench().core)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true })) })
    expect(save(bench().core)).toBe(before)
    expect((t.host.querySelector('[data-testid="open"]') as HTMLInputElement).closest('fieldset')!.disabled).toBe(true)
    const pe = (type: string, x: number, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 7, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: 1 }); return e }
    await act(async () => { for (const x of [-300, -250]) { t.svg.dispatchEvent(pe('pointerdown', x, 1)); window.dispatchEvent(pe('pointerup', x, 0)) } })
    expect(save(bench().core)).toBe(before) // the canvas takes no press while restoring
    await m.release()
    expect(bench().core.snapshot().lines.map(l => l.id)).toContain(st.line)
    expect(t.status()).toBe('autosave: saved')
    expect(m.writes).toEqual([]) // the restored text is already on disk
    expect(cursor()).toContain('data:image/svg+xml') // the Pen again
  })

  it('a version-5 record is restored converted (not backed up, not empty), then saved again in the current version, 7 (bowen 1791726456, 1791808493)', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const st = storedDrawing(), d = open(st.text)
    for (const v of ['view:0,0', 'view:90,0']) d.editIn(v, e => e.placeReference({ id: `${st.line}-${v}`, view: v, src: PNG, width: 40, height: 20, x: 3, y: 4, scale: 1, angle: 10, opacity: 0.5, visible: true, flipped: v === 'view:90,0' }))
    const f = JSON.parse(save(d)), lib = new Map(f.document.reference.library.map((a: { id: string; src: string }) => [a.id, a.src]))
    f.version = 5
    f.document.reference = { images: f.document.reference.images.map(({ asset, ...rest }: { asset: string }) => ({ ...rest, src: lib.get(asset) })) }
    const m = memoryStore(JSON.stringify(f))
    const t = await mount(m.store)
    await m.release()
    expect(t.status()).toBe('autosave: saved')
    expect(m.writes.filter(k => k.startsWith('unreadable'))).toEqual([]) // never backed up as unreadable
    expect(bench().core.snapshot().lines.map(l => l.id)).toContain(st.line)
    expect(['view:0,0', 'view:90,0'].flatMap(v => bench().core.in(v).references())).toEqual(['view:0,0', 'view:90,0'].flatMap(v => d.in(v).references()))
    expect(JSON.parse(m.data[CURRENT]!).version).toBe(7) // the record is replaced only after the converted drawing is open
  })

  it('a restore returning after the App unmounted applies nothing', async () => {
    const st = storedDrawing(), m = memoryStore(st.text)
    const t = await mount(m.store)
    await act(async () => { t.root.unmount() })
    await m.release()
    resetPage()
    await mount(memoryStore().store) // a fresh App; the module's drawing must not hold the stored line
    expect(bench().core.snapshot().lines.map(l => l.id)).not.toContain(st.line)
  })

  it('a correction made in playback is saved; moving the sliders alone writes nothing', async () => {
    const st = storedDrawing(), m = memoryStore(st.text)
    const t = await mount(m.store)
    await m.release()
    await act(async () => { t.button('Playback').click() })
    const yaw = t.host.querySelector('[data-testid="yaw-text"]') as HTMLInputElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(yaw, '45'); yaw.dispatchEvent(new Event('input', { bubbles: true })); await wait(10) })
    expect(m.writes).toEqual([])
    await act(async () => { bench().edit(e => e.correct({ yaw: 45, pitch: 0 }, { points: [{ id: st.b, position: { x: 90, y: 20 } }] })); await wait(10) })
    expect(m.writes).toEqual([CURRENT])
    expect(m.data[CURRENT]).toBe(save(bench().core))
  })

  it('leaving while a write has not landed asks; once saved it does not', async () => {
    const st = storedDrawing()
    const data: Record<string, string> = { [CURRENT]: st.text }
    let land!: () => void
    const store: Store = { async get(k) { return data[k] }, put(k, v) { return new Promise<void>(r => { land = () => { data[k] = v; r() } }) } }
    await mount(store)
    await act(async () => { await wait(10) })
    await act(async () => { bench().edit(e => e.move([{ id: st.a, target: { x: 5, y: 5 } }])); await wait(10) })
    const ask = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }
    expect(ask()).toBe(true)
    await act(async () => { land(); await wait(10) })
    expect(ask()).toBe(false)
  })
})
