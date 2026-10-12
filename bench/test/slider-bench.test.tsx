// The one slider in the bench (docs/slider-plan.md; bowen 1791769016, 1791769065, 1791769257; dot 1791769272,
// 1791769298, 1791769582, 1791770098): the picture's five sliders — one write per held run, typing, slide or bar
// click; accepted as core accepts; an open field ended by its own ending before another input begins; the stroke
// width and the join radius as fields only; no native range input left.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Core, save } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const pending: (() => void)[] = []
class StubImage { width = 0; height = 0; onload: null | (() => void) = null; onerror: null | (() => void) = null
  set src(_: string) { pending.push(() => { this.width = 400; this.height = 300; this.onload?.() }) } }
const realImage = globalThis.Image
beforeEach(() => { pending.length = 0; (globalThis as { Image: unknown }).Image = StubImage })
const roots: { unmount(): void }[] = []
afterEach(async () => { (globalThis as { Image: unknown }).Image = realImage; await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; chooseView(k: string): void; ix: { setTool(t: string): void; setOptions(o: object): void; options(): { radius: number } }; refresh(): void }
const bench = () => (window as unknown as { bench: B }).bench
const setValue = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
const kd = (target: EventTarget, k: string, more: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...more }))
const ku = (target: EventTarget, k: string) => target.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }))
const focusOut = (el: Element) => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
/** A press on a slider's bar at `v` (its range from the thumb, the bar given a 100 px rect); `release` ends it. */
function slideAt(thumb: Element, v: number) {
  const bar = thumb.parentElement as HTMLElement, lo = Number(thumb.getAttribute('aria-valuemin')), hi = Number(thumb.getAttribute('aria-valuemax'))
  bar.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 4, right: 100, bottom: 4, x: 0, y: 0, toJSON() {} }) as DOMRect
  const x = (v - lo) / (hi - lo) * 100, ev = (type: string, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: 1 }); return e }
  bar.dispatchEvent(ev('pointerdown', 1))
  return { release: () => window.dispatchEvent(ev('pointerup', 0)) }
}

async function setup(pictures = 1) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  await act(async () => { bench().chooseView('view:0,0') })
  const pics = () => bench().core.in('view:0,0').references()
  const already = new Set(pics().map(r => r.id))
  for (let i = 0; i < pictures; i++) {
    const input = host.querySelector('[data-testid="ref-file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File([Uint8Array.from(atob(PNG), c => c.charCodeAt(0))], `f${i}.png`, { type: 'image/png' })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(30) })
    await act(async () => { pending.shift()!() })
  }
  const ids = pics().map(r => r.id).filter(id => !already.has(id)) // the bench's core is shared between tests: only this test's pictures
  const pic = (i = 0) => pics().find(r => r.id === ids[i])!
  const field = (k: string, i = 0) => host.querySelector(`[data-ref="${ids[i]}"] [data-field="${k}"]`) as HTMLInputElement
  const thumb = (k: string, i = 0) => host.querySelector(`[data-ref="${ids[i]}"] [data-slider="${k}"]`) as HTMLElement
  const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)! as HTMLButtonElement
  const undos = () => { let n = 0; const c = bench().core; const text = save(c); while (c.canUndo) { c.undo(); n++ } for (let i = 0; i < n; i++) c.redo(); expect(save(c)).toBe(text); return n }
  return { host, pic, field, thumb, button, undos }
}

describe('the picture\'s sliders', () => {
  it('a held arrow on the focused thumb is one setReference, one undo step; typing + Enter one; a slide one; a bar click one; Esc none', async () => {
    const t = await setup()
    const start = t.undos()
    await act(async () => { t.thumb('angle').focus(); kd(t.thumb('angle'), 'ArrowRight'); kd(t.thumb('angle'), 'ArrowRight', { repeat: true }); kd(t.thumb('angle'), 'ArrowRight', { shiftKey: true }) })
    expect([t.pic().angle, t.undos()]).toEqual([0, start]) // nothing written while held
    await act(async () => { ku(t.thumb('angle'), 'ArrowRight') })
    expect([t.pic().angle, t.undos()]).toEqual([12, start + 1])
    await act(async () => { setValue(t.field('y'), '40'); kd(t.field('y'), 'Enter'); focusOut(t.field('y')) })
    expect([t.pic().y, t.undos()]).toEqual([40, start + 2])
    let s!: { release(): void }
    await act(async () => { s = slideAt(t.thumb('opacity'), 0.3) })
    await act(async () => { s.release() })
    expect([t.pic().opacity, t.undos()]).toEqual([0.3, start + 3])
    await act(async () => { t.thumb('angle').focus(); kd(t.thumb('angle'), 'ArrowLeft'); kd(t.thumb('angle'), 'Escape'); ku(t.thumb('angle'), 'ArrowLeft') })
    expect([t.pic().angle, t.undos()]).toEqual([12, start + 3])
  })

  it('accepted as before: x typed off screen and angle 400 are written; scale 0 and opacity 2 are refused (red, nothing written)', async () => {
    const t = await setup()
    await act(async () => { setValue(t.field('x'), '-99999'); kd(t.field('x'), 'Enter') })
    await act(async () => { setValue(t.field('angle'), '400'); kd(t.field('angle'), 'Enter') })
    const text = save(bench().core)
    await act(async () => { setValue(t.field('scale'), '0') })
    expect(t.field('scale').style.borderColor).toBe('rgb(204, 0, 0)')
    await act(async () => { kd(t.field('scale'), 'Enter'); setValue(t.field('opacity'), '2') })
    expect(t.field('opacity').style.borderColor).toBe('rgb(204, 0, 0)')
    await act(async () => { kd(t.field('opacity'), 'Enter') })
    expect([t.pic().x, t.pic().angle, save(bench().core) === text]).toEqual([-99999, 400, true])
  })

  it('scale is a log slider: a key step multiplies by 10^0.01; a run back to the start writes nothing', async () => {
    const t = await setup()
    const s0 = t.pic().scale
    await act(async () => { t.thumb('scale').focus(); kd(t.thumb('scale'), 'ArrowUp'); ku(t.thumb('scale'), 'ArrowUp') })
    expect(t.pic().scale).toBeCloseTo(s0 * 10 ** 0.01, 12)
    const text = save(bench().core), s1 = t.pic().scale
    await act(async () => { kd(t.thumb('scale'), 'ArrowUp'); kd(t.thumb('scale'), 'ArrowDown'); ku(t.thumb('scale'), 'ArrowUp'); ku(t.thumb('scale'), 'ArrowDown') })
    expect([t.pic().scale, save(bench().core) === text]).toEqual([s1, true])
  })

  it('after a run ended by Undo, the next Undo undoes as usual (the run wrote nothing to undo)', async () => {
    const t = await setup()
    await act(async () => { setValue(t.field('x'), '10'); kd(t.field('x'), 'Enter') })
    await act(async () => { t.thumb('angle').focus(); kd(t.thumb('angle'), 'ArrowRight') })
    await act(async () => { t.button('Undo').click() }) // ends the run only
    await act(async () => { ku(t.thumb('angle'), 'ArrowRight') })
    expect([t.pic().x, t.pic().angle]).toEqual([10, 0])
    await act(async () => { t.button('Undo').click() })
    expect([t.pic().x, t.pic().angle]).toEqual([0, 0])
  })

  it('an open field ends by its own ending before another slider begins — its own typed value written, then the new slide — in both event orders, for the same picture and another', async () => {
    for (const other of [{ k: 'y', i: 0 }, { k: 'x', i: 1 }]) for (const order of ['press first', 'blur first'] as const) {
      const t = await setup(2)
      await act(async () => { setValue(t.field('x'), '25') }) // x open, previewing 25
      let s!: { release(): void }
      if (order === 'press first') {
        await act(async () => { s = slideAt(t.thumb(other.k, other.i), 50) })
        expect([order, other.i, t.pic(0).x]).toEqual([order, other.i, 25]) // the field ended (written) by the press, before the new slide's preview
        await act(async () => { focusOut(t.field('x')) }) // the browser's blur after the press
      } else {
        await act(async () => { focusOut(t.field('x')) })
        await act(async () => { s = slideAt(t.thumb(other.k, other.i), 50) })
      }
      await act(async () => { s.release() })
      const p = t.pic(other.i)
      expect([order, other.i, t.pic(0).x, (p as unknown as Record<string, number>)[other.k]]).toEqual([order, other.i, 25, 50])
    }
  })
})

describe('a thumb key run is a key run: blur, ⌘Z and the Undo / Redo buttons end it and undo nothing earlier (dot 1791771773)', () => {
  it('each ends the run with nothing written; the late key up writes nothing; the earlier history is intact', async () => {
    for (const how of ['blur', '⌘Z', 'Undo button', 'Redo button'] as const) {
      const t = await setup()
      await act(async () => { setValue(t.field('x'), '10'); kd(t.field('x'), 'Enter') }) // an earlier step to keep
      const kept = save(bench().core), depth = t.undos()
      await act(async () => { t.thumb('angle').focus(); kd(t.thumb('angle'), 'ArrowRight'); kd(t.thumb('angle'), 'ArrowRight', { repeat: true }) })
      expect([how, Number(t.thumb('angle').getAttribute('aria-valuenow'))]).toEqual([how, 2]) // the run is running: previewing 2
      await act(async () => {
        if (how === 'blur') window.dispatchEvent(new Event('blur'))
        else if (how === '⌘Z') kd(t.thumb('angle'), 'z', { metaKey: true })
        else t.button(how === 'Undo button' ? 'Undo' : 'Redo').click()
      })
      await act(async () => { kd(t.thumb('angle'), 'ArrowRight', { repeat: true }); ku(t.thumb('angle'), 'ArrowRight') })
      expect([how, save(bench().core) === kept, t.undos(), t.pic().x, t.pic().angle]).toEqual([how, true, depth, 10, 0])
      await act(async () => { for (const r of roots.splice(0)) r.unmount() }) // one App on the page: an earlier one's keys would act too
    }
  })
})

describe('fields only: the stroke width and the join radius (bowen 1791769257)', () => {
  it('width ↑ changes the field, not the selected lines, until "Set width" (dot 1791769298); radius ↑ sets the join option on leaving the field', async () => {
    const t = await setup(0)
    await act(async () => {
      bench().core.edit(e => e.line('w1', { id: 'w1a', layer: 'layer-1', position: { x: 0, y: 0 } }, { id: 'w1b', layer: 'layer-1', position: { x: 50, y: 0 } }))
      bench().core.edit(e => e.select([{ kind: 'line', id: 'w1' }])); bench().refresh()
    })
    const width = t.host.querySelector('[data-testid="width"]') as HTMLInputElement
    const w0 = bench().core.snapshot().lines.find(l => l.id === 'w1')!.stroke.width
    await act(async () => { width.focus(); kd(width, 'ArrowUp', { shiftKey: true }); ku(width, 'ArrowUp'); focusOut(width) })
    expect([width.value, bench().core.snapshot().lines.find(l => l.id === 'w1')!.stroke.width]).toEqual([String(Number(width.value)), w0])
    expect(Number(width.value)).toBe(12)
    await act(async () => { t.button('Set width').click() })
    expect(bench().core.snapshot().lines.find(l => l.id === 'w1')!.stroke.width).toBe(12)
    await act(async () => { bench().ix.setTool('join'); bench().ix.setOptions({ joinMode: 'arc' }); bench().refresh() })
    const radius = t.host.querySelector('[data-testid="radius"]') as HTMLInputElement
    const r0 = Number(radius.value)
    await act(async () => { radius.focus(); kd(radius, 'ArrowUp'); ku(radius, 'ArrowUp') })
    expect(bench().ix.options().radius).toBe(r0) // previewed in the field only
    await act(async () => { focusOut(radius) })
    expect(bench().ix.options().radius).toBe(r0 + 1)
  })
})

describe('the boundary', () => {
  it('no native range input is left in the bench: every slider is the module', () => {
    expect(readFileSync(join(__dirname, '..', 'src', 'app.tsx'), 'utf8')).not.toMatch(/type="range"/)
  })
})
