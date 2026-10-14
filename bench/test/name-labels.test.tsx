// Name labels on the canvas (docs/name-labels-plan.md; bowen 1791731823; dot 1791732110): line names after A or
// a line row, curve names after V or a curve row; the kind changes only when A / V hit a line; the scoped
// selection; one display kind (undo and mixed selections take the last); the middle line by stored order.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; refresh(): void; chooseView(k: string): void }
const bench = () => (window as unknown as { bench: B }).bench
function pe(type: string, x: number, y: number, buttons: number, mods: { shiftKey?: boolean } = {}) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons, ...mods })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  return e
}
const key = (k: string, more: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...more }))

/** Layer A: a curve of four lines along y = 0 (x 0…400) and a curve of one line along y = 100; layer B: one line along y = 200. */
async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const d = Core.newDocument({ layer: { id: 'A', name: 'A' } })
  d.edit(e => {
    e.layer('B', 'B')
    const P = (id: string, x: number, y: number, layer = 'A') => ({ id, layer, position: { x, y } })
    e.line('l1', P('p0', 0, 0), P('p1', 100, 0)); e.line('l2', 'p1', P('p2', 200, 0)); e.line('l3', 'p2', P('p3', 300, 0)); e.line('l4', 'p3', P('p4', 400, 0))
    e.line('solo', P('s0', 0, 100), P('s1', 100, 100))
    e.line('other', P('o0', 0, 200, 'B'), P('o1', 100, 200, 'B'))
  })
  const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
  const svg = host.querySelector('[data-testid="canvas"]') as SVGSVGElement
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => { bench().chooseView('view:0,0') })
  // the scope starts at the layer the drawing opened on: choose layer A, where the curves are
  const layerRow = (name: string) => [...host.querySelectorAll('span[title="双击改名"]')].find(x => x.textContent === name)!
  await act(async () => { layerRow('A').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  const s = () => bench().core.snapshot()
  const name = (id: string) => s().lines.find(l => l.id === id)!.name
  const curve = (line: string) => s().groups.find(g => g.lines.includes(line))!
  const labels = () => [...host.querySelectorAll('[data-label]')].map(t => t.textContent)
  const press = async (x: number, y: number, mods: { shiftKey?: boolean } = {}) => { await act(async () => { svg.dispatchEvent(pe('pointerdown', x, y, 1, mods)); window.dispatchEvent(pe('pointerup', x, y, 0, mods)) }) }
  const tool = async (k: string) => { await act(async () => { key(k) }) }
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)! as HTMLButtonElement
  return { host, svg, s, name, curve, labels, press, tool, button, layerRow }
}

/** Playback at an in-between pose (yaw 20): read only there; at a view A / V edit it (docs/playback-edit-checklist.md §2). */
async function between(host: HTMLElement) {
  const el = host.querySelector('[data-testid="yaw-text"]') as HTMLInputElement
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '20'); el.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('name labels', () => {
  it('A on a line: its name beside it; V on the same, already selected line: the curve\'s name, at its middle line (the 2nd of 4, stored order)', async () => {
    const t = await setup()
    await t.tool('a'); await t.press(150, 0)
    expect(t.labels()).toEqual([t.name('l2')])
    await t.tool('v'); await t.press(150, 0)
    expect(t.labels()).toEqual([t.curve('l2').name])
    const label = t.host.querySelector('[data-label]')!
    expect(Number(label.getAttribute('x'))).toBeGreaterThan(150) // l2's middle (150, 0), offset up-right
    expect(Number(label.getAttribute('x'))).toBeLessThan(250)
    expect(label.getAttribute('pointer-events')).toBe('none')
  })

  it('a press on empty space (a marquee) keeps the kind; a viewport gesture keeps it', async () => {
    const t = await setup()
    await t.tool('v'); await t.press(50, 100)
    expect(t.labels()).toEqual([t.curve('solo').name])
    await t.tool('a'); await t.press(700, 500) // nothing there: a marquee, the selection cleared
    expect(t.labels()).toEqual([])
    await act(async () => { t.button('Undo').click() }) // the selection back; the kind is still curve
    expect(t.labels()).toEqual([t.curve('solo').name])
    await t.tool('z'); await t.press(10, 10); await t.tool('z')
    expect(t.labels()).toEqual([t.curve('solo').name])
  })

  it('A hitting a point is not a line hit: after V, an A Shift-click on an end point keeps the curve name; an A click on a point then undo keeps it too (dot 1791732824)', async () => {
    const t = await setup()
    await t.tool('v'); await t.press(50, 100)
    expect(t.labels()).toEqual([t.curve('solo').name])
    await t.tool('a'); await t.press(100, 100, { shiftKey: true }) // the end point s1, added
    expect(t.labels()).toEqual([t.curve('solo').name])
    await t.press(0, 100) // the end point s0 alone: no line selected, no label
    expect(t.labels()).toEqual([])
    await act(async () => { t.button('Undo').click() }) // back to the curve and s1: still the curve's name
    expect(t.labels()).toEqual([t.curve('solo').name])
  })

  it('A on X, then V on Y, then undo back to X: X is labelled with its curve\'s name (one display kind, a stated trade-off); a mixed selection takes the last kind', async () => {
    const t = await setup()
    await t.tool('a'); await t.press(50, 100)
    await t.tool('v'); await t.press(350, 0)
    await act(async () => { t.button('Undo').click() })
    expect(t.labels()).toEqual([t.curve('solo').name])
    await t.tool('a'); await t.press(50, 100)
    await t.tool('v'); await t.press(350, 0, { shiftKey: true }) // add the long curve with V
    expect(t.labels().sort()).toEqual([t.curve('l1').name, t.curve('solo').name].sort())
  })

  it('a line row / a curve row in the layers panel gives the line / curve name; renaming updates the label', async () => {
    const t = await setup()
    const row = (text: string) => [...t.host.querySelectorAll('[data-name]')].find(x => x.textContent === text)!
    // unfold layer A by its own row's twirl, if its curves are not listed yet
    const rowA = t.layerRow('A').closest('div[draggable]')!
    if (!row(t.curve('solo').name)) await act(async () => { [...rowA.querySelectorAll('svg > title')].find(x => x.textContent === '展开')!.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { row(t.curve('solo').name).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(t.labels()).toEqual([t.curve('solo').name])
    const curveRow = row(t.curve('solo').name).parentElement!
    await act(async () => { [...curveRow.querySelectorAll('svg > title')].find(x => x.textContent === '展开到每条线')!.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { row(t.name('solo')).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(t.labels()).toEqual([t.name('solo')])
    await act(async () => { (bench() as unknown as { edit(f: (e: import('../../src').Editor) => void): void }).edit(e => e.renameLine('solo', '下巴线')); bench().refresh() })
    expect(t.labels()).toEqual(['下巴线'])
  })

  it('a line selected outside the current layers (still in the raw selection) gets no label', async () => {
    const t = await setup(), layerRow = t.layerRow
    await act(async () => { layerRow('B').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await t.tool('a'); await t.press(50, 200)
    expect(t.labels()).toEqual([t.name('other')])
    await act(async () => { layerRow('A').dispatchEvent(new MouseEvent('click', { bubbles: true })) }) // scope: A only
    expect(bench().core.snapshot().selection.some(u => 'id' in u && u.id === 'other')).toBe(true)
    expect(t.labels()).toEqual([])
  })

  it('no labels in playback', async () => {
    const t = await setup()
    await t.tool('a'); await t.press(150, 0)
    await act(async () => { t.button('Playback').click() }); await between(t.host)
    expect(t.labels()).toEqual([])
  })
})
