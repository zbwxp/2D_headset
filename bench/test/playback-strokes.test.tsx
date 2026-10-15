// Strokes at a playback pose (docs/shared-strokes-checklist.md §3; bowen 1792057731, dot): every stroke value is one for
// every view and pose, so the gate lets through a point's width, a line's or a curve's stroke, an end stroke and a join's
// zone; core still checks the targets and the locks. A new join or a mode change stays refused.
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
  const [a, b, c] = [`a${k}`, `b${k}`, `c${k}`]
  await act(async () => {
    bench().chooseView('view:0,0')
    bench().core.edit(e => {
      e.line(`ab${k}`, { id: a, layer: 'layer-1', position: { x: 0, y: 300 * k } }, { id: b, layer: 'layer-1', position: { x: 40, y: 300 * k } })
      e.line(`bc${k}`, b, { id: c, layer: 'layer-1', position: { x: 40, y: 300 * k + 40 } })
      e.join(b, `ab${k}`, `bc${k}`, { mode: 'smooth' })
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
  const tryEdit = async (fn: (e: Editor) => unknown) => { await act(async () => { try { bench().edit(fn) } catch { /* the log holds the refusal */ } }) }
  /** The four values of this drawing as a reader shows them. */
  const look = (s: ReturnType<Core['snapshot']>) => ({
    points: s.points.filter(p => p.id.endsWith(String(k))).map(p => [p.id, p.width, p.endStroke ?? null]),
    lines: s.lines.filter(l => l.id.endsWith(String(k))).map(l => [l.id, l.stroke]),
    zones: s.joins.filter(j => j.point === b).map(j => j.zone ?? null),
  })
  return { k, a, b, c, play, tryEdit, look }
}

describe('strokes at a playback pose', () => {
  it('at yaw 30 each of the five stroke calls goes through; the nine views and the poses read the one value', async () => {
    const t = await setup()
    await t.play(30, 0)
    const calls: ((e: Editor) => unknown)[] = [
      e => e.pointWidth(t.a, 3),
      e => e.lineStroke(`bc${t.k}`, { width: 2, widthB: 5, profile: 'taper' }),
      e => e.endStroke(t.c, { taper: 4 }),
      e => e.zone(t.b, `ab${t.k}`, `bc${t.k}`, 6),
    ]
    for (const fn of calls) { await t.tryEdit(fn); expect(bench().log[0]!.result).toBe('ok') }
    const want = {
      points: [[t.a, 3, null], [t.b, 2, null], [t.c, 5, { taper: 4 }]],
      lines: [[`ab${t.k}`, { width: 3, widthB: 2, profile: 'uniform' }], [`bc${t.k}`, { width: 2, widthB: 5, profile: 'taper' }]],
      zones: [6],
    }
    for (const v of bench().core.views()) expect([v, t.look(bench().core.in(v).snapshot())]).toEqual([v, want])
    for (const p of [{ yaw: 30, pitch: 0 }, { yaw: -60, pitch: 45 }]) expect([p, t.look(bench().core.atPose(p).snapshot())]).toEqual([p, want])
    // a curve's stroke (the group batch) goes through too
    const group = bench().core.snapshot().groups.find(g => g.lines.includes(`ab${t.k}`))!.id
    await t.tryEdit(e => e.stroke(group, { width: 1.5, profile: 'uniform' }))
    expect(bench().log[0]!.result).toBe('ok')
    expect(bench().core.in('view:90,45').snapshot().lines.find(l => l.id === `ab${t.k}`)!.stroke).toEqual({ width: 1.5, profile: 'uniform' })
  })

  it('a locked line refuses a width at its point, and a join change stays refused: nothing is written', async () => {
    const t = await setup()
    await act(async () => { bench().core.edit(e => e.lineState(`ab${t.k}`, { locked: true })); bench().refresh() })
    await t.play(30, 0)
    const before = save(bench().core)
    await t.tryEdit(e => e.pointWidth(t.b, 9))
    expect(bench().log[0]!.result).toMatch(/Locked lines would change/)
    await t.tryEdit(e => e.join(t.b, `ab${t.k}`, `bc${t.k}`, { mode: 'cusp' }))
    expect(bench().log[0]!.result).toMatch(/read-only-playback: join is not allowed/)
    await t.tryEdit(e => e.removeJoin(t.b, `ab${t.k}`, `bc${t.k}`))
    expect(bench().log[0]!.result).toMatch(/read-only-playback: removeJoin is not allowed/)
    expect(save(bench().core)).toBe(before)
  })
})
