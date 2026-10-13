// Picking follows what is drawn, in the bench (docs/mask-p3-checklist.md §3): a wide line with only half left is hit on
// the half that is drawn (dot 1791907560); near the cut, the remaining ink's reach counts; the switch off, or the source
// fill off, picks by geometry again.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
const bench = () => (window as unknown as { bench: { core: Core; refresh(): void; edit(fn: (e: Parameters<Parameters<Core['edit']>[0]>[0]) => void): void } }).bench
const pe = (type: string, x: number, y: number, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: 1 }); return e }

/** Layer B: a filled square x 0..100, y −1..100; layer A (current): line x from (−50, 0) to (150, 0), 10 wide, masked by the square (inverse). */
async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const d = Core.newDocument()
  d.edit(e => {
    e.layer('B', 'B'); e.layer('A', 'A')
    const P = (id: string, layer: string, x: number, y: number) => ({ id, layer, position: { x, y } })
    e.line('s1', P('q1', 'B', 0, -1), P('q2', 'B', 100, -1)); e.line('s2', 'q2', P('q3', 'B', 100, 100)); e.line('s3', 'q3', P('q4', 'B', 0, 100)); e.line('s4', 'q4', 'q1')
    e.line('x', P('a', 'A', -50, 0), P('b', 'A', 150, 0))
  })
  d.edit(e => { e.pointWidth('a', 10); e.pointWidth('b', 10) })
  const sq = d.snapshot().loops[0]!.id
  d.edit(e => { e.fill(sq, '#ccc'); e.mask('m', [sq], { kind: 'line', id: 'x' }, 'inverse') })
  const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 50)) })
  // these cases start with the 蒙版 switch off and turn it on themselves (it is on by default)
  { const m = host.querySelector('[data-testid="masks"]') as HTMLInputElement; if (m.checked) await act(async () => { m.click() }) }
  const svg = host.querySelector('[data-testid="canvas"]') as SVGSVGElement
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true })) })
  const [, , w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number)
  const reach = 8 * Math.max(w! / 900, h! / 600) // the line reach in drawing units (the bench's px, jsdom's 900 × 600)
  const click = async (x: number, y: number) => { await act(async () => { svg.dispatchEvent(pe('pointerdown', x, y, 1)); window.dispatchEvent(pe('pointerup', x, y, 0)) }) }
  const picked = () => bench().core.snapshot().selection.map(u => ('id' in u ? u.id : ''))
  const toggle = async () => { await act(async () => { (host.querySelector('[data-testid="masks"]') as HTMLInputElement).click() }) }
  return { host, sq, reach, click, picked, toggle }
}

describe('picking follows the masks (蒙版 on)', () => {
  it('a wide line with only half left: hit on the drawn half, even where its centre is cut (dot 1791907560)', async () => {
    const t = await setup()
    expect(t.reach).toBeGreaterThan(2) // the cases below need the reach to cover the centre
    await t.toggle()
    await t.click(50, -3) // the centre point nearest (50, 0) is cut; the ink below y = −1 is under the pointer
    expect(t.picked()).toEqual(['x'])
  })

  it('near the cut: within reach of the remaining ink it hits, beyond it it does not; with 蒙版 off it hits by geometry', async () => {
    const t = await setup()
    await t.toggle()
    await t.click(50, -1 + t.reach / 2)
    expect(t.picked()).toEqual(['x'])
    await t.click(50, t.reach - 0.5) // the centre within reach, the remaining ink (y ≤ −1) beyond it
    expect(t.picked()).toEqual([])
    await t.toggle()
    await t.click(50, t.reach - 0.5)
    expect(t.picked()).toEqual(['x'])
  })

  it('outside the source the line is hit as always; the source fill turned off makes the hidden part pickable again', async () => {
    const t = await setup()
    await t.toggle()
    await t.click(120, 3)
    expect(t.picked()).toEqual(['x'])
    await t.click(50, t.reach - 0.5)
    expect(t.picked()).toEqual([])
    await act(async () => { bench().core.edit(e => e.fillVisible(t.sq, false)); bench().refresh() })
    await t.click(50, t.reach - 0.5)
    expect(t.picked()).toEqual(['x'])
  })

  it('the same view, the source reshaped or switched by an edit: the next click uses the new cut, never the old one (dot 1791907635)', async () => {
    const t = await setup()
    await t.toggle()
    await t.click(80, t.reach - 0.5)
    expect(t.picked()).toEqual([]) // inside the square: cut
    // a write with no render after it (bench.edit does not refresh): the old cut is dropped, never used
    await act(async () => { bench().edit(e => e.move([{ id: 'q2', target: { x: 60, y: -1 } }, { id: 'q3', target: { x: 60, y: 100 } }])) })
    await t.click(80, t.reach - 0.5)
    expect(t.picked()).toEqual(['x']) // the square now ends at 60
    await act(async () => { bench().edit(e => e.move([{ id: 'q2', target: { x: 100, y: -1 } }, { id: 'q3', target: { x: 100, y: 100 } }])); bench().refresh() })
    await t.click(80, t.reach - 0.5)
    expect(t.picked()).toEqual([]) // rendered again: the new (restored) cut
    await act(async () => { bench().edit(e => e.fillVisible(t.sq, false)); bench().refresh() })
    await t.click(80, t.reach - 0.5)
    expect(t.picked()).toEqual(['x'])
  })
})
