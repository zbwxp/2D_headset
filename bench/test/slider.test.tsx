// slider/ (docs/slider-plan.md; bowen 1791769016, 1791769065, 1791769146, 1791769257; dot 1791769272,
// 1791769298, 1791769582, 1791770098): a typed number, a slide and keys as move/ sessions; one write per
// session through its own ending; outside changes cancel without restoring; the app's slot and open field.
import { describe, it, expect, afterEach } from 'vitest'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Slider, type SliderProps } from '../../slider'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: { unmount(): void }[] = []
afterEach(async () => { await act(async () => { for (const r of roots.splice(0)) r.unmount() }) })
function pe(type: string, x: number, buttons: number, id = 1) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0, button: 0, buttons })
  Object.defineProperty(e, 'pointerId', { value: id })
  return e
}
const setValue = (el: HTMLInputElement, v: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
/** Window listeners counted by type, callback and capture (dot 1791718017). */
function track() {
  const live = new Set<string>(), add = window.addEventListener, remove = window.removeEventListener
  const ids = new WeakMap<object, number>(); let n = 0
  const key = (t: string, f: object, o: unknown) => `${t}|${ids.get(f) ?? (ids.set(f, ++n), n)}|${typeof o === 'boolean' ? o : !!(o as { capture?: boolean } | undefined)?.capture}`
  window.addEventListener = function (this: Window, t: string, f: EventListenerOrEventListenerObject, o?: unknown) { if (/^pointer|^blur$/.test(t)) live.add(key(t, f as object, o)); return add.call(this, t, f, o as boolean) } as typeof window.addEventListener
  window.removeEventListener = function (this: Window, t: string, f: EventListenerOrEventListenerObject, o?: unknown) { live.delete(key(t, f as object, o)); return remove.call(this, t, f, o as boolean) } as typeof window.removeEventListener
  return { count: () => live.size, restore: () => { window.addEventListener = add; window.removeEventListener = remove } }
}

type Opts = Partial<Pick<SliderProps, 'track' | 'scale' | 'steps' | 'accept'>> & { value?: number; refuse?: boolean; echo?: boolean }
/** One slider on a host that keeps the value; `echo`: previews set the value (as the pose does), else only commits do (as the picture). */
async function mount(o: Opts = {}) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  const log: string[] = []
  let setV!: (v: number) => void, setId!: (s: string) => void, setVer!: (n: number) => void, show!: (b: boolean) => void
  let slot: null | (() => void) = null, open: null | { end(): void } = null
  function Host() {
    const [v, sv] = useState(o.value ?? 10), [id, si] = useState('a'), [ver, sver] = useState(0), [on, son] = useState(true)
    setV = sv; setId = si; setVer = sver; show = son
    return on ? <Slider value={v} identity={id} version={ver} accept={o.accept ?? (x => x >= 0 && x <= 100)} track={o.track === undefined ? [0, 100] : o.track} scale={o.scale}
      steps={o.steps ?? { step: 1, long: 10, short: 0.1 }} fieldAttrs={{ 'data-testid': 'field' }} thumbAttrs={{ 'data-testid': 'thumb' }}
      onStart={d => { log.push(`start ${d.input}`); if (o.refuse) return false; slot = d.cancel; return true }}
      onEnd={c => { log.push(c === slot ? 'end' : 'end?'); slot = null }}
      onField={d => { log.push(d ? 'field open' : 'field closed'); open = d }}
      onPreview={(x, i) => { log.push(`preview ${x} ${i}`); if (o.echo) sv(x) }}
      onCommit={(x, i) => { log.push(`commit ${x} ${i}`); sv(x) }}
      onCancel={i => { log.push(`cancel ${i}`) }} /> : null
  }
  await act(async () => { root.render(<Host />) })
  const field = () => host.querySelector('[data-testid="field"]') as HTMLInputElement
  const thumb = () => host.querySelector('[data-testid="thumb"]') as HTMLElement
  const bar = () => thumb()?.parentElement as HTMLElement
  if (bar()) bar().getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 4, right: 100, bottom: 4, x: 0, y: 0, toJSON() {} }) as DOMRect
  const key = async (el: Element, k: string, more: KeyboardEventInit = {}) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...more }); await act(async () => { el.dispatchEvent(e) }); return e }
  const up = async (el: Element, k: string) => { const e = new KeyboardEvent('keyup', { key: k, bubbles: true }); await act(async () => { el.dispatchEvent(e) }); return e }
  const type = async (t: string) => { await act(async () => { setValue(field(), t) }) }
  const blur = async () => { await act(async () => { field().dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }) }
  return {
    host, log, field, thumb, bar, key, up, type, blur,
    slot: () => slot, open: () => open,
    set: async (v: number) => { await act(async () => { setV(v) }) },
    identity: async (s: string) => { await act(async () => { setId(s) }) },
    version: async (n: number) => { await act(async () => { setVer(n) }) },
    unmount: async () => { await act(async () => { show(false) }) },
    writes: () => log.filter(x => x.startsWith('commit')),
  }
}

describe('typing', () => {
  it('previews each accepted number; Enter commits once and the later blur does not; Esc cancels; refused text is red and changes nothing', async () => {
    const t = await mount()
    await t.type('42')
    expect(t.log).toEqual(['field open', 'preview 42 typing'])
    await t.key(t.field(), 'Enter'); await t.blur()
    expect(t.writes()).toEqual(['commit 42 typing'])
    await t.type('7'); await t.type('7x')
    expect([t.field().style.borderColor, t.log.at(-1)]).toEqual(['rgb(204, 0, 0)', 'preview 7 typing'])
    await t.key(t.field(), 'Escape')
    expect([t.log.at(-1), t.field().value, t.writes().length]).toEqual(['cancel typing', '42', 1])
  })
  it('accepted beyond the track: the caller\'s accept decides, not the track (x off screen, angle 400)', async () => {
    const t = await mount({ accept: Number.isFinite })
    await t.type('400'); await t.key(t.field(), 'Enter')
    expect(t.writes()).toEqual(['commit 400 typing'])
  })
  it('valid, then invalid when leaving: cancelled, the earlier valid preview not written (dot 1791769298); no change: no write', async () => {
    const t = await mount()
    await t.type('30'); await t.type('-'); await t.blur()
    expect([t.writes(), t.log.at(-1)]).toEqual([[], 'cancel typing'])
    await t.type('10'); await t.blur()
    expect([t.writes(), t.log.at(-1)]).toEqual([[], 'cancel typing'])
  })
  it('↑ / ↓ in the field preview only; typing, ↑, Enter is one write; ← / → stay the caret\'s', async () => {
    const t = await mount()
    await t.type('20')
    await t.key(t.field(), 'ArrowUp'); await t.key(t.field(), 'ArrowUp', { repeat: true }); await t.up(t.field(), 'ArrowUp')
    await t.key(t.field(), 'ArrowDown', { shiftKey: true }); await t.up(t.field(), 'ArrowDown')
    expect([t.field().value, t.writes()]).toEqual(['12', []])
    const left = await t.key(t.field(), 'ArrowLeft')
    expect(left.defaultPrevented).toBe(false)
    await t.key(t.field(), 'Enter')
    expect(t.writes()).toEqual(['commit 12 typing'])
  })
  it('leaving the field with ↑ still held writes once; the key-up after writes nothing', async () => {
    const t = await mount()
    await t.key(t.field(), 'ArrowUp')
    await t.blur()
    await t.up(t.field(), 'ArrowUp')
    expect(t.writes()).toEqual(['commit 11 typing'])
  })
  it('the app ends an open field (`end`) as leaving it would: its own typed value written', async () => {
    const t = await mount()
    await t.type('55')
    await act(async () => { t.open()!.end() })
    await t.blur()
    expect([t.writes(), t.log.filter(x => x.startsWith('field'))]).toEqual([['commit 55 typing'], ['field open', 'field closed']])
  })
})

describe('keys on the thumb — a move/ key run', () => {
  it('the sizes given: 1, Shift 10, Option 0.1; a held run previews each step and writes once on the last key up; the keys never reach the window', async () => {
    const t = await mount()
    let reached = 0
    const seen = () => { reached++ }
    window.addEventListener('keydown', seen); window.addEventListener('keyup', seen)
    try {
      await t.key(t.thumb(), 'ArrowRight'); await t.key(t.thumb(), 'ArrowRight', { repeat: true }); await t.key(t.thumb(), 'ArrowUp', { shiftKey: true }); await t.key(t.thumb(), 'ArrowLeft', { altKey: true })
      await t.up(t.thumb(), 'ArrowRight'); await t.up(t.thumb(), 'ArrowUp')
      expect(t.writes()).toEqual([])
      await t.up(t.thumb(), 'ArrowLeft')
      expect([t.log, reached]).toEqual([['start keys', 'preview 11 keys', 'preview 12 keys', 'preview 22 keys', 'preview 21.9 keys', 'end', 'commit 21.9 keys'], 0])
    } finally { window.removeEventListener('keydown', seen); window.removeEventListener('keyup', seen) }
  })
  it('two sliders, different sizes; Shift + Option is the single step', async () => {
    const t = await mount({ steps: { step: 0.25, long: 5, short: 0.05 }, value: 1 })
    await t.key(t.thumb(), 'ArrowRight', { shiftKey: true, altKey: true }); await t.key(t.thumb(), 'ArrowRight', { altKey: true }); await t.up(t.thumb(), 'ArrowRight')
    expect(t.writes()).toEqual(['commit 1.3 keys'])
  })
  it('a step accept refuses is not taken and leaves no dead travel: at 100, ↑ ↑ refused, ↓ gives 99 at once (dot 1791770098)', async () => {
    const t = await mount({ value: 100 })
    await t.key(t.thumb(), 'ArrowUp'); await t.key(t.thumb(), 'ArrowUp', { repeat: true }); await t.key(t.thumb(), 'ArrowDown')
    expect(t.log.filter(x => x.startsWith('preview'))).toEqual(['preview 99 keys'])
  })
  it('the value keeps its own decimals; a run back and forth is exactly its start: no write', async () => {
    const t = await mount({ value: 0.25 })
    await t.key(t.thumb(), 'ArrowRight', { altKey: true })
    expect(t.log.at(-1)).toBe('preview 0.35 keys')
    await t.key(t.thumb(), 'ArrowLeft', { altKey: true }); await t.up(t.thumb(), 'ArrowRight'); await t.up(t.thumb(), 'ArrowLeft')
    expect([t.writes(), t.log.at(-1)]).toEqual([[], 'cancel keys'])
  })
  it('Esc and blur with a key held cancel: the preview withdrawn, nothing written; a late key up writes nothing', async () => {
    const t = await mount()
    await t.key(t.thumb(), 'ArrowRight'); await t.key(t.thumb(), 'Escape'); await t.up(t.thumb(), 'ArrowRight')
    await t.key(t.thumb(), 'ArrowRight'); await act(async () => { t.thumb().dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }); await t.up(t.thumb(), 'ArrowRight')
    expect([t.writes(), t.log.filter(x => x.startsWith('cancel'))]).toEqual([[], ['cancel keys', 'cancel keys']])
  })
  it('the app may refuse the start: nothing previews', async () => {
    const t = await mount({ refuse: true })
    await t.key(t.thumb(), 'ArrowRight')
    expect(t.log).toEqual(['start keys'])
  })
  it('a log slider steps log10: start × 10^offset, back exactly to the start; 0.0001 kept; a step down past what accept takes is not taken', async () => {
    const t = await mount({ scale: 'log', track: [-3, 2], value: 2, steps: { step: 0.01, long: 0.1, short: 0.001 }, accept: v => v > 1e-5 })
    await t.key(t.thumb(), 'ArrowRight', { shiftKey: true })
    expect(Number(t.log.at(-1)!.split(' ')[1])).toBeCloseTo(2 * 10 ** 0.1, 12)
    await t.key(t.thumb(), 'ArrowLeft', { shiftKey: true }); await t.up(t.thumb(), 'ArrowRight'); await t.up(t.thumb(), 'ArrowLeft')
    expect([t.writes(), t.log.at(-1)]).toEqual([[], 'cancel keys'])
    const s = await mount({ scale: 'log', track: [-3, 2], value: 0.0001, steps: { step: 0.01, long: 0.1, short: 0.001 }, accept: v => v > 1e-5 })
    expect(s.field().value).toBe('0.0001')
    for (let i = 0; i < 12; i++) await s.key(s.thumb(), 'ArrowDown', { shiftKey: true, repeat: i > 0 })
    const last = Number(s.log.filter(x => x.startsWith('preview')).at(-1)!.split(' ')[1])
    expect(last > 1e-5 && last < 2e-5).toBe(true)
  })
})

describe('sliding — a move/ drag session', () => {
  it('on the thumb the grab offset is kept; each move previews; the release writes the value at the release', async () => {
    const t = await mount({ value: 50 })
    const l = track()
    try {
      await act(async () => { t.thumb().dispatchEvent(pe('pointerdown', 53, 1)) }) // 3 px right of the thumb's centre
      await act(async () => { window.dispatchEvent(pe('pointermove', 63.4, 1)) })
      expect(t.log.at(-1)).toBe('preview 60 drag') // 60.4 snapped to the single step
      await act(async () => { window.dispatchEvent(pe('pointerup', 73, 0)) })
      expect([t.writes(), l.count()]).toEqual([['commit 70 drag'], 0])
    } finally { l.restore() }
  })
  it('a slide snaps to multiples of the single step: 0.25 → 60.4 gives 60.5', async () => {
    const t = await mount({ value: 50, steps: { step: 0.25, long: 5, short: 0.05 } })
    await act(async () => { t.bar().dispatchEvent(pe('pointerdown', 60.4, 1)); window.dispatchEvent(pe('pointerup', 60.4, 0)) })
    expect(t.writes()).toEqual(['commit 60.5 drag'])
  })
  it('a click on the bar with no drag writes the jump once (dot 1791769272 §5)', async () => {
    const t = await mount({ value: 50 })
    await act(async () => { t.bar().dispatchEvent(pe('pointerdown', 20, 1)); window.dispatchEvent(pe('pointerup', 20, 0)) })
    expect(t.writes()).toEqual(['commit 20 drag'])
  })
  it('a second pointer is ignored and never ends the first; Esc on the thumb cancels; a late release writes nothing', async () => {
    const t = await mount({ value: 50 })
    await act(async () => { t.thumb().dispatchEvent(pe('pointerdown', 50, 1)) })
    await act(async () => { t.bar().dispatchEvent(pe('pointerdown', 10, 1, 2)); window.dispatchEvent(pe('pointerup', 10, 0, 2)) })
    await act(async () => { window.dispatchEvent(pe('pointermove', 60, 1)) })
    expect(t.log.at(-1)).toBe('preview 60 drag')
    await t.key(t.thumb(), 'Escape')
    await act(async () => { window.dispatchEvent(pe('pointerup', 80, 0)) })
    expect([t.writes(), t.log.at(-2), t.log.at(-1)]).toEqual([[], 'end', 'cancel drag'])
  })
  it('the app\'s slot cancel ends a slide (a new input elsewhere): cancelled, never forced to commit', async () => {
    const t = await mount({ value: 50 })
    await act(async () => { t.thumb().dispatchEvent(pe('pointerdown', 50, 1)); window.dispatchEvent(pe('pointermove', 70, 1)) })
    await act(async () => { t.slot()!() })
    await act(async () => { window.dispatchEvent(pe('pointerup', 90, 0)) })
    expect([t.writes(), t.log.at(-1)]).toEqual([[], 'cancel drag'])
  })
  it('a log track maps both ways: the thumb at log10, a slide gives 10^t', async () => {
    const t = await mount({ scale: 'log', track: [-3, 2], value: 1, steps: { step: 0.01, long: 0.1, short: 0.001 }, accept: v => v > 0 })
    expect(t.thumb().style.left).toBe('calc(60% - 5px)')
    await act(async () => { t.bar().dispatchEvent(pe('pointerdown', 80, 1)); window.dispatchEvent(pe('pointerup', 80, 0)) })
    expect(t.writes()).toEqual(['commit 10 drag'])
  })
})

describe('outside changes and unmounting (dot 1791769272 §2, 1791769582 §1)', () => {
  it('a value changed from outside during a session cancels it and shows the new value, never the old; its own echo does not', async () => {
    const t = await mount({ echo: true })
    await t.key(t.thumb(), 'ArrowRight') // echo: the host's value becomes 11
    expect(t.log.filter(x => x.startsWith('cancel'))).toEqual([])
    await t.set(40) // from outside
    await t.up(t.thumb(), 'ArrowRight')
    expect([t.writes(), t.log.at(-1), t.field().value]).toEqual([[], 'cancel keys', '40'])
  })
  it('identity or version changing during a session cancels it; a late release writes nothing', async () => {
    for (const change of ['identity', 'version'] as const) {
      const t = await mount({ value: 50 })
      await act(async () => { t.thumb().dispatchEvent(pe('pointerdown', 50, 1)); window.dispatchEvent(pe('pointermove', 60, 1)) })
      if (change === 'identity') await t.identity('b'); else await t.version(1)
      await act(async () => { window.dispatchEvent(pe('pointerup', 80, 0)) })
      expect([change, t.writes(), t.log.at(-1)]).toEqual([change, [], 'cancel drag'])
    }
  })
  it('unmounting during a slide cancels it and leaves no window listener', async () => {
    const l = track()
    try {
      const t = await mount({ value: 50 })
      await act(async () => { t.thumb().dispatchEvent(pe('pointerdown', 50, 1)) })
      expect(l.count()).toBeGreaterThan(0)
      await t.unmount()
      expect([l.count(), t.log.at(-1)]).toEqual([0, 'cancel drag'])
    } finally { l.restore() }
  })
  it('the field-only form (no track): a field with ↑ / ↓, no thumb', async () => {
    const t = await mount({ track: null, value: 2 })
    expect(t.thumb()).toBeNull()
    await t.key(t.field(), 'ArrowUp'); await t.up(t.field(), 'ArrowUp'); await t.key(t.field(), 'Enter')
    expect(t.writes()).toEqual(['commit 3 typing'])
  })
})
