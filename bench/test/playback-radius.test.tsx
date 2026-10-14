// An arc's radius at a playback pose (docs/arc-radius-shared-checklist.md §5b; bowen 1791985326, dot 1791985670): the
// gate lets through a `join` that only changes an existing arc's radius; the one radius then reads the same in the nine
// views and at the pose. A new join or a mode change stays refused.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Core, save, type Editor } from '../../src'
import { App } from '../src/app'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Pt { constructor(public x = 0, public y = 0) {} matrixTransform() { return this } }
;(globalThis as { DOMPoint?: unknown }).DOMPoint ??= Pt
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
type B = { core: Core; refresh(): void; chooseView(k: string): void; pose(): null | { yaw: number; pitch: number }; edit(fn: (e: Editor) => unknown): void; log: { calls: string; result: string }[] }
const bench = () => (window as unknown as { bench: B }).bench
let n = 0

async function setup() {
  const k = ++n
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  await act(async () => { root.render(<App />) })
  const [a, b, c, d] = [`a${k}`, `b${k}`, `c${k}`, `d${k}`]
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => {
      e.line(`ab${k}`, { id: a, layer: 'layer-1', position: { x: 0, y: 300 * k } }, { id: b, layer: 'layer-1', position: { x: 40, y: 300 * k } })
      e.line(`bc${k}`, b, { id: c, layer: 'layer-1', position: { x: 40, y: 300 * k + 40 } })
      e.line(`cd${k}`, c, { id: d, layer: 'layer-1', position: { x: 0, y: 300 * k + 40 } })
      e.join(b, `ab${k}`, `bc${k}`, { mode: 'arc', radius: 10 })
    })
    bench().core.editIn('view:90,0', e => e.move([{ id: c, target: { x: 60, y: 300 * k + 50 } }]))
    bench().refresh()
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find(x => x.textContent === label)!
  const type = async (id: string, v: string) => {
    const el = host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const play = async (yaw: number, pitch: number) => { await act(async () => { button('Playback').click() }); await type('yaw-text', String(yaw)); await type('pitch-text', String(pitch)) }
  const radiusIn = (view: string) => bench().core.in(view).snapshot().joins.find(r => r.point === b)?.radius
  const radiusAt = (pose: { yaw: number; pitch: number }) => bench().core.atPose(pose).snapshot().joins.find(r => r.point === b)?.radius
  const tryEdit = async (fn: (e: Editor) => unknown) => { await act(async () => { try { bench().edit(fn) } catch { /* the log holds the refusal */ } }) }
  return { k, a, b, c, d, play, radiusIn, radiusAt, tryEdit }
}

describe('an arc\'s radius at a playback pose', () => {
  it('at yaw 30 a radius change of an existing arc is one join; the nine views and the pose read the new radius', async () => {
    const t = await setup()
    await t.play(30, 0)
    await t.tryEdit(e => e.join(t.b, `bc${t.k}`, `ab${t.k}`, { mode: 'arc', radius: 4 }))
    expect(bench().log[0]!.result).toBe('ok')
    for (const v of bench().core.views()) expect([v, t.radiusIn(v)]).toEqual([v, 4])
    for (const p of [{ yaw: 30, pitch: 0 }, { yaw: -60, pitch: 45 }]) expect(t.radiusAt(p)).toBe(4)
  })

  it('a new join, a mode change, or a radius change mixed with another call is refused and writes nothing', async () => {
    const t = await setup()
    await t.play(30, 0)
    const before = save(bench().core)
    await t.tryEdit(e => e.join(t.c, `bc${t.k}`, `cd${t.k}`, { mode: 'arc', radius: 4 }))
    expect(bench().log[0]!.result).toMatch(/read-only-playback: join is not allowed/)
    await t.tryEdit(e => e.join(t.b, `ab${t.k}`, `bc${t.k}`, { mode: 'smooth' }))
    expect(bench().log[0]!.result).toMatch(/read-only-playback: join is not allowed/)
    await t.tryEdit(e => { e.join(t.b, `ab${t.k}`, `bc${t.k}`, { mode: 'arc', radius: 4 }); e.lineState(`ab${t.k}`, { locked: true }) })
    expect(bench().log[0]!.result).toMatch(/read-only-playback/)
    expect(save(bench().core)).toBe(before)
  })
})
