// Masks package 1 in the bench (docs/mask-p1-checklist.md §3): the 蒙版（实验） switch draws the temporary relations;
// a source fill turned off turns its mask off (bowen 1791901604).
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
type Mask = { sources: string[]; target: { kind: 'line' | 'fill'; id: string }; mode: 'inverse' | 'normal' }
const bench = () => (window as unknown as { bench: { core: Core; refresh(): void; setMasks(ms: Mask[]): void } }).bench

/** Layer B: a filled square (0..100); layer A: a line x across it, from -50 to 150. */
async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const d = Core.newDocument()
  d.edit(e => {
    e.layer('B', 'B'); e.layer('A', 'A')
    const P = (id: string, x: number, y: number) => ({ id, layer: 'B', position: { x, y } })
    e.line('s1', P('q1', 0, 0), P('q2', 100, 0)); e.line('s2', 'q2', P('q3', 100, 100)); e.line('s3', 'q3', P('q4', 0, 100)); e.line('s4', 'q4', 'q1')
    e.line('x', { id: 'a', layer: 'A', position: { x: -50, y: 50 } }, { id: 'b', layer: 'A', position: { x: 150, y: 50 } })
  })
  const loop = d.snapshot().loops[0]!.id
  d.edit(e => e.fill(loop, '#ccc'))
  const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 50)) })
  const fillId = bench().core.snapshot().loops[0]!.id
  await act(async () => { bench().setMasks([{ sources: [fillId], target: { kind: 'line', id: 'x' }, mode: 'inverse' }]) })
  const ink = () => host.querySelector('[data-ink="x"]')?.getAttribute('d') ?? ''
  const xs = () => [...ink().matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]))
  /** The outline's loops: one for the whole line; two once the square's inside is cut out. */
  const loops = () => (ink().match(/M/g) ?? []).length
  return { host, ink, xs, loops, fillId }
}

describe('蒙版（实验） in the bench (masks package 1)', () => {
  it('off: the line drawn whole; on: none of it inside the filled square', async () => {
    const t = await setup()
    expect(t.loops()).toBe(1)
    await act(async () => { (t.host.querySelector('[data-testid="masks"]') as HTMLInputElement).click() })
    expect(t.loops()).toBe(2)
    expect(t.xs().some(x => x > 1 && x < 99)).toBe(false) // nothing inside the square
    expect(t.xs().some(x => x < -10) && t.xs().some(x => x > 110)).toBe(true) // the parts outside stay
  })
  it('the source fill turned off turns the mask off (bowen 1791901604)', async () => {
    const t = await setup()
    await act(async () => { (t.host.querySelector('[data-testid="masks"]') as HTMLInputElement).click() })
    expect(t.loops()).toBe(2)
    await act(async () => { bench().core.edit(e => e.fillVisible(t.fillId, false)); bench().refresh() })
    expect(t.loops()).toBe(1)
  })

  it('a line wholly inside: drawn as nothing — never its uncut stroke (dot 1791902445)', async () => {
    const t = await setup()
    await act(async () => { bench().core.edit(e => e.move([{ id: 'a', target: { x: 20, y: 50 } }, { id: 'b', target: { x: 80, y: 50 } }])); bench().refresh() })
    await act(async () => { (t.host.querySelector('[data-testid="masks"]') as HTMLInputElement).click() })
    expect(t.host.querySelector('[data-ink="x"]')).not.toBeNull() // its ink is drawn — as nothing
    expect(t.ink()).toBe('')
  })
  it('the source changing shape updates the cut at once (dot 1791902445)', async () => {
    const t = await setup()
    await act(async () => { (t.host.querySelector('[data-testid="masks"]') as HTMLInputElement).click() })
    const before = t.ink()
    await act(async () => { bench().core.edit(e => e.move([{ id: 'q2', target: { x: 60, y: 0 } }, { id: 'q3', target: { x: 60, y: 100 } }])); bench().refresh() })
    expect(t.ink()).not.toBe(before)
    expect(t.xs().some(x => Math.abs(x - 60) < 0.5)).toBe(true) // the square now ends at 60: the cut follows it
    expect(t.xs().some(x => Math.abs(x - 100) < 0.5)).toBe(false)
  })
  it('with 墨迹轮廓 off the 蒙版 switch is disabled and says why (dot 1791902445)', async () => {
    const t = await setup()
    await act(async () => { (t.host.querySelector('[data-testid="masks"]') as HTMLInputElement).click() })
    await act(async () => { (t.host.querySelector('[data-testid="ink-outline"]') as HTMLInputElement).click() })
    const box = t.host.querySelector('[data-testid="masks"]') as HTMLInputElement
    expect([box.disabled, box.checked, box.parentElement!.textContent!.includes('需要墨迹轮廓')]).toEqual([true, false, true])
  })
})
