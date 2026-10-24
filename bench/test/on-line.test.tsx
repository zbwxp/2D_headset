// 线上点 in the bench (bowen 1792812088): a point listed in the file's `bench.onLine` stays on its target lines — a move
// of it slides along them, a change of a target carries it along — it never splits a target, and Save keeps the list.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save, type Editor } from '../../src'
import { App } from '../src/app'
import { resetPage, CURRENT, type Store } from '../../autosave'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }); delete (window as { benchStore?: Store }).benchStore; resetPage() })
type B = { core: Core; edit(fn: (e: Editor) => void): void; svg(): string }
const bench = () => (window as unknown as { bench: B }).bench

/** A target line T (0,0)→(100,0) bowed down by its handles, and an ear line E: e1 → e2 with e1 listed as on T. */
async function mount() {
  const d = Core.newDocument({ layer: { id: 'layer-1', name: 'L' } })
  d.edit(e => e.line('T', { id: 't1', layer: 'layer-1', position: { x: 0, y: 0 } }, { id: 't2', layer: 'layer-1', position: { x: 100, y: 0 } }, { ha: { x: 30, y: 40 }, hb: { x: -30, y: 40 } }))
  d.edit(e => e.line('E', { id: 'e1', layer: 'layer-1', position: { x: 50, y: 30 } }, { id: 'e2', layer: 'layer-1', position: { x: 50, y: 80 } }))
  const text = save(d), data: Record<string, string> = { [CURRENT]: `${text.slice(0, text.lastIndexOf('}'))},"bench":{"onLine":{"e1":["T"]}}}` }
  ;(window as { benchStore?: Store }).benchStore = { async get(k) { return data[k] }, async put(k, v) { data[k] = v } }
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />); await wait(20) })
  return { data }
}
const at = (id: string) => bench().core.snapshot().points.find(p => p.id === id)!.position
/** T at parameter t (its Bézier, as set up). */
const onT = (t: number, b = { x: 100, y: 0 }) => { const u = 1 - t, c = [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: b.x - 30, y: b.y + 40 }, b]; return { x: u ** 3 * c[0]!.x + 3 * u * u * t * c[1]!.x + 3 * u * t * t * c[2]!.x + t ** 3 * c[3]!.x, y: u ** 3 * c[0]!.y + 3 * u * u * t * c[1]!.y + 3 * u * t * t * c[2]!.y + t ** 3 * c[3]!.y } }
/** The distance from `q` to T (sampled, then refined around the best sample). */
const distToT = (q: { x: number; y: number }, b?: { x: number; y: number }) => {
  const d = (t: number) => { const p = onT(t, b); return Math.hypot(p.x - q.x, p.y - q.y) }
  let tb = 0; for (let i = 1; i <= 1000; i++) if (d(i / 1000) < d(tb)) tb = i / 1000
  let lo = Math.max(0, tb - 0.001), hi = Math.min(1, tb + 0.001)
  for (let i = 0; i < 60; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (d(m1) < d(m2)) hi = m2; else lo = m1 }
  return d((lo + hi) / 2)
}

describe('线上点', () => {
  it('a move of the point lands on the nearest place of its target; the target is not split; the mark shows', async () => {
    await mount()
    await act(async () => { bench().edit(e => e.move([{ id: 'e1', target: { x: 20, y: 60 } }])) })
    expect(distToT(at('e1'))).toBeLessThan(1e-3)
    expect(at('e1').x).toBeGreaterThan(15); expect(at('e1').x).toBeLessThan(35) // the near part of T, not an end
    const s = bench().core.snapshot()
    expect(s.lines.map(l => [l.id, l.a, l.b])).toEqual([['T', 't1', 't2'], ['E', 'e1', 'e2']])
    const svgText = bench().svg() ?? ''
    expect(svgText).toContain('data-on-line="e1:T"')
  })
  it('changing the target carries the point along; the other end of its own line stays free', async () => {
    await mount()
    await act(async () => { bench().edit(e => e.move([{ id: 't2', target: { x: 100, y: 50 } }])) })
    expect(distToT(at('e1'), { x: 100, y: 50 })).toBeLessThan(1e-3)
    await act(async () => { bench().edit(e => e.move([{ id: 'e2', target: { x: 70, y: 90 } }])) })
    expect(at('e2')).toEqual({ x: 70, y: 90 })
  })
  it('the file written keeps the list', async () => {
    const m = await mount()
    await act(async () => { bench().edit(e => e.move([{ id: 'e2', target: { x: 60, y: 90 } }])); await wait(30) })
    expect(JSON.parse(m.data[CURRENT]!).bench).toEqual({ onLine: { e1: ['T'] } })
  })
})
