// The 蒙版 section of the properties panel (docs/mask-p2-checklist.md §4): target first (the subject's lines and fills),
// then the source fills, then the mode; one edit per add / remove; the draft belongs to one drawing and subject.
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
const bench = () => (window as unknown as { bench: { core: Core; refresh(): void } }).bench

/** Layer B: a filled square; layer A: a filled triangle and a line x across the square. */
async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const d = Core.newDocument()
  d.edit(e => {
    e.layer('B', 'B'); e.layer('A', 'A')
    const P = (id: string, layer: string, x: number, y: number) => ({ id, layer, position: { x, y } })
    e.line('s1', P('q1', 'B', 0, 0), P('q2', 'B', 100, 0)); e.line('s2', 'q2', P('q3', 'B', 100, 100)); e.line('s3', 'q3', P('q4', 'B', 0, 100)); e.line('s4', 'q4', 'q1')
    e.line('t1', P('r1', 'A', 200, 0), P('r2', 'A', 260, 0)); e.line('t2', 'r2', P('r3', 'A', 230, 50)); e.line('t3', 'r3', 'r1')
    e.line('x', P('a', 'A', -50, 50), P('b', 'A', 150, 50))
  })
  d.edit(e => { for (const l of d.snapshot().loops) e.fill(l.id, '#ccc') })
  const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 50)) })
  const s = () => bench().core.snapshot()
  const fillOf = (line: string) => s().loops.find(l => l.route.some(u => u.line === line))!.id
  const q = (sel: string) => host.querySelector(sel) as HTMLElement | null
  /** An element by an attribute's exact value (fill ids hold quotes and brackets). */
  const at = (name: string, value: string) => [...host.querySelectorAll(`[${name}]`)].find(e => e.getAttribute(name) === value) as HTMLElement | undefined ?? null
  const click = async (sel: string | HTMLElement | null) => { await act(async () => { (typeof sel === 'string' ? q(sel) : sel)!.click() }) }
  return { host, s, fillOf, q, at, click }
}

describe('the 蒙版 section', () => {
  it('a layer as subject: its lines are the targets, its fills too when 填充也遮 is ticked (then its own fill is no longer offered); one add = one undo step', async () => {
    const t = await setup(), sq = t.fillOf('s1'), tri = t.fillOf('t1')
    await t.click('[data-layer-row="A"]')
    expect(t.q('[data-testid="mask-section"]')).not.toBeNull()
    expect(t.at('data-mask-source', tri)).not.toBeNull() // lines only: the layer's own fill may mask them (dot 1791906426)
    await t.click('[data-mask-with-fills]')
    expect(t.at('data-mask-source', tri)).toBeNull() // a fill never masks itself
    await t.click('[data-mask-with-fills]')
    expect((t.q('[data-testid="mask-add"]') as HTMLButtonElement).disabled).toBe(true) // nothing ticked
    await t.click(t.at('data-mask-source', sq))
    await t.click('[data-testid="mask-add"]')
    expect(t.s().masks.map(m => m.target.id)).toEqual(['t1', 't2', 't3', 'x']) // lines only by default
    await act(async () => { bench().core.undo(); bench().refresh() })
    await t.click(t.at('data-mask-source', sq))
    await t.click('[data-mask-with-fills]')
    await t.click('[data-testid="mask-add"]')
    const made = t.s().masks
    expect(made.map(m => [m.target.kind, m.target.id, m.sources, m.mode])).toEqual([
      ['line', 't1', [sq], 'inverse'], ['line', 't2', [sq], 'inverse'], ['line', 't3', [sq], 'inverse'], ['line', 'x', [sq], 'inverse'], ['fill', tri, [sq], 'inverse'],
    ])
    expect(new Set(made.map(m => m.id)).size).toBe(5)
    expect(t.host.querySelectorAll('[data-mask]').length).toBe(5)
    await act(async () => { bench().core.undo(); bench().refresh() })
    expect(t.s().masks).toEqual([])
  })

  it('a line as subject, 正常; × removes that mask only', async () => {
    const t = await setup(), sq = t.fillOf('s1'), tri = t.fillOf('t1')
    await act(async () => { bench().core.edit(e => e.mask('keep', [tri], { kind: 'fill', id: sq }, 'inverse')); bench().refresh() })
    // pick line x through the canvas selection (V): the panel follows a single selected line
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: 'x' }])); bench().refresh() })
    expect(t.q('[data-testid="mask-section"]')!.textContent).toContain('目标：线')
    await t.click(t.at('data-mask-source', sq))
    await t.click('[data-mask-mode="normal"]')
    await t.click('[data-testid="mask-add"]')
    const m = t.s().masks.find(x => x.target.id === 'x')!
    expect([m.sources, m.mode]).toEqual([[sq], 'normal'])
    await t.click(t.at('data-mask-remove', m.id))
    expect(t.s().masks.map(x => x.id)).toEqual(['keep'])
  })

  it('a rule added once cannot be added again: those targets are left out, with all of them done 添加 is off (bowen 1791908041)', async () => {
    const t = await setup(), sq = t.fillOf('s1')
    await act(async () => { bench().core.edit(e => e.mask('old', [sq], { kind: 'line', id: 't2' }, 'inverse')); bench().refresh() })
    await t.click('[data-layer-row="A"]')
    await t.click(t.at('data-mask-source', sq))
    await t.click('[data-testid="mask-add"]')
    expect(t.s().masks.filter(m => m.target.id === 't2').length).toBe(1) // t2 already had it
    expect(t.s().masks.map(m => m.target.id).sort()).toEqual(['t1', 't2', 't3', 'x'])
    await t.click(t.at('data-mask-source', sq))
    expect((t.q('[data-testid="mask-add"]') as HTMLButtonElement).disabled).toBe(true)
    expect(t.q('[data-testid="mask-section"]')!.textContent).toContain('已经加过')
    await t.click('[data-mask-mode="normal"]')
    expect((t.q('[data-testid="mask-add"]') as HTMLButtonElement).disabled).toBe(false) // another mode is another rule
  })

  it('only on selected layers: a layer deselected with Cmd takes the section away (bowen 1791899593, dot 1791906426)', async () => {
    const t = await setup()
    await t.click('[data-layer-row="A"]')
    expect(t.q('[data-testid="mask-section"]')).not.toBeNull()
    const cmd = async (id: string) => { await act(async () => { t.q(`[data-layer-row="${id}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })) }) }
    await cmd('B'); await cmd('A')
    expect(t.q('[data-testid="mask-section"]')).toBeNull()
  })

  it('a target gone takes the section and its draft away: after undo it comes back empty (dot 1791906426)', async () => {
    const t = await setup(), sq = t.fillOf('s1')
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: 'x' }])); bench().refresh() })
    await t.click(t.at('data-mask-source', sq))
    await t.click('[data-mask-mode="normal"]')
    await act(async () => { bench().core.edit(e => e.deleteLine('x')); bench().refresh() })
    expect(t.q('[data-testid="mask-section"]')).toBeNull()
    await act(async () => { bench().core.undo(); bench().refresh() })
    await act(async () => { bench().core.edit(e => e.select([{ kind: 'line', id: 'x' }])); bench().refresh() })
    expect((t.at('data-mask-source', sq) as HTMLInputElement).checked).toBe(false)
    expect((t.q('[data-mask-mode="inverse"]') as HTMLInputElement).checked).toBe(true)
  })

  it('the draft belongs to its subject: ticks are dropped when another subject is chosen', async () => {
    const t = await setup(), sq = t.fillOf('s1')
    await t.click('[data-layer-row="A"]')
    await t.click(t.at('data-mask-source', sq))
    expect((t.at('data-mask-source', sq) as HTMLInputElement).checked).toBe(true)
    await t.click('[data-layer-row="B"]')
    await t.click('[data-layer-row="A"]')
    expect((t.at('data-mask-source', sq) as HTMLInputElement).checked).toBe(false)
  })

  it('made through the panel, drawn on the canvas: line x has no ink inside the square', async () => {
    const t = await setup(), sq = t.fillOf('s1')
    await t.click('[data-layer-row="A"]')
    await t.click(t.at('data-mask-source', sq))
    await t.click('[data-testid="mask-add"]')
    await t.click('[data-testid="masks"]')
    const d = t.q('[data-ink="x"]')!.getAttribute('d') ?? ''
    expect((d.match(/M/g) ?? []).length).toBe(2)
    const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]))
    expect(xs.some(x => x > 1 && x < 99)).toBe(false)
  })
})
