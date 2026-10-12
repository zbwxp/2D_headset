// J1b — the join list in the properties panel (docs/j1b-join-panel-checklist.md §5): a line's ends list
// their points' joins top first; mode, zone (自动 / 手动, the 限长后长度) and arc radius edit through the
// app; rows drag to reorder; a point shows its list; the canvas pick and a list click — the last wins;
// the Join tool offers 'bound'.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save, type Editor } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; edit(fn: (e: Editor) => void): void; refresh(): void; chooseView(k: string): void }
const bench = () => (window as unknown as { bench: B }).bench
const setValue = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
const key = (k: string, target: EventTarget) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))

/** A chain l1–l2 (bound at b), and a fork at p with lines f1, f2 (bound) and f3 joined to f1 as cusp (on top). */
async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const d = Core.newDocument({ layer: { id: 'A', name: 'A' } })
  const at = (id: string, x: number, y = 0) => ({ id, layer: 'A', position: { x, y } })
  d.edit(e => {
    e.line('l1', at('a', 0), at('b', 100)); e.line('l2', 'b', at('c', 200))
    e.line('f1', at('p0', 0, 200), at('p', 100, 200)); e.line('f2', 'p', at('p1', 200, 200)); e.line('f3', 'p', at('p2', 100, 300))
    e.join('p', 'f1', 'f3', { mode: 'cusp' })
  })
  const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
  const svg = host.querySelector('[data-testid="canvas"]') as SVGSVGElement
  ;(svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) })
  Object.defineProperty(svg, 'clientWidth', { value: 800 }); Object.defineProperty(svg, 'clientHeight', { value: 600 })
  await act(async () => { bench().chooseView('view:0,0') })
  const pe = (type: string, x: number, y: number, buttons: number) => { const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons }); Object.defineProperty(e, 'pointerId', { value: 1 }); return e }
  const press = async (x: number, y: number) => { await act(async () => { svg.dispatchEvent(pe('pointerdown', x, y, 1)); window.dispatchEvent(pe('pointerup', x, y, 0)) }) }
  const tool = async (k: string) => { await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) }) }
  const pick = async (kind: 'line' | 'point', id: string) => { await act(async () => { bench().edit(e => e.select([{ kind, id }])); bench().refresh() }) }
  const rows = (point: string) => [...host.querySelectorAll(`[data-join-list="${point}"] [data-join-row]`)] as HTMLElement[]
  const title = () => [...host.querySelectorAll('div')].find(x => x.title === '收起属性')?.textContent ?? ''
  const joinsAt = (p: string) => bench().core.snapshot().joins.filter(j => j.point === p).map(j => `${j.lines.join('↔')}:${j.mode}`)
  return { host, pick, rows, title, joinsAt, press, tool }
}

describe('the join list in the properties panel', () => {
  it('a line picked on the canvas: each shared end lists its point\'s joins, the governing one marked; a bound join\'s zone automatic', async () => {
    const t = await setup()
    await t.pick('line', 'l1')
    expect(t.title()).toMatch(/属性 线 · /)
    const r = t.rows('b')
    expect(r.map(x => x.dataset.joinRow)).toEqual(['l1↔l2'])
    expect(r[0]!.querySelector('[data-governing]')).not.toBeNull()
    expect((r[0]!.querySelector('[data-join-mode]') as HTMLSelectElement).value).toBe('bound')
    expect(t.host.querySelector('[data-join-zone-auto="l1↔l2"]')!.textContent).toBe('自动 1') // widths 1 and 1: 1² / 1
    expect(t.host.querySelector('[data-join-zone-limited="l1↔l2"]')!.textContent).toBe('限长后 1')
  })
  it('the mode changes in place; 手动 sets this view\'s zone, typed values commit with Enter, 自动 clears it; the order stays', async () => {
    const t = await setup()
    await t.pick('line', 'f2')
    expect(t.rows('p').map(x => x.dataset.joinRow)).toEqual(['f1↔f3', 'f1↔f2'])
    const mode = t.rows('p')[1]!.querySelector('[data-join-mode]') as HTMLSelectElement
    await act(async () => { mode.value = 'smooth'; mode.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(t.joinsAt('p')).toEqual(['f1↔f3:cusp', 'f1↔f2:smooth'])
    const manual = t.host.querySelector('[data-join-zone-manual="f1↔f2"]') as HTMLInputElement
    await act(async () => { manual.click() })
    expect(bench().core.snapshot().joins.find(j => j.lines.join() === 'f1,f2')?.zone).toBe(1)
    const field = t.host.querySelector('[data-join-zone="f1↔f2"]') as HTMLInputElement
    await act(async () => { setValue(field, '12'); key('Enter', field) })
    expect(bench().core.snapshot().joins.find(j => j.lines.join() === 'f1,f2')?.zone).toBe(12)
    expect(t.host.querySelector('[data-join-zone-limited="f1↔f2"]')!.textContent).toBe('限长后 12')
    expect(bench().core.in('view:90,0').snapshot().joins.find(j => j.lines.join() === 'f1,f2')?.zone).toBeUndefined()
    await act(async () => { (t.host.querySelector('[data-join-zone-manual="f1↔f2"]') as HTMLInputElement).click() })
    expect(bench().core.snapshot().joins.find(j => j.lines.join() === 'f1,f2')?.zone).toBeUndefined()
    expect(t.joinsAt('p')).toEqual(['f1↔f3:cusp', 'f1↔f2:smooth'])
  })
  it('a row dragged above another reorders the point\'s list in every view; the governing mark follows; undo restores', async () => {
    const t = await setup()
    await t.pick('line', 'f1')
    const [top, low] = t.rows('p')
    expect(top!.querySelector('[data-governing]')).not.toBeNull()
    await act(async () => { low!.dispatchEvent(new Event('dragstart', { bubbles: true })) })
    await act(async () => { top!.dispatchEvent(new Event('drop', { bubbles: true })) })
    expect(t.joinsAt('p')).toEqual(['f1↔f2:bound', 'f1↔f3:cusp'])
    expect(bench().core.in('view:90,0').snapshot().joins.filter(j => j.point === 'p').map(j => j.lines.join())).toEqual(['f1,f2', 'f1,f3'])
    expect(t.rows('p')[0]!.dataset.joinRow).toBe('f1↔f2')
    expect(t.rows('p')[0]!.querySelector('[data-governing]')).not.toBeNull()
    await act(async () => { ([...t.host.querySelectorAll('button')].find(b => b.textContent === 'Undo') as HTMLButtonElement).click() })
    expect(t.joinsAt('p')).toEqual(['f1↔f3:cusp', 'f1↔f2:bound'])
  })
  it('a point picked on the canvas shows its list; a later list click keeps the clicked item; the next canvas pick shows again', async () => {
    const t = await setup()
    await t.pick('point', 'p')
    expect(t.title()).toContain('点 · p')
    expect(t.rows('p')).toHaveLength(2)
    const layer = [...t.host.querySelectorAll('span[title="双击改名"]')].find(x => x.textContent === 'A') as HTMLElement
    await act(async () => { layer.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(t.title()).toContain('图层 · A')
    await act(async () => { bench().edit(e => e.moveHandle('l1', 'a', { x: 5, y: 5 })); bench().refresh() }) // a canvas change that is not a new pick
    expect(t.title()).toContain('图层 · A')
    await t.pick('line', 'l2')
    expect(t.title()).toMatch(/属性 线 · /)
  })
  it('a typed zone or radius not yet committed never lands in another view (dot 1791813754)', async () => {
    const t = await setup()
    await act(async () => {
      bench().edit(e => e.join('b', 'l1', 'l2', { mode: 'arc', radius: 5 }))
      for (const v of ['view:0,0', 'view:90,0']) bench().core.editIn(v, e => e.zone('b', 'l1', 'l2', 1))
      bench().refresh()
    })
    await t.pick('line', 'l1')
    const zoneOf = (v: string) => bench().core.in(v).snapshot().joins.find(j => j.point === 'b')!
    for (const [attr, read] of [['data-join-zone', (v: string) => zoneOf(v).zone], ['data-join-radius', (v: string) => zoneOf(v).radius]] as const) {
      const before = ['view:0,0', 'view:90,0'].map(read)
      const field = () => t.host.querySelector(`[${attr}="l1↔l2"]`) as HTMLInputElement
      await act(async () => { setValue(field(), '17') })
      await act(async () => { bench().chooseView('view:90,0') })
      await act(async () => { key('Enter', field()) })
      expect(['view:0,0', 'view:90,0'].map(read)).toEqual(before)
      await act(async () => { bench().chooseView('view:0,0') })
    }
  })
  it('a canvas press on the same point after a list click shows the point again (dot): every canvas pick counts', async () => {
    const t = await setup()
    await t.tool('a'); await t.press(100, 200)
    expect(t.title()).toContain('点 · p')
    const layer = [...t.host.querySelectorAll('span[title="双击改名"]')].find(x => x.textContent === 'A') as HTMLElement
    await act(async () => { layer.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(t.title()).toContain('图层 · A')
    await t.press(100, 200)
    expect(t.title()).toContain('点 · p')
    // a curve clicked in the list, then one of its lines picked on the canvas: the line shows
    await act(async () => { ([...t.host.querySelectorAll('svg title')].find(x => x.textContent === '展开全部图层')!.parentElement!).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const curveRow = ([...t.host.querySelectorAll('[title^="点击选中这条连续曲线"]')] as HTMLElement[]).find(r => r.textContent?.includes(bench().core.snapshot().groups.find(g => g.lines.includes('l1'))!.name))!
    await act(async () => { curveRow.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(t.title()).toContain('连续曲线 · ')
    await t.press(300, 400) // empty canvas: the curve's lines are deselected; not a pick
    expect(t.title()).toContain('连续曲线 · ')
    await t.press(50, 0) // l1, a line of that curve: a new pick wins over the curve the list showed
    expect(t.title()).toMatch(/属性 线 · /)
  })
  it('the line\'s width is set in its properties (bowen 1791814093): Enter commits, this view only; the left Set width with nothing selected says so', async () => {
    const t = await setup()
    await t.pick('line', 'l2')
    const field = t.host.querySelector('[data-line-width="l2"]') as HTMLInputElement
    await act(async () => { setValue(field, '6'); key('Enter', field) })
    expect(bench().core.snapshot().lines.find(l => l.id === 'l2')!.stroke.width).toBe(6)
    expect(bench().core.in('view:90,0').snapshot().lines.find(l => l.id === 'l2')!.stroke.width).toBe(1)
    await act(async () => { bench().edit(e => e.select([])); bench().refresh() })
    await act(async () => { ([...t.host.querySelectorAll('button')].find(b => b.textContent === 'Set width') as HTMLButtonElement).click() })
    expect(t.host.textContent).toContain('Set width: no line is selected')
  })
  it('a new width updates the automatic zone; the Join tool offers bound', async () => {
    const t = await setup()
    await t.pick('line', 'l1')
    await act(async () => { bench().edit(e => e.lineStroke('l2', { width: 4, profile: 'uniform' })); bench().refresh() })
    // l2's width sets its points, so both lines are 4 at b (widths at points, bowen 1791820396): 4² / 4 = 4
    expect(t.host.querySelector('[data-join-zone-auto="l1↔l2"]')!.textContent).toBe('自动 4')
    await act(async () => { (window as unknown as { bench: { ix: { setTool(t: string): void } } }).bench.ix.setTool('join'); bench().refresh() })
    const options = [...t.host.querySelectorAll('select option')].map(o => o.textContent)
    expect(options).toContain('bound')
  })
})
