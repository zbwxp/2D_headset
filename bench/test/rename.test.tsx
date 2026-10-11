// rename/ (bowen 1791708333; docs/rename-and-cursor-plan.md §1): one way to rename — double-click, Enter or
// leaving the field commits once, Esc cancels; used by layers, continuous curves, lines and slots.
import { describe, it, expect } from 'vitest'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'
import { Rename } from '../../rename'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const bench = () => (window as unknown as { bench: { core: Core; edit(fn: (e: import('../../src').Editor) => void): void; refresh(): void } }).bench
const setValue = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
const fire = (el: Element, type: string) => el.dispatchEvent(new MouseEvent(type, { bubbles: true }))
const keyOn = (el: EventTarget, k: string, meta = false, composing = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, metaKey: meta, isComposing: composing, bubbles: true }))

/** The component alone, with a name that follows its own state, as a document would. */
async function alone(initial = 'eye') {
  const host = document.createElement('div'); document.body.appendChild(host)
  const calls: string[] = [], clicks: number[] = []
  let setName!: (n: string) => void
  function Host() { const [n, set] = useState(initial); setName = set; return <div onClick={() => clicks.push(1)}><Rename name={n} onRename={x => { calls.push(x); set(x) }} /></div> }
  await act(async () => { createRoot(host).render(<Host />) })
  const span = () => host.querySelector('[data-name]')
  const input = () => host.querySelector('[data-rename]') as HTMLInputElement | null
  const edit = async () => { await act(async () => { fire(span()!, 'dblclick') }) }
  return { host, calls, clicks, span, input, edit, setName: async (n: string) => { await act(async () => { setName(n) }) } }
}

describe('the Rename component', () => {
  it('double-click edits with the name; Enter commits once, the trimmed name, even if a blur follows', async () => {
    const t = await alone()
    await t.edit()
    expect(t.input()!.value).toBe('eye')
    const f = t.input()!
    // the blur arrives before React has removed the field (as a browser may send it on Enter)
    await act(async () => { setValue(f, '  left eye '); keyOn(f, 'Enter'); f.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect([t.calls, t.input(), t.span()!.textContent]).toEqual([['left eye'], null, 'left eye'])
  })

  it('leaving the field commits; Esc cancels; empty and unchanged commit nothing', async () => {
    const t = await alone()
    await t.edit(); await act(async () => { setValue(t.input()!, 'a'); t.input()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(t.calls).toEqual(['a'])
    await t.edit(); await act(async () => { setValue(t.input()!, 'b'); keyOn(t.input()!, 'Escape') })
    await t.edit(); await act(async () => { setValue(t.input()!, '   '); keyOn(t.input()!, 'Enter') })
    await t.edit(); await act(async () => { keyOn(t.input()!, 'Enter') })
    expect([t.calls, t.span()!.textContent]).toEqual([['a'], 'a'])
  })

  it('a single click does not edit and reaches the row; a click inside the field does not', async () => {
    const t = await alone()
    await act(async () => { fire(t.span()!, 'click') })
    expect([t.input(), t.clicks.length]).toEqual([null, 1])
    await t.edit()
    const before = t.clicks.length
    await act(async () => { fire(t.input()!, 'click') })
    expect(t.clicks.length).toBe(before)
  })

  it('the Enter that picks a word in an input method does not commit; the next Enter does', async () => {
    const t = await alone()
    await t.edit()
    await act(async () => { setValue(t.input()!, '眼睛'); keyOn(t.input()!, 'Enter', false, true) })
    expect([t.calls, !!t.input()]).toEqual([[], true])
    await act(async () => { keyOn(t.input()!, 'Enter') })
    expect(t.calls).toEqual(['眼睛'])
  })

  it('Esc followed by a blur commits nothing', async () => {
    const t = await alone()
    await t.edit()
    const f = t.input()!
    await act(async () => { setValue(f, 'x'); keyOn(f, 'Escape'); f.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect([t.calls, t.span()!.textContent]).toEqual([[], 'eye'])
  })

  it('the name changing under the edit (an undo) drops the edit: the field closes and a later Enter or blur writes nothing (dot 1791708548)', async () => {
    const t = await alone()
    await t.edit()
    const f = t.input()!
    await act(async () => { setValue(f, 'typed') })
    await t.setName('changed by undo')
    expect([t.input(), t.span()!.textContent]).toEqual([null, 'changed by undo'])
    await act(async () => { keyOn(f, 'Enter'); f.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(t.calls).toEqual([])
  })

  it('the row removed during an edit (object deleted, drawing replaced): a blur the browser sends while removing the field writes nothing', async () => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const calls: string[] = []
    let show!: (b: boolean) => void
    function Host() { const [on, set] = useState(true); show = set; return <div>{on && <div><Rename name="eye" onRename={x => calls.push(x)} /></div>}</div> }
    await act(async () => { createRoot(host).render(<Host />) })
    await act(async () => { fire(host.querySelector('[data-name]')!, 'dblclick') })
    const f = host.querySelector('[data-rename]') as HTMLInputElement
    await act(async () => { setValue(f, 'stale') })
    // as Chrome does: removing a focused field sends it a blur during the removal
    const real = Node.prototype.removeChild
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T { if (child instanceof Element && child.contains(f)) f.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); return real.call(this, child) as T }
    try { await act(async () => { show(false) }) } finally { Node.prototype.removeChild = real }
    expect(calls).toEqual([])
  })

  it('the name shown follows the data (an undo after a rename shows the old name)', async () => {
    const t = await alone()
    await t.edit(); await act(async () => { setValue(t.input()!, 'new'); keyOn(t.input()!, 'Enter') })
    await t.setName('eye')
    expect(t.span()!.textContent).toBe('eye')
  })
})

/** The App with one layer holding two curves of one line each; the layer and its first curve unfolded. */
async function panel() {
  const host = document.createElement('div'); document.body.appendChild(host)
  await act(async () => { createRoot(host).render(<App />) })
  const d = Core.newDocument({ layer: { id: 'L', name: 'face' } })
  d.edit(e => {
    e.line('l1', { id: 'a1', layer: 'L', position: { x: 0, y: 0 } }, { id: 'b1', layer: 'L', position: { x: 100, y: 0 } })
    e.line('l2', { id: 'a2', layer: 'L', position: { x: 0, y: 50 } }, { id: 'b2', layer: 'L', position: { x: 100, y: 50 } })
  })
  const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 50)) })
  const s = () => bench().core.snapshot()
  const icons = (t: string) => [...host.querySelectorAll('svg > title')].filter(x => x.textContent === t).map(x => x.parentElement!)
  if (!icons('展开到每条线').length) await act(async () => { fire(icons('展开')[0]!, 'click') }) // an opened drawing may show its layers unfolded already
  const g1 = s().groups.find(g => g.lines.includes('l1'))!
  await act(async () => { fire(icons('展开到每条线')[s().groups.findIndex(g => g.id === g1.id)]!, 'click') })
  const names = () => [...host.querySelectorAll('[data-name]')]
  const named = (text: string) => names().find(x => x.textContent === text)!
  const rename = async (from: string, to: string) => {
    await act(async () => { fire(named(from), 'dblclick') })
    await act(async () => { const f = host.querySelector('[data-rename]') as HTMLInputElement; setValue(f, to); keyOn(f, 'Enter') })
  }
  return { host, s, g1, named, names, rename }
}

describe('renaming in the layers panel', () => {
  it('a continuous curve and a line are renamed by double-click on their rows; each undoes in one step', async () => {
    const t = await panel()
    const line1 = t.s().lines.find(l => l.id === 'l1')!
    await t.rename(t.g1.name, '上眼睑')
    expect(t.s().groups.find(g => g.id === t.g1.id)!.name).toBe('上眼睑')
    await t.rename(line1.name, '上眼睑外')
    expect(t.s().lines.find(l => l.id === 'l1')!.name).toBe('上眼睑外')
    expect(t.named('上眼睑外')).toBeTruthy()
    await act(async () => { keyOn(window, 'z', true) })
    expect([t.s().lines.find(l => l.id === 'l1')!.name, t.s().groups.find(g => g.id === t.g1.id)!.name]).toEqual([line1.name, '上眼睑'])
    expect(t.named(line1.name)).toBeTruthy()
  })

  it('a taken name is refused by core and the old name stays', async () => {
    const t = await panel()
    const other = t.s().groups.find(g => g.id !== t.g1.id)!
    await t.rename(t.g1.name, other.name)
    expect(t.s().groups.find(g => g.id === t.g1.id)!.name).toBe(t.g1.name)
  })

  it('a click on a curve name still selects it; the layer is renamed the same way', async () => {
    const t = await panel()
    await act(async () => { fire(t.named(t.g1.name), 'click') })
    expect(t.named(t.g1.name).getAttribute('style')).toMatch(/143, 180, 255|#8fb4ff/)
    await t.rename('face', 'head')
    expect(t.s().layers[0]!.name).toBe('head')
  })

  it('keys typed in the field never reach the tool shortcuts', async () => {
    const t = await panel()
    const tool = () => t.host.textContent!.match(/tool (\w+)/)![1]
    const before = tool()
    await act(async () => { fire(t.named(t.g1.name), 'dblclick') })
    const f = t.host.querySelector('[data-rename]') as HTMLInputElement
    await act(async () => { for (const k of ['v', 'a', 'f', 'z', 'Delete']) keyOn(f, k); keyOn(f, 'z', true) })
    expect([tool(), t.s().groups.map(g => g.name), !!t.host.querySelector('[data-rename]')]).toEqual([before, ['连续曲线1', '连续曲线2'], true])
  })

  it('a taken name: core refuses it and the refusal is shown in the log', async () => {
    const t = await panel()
    const other = t.s().groups.find(g => g.id !== t.g1.id)!
    await t.rename(t.g1.name, other.name)
    expect(t.host.textContent).toMatch(/✗[^✓]*renameGroup|renameGroup[^✓]*✗/)
  })

  it('another drawing opened during an edit: the edit is dropped, nothing is written to the same id in the new drawing (dot 1791708548)', async () => {
    const t = await panel()
    await act(async () => { fire(t.named(t.g1.name), 'dblclick') })
    const f = t.host.querySelector('[data-rename]') as HTMLInputElement
    await act(async () => { setValue(f, 'stale') })
    const d = Core.newDocument({ layer: { id: 'L', name: 'face' } })
    d.edit(e => e.line('l1', { id: 'a1', layer: 'L', position: { x: 0, y: 0 } }, { id: 'b1', layer: 'L', position: { x: 9, y: 9 } }))
    const input = t.host.querySelector('[data-testid="open"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File([save(d)], 'other.json')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 50)) })
    await act(async () => { keyOn(f, 'Enter'); f.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect([t.host.querySelector('[data-rename]'), t.s().groups.map(g => g.name)]).toEqual([null, d.snapshot().groups.map(g => g.name)])
  })

  it('the object deleted during an edit: the edit is dropped and nothing is written', async () => {
    const t = await panel()
    await act(async () => { fire(t.named(t.g1.name), 'dblclick') })
    const f = t.host.querySelector('[data-rename]') as HTMLInputElement
    await act(async () => { setValue(f, 'stale') })
    await act(async () => { bench().edit(e => e.deleteLine('l1')); bench().refresh() })
    const log = t.host.textContent
    await act(async () => { keyOn(f, 'Enter'); f.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect([t.host.querySelector('[data-rename]'), t.host.textContent === log, t.s().groups.some(g => g.name === 'stale')]).toEqual([null, true, false])
  })

  it('the old Rename line / Rename curve buttons are gone: one way to rename', async () => {
    const t = await panel()
    expect([...t.host.querySelectorAll('button')].map(b => b.textContent).filter(x => /^Rename/.test(x ?? ''))).toEqual([])
  })
})
