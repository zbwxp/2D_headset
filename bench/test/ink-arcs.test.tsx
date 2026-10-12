// Arc ink on the canvas (dot 1791802438 / 1791803549): an arc join drawn as one path when its lines share a paint;
// when there is nothing to draw — an empty union, an arc with no ink — the canvas falls back to what exists (the
// pieces; the arc's debug centre line) instead of going blank. The two empty results are forced through the cache.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save } from '../../src'
import { App } from '../src/app'

const force = { mode: 'none' as 'none' | 'empty-union' | 'no-arc' }
vi.mock('../../ink', async orig => {
  const m = await orig<typeof import('../../ink')>()
  return {
    ...m,
    createInkCache: (o?: Parameters<typeof m.createInkCache>[0]) => {
      const c = m.createInkCache(o)
      return {
        build: (...a: Parameters<ReturnType<typeof m.createInkCache>['build']>) => {
          const r = c.build(...a)
          if (force.mode === 'empty-union') return { ...r, groups: r.groups.map(x => ({ ...x, loops: [] })) }
          if (force.mode === 'no-arc') return { pieces: r.pieces.filter(p => p.source.kind !== 'arc'), groups: [],
            diagnostics: r.diagnostics.map(d => d.source.kind === 'arc' ? { source: d.source, status: 'fallback' as const, reason: 'forced' } : d) }
          return r
        },
      }
    },
  }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this) }) }
const wait = (ms = 0) => new Promise(r => setTimeout(r, ms))
const roots: { unmount(): void }[] = []
afterEach(async () => { force.mode = 'none'; await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; chooseView(k: string): void }
const bench = () => (window as unknown as { bench: B }).bench

/** Two lines meeting at b, joined by an arc of radius 10, both width 4. */
async function setup() {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const d = Core.newDocument({ layer: { id: 'A', name: 'A' } })
  d.edit(e => {
    const P = (id: string, x: number, y: number) => ({ id, layer: 'A', position: { x, y } })
    e.line('ab', P('a', 0, 0), P('b', 50, 0)); e.line('bc', 'b', P('c', 50, 40))
    e.lineStroke('ab', { width: 4, profile: 'uniform' }); e.lineStroke('bc', { width: 4, profile: 'uniform' })
    e.join('b', 'ab', 'bc', { mode: 'arc', radius: 10 })
  })
  const input = host.querySelector('[data-testid="open"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([save(d)], 'd.json')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await wait(50) })
  await act(async () => { bench().chooseView('view:0,0') })
  const toggle = host.querySelector('[data-testid="ink-outline"]') as HTMLInputElement
  await act(async () => { toggle.click() })
  const q = (sel: string) => [...host.querySelectorAll(sel)]
  return { host, q }
}

describe('arc ink on the canvas', () => {
  it('one path for the turn when the lines share a paint; no debug arc', async () => {
    const { q } = await setup()
    expect(q('[data-ink-group]').length).toBe(1)
    expect(q('path[stroke="#a50"]').length).toBe(0)
  })
  it('an empty union: the group falls back to its pieces (both lines and the arc drawn)', async () => {
    force.mode = 'empty-union'
    const { q } = await setup()
    expect(q('[data-ink-group]').length).toBe(0)
    expect(q('[data-ink]').map(p => p.getAttribute('data-ink')!.startsWith('arc:') ? 'arc' : p.getAttribute('data-ink')).sort()).toEqual(['ab', 'arc', 'bc'])
  })
  it('an arc with no ink: its debug centre line stays, and the diagnostics count it as a fallback', async () => {
    force.mode = 'no-arc'
    const { q, host } = await setup()
    expect(q('[data-arc-fallback]').length).toBe(1)
    expect(host.querySelector('[data-testid="ink-diagnostics"]')!.textContent).toMatch(/回退 1/)
  })
})
