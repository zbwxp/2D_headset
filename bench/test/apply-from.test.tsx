// 从视角应用 in the bench (bowen 1791878160; docs/apply-from-view-checklist.md §3): the button turns the nine
// view buttons into a picker; a pick applies that view's shapes of the selected layers to the current view.
import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt

type B = { core: Core; view(): string }
const bench = () => (window as unknown as { bench: B }).bench
const FRONT = 'view:0,0', SIDE = 'view:90,0'
const at = (k: string, p: string) => bench().core.in(k).snapshot().points.find(x => x.id === p)!.position

/** A drawing: layers A (line a1) and B (line b1); in the side view both moved away from the front. */
function drawing() {
  const d = Core.newDocument()
  d.edit(e => {
    for (const [i, L] of ['A', 'B'].entries()) { e.layer(L, L); e.line(`${L.toLowerCase()}1`, { id: `p${L}`, layer: L, position: { x: 0, y: 40 * i } }, { id: `q${L}`, layer: L, position: { x: 100, y: 40 * i } }) }
  })
  d.editIn(SIDE, e => e.move([{ id: 'qA', target: { x: 60, y: 30 } }, { id: 'qB', target: { x: 60, y: 90 } }]))
  return d
}
async function open(host: HTMLElement, d: Core) {
  const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 50)) })
}
/** The drawing opened, the side view shown, A selected. */
async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  await act(async () => { createRoot(host).render(<App />) })
  await open(host, drawing())
  const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await click(host.querySelector(`[data-view="${SIDE}"]`)!)
  await click([...host.querySelectorAll('span[title="双击改名"]')].find(x => x.textContent === 'A')!)
  const view = (k: string) => host.querySelector(`[data-view="${k}"]`) as HTMLButtonElement
  const button = () => host.querySelector('[data-testid="apply-from"]') as HTMLButtonElement
  return { host, click, view, button }
}

describe('从视角应用 (bowen 1791878160)', () => {
  it('pick the front while in the side view: the selected layer takes the front\'s shape there; the view stays; one undo step', async () => {
    const t = await setup()
    await t.click(t.button())
    expect(t.view(SIDE).disabled).toBe(true) // the current view cannot be picked
    await t.click(t.view(FRONT))
    expect(bench().view()).toBe(SIDE)
    expect(at(SIDE, 'qA')).toEqual(at(FRONT, 'qA'))
    expect(at(SIDE, 'qB')).toEqual({ x: 60, y: 90 }) // B was not selected
    expect(t.view(SIDE).disabled).toBe(false) // the picker closed
    await t.click([...t.host.querySelectorAll('button')].find(b => b.textContent === 'Undo')!)
    expect(at(SIDE, 'qA')).toEqual({ x: 60, y: 30 })
  })

  it('started, then another drawing opened: the picking ends there; a view button only shows that view, the new drawing unchanged (dot 1791879488)', async () => {
    const t = await setup()
    await t.click(t.button())
    await open(t.host, drawing())
    const before = JSON.stringify(bench().core.views().map(k => bench().core.in(k).snapshot()))
    await t.click(t.view(FRONT))
    expect(bench().view()).toBe(FRONT)
    expect(JSON.stringify(bench().core.views().map(k => bench().core.in(k).snapshot()))).toBe(before)
    expect(t.button().style.fontWeight).toBe('400')
  })

  it('Esc or the button again cancels: a view button then just shows that view', async () => {
    const t = await setup()
    await t.click(t.button())
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await t.click(t.view(FRONT))
    expect(bench().view()).toBe(FRONT)
    expect(at(SIDE, 'qA')).toEqual({ x: 60, y: 30 })
    await t.click(t.button()); await t.click(t.button())
    await t.click(t.view(SIDE))
    expect(bench().view()).toBe(SIDE)
    expect(at(SIDE, 'qA')).toEqual({ x: 60, y: 30 })
  })
})
