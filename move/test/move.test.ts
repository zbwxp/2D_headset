// move/ (docs/move-plan.md; dot 1791733489): sessions for a drag and a key run — one commit, cancel paths,
// step sizes, one session at a time, end before commit; no imports.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMover, stepOf, type Target, type Vec } from '../index'

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
  it('steps 1, Shift 10, Option 0.1, Ctrl 0.1; Shift with Option or Ctrl gives 1 (the factors multiply)', () => {
    expect([stepOf({}), stepOf({ shift: true }), stepOf({ alt: true }), stepOf({ ctrl: true }), stepOf({ shift: true, alt: true }), stepOf({ shift: true, ctrl: true })]).toEqual([1, 10, 0.1, 0.1, 1, 1])
  })
  it('repeats add; another arrow joins; one commit when the last arrow is released', () => {
    const m = createMover(), { t, log } = target()
    m.keyDown(() => t, down('ArrowRight')); m.keyDown(() => t, down('ArrowRight', { repeat: true })); m.keyDown(() => t, down('ArrowDown', { shift: true }))
    m.keyUp('ArrowRight')
    expect(m.running).toBe('keys')
    m.keyUp('ArrowDown')
    expect(log).toEqual(['begin', 'preview 1,0', 'preview 2,0', 'preview 2,10', 'commit 2,10'])
    expect(m.running).toBeNull()
  })
  it('a run that comes back to its start commits nothing — exactly, with Option steps too', () => {
    const m = createMover(), { t, log } = target()
    for (let k = 0; k < 3; k++) m.keyDown(() => t, down('ArrowRight', { alt: true, repeat: k > 0 }))
    for (let k = 0; k < 3; k++) m.keyDown(() => t, down('ArrowLeft', { alt: true, repeat: k > 0 }))
    m.keyUp('ArrowRight'); m.keyUp('ArrowLeft')
    expect(log.at(-1)).toBe('cancel')
    expect(log.filter(x => x.startsWith('commit'))).toEqual([])
  })
  it('a repeat never starts a session: after a cancel, a held key does nothing until a real press', () => {
    const m = createMover(), { t, log } = target()
    m.keyDown(() => t, down('ArrowUp')); m.cancel()
    expect(m.keyDown(() => t, down('ArrowUp', { repeat: true }))).toBe(true)
    expect([m.running, log]).toEqual([null, ['begin', 'preview 0,-1', 'cancel']])
    m.keyUp('ArrowUp') // a late release writes nothing
    expect(log.length).toBe(3)
  })
  it('a key that is not an arrow is not taken; no target, or a refused one, starts nothing', () => {
    const m = createMover(), { t } = target({ refuse: true })
    expect([m.keyDown(() => t, down('a')), m.keyDown(() => undefined, down('ArrowUp')), m.keyDown(() => t, down('ArrowUp')), m.running]).toEqual([false, false, false, null])
  })
})

describe('one session at a time; cancel; end before commit', () => {
  it('keys during a drag are taken and ignored; a press during a key run is refused', () => {
    const m = createMover(), a = target(), b = target()
    m.press(a.t, { x: 0, y: 0 })
    expect(m.keyDown(() => b.t, down('ArrowLeft'))).toBe(true)
    expect(b.log).toEqual([])
    m.release({ x: 3, y: 0 })
    m.keyDown(() => b.t, down('ArrowLeft'))
    expect(m.press(a.t, { x: 0, y: 0 })).toBe(false)
    expect(a.log).toEqual(['begin', 'commit 3,0'])
  })
  it('cancel writes nothing, for a drag and a key run alike; a release after it writes nothing', () => {
    const m = createMover(), a = target(), b = target()
    m.press(a.t, { x: 0, y: 0 }); m.drag({ x: 9, y: 9 }); m.cancel(); m.release({ x: 9, y: 9 })
    m.keyDown(() => b.t, down('ArrowRight')); m.cancel(); m.keyUp('ArrowRight')
    expect([a.log, b.log]).toEqual([['begin', 'preview 9,9', 'cancel'], ['begin', 'preview 1,0', 'cancel']])
  })
  it('the session has ended before its commit: a commit that re-enters, or throws, never commits twice', () => {
    const m = createMover()
    let reentered = false
    const { t, log } = target({ onCommit: () => { expect(m.running).toBeNull(); m.release({ x: 50, y: 50 }); m.keyUp('ArrowRight'); reentered = true } })
    m.press(t, { x: 0, y: 0 }); m.release({ x: 4, y: 0 })
    expect([reentered, log.filter(x => x.startsWith('commit'))]).toEqual([true, ['commit 4,0']])
    const thrower: Target = { begin: () => true, preview: () => {}, commit: () => { throw new Error('refused') }, cancel: () => {} }
    m.keyDown(() => thrower, down('ArrowRight'))
    expect(() => m.keyUp('ArrowRight')).toThrow('refused')
    expect(m.running).toBeNull()
  })
  it('imports nothing', () => {
    expect(readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')).not.toMatch(/^import /m)
  })
})
