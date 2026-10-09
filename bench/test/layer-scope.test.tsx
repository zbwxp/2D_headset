// Selected layers in the panel and the scope they give the tools (bowen 1791555800;
// docs/layer-scope-plan.md §1, §3, §5). Real App, real Core, real interaction; jsdom events.
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt

type B = { core: Core; ix: { setTool(t: string): void; preview(): { points: string[] } }; refresh(): void; scope(): { layer: string; layers: string[] } }
const bench = () => (window as unknown as { bench: B }).bench

async function openDoc(host: HTMLElement, d: Core) {
  const input = host.querySelector('input[type=file]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 50)) })
}
/** Opens four layers bottom → top: A, B, C, D, one line in each; D (the top) is current. */
async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  await act(async () => { createRoot(host).render(<App />) })
  const d = Core.newDocument()
  d.edit(e => {
    for (const [i, L] of ['A', 'B', 'C', 'D'].entries()) {
      e.layer(L, L)
      e.line(`l${L}`, { id: `p${L}`, layer: L, position: { x: 0, y: 40 * i } }, { id: `q${L}`, layer: L, position: { x: 100, y: 40 * i } })
    }
  })
  await openDoc(host, d)
  return host
}
/** Click a layer row by its name, with modifiers. */
async function row(host: HTMLElement, name: string, mods: { shiftKey?: boolean; metaKey?: boolean } = {}) {
  const span = [...host.querySelectorAll('span[title="双击改名"]')].find(x => x.textContent === name)!
  await act(async () => { span.dispatchEvent(new MouseEvent('click', { bubbles: true, ...mods })) })
}
const scope = () => { const s = bench().scope(); return { current: s.layer, selected: [...s.layers].sort() } }

describe('the layers panel: click, Shift range, Cmd add / remove (bowen 1791555800; dot 1791555851)', () => {
  it('a plain click selects only that layer and makes it current', async () => {
    const host = await setup()
    await row(host, 'B')
    expect(scope()).toEqual({ current: 'B', selected: ['B'] })
  })

  it('Shift-click selects the run from the anchor, in either direction', async () => {
    const host = await setup()
    await row(host, 'B'); await row(host, 'D', { shiftKey: true })
    expect(scope()).toEqual({ current: 'D', selected: ['B', 'C', 'D'] })
    await row(host, 'A', { shiftKey: true }) // the anchor is still B
    expect(scope()).toEqual({ current: 'A', selected: ['A', 'B'] })
  })

  it('Cmd-click adds and removes one layer; removing the current hands over to the topmost left; the last one stays', async () => {
    const host = await setup()
    await row(host, 'B'); await row(host, 'D', { metaKey: true })
    expect(scope()).toEqual({ current: 'D', selected: ['B', 'D'] })
    await row(host, 'A', { metaKey: true })
    expect(scope()).toEqual({ current: 'A', selected: ['A', 'B', 'D'] })
    await row(host, 'A', { metaKey: true }) // remove the current: the topmost left, D, takes over
    expect(scope()).toEqual({ current: 'D', selected: ['B', 'D'] })
    await row(host, 'B', { metaKey: true }); await row(host, 'D', { metaKey: true }) // D is the only one: stays
    expect(scope()).toEqual({ current: 'D', selected: ['D'] })
  })

  it('a plain click after a multi-selection selects only that layer again', async () => {
    const host = await setup()
    await row(host, 'B'); await row(host, 'D', { shiftKey: true })
    await row(host, 'C')
    expect(scope()).toEqual({ current: 'C', selected: ['C'] })
  })
})

describe('the scope the selected layers give', () => {
  it('A draws exactly the points interaction lists, those of the selected layers', async () => {
    const host = await setup()
    await row(host, 'B'); await row(host, 'C', { metaKey: true })
    await act(async () => { bench().ix.setTool('A'); bench().refresh() })
    expect(bench().ix.preview().points.sort()).toEqual(['pB', 'pC', 'qB', 'qC'])
    // the view draws one circle per listed point
    expect(host.querySelectorAll('svg circle').length).toBe(4)
  })

  it('changing the selected layers deselects what is outside them, and keeps what is inside', async () => {
    const host = await setup()
    await row(host, 'B'); await row(host, 'C', { metaKey: true })
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: 'lB' }, { kind: 'line', id: 'lC' }])); bench().refresh() })
    await row(host, 'C')
    expect(bench().core.snapshot().selection).toEqual([{ kind: 'line', id: 'lC' }])
  })

  it('opening another drawing resets to one selected layer, its top one', async () => {
    const host = await setup()
    await row(host, 'B'); await row(host, 'D', { shiftKey: true })
    const other = Core.newDocument(); other.edit(e => { e.layer('X', 'X'); e.layer('Y', 'Y') })
    await openDoc(host, other)
    expect(scope()).toEqual({ current: 'Y', selected: ['Y'] })
  })
})
