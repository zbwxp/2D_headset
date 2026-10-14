// A second layer order for yaw < 0 (bowen 1791995249, 1791996722; docs/left-layer-order-checklist.md §4–5):
// the canvas and the layers panel follow the order of the view or pose on screen; the panel's drag writes that
// order; the note and the reset button; playback leaves the order alone; a drag across a side change is dropped.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save, type Editor } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
let n = 0
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; refresh(): void; chooseView(k: string): void; pose(): null | { yaw: number; pitch: number }; edit(fn: (e: Editor) => unknown): void }
const bench = () => (window as unknown as { bench: B }).bench

/** Layers 侧脸 (line s) below 左眼 (line e), both in every view; the bench's own layer-1 stays at the bottom. */
async function setup() {
  const k = ++n, Y = 300 * k
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const svg = host.querySelector('[data-testid="canvas"]')!
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  const [S, E, s, e] = [`side${k}`, `eye${k}`, `s${k}`, `e${k}`]
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(x => {
      x.layer(S, `侧脸${k}`); x.layer(E, `左眼${k}`, S)
      x.line(s, { id: `s1${k}`, layer: S, position: { x: 0, y: Y } }, { id: `s2${k}`, layer: S, position: { x: 80, y: Y } })
      x.line(e, { id: `e1${k}`, layer: E, position: { x: 10, y: Y } }, { id: `e2${k}`, layer: E, position: { x: 70, y: Y } })
    })
    bench().refresh()
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
  const type = async (id: string, v: string) => {
    const el = host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const view = async (key: string) => { await act(async () => { bench().chooseView(key) }) }
  const pose = async (yaw: number) => { await type('yaw-text', String(yaw)); await type('pitch-text', '0') }
  /** The two lines' ink, bottom first, as the canvas draws them. */
  const drawn = () => [...svg.querySelectorAll('[data-ink]')].map(x => x.getAttribute('data-ink')).filter(id => id === s || id === e)
  const panel = () => [...host.querySelectorAll('[data-layer-row]')].map(x => x.getAttribute('data-layer-row')).filter(id => id === S || id === E)
  const order = (key: string) => bench().core.in(key).snapshot().layers.map(l => l.id).filter(id => id === S || id === E)
  const note = () => host.querySelector('[data-testid="left-order-note"]')?.textContent ?? null
  const reset = () => host.querySelector('[data-testid="reset-left-order"]') as HTMLButtonElement | null
  const fire = (el: Element, t: string, clientY = 0) => act(async () => { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientY })) })
  const row = (id: string) => host.querySelector(`[data-layer-row="${id}"]`) as HTMLElement
  /** The panel lists top first: dropping 侧脸 on 左眼's upper half puts it above. */
  const sideAbove = async () => { await fire(row(S), 'dragstart'); await fire(row(E), 'dragover', -1); await fire(row(E), 'drop'); await fire(row(S), 'dragend') }
  return { host, S, E, s, e, button, view, pose, drawn, panel, order, note, reset, fire, row, sideAbove }
}

describe('the left layer order in the bench (docs/left-layer-order-checklist.md §4)', () => {
  it('a panel drag at view −90 moves the left order only; the canvas and the panel stack each side by its own order', async () => {
    const t = await setup()
    await t.view('view:-90,0')
    expect(t.note()).toContain('左转顺序（目前同右转）')
    expect(t.reset()!.disabled).toBe(true)
    await t.sideAbove()
    expect(t.order('view:-90,0')).toEqual([t.E, t.S])
    expect(t.order('view:-90,45')).toEqual([t.E, t.S])
    for (const k of ['view:0,0', 'view:90,0']) expect(t.order(k)).toEqual([t.S, t.E])
    expect(t.drawn()).toEqual([t.e, t.s]) // 侧脸 drawn over 左眼
    expect(t.panel()).toEqual([t.S, t.E]) // top first
    expect(t.note()).toContain('左转顺序（yaw < 0）')
    expect(t.reset()!.disabled).toBe(false)

    await t.view('view:90,0')
    expect(t.drawn()).toEqual([t.s, t.e])
    expect(t.panel()).toEqual([t.E, t.S])
    expect(t.note()).toBeNull()
    await t.view('view:0,0')
    expect(t.drawn()).toEqual([t.s, t.e])
    expect(t.note()).toBeNull()
  })

  it('playback at ±30 stacks by each side; the reset button is disabled there and the order stays', async () => {
    const t = await setup()
    await t.view('view:-90,0'); await t.sideAbove()
    await act(async () => { t.button('Playback').click() })
    await t.pose(-30)
    expect(bench().pose()).toEqual({ yaw: -30, pitch: 0 })
    expect(t.drawn()).toEqual([t.e, t.s])
    expect(t.panel()).toEqual([t.S, t.E])
    expect(t.note()).toContain('左转顺序（yaw < 0）')
    expect(t.reset()!.disabled).toBe(true)
    await act(async () => { t.reset()!.click() })
    expect(t.order('view:-90,0')).toEqual([t.E, t.S])
    await t.pose(30)
    expect(t.drawn()).toEqual([t.s, t.e])
    expect(t.panel()).toEqual([t.E, t.S])
    expect(t.note()).toBeNull()
    await t.pose(0)
    expect(t.drawn()).toEqual([t.s, t.e]) // yaw 0 uses today's order (bowen 1791996722: mine to fix)
  })

  it('the reset button drops the left order in one undo step', async () => {
    const t = await setup()
    await t.view('view:-90,0'); await t.sideAbove()
    await act(async () => { t.reset()!.click() })
    expect(t.order('view:-90,0')).toEqual([t.S, t.E])
    expect(t.drawn()).toEqual([t.s, t.e])
    expect(t.note()).toContain('左转顺序（目前同右转）')
    expect(t.reset()!.disabled).toBe(true)
    await act(async () => { t.button('Undo').click() })
    expect(t.order('view:-90,0')).toEqual([t.E, t.S])
    expect(t.drawn()).toEqual([t.e, t.s])
  })

  it('a drag begun at view −90 and dropped after a change to view 0 writes nothing on either side (dot 1791997825)', async () => {
    const t = await setup()
    await t.view('view:-90,0')
    const before = save(bench().core)
    await t.fire(t.row(t.S), 'dragstart')
    await t.view('view:0,0')
    await t.fire(t.row(t.E), 'dragover', -1)
    expect(t.row(t.E).dataset.drop).toBeUndefined()
    await t.fire(t.row(t.E), 'drop')
    for (const k of ['view:-90,0', 'view:0,0']) expect(t.order(k)).toEqual([t.S, t.E])
    expect(save(bench().core)).toBe(before)
    // and the other way: begun at view 0, dropped at view −90
    await t.fire(t.row(t.S), 'dragstart')
    await t.view('view:-90,0')
    await t.fire(t.row(t.E), 'dragover', -1); await t.fire(t.row(t.E), 'drop')
    for (const k of ['view:-90,0', 'view:0,0']) expect(t.order(k)).toEqual([t.S, t.E])
    expect(save(bench().core)).toBe(before)
  })
})
