// move/ (docs/move-plan.md; dot 1791733489): sessions for a drag and a key run — one commit, cancel paths,
// step sizes, one session at a time, end before commit; no imports.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMover, type Mover, type Steps, type Target, type Vec, type KeyInput } from '../index'

function target(opts: { refuse?: boolean; onCommit?: () => void } = {}) {
  const log: string[] = []
  const t: Target = {
    begin: () => { log.push('begin'); return !opts.refuse },
    preview: (o: Vec) => { log.push(`preview ${o.x},${o.y}`) },
    commit: (o: Vec) => { log.push(`commit ${o.x},${o.y}`); opts.onCommit?.() },
    cancel: () => { log.push('cancel') },
  }
  return { t, log }
}
/** The sizes the selection and the picture pass (bowen 1791769146: passed in by each caller). */
const S: Steps = { step: 1, long: 10, short: 0.1 }
const kd = (m: Mover, t: () => Target | undefined, k: KeyInput, steps: Steps = S) => m.keyDown(t, k, steps)
const down = (key: string, more: { repeat?: boolean; shift?: boolean; alt?: boolean; ctrl?: boolean } = {}) => ({ key, ...more })

describe('a drag', () => {
  it('previews the pointer\'s displacement and commits once on release; a release where it was pressed commits nothing', () => {
    const m = createMover(), { t, log } = target()
    expect(m.press(t, { x: 10, y: 10 })).toBe(true)
    m.drag({ x: 15, y: 12 }); m.release({ x: 20, y: 30 })
    m.release({ x: 99, y: 99 }) // a repeated release finds nothing
    expect(log).toEqual(['begin', 'preview 5,2', 'commit 10,20'])
    const b = target()
    m.press(b.t, { x: 1, y: 1 }); m.release({ x: 1, y: 1 })
    expect(b.log).toEqual(['begin', 'cancel'])
  })
  it('a refused begin starts nothing', () => {
    const m = createMover(), { t, log } = target({ refuse: true })
    expect([m.press(t, { x: 0, y: 0 }), m.running]).toEqual([false, null])
    m.drag({ x: 5, y: 5 }); m.release({ x: 5, y: 5 })
    expect(log).toEqual(['begin'])
  })
})

describe('a key run', () => {
  it('the sizes passed in: single, Shift the long one, Option or Ctrl the short one; Shift with Option or Ctrl the single one', () => {
    const one = (mods: { shift?: boolean; alt?: boolean; ctrl?: boolean }) => {
      const m = createMover(), { t, log } = target()
      kd(m, () => t, down('ArrowRight', mods), { step: 2, long: 15, short: 0.25 })
      return log[1]
    }
    expect([one({}), one({ shift: true }), one({ alt: true }), one({ ctrl: true }), one({ shift: true, alt: true }), one({ shift: true, ctrl: true })])
      .toEqual(['preview 2,0', 'preview 15,0', 'preview 0.25,0', 'preview 0.25,0', 'preview 2,0', 'preview 2,0'])
  })
  it('sizes are fixed when the run begins; two runs may use different sizes', () => {
    const m = createMover(), { t, log } = target()
    kd(m, () => t, down('ArrowRight'), { step: 2, long: 20, short: 0.2 })
    kd(m, () => t, down('ArrowRight', { repeat: true }), { step: 5, long: 50, short: 0.5 }) // the run keeps its own
    m.keyUp('ArrowRight')
    kd(m, () => t, down('ArrowLeft'), { step: 5, long: 50, short: 0.5 })
    m.keyUp('ArrowLeft')
    expect(log).toEqual(['begin', 'preview 2,0', 'preview 4,0', 'commit 4,0', 'begin', 'preview -5,0', 'commit -5,0'])
  })
  it('bad sizes are refused before anything begins: not finite, 0, negative, more than 10 decimals', () => {
    for (const bad of [NaN, Infinity, 0, -1, 0.12345678901, 1e16, 2e15 + 0.5]) {
      const m = createMover(), { t, log } = target()
      expect(() => kd(m, () => t, down('ArrowRight'), { step: 1, long: 10, short: bad })).toThrow(/move step/)
      expect([log, m.running]).toEqual([[], null])
    }
  })
  it('sizes in scientific notation count exactly (1e-7); a step that would leave the safe integers is not taken', () => {
    const m = createMover(), { t, log } = target()
    kd(m, () => t, down('ArrowRight', { alt: true }), { step: 1e-6, long: 1e-5, short: 1e-7 })
    kd(m, () => t, down('ArrowRight', { alt: true, repeat: true }), { step: 1e-6, long: 1e-5, short: 1e-7 })
    expect(log.slice(1)).toEqual(['preview 1e-7,0', 'preview 2e-7,0'])
    m.cancel()
    const big = createMover(), b = target()
    const sz = { step: 4e15, long: 4e15, short: 4e15 } // whole units, near the safe limit (9.007e15)
    kd(big, () => b.t, down('ArrowRight'), sz); kd(big, () => b.t, down('ArrowRight', { repeat: true }), sz); kd(big, () => b.t, down('ArrowRight', { repeat: true }), sz)
    expect(b.log.slice(1)).toEqual(['preview 4000000000000000,0', 'preview 8000000000000000,0']) // the third would pass the limit
  })
  it('mixed sizes that come back to the start are exactly zero: single 0.3, then three short −0.1 — no commit (dot 1791769354)', () => {
    const m = createMover(), { t, log } = target()
    const sz = { step: 0.3, long: 3, short: 0.1 }
    kd(m, () => t, down('ArrowRight'), sz)
    for (let k = 0; k < 3; k++) kd(m, () => t, down('ArrowLeft', { alt: true, repeat: k > 0 }), sz)
    m.keyUp('ArrowRight'); m.keyUp('ArrowLeft')
    expect(log.at(-2)).toBe('preview 0,0')
    expect([log.at(-1), log.some(x => x.startsWith('commit'))]).toEqual(['cancel', false])
  })
  it('a repeat moves only for a key whose real press this run took: an old key\'s repeats do nothing in a new run (dot 1791769354)', () => {
    const m = createMover(), { t, log } = target()
    kd(m, () => t, down('ArrowRight')); m.cancel() // → held, then blur
    kd(m, () => t, down('ArrowUp')) // a real press: a new run
    kd(m, () => t, down('ArrowRight', { repeat: true })) // the old key's repeat
    kd(m, () => t, down('ArrowUp', { repeat: true }))
    m.keyUp('ArrowUp')
    expect(log).toEqual(['begin', 'preview 1,0', 'cancel', 'begin', 'preview 0,-1', 'preview 0,-2', 'commit 0,-2'])
  })
  it('repeats add; another arrow joins; one commit when the last arrow is released', () => {
    const m = createMover(), { t, log } = target()
    kd(m, () => t, down('ArrowRight')); kd(m, () => t, down('ArrowRight', { repeat: true })); kd(m, () => t, down('ArrowDown', { shift: true }))
    m.keyUp('ArrowRight')
    expect(m.running).toBe('keys')
    m.keyUp('ArrowDown')
    expect(log).toEqual(['begin', 'preview 1,0', 'preview 2,0', 'preview 2,10', 'commit 2,10'])
    expect(m.running).toBeNull()
  })
  it('a run that comes back to its start commits nothing — exactly, with Option steps too', () => {
    const m = createMover(), { t, log } = target()
    for (let k = 0; k < 3; k++) kd(m, () => t, down('ArrowRight', { alt: true, repeat: k > 0 }))
    for (let k = 0; k < 3; k++) kd(m, () => t, down('ArrowLeft', { alt: true, repeat: k > 0 }))
    m.keyUp('ArrowRight'); m.keyUp('ArrowLeft')
    expect(log.at(-1)).toBe('cancel')
    expect(log.filter(x => x.startsWith('commit'))).toEqual([])
  })
  it('a repeat never starts a session: after a cancel, a held key does nothing until a real press', () => {
    const m = createMover(), { t, log } = target()
    kd(m, () => t, down('ArrowUp')); m.cancel()
    expect(kd(m, () => t, down('ArrowUp', { repeat: true }))).toBe(true)
    expect([m.running, log]).toEqual([null, ['begin', 'preview 0,-1', 'cancel']])
    m.keyUp('ArrowUp') // a late release writes nothing
    expect(log.length).toBe(3)
  })
  it('a key that is not an arrow is not taken; no target, or a refused one, starts nothing', () => {
    const m = createMover(), { t } = target({ refuse: true })
    expect([kd(m, () => t, down('a')), kd(m, () => undefined, down('ArrowUp')), kd(m, () => t, down('ArrowUp')), m.running]).toEqual([false, false, false, null])
  })
})

describe('one session at a time; cancel; end before commit', () => {
  it('keys during a drag are taken and ignored; a press during a key run is refused', () => {
    const m = createMover(), a = target(), b = target()
    m.press(a.t, { x: 0, y: 0 })
    expect(kd(m, () => b.t, down('ArrowLeft'))).toBe(true)
    expect(b.log).toEqual([])
    m.release({ x: 3, y: 0 })
    kd(m, () => b.t, down('ArrowLeft'))
    expect(m.press(a.t, { x: 0, y: 0 })).toBe(false)
    expect(a.log).toEqual(['begin', 'commit 3,0'])
  })
  it('cancel writes nothing, for a drag and a key run alike; a release after it writes nothing', () => {
    const m = createMover(), a = target(), b = target()
    m.press(a.t, { x: 0, y: 0 }); m.drag({ x: 9, y: 9 }); m.cancel(); m.release({ x: 9, y: 9 })
    kd(m, () => b.t, down('ArrowRight')); m.cancel(); m.keyUp('ArrowRight')
    expect([a.log, b.log]).toEqual([['begin', 'preview 9,9', 'cancel'], ['begin', 'preview 1,0', 'cancel']])
  })
  it('the session has ended before its commit: a commit that re-enters, or throws, never commits twice', () => {
    const m = createMover()
    let reentered = false
    const { t, log } = target({ onCommit: () => { expect(m.running).toBeNull(); m.release({ x: 50, y: 50 }); m.keyUp('ArrowRight'); reentered = true } })
    m.press(t, { x: 0, y: 0 }); m.release({ x: 4, y: 0 })
    expect([reentered, log.filter(x => x.startsWith('commit'))]).toEqual([true, ['commit 4,0']])
    const thrower: Target = { begin: () => true, preview: () => {}, commit: () => { throw new Error('refused') }, cancel: () => {} }
    kd(m, () => thrower, down('ArrowRight'))
    expect(() => m.keyUp('ArrowRight')).toThrow('refused')
    expect(m.running).toBeNull()
  })
  it('imports nothing', () => {
    expect(readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')).not.toMatch(/^import /m)
  })
})
