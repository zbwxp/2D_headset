// autosave (docs/autosave-plan.md; dot 1791704242, 1791704319): restore before saving, writes in
// order with a re-compare after each, failures keep the newest text, one writer per page. These run on
// an in-memory store whose writes the test finishes one by one; the IndexedDB adapter is checked in a
// real browser (listed in the hand-in), not here.
import { describe, it, expect, beforeEach } from 'vitest'
import { createAutosave, resetPage, CURRENT, type Store } from '../index'

/** A store whose reads and writes wait until the test settles them. */
function slowStore(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial }
  const writes: { key: string; value: string; done(): void; fail(e: string): void }[] = []
  let readFail: string | undefined, readGate: Promise<void> = Promise.resolve()
  const store: Store = {
    async get(key) { await readGate; if (readFail) throw new Error(readFail); return data[key] },
    put(key, value) { return new Promise<void>((res, rej) => { writes.push({ key, value, done: () => { data[key] = value; res() }, fail: e => rej(new Error(e)) }) }) },
  }
  return { store, data, writes, failRead: (e: string) => { readFail = e }, holdRead: () => { let open!: () => void; readGate = new Promise(r => { open = r }); return () => open() } }
}
const tick = () => new Promise(r => setTimeout(r, 0))
beforeEach(() => resetPage())

function drawing(text = 'empty') {
  const d = { text, applied: [] as string[] }
  return { d, options: { apply: (t: string) => { if (t.startsWith('bad')) throw new Error('not a drawing'); d.text = t; d.applied.push(t) }, current: () => d.text, changed: () => {}, now: () => 42 } }
}

describe('restore, then save', () => {
  it('a stored drawing is applied on start; nothing is written before the read returns, and the same text is not rewritten', async () => {
    const s = slowStore({ [CURRENT]: 'A' }), release = s.holdRead(), { d, options } = drawing()
    const a = createAutosave(s.store, options)
    const started = a.start()
    d.text = 'drawn-early'; a.want()
    expect([a.status().state, s.writes.length]).toEqual(['restoring', 0])
    release(); await started
    expect([d.applied, a.status().state, s.writes.length]).toEqual([['A'], 'saved', 0])
  })

  it('an unreadable saved drawing is backed up before the first write; a failed backup leaves autosave off and writes nothing', async () => {
    const s = slowStore({ [CURRENT]: 'bad file' }), { d, options } = drawing('new')
    const a = createAutosave(s.store, options)
    const started = a.start()
    await tick()
    expect(s.writes.map(w => w.key)).toEqual(['unreadable-42'])
    s.writes.shift()!.done(); await started; await tick()
    expect(a.status().notice).toMatch(/kept as unreadable-42/)
    expect(s.writes.map(w => [w.key, w.value])).toEqual([[CURRENT, 'new']])
    void d
    resetPage()
    const t = slowStore({ [CURRENT]: 'bad file' }), b = createAutosave(t.store, drawing('new').options)
    const startedB = b.start(); await tick()
    t.writes.shift()!.fail('quota')
    await startedB
    expect([b.status().state, t.writes.length, t.data[CURRENT]]).toEqual(['off', 0, 'bad file'])
  })

  it('a failed read leaves autosave off and the store untouched; a restore returning after dispose applies nothing', async () => {
    const s = slowStore({ [CURRENT]: 'A' }); s.failRead('blocked')
    const a = createAutosave(s.store, drawing().options)
    await a.start(); a.want()
    expect([a.status().state, s.writes.length]).toEqual(['off', 0])
    resetPage()
    const t = slowStore({ [CURRENT]: 'A' }), release = t.holdRead(), { d, options } = drawing()
    const b = createAutosave(t.store, options)
    const started = b.start(); b.dispose(); release(); await started
    expect(d.applied).toEqual([])
  })
})

describe('saving in order', () => {
  async function ready(initial = 'A') {
    const s = slowStore({ [CURRENT]: initial }), { d, options } = drawing()
    const a = createAutosave(s.store, options)
    await a.start()
    return { s, d, a }
  }

  it('A on disk, B being written, undo back to A: the disk ends with A (dot 1791704242)', async () => {
    const { s, d, a } = await ready('A')
    d.text = 'B'; a.want(); await tick()
    expect(a.status().state).toBe('saving')
    d.text = 'A'; a.want()
    s.writes.shift()!.done(); await tick()
    expect(s.writes.map(w => w.value)).toEqual(['A'])
    s.writes.shift()!.done(); await tick()
    expect([s.data[CURRENT], a.status().state, a.unsaved()]).toEqual(['A', 'saved', false])
  })

  it('three quick changes: one write at a time, the newest last, never an older after a newer', async () => {
    const { s, d, a } = await ready('A')
    d.text = 'B'; a.want(); await tick()
    d.text = 'C'; a.want(); d.text = 'D'; a.want()
    expect(s.writes.length).toBe(1)
    s.writes.shift()!.done(); await tick()
    expect(s.writes.map(w => w.value)).toEqual(['D'])
    s.writes.shift()!.done(); await tick()
    expect(s.data[CURRENT]).toBe('D')
  })

  it('a failed write: not saved, the baseline kept, the newest text retried by the next change', async () => {
    const { s, d, a } = await ready('A')
    d.text = 'B'; a.want(); await tick()
    s.writes.shift()!.fail('transaction aborted'); await tick()
    expect([a.status(), a.unsaved(), s.data[CURRENT]]).toEqual([{ state: 'failed', error: 'transaction aborted' }, true, 'A'])
    d.text = 'C'; a.want(); await tick()
    s.writes.shift()!.done(); await tick()
    expect([s.data[CURRENT], a.status().state]).toEqual(['C', 'saved'])
  })

  it('one writer per page: a new instance waits for the old one\'s write in flight, and the old one writes no more', async () => {
    const s = slowStore({ [CURRENT]: 'A' }), first = drawing()
    const a = createAutosave(s.store, first.options)
    await a.start()
    first.d.text = 'B'; a.want(); await tick()
    const second = drawing(), b = createAutosave(s.store, second.options) // mounted while B is being written
    first.d.text = 'C'; a.want(); await tick()
    expect(s.writes.length).toBe(1)
    s.writes.shift()!.done(); await tick() // B lands
    await b.start(); await tick()
    expect(s.writes.map(w => w.value)).toEqual([]) // b restored B (equal), a stopped
    second.d.text = 'E'; b.want(); await tick()
    expect(s.writes.map(w => w.value)).toEqual(['E'])
  })
})
