// Stage 3a, package 3 (docs/stage3a-playback-plan.md, "Bench playback mode"; dot 1791683911,
// 1791684079): the minimal playback screen. It shows Core.atPose and writes nothing: entering ends
// any gesture and unfinished operation; while posing, keys, the canvas and the panels write
// nothing; an Open read that returns during playback (or after a later Open) is dropped.
// Real App, real Core, real interaction; jsdom events.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
let n = 0
// every App of a test is unmounted after it: a mounted App listens on the window and would take keys and window.bench
/** A real click on a slider's bar at `v` (the bar given a 100 px rect): the jump is the slider's own change (docs/slider-plan.md). */
async function slideTo(thumb: Element, v: number, lo: number, hi: number) {
  const bar = thumb.parentElement as HTMLElement
  bar.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 4, right: 100, bottom: 4, x: 0, y: 0, toJSON() {} }) as DOMRect
  const x = (v - lo) / (hi - lo) * 100, ev = (type: string, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: 7 }); return e }
  await act(async () => { bar.dispatchEvent(ev('pointerdown', 1)); window.dispatchEvent(ev('pointerup', 0)) })
}
const valueOf = (thumb: Element) => thumb.getAttribute('aria-valuenow')
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; ix: { setTool(t: string): void; tool: string; preview(): { drag?: unknown } }; refresh(): void; chooseView(k: string): void; pose(): null | { yaw: number; pitch: number } }
const bench = () => (window as unknown as { bench: B }).bench

function pe(type: string, x: number, y: number, buttons: number) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  return e
}
async function setup() {
  const k = ++n
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => e.line(`v${k}`, { id: `p${k}`, layer: 'layer-1', position: { x: 0, y: 300 * k } }, { id: `q${k}`, layer: 'layer-1', position: { x: 100, y: 300 * k } }))
    bench().core.editIn('view:90,0', e => e.move([{ id: `q${k}`, target: { x: 60, y: 300 * k + 30 } }]))
    bench().ix.setTool('A'); bench().refresh()
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
  const slider = (id: 'yaw' | 'pitch') => host.querySelector(`[data-testid="${id}"]`) as HTMLElement
  const setSlider = async (id: 'yaw' | 'pitch', v: number) => { await slideTo(slider(id), v, id === 'yaw' ? -90 : -45, id === 'yaw' ? 90 : 45) }
  return { host, svg, k, root, button, slider, setSlider }
}
const state = () => ({ file: save(bench().core), undo: bench().core.canUndo, redo: bench().core.canRedo })
const curve = (view: string, id: string) => bench().core.in(view).geometry().lines.find(l => l.id === id)!.curve
const d = (c: readonly { x: number; y: number }[]) => `M${c[0]!.x},${c[0]!.y} C${c[1]!.x},${c[1]!.y} ${c[2]!.x},${c[2]!.y} ${c[3]!.x},${c[3]!.y}`

describe('bench playback', () => {
  it('the sliders draw the pose; at a grid angle the drawing is that view; between views it is atPose', async () => {
    const { svg, k, button, setSlider } = await setup()
    await act(async () => { button('Playback').click() })
    expect(bench().pose()).toEqual({ yaw: 0, pitch: 0 })
    await setSlider('yaw', 90)
    expect(svg.outerHTML).toContain(d(curve('view:90,0', `v${k}`)))
    await setSlider('yaw', 30); await setSlider('pitch', -15)
    const at = bench().core.atPose({ yaw: 30, pitch: -15 }).geometry().lines.find(l => l.id === `v${k}`)!.curve
    expect(svg.outerHTML).toContain(d(at))
    await act(async () => { button('Leave playback').click() })
    expect(bench().pose()).toBeNull()
  })

  it('entering playback during a drag, then a late release: nothing is committed and the drag is gone', async () => {
    const { svg, k, button } = await setup()
    const before = state()
    await act(async () => { svg.dispatchEvent(pe('pointerdown', 0, 300 * k, 1)); window.dispatchEvent(pe('pointermove', 20, 300 * k + 40, 1)) })
    expect(bench().ix.preview().drag).toBeDefined()
    await act(async () => { button('Playback').click() })
    await act(async () => { window.dispatchEvent(pe('pointerup', 20, 300 * k + 40, 0)) })
    expect(bench().ix.preview().drag).toBeUndefined()
    // the press before the drag selected the point (an edit); nothing after it was committed
    expect(bench().core.in('view:0,0').snapshot().points.find(p => p.id === `p${k}`)!.position).toEqual({ x: 0, y: 300 * k })
    expect(save(bench().core)).not.toContain(`"x":20,"y":${300 * k + 40}`)
    void before
    // the canvas takes no press while posing
    const s = state()
    await act(async () => { svg.dispatchEvent(pe('pointerdown', 0, 300 * k, 1)); window.dispatchEvent(pe('pointermove', 30, 300 * k, 1)); window.dispatchEvent(pe('pointerup', 30, 300 * k, 0)) })
    expect(state()).toEqual(s)
  })

  it('entering playback ends every unfinished operation in interaction, a pending cut included', async () => {
    const { svg, k, button } = await setup()
    await act(async () => { bench().ix.setTool('V'); bench().refresh() })
    await act(async () => { svg.dispatchEvent(pe('pointerdown', 50, 300 * k, 1)); window.dispatchEvent(pe('pointerup', 50, 300 * k, 0)) })
    await act(async () => { button('Cut').click() })
    expect((bench().ix.preview() as { cut: unknown[] }).cut.length).toBe(1)
    await act(async () => { button('Playback').click() })
    expect((bench().ix.preview() as { cut: unknown[] }).cut).toEqual([])
    await act(async () => { button('Leave playback').click() })
  })

  it('with a playback slider focused, Delete, ⌘V, ⌘Z, ⇧⌘Z and a tool key change nothing', async () => {
    const { button, slider } = await setup()
    await act(async () => { bench().core.edit(e => e.select([])); bench().refresh() })
    await act(async () => { button('Playback').click() })
    const s = state(), tool = bench().ix.tool
    slider('yaw').focus()
    for (const [key, mods] of [['Delete', {}], ['Backspace', {}], ['v', { metaKey: true }], ['z', { metaKey: true }], ['z', { metaKey: true, shiftKey: true }], ['p', {}], ['x', { metaKey: true }]] as const) {
      await act(async () => { slider('yaw').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...mods })) })
    }
    expect(state()).toEqual(s)
    expect(bench().ix.tool).toBe(tool)
  })

  it('the writing buttons and panels are disabled while posing; Save stays; a layers-panel command writes nothing', async () => {
    const { host, button } = await setup()
    await act(async () => { button('Playback').click() })
    // disabled through their fieldset: `.disabled` is the element's own attribute, `:disabled` the real state
    const labels = ['Undo', 'Redo', 'Delete', 'Paste', 'Broadcast shape', 'Broadcast stroke', 'Fit', 'Draft corners', 'Pen P', 'demo eyes']
    expect(labels.filter(label => !button(label).matches(':disabled'))).toEqual([])
    expect((host.querySelector('[data-testid="open"]') as HTMLInputElement).matches(':disabled')).toBe(true)
    expect([...host.querySelectorAll('[data-testid="views"] button')].every(b => b.matches(':disabled'))).toBe(true)
    expect(button('Save').matches(':disabled')).toBe(false)
    const s = state()
    // clicking them anyway changes nothing (and the logged Core refuses any edit or undo meanwhile)
    for (const label of labels) await act(async () => { button(label).click() })
    expect(state()).toEqual(s)
    // the layers panel's icons are not form controls: its commands go through run, which refuses
    const icon = [...host.querySelectorAll('svg > title')].find(x => x.textContent === '新建图层')!.parentElement!
    await act(async () => { icon.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(state()).toEqual(s)
  })

  it('each guard on its own: interaction\'s own calls are refused by the logged Core; a canvas press starts nothing; a pan in progress ends', async () => {
    const { host, svg, k, button } = await setup()
    // a selection and an undo step to work on
    await act(async () => { svg.dispatchEvent(pe('pointerdown', 0, 300 * k, 1)); window.dispatchEvent(pe('pointerup', 0, 300 * k, 0)) })
    await act(async () => { bench().ix.setTool('pen'); bench().refresh() })
    await act(async () => { button('Playback').click() })
    const s = state()
    // past the disabled buttons and the key handler: interaction's calls reach the logged Core, which writes nothing
    const ix = bench().ix as unknown as { deleteSelection(): void; undo(): void; redo(): void; paste(): void }
    for (const call of [() => ix.deleteSelection(), () => ix.undo(), () => ix.paste()]) {
      await act(async () => { call() })
      expect(state()).toEqual(s)
    }
    // a canvas press with the pen starts no chain
    await act(async () => { svg.dispatchEvent(pe('pointerdown', 500, 300 * k + 100, 1)); window.dispatchEvent(pe('pointerup', 500, 300 * k + 100, 0)) })
    await act(async () => { button('Leave playback').click() })
    expect((bench().ix.preview() as { pen?: unknown }).pen).toBeUndefined()
    // a right-button pan in progress when playback is entered ends there, back where it started
    const box = () => svg.getAttribute('viewBox')
    const start = box()
    const right = (type: string, x: number, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0, button: 2, buttons }); Object.defineProperty(e, 'pointerId', { value: 1 }); return e }
    await act(async () => { svg.dispatchEvent(right('pointerdown', 0, 2)); window.dispatchEvent(right('pointermove', 100, 2)) })
    expect(box()).not.toBe(start)
    await act(async () => { button('Playback').click() })
    await act(async () => { window.dispatchEvent(right('pointermove', 200, 2)); window.dispatchEvent(right('pointerup', 200, 0)) })
    expect(box()).toBe(start)
    await act(async () => { button('Leave playback').click() })
    void host
  })

  it('the read-only flag and the logged wrapper belong to each App: a second App mounting or unmounting leaves the first one read-only (dot 1791686247)', async () => {
    const a = await setup()
    await act(async () => { a.button('Playback').click() })
    const layers = () => bench().core.snapshot().layers.map(l => l.id)
    const newLayerIcon = (host: HTMLElement) => [...host.querySelectorAll('svg > title')].find(x => x.textContent === '新建图层')!.parentElement!
    // B mounts, editing: B edits; A, still posing, writes nothing through its own panel
    const b = await setup()
    await act(async () => { b.svg.dispatchEvent(pe('pointerdown', 0, 300 * b.k, 1)); window.dispatchEvent(pe('pointermove', 20, 300 * b.k + 40, 1)); window.dispatchEvent(pe('pointerup', 20, 300 * b.k + 40, 0)) })
    expect(bench().core.in('view:0,0').snapshot().points.find(p => p.id === `p${b.k}`)!.position).toEqual({ x: 20, y: 300 * b.k + 40 })
    const before = layers()
    await act(async () => { newLayerIcon(a.host).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(layers()).toEqual(before)
    // B unmounts: A is still read-only
    await act(async () => { b.root.unmount() })
    await act(async () => { newLayerIcon(a.host).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(layers()).toEqual(before)
    // and A, once it leaves playback, writes again
    await act(async () => { a.button('Leave playback').click() })
    await act(async () => { newLayerIcon(a.host).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(layers().length).toBe(before.length + 1)
  })

  it('no selection colour is drawn while posing: neither a selected line\'s nor a selected fill\'s (dot 1791686247)', async () => {
    const { svg, k, button } = await setup()
    await act(async () => {
      bench().core.edit(e => { e.line(`t${k}`, `q${k}`, { id: `r${k}`, layer: 'layer-1', position: { x: 50, y: 300 * k + 80 } }); e.line(`u${k}`, `r${k}`, `p${k}`) })
      const loop = bench().core.snapshot().loops.find(l => l.route.some(u => u.line === `t${k}`))!
      bench().core.edit(e => e.fill(loop.id, '#88cc88'))
      bench().core.edit(e => e.select([{ kind: 'line', id: `v${k}` }, { kind: 'fill', id: loop.id }]))
      bench().refresh()
    })
    expect(svg.outerHTML).toContain('stroke="#06f"')
    await act(async () => { button('Playback').click() })
    expect(svg.outerHTML).not.toContain('#06f')
    expect(svg.outerHTML).not.toContain('#2a7fff')
    await act(async () => { button('Leave playback').click() })
  })

  it('leaving playback, normal editing works again: a drag commits and undo undoes it', async () => {
    const { svg, k, button } = await setup()
    await act(async () => { button('Playback').click() })
    await act(async () => { button('Leave playback').click() })
    await act(async () => { svg.dispatchEvent(pe('pointerdown', 0, 300 * k, 1)); window.dispatchEvent(pe('pointermove', 20, 300 * k + 40, 1)); window.dispatchEvent(pe('pointerup', 20, 300 * k + 40, 0)) })
    expect(bench().core.in('view:0,0').snapshot().points.find(p => p.id === `p${k}`)!.position).toEqual({ x: 20, y: 300 * k + 40 })
    await act(async () => { button('Undo').click() })
    expect(bench().core.in('view:0,0').snapshot().points.find(p => p.id === `p${k}`)!.position).toEqual({ x: 0, y: 300 * k })
  })
})

describe('bench Open: a read that returns late (ledger row 8; dot 1791684079)', () => {
  /** A file whose read resolves only when told to. */
  function slowFile(text: string, name: string) {
    let resolve!: () => void
    const done = new Promise<void>(r => { resolve = r })
    return { file: { name, text: () => done.then(() => text) }, resolve }
  }
  async function startOpen(host: HTMLElement, f: { name: string }) {
    const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [f], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  }

  it('Open starts, playback is entered, the read returns: the drawing is not replaced and playback goes on', async () => {
    const { host, button } = await setup()
    const before = bench().core
    const other = Core.newDocument(); other.edit(e => e.layer('OTHER', 'OTHER'))
    const slow = slowFile(save(other), 'other.json')
    await startOpen(host, slow.file)
    await act(async () => { button('Playback').click() })
    await act(async () => { slow.resolve(); await wait(10) })
    expect(bench().core).toBe(before)
    expect(bench().pose()).not.toBeNull()
    await act(async () => { button('Leave playback').click() })
  })

  it('playback entered and left while the read is pending: the read is still dropped', async () => {
    const { host, button } = await setup()
    const before = bench().core
    const other = Core.newDocument(); other.edit(e => e.layer('OTHER', 'OTHER'))
    const slow = slowFile(save(other), 'other.json')
    await startOpen(host, slow.file)
    await act(async () => { button('Playback').click() })
    await act(async () => { button('Leave playback').click() })
    await act(async () => { slow.resolve(); await wait(10) })
    expect(bench().core).toBe(before)
  })

  it('two Opens whose reads return out of order: only the later one opens', async () => {
    const { host } = await setup()
    const a = Core.newDocument(); a.edit(e => e.layer('A', 'A'))
    const b = Core.newDocument(); b.edit(e => e.layer('B', 'B'))
    const first = slowFile(save(a), 'a.json'), second = slowFile(save(b), 'b.json')
    await startOpen(host, first.file)
    await startOpen(host, second.file)
    await act(async () => { second.resolve(); await wait(10) })
    expect(bench().core.snapshot().layers.map(l => l.id)).toContain('B')
    const opened = bench().core
    await act(async () => { first.resolve(); await wait(10) })
    expect(bench().core).toBe(opened)
  })
})
