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

  it('narrowing the selected layers leaves the selection elsewhere in core but inert: not shown, not acted on, no edit made', async () => {
    const host = await setup()
    await row(host, 'B'); await row(host, 'C', { metaKey: true })
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: 'lB' }, { kind: 'line', id: 'lC' }])); bench().refresh() })
    const undoable = bench().core.canUndo
    await row(host, 'C')
    expect(bench().core.snapshot().selection).toEqual([{ kind: 'line', id: 'lB' }, { kind: 'line', id: 'lC' }]) // no select edit
    expect(bench().core.canUndo).toBe(undoable)
    expect((bench().ix as unknown as { selection(): unknown[] }).selection()).toEqual([{ kind: 'line', id: 'lC' }])
  })

  it('A+B selected, focus narrowed to A, undo brings B back: drag, Delete, Flip, Rot, copy act on A only; redo stays (dot 1791556061)', async () => {
    const host = await setup()
    const core = () => bench().core, pos = (id: string) => core().snapshot().points.find(p => p.id === id)!.position
    await row(host, 'A'); await row(host, 'B', { metaKey: true })
    await act(async () => { core().edit(e => e.select([{ kind: 'line', id: 'lA' }, { kind: 'line', id: 'lB' }])); bench().refresh() })
    // an edit, then undo it: narrowing the focus afterwards makes no edit of its own, so redo stays
    await act(async () => { core().edit(e => e.translate(1, 0, [{ kind: 'line', id: 'lD' }])); core().undo(); bench().refresh() })
    await row(host, 'A')
    expect(core().canRedo).toBe(true)
    const pB = pos('pB'), qB = pos('qB')
    const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
    await act(async () => { button('Flip').click() })
    await act(async () => { button('Rot +15°').click() })
    expect([pos('pB'), pos('qB')]).toEqual([pB, qB])
    const ix = bench().ix as unknown as { copy(): void; paste(): void; deleteSelection(): void; setTool(t: string): void }
    await act(async () => { ix.copy(); ix.paste() })
    const pasted = core().snapshot().lines.filter(l => l.id.includes('/'))
    expect(pasted.map(l => l.id.split('/').pop())).toEqual(['lA'])
    await act(async () => { core().edit(e => e.select([{ kind: 'line', id: 'lA' }, { kind: 'line', id: 'lB' }])); ix.deleteSelection(); bench().refresh() })
    expect(core().snapshot().lines.some(l => l.id === 'lB')).toBe(true)
    expect(core().snapshot().lines.some(l => l.id === 'lA')).toBe(false)
  })

  it('opening another drawing resets to one selected layer, its top one', async () => {
    const host = await setup()
    await row(host, 'B'); await row(host, 'D', { shiftKey: true })
    const other = Core.newDocument(); other.edit(e => { e.layer('X', 'X'); e.layer('Y', 'Y') })
    await openDoc(host, other)
    expect(scope()).toEqual({ current: 'Y', selected: ['Y'] })
  })
})

describe('the panel header and line rows (bowen 1791557559, 1791557998)', () => {
  it('fills and fold act on every layer; a continuous curve opens to its lines, each showing width and both ends', async () => {
    const host = await setup()
    const icon = (title: string) => [...host.querySelectorAll('svg title')].find(t => t.textContent === title)!.parentElement!
    const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
    // fills of two layers, then one click hides them all
    await act(async () => {
      bench().core.edit(e => {
        for (const L of ['A', 'C']) { e.line(`t${L}`, `q${L}`, { id: `r${L}`, layer: L, position: { x: 50, y: 300 } }); e.line(`u${L}`, `r${L}`, `p${L}`) }
      })
      const loops = bench().core.snapshot().loops
      bench().core.edit(e => loops.forEach(l => e.fill(l.id, 'red')))
      bench().refresh()
    })
    expect(bench().core.snapshot().loops.filter(l => l.filled && l.visible)).toHaveLength(2)
    await click(icon('隐藏全部图层的填充'))
    expect(bench().core.snapshot().loops.filter(l => l.filled && l.visible)).toHaveLength(0)
    // fold all: every layer opens, then closes
    await click(icon('展开全部图层'))
    expect(host.querySelectorAll('[title^="点击选中这条连续曲线"]').length).toBe(4)
    // a continuous curve opens to one row per line, with what is attached to it
    await click(icon('展开到每条线'))
    const rows = [...host.querySelectorAll('[data-line]')]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]!.textContent).toMatch(/w\d.* a:.* b:/)
    await click(icon('收起全部图层'))
    expect(host.querySelectorAll('[title^="点击选中这条连续曲线"]').length).toBe(0)
  })
})

describe('panel rows pick curves and lines; the layer selection stays (bowen 1791558186)', () => {
  it('click, Cmd and Shift on curve rows select curves; layers selected do not change', async () => {
    const host = await setup()
    await act(async () => {
      bench().core.edit(e => { e.line('lA2', { id: 'xA', layer: 'A', position: { x: 0, y: 500 } }, { id: 'yA', layer: 'A', position: { x: 50, y: 500 } }); e.line('lA3', { id: 'zA', layer: 'A', position: { x: 0, y: 600 } }, { id: 'wA', layer: 'A', position: { x: 50, y: 600 } }) })
      bench().refresh()
    })
    await row(host, 'A')
    const icon = (title: string) => [...host.querySelectorAll('svg title')].find(t => t.textContent === title)!.parentElement!
    await act(async () => { icon('展开全部图层').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // layer A is listed last (top layer first): its three curves are the last three rows
    const curves = () => ([...host.querySelectorAll('[title^="点击选中这条连续曲线"]')] as HTMLElement[]).slice(-3)
    const before = scope()
    const lines = () => bench().core.snapshot().selection.map(u => ('id' in u ? u.id : '')).sort()
    const names = curves().map(c => c.textContent)
    const click = async (i: number, mods: { shiftKey?: boolean; metaKey?: boolean } = {}) => { await act(async () => { curves()[i]!.dispatchEvent(new MouseEvent('click', { bubbles: true, ...mods })) }) }
    expect(names.length).toBe(3)
    await click(0)
    expect(lines()).toHaveLength(1)
    await click(2, { metaKey: true })
    expect(lines()).toHaveLength(2)
    await click(2, { metaKey: true })
    expect(lines()).toHaveLength(1)
    await click(0); await click(2, { shiftKey: true })
    expect(lines()).toHaveLength(3)
    expect(scope()).toEqual(before)
  })
})

describe('picking an element in a layer that is not selected adds that layer (bowen 1791558438)', () => {
  it('a curve row in an unselected layer: the curve is picked and shown, its layer joins the selected layers, the current stays', async () => {
    const host = await setup()
    await row(host, 'D')
    const icon = (title: string) => [...host.querySelectorAll('svg title')].find(t => t.textContent === title)!.parentElement!
    await act(async () => { icon('展开全部图层').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const curveOfB = ([...host.querySelectorAll('[title^="点击选中这条连续曲线"]')] as HTMLElement[])[2]! // D, C, B, A: B is third
    await act(async () => { curveOfB.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(scope()).toEqual({ current: 'D', selected: ['B', 'D'] })
    expect((bench().ix as unknown as { selection(): unknown[] }).selection()).toEqual([{ kind: 'line', id: 'lB' }])
  })
})
