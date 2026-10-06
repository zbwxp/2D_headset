// Stage 4 (doc 18 §21.2 / §21.3): a pick through a reference instance selects on the placement side; duplicate.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import { graphProblems } from '../src/model'
import { schema, type DocRecord } from '../src/schema'
import { Editor } from '../src/editor'
import { evaluate, hitTest } from '../src/evaluate'
import { exampleRecords, ids } from '../src/fixture'
import { topContainerOfHit } from '../src/select'

describe('pick → top-level container', () => {
  it('R1 (placed in L1) shows E1 (source in L3): a pick on the instance selects L1, a pick on E1 itself selects L3', () => {
    const e = new Editor(exampleRecords())
    const ev = e.derived.evaluated()
    const inst = ev.curves.find((c) => c.address === `${ids.R1}/${ids.E1}`)!
    const src = ev.curves.find((c) => c.address === ids.E1)!
    const mid = (c: typeof inst) => c.segments[0].cubic[0]
    const onInst = hitTest(ev, mid(inst), { mode: 'V', tolerance: 0.5 })
    const onSrc = hitTest(ev, mid(src), { mode: 'V', tolerance: 0.5 })
    expect(onInst?.kind === 'segment' && onInst.referenceId).toBe(ids.R1)
    expect(topContainerOfHit(e.reader, onInst!)).toBe(ids.L1)
    expect(topContainerOfHit(e.reader, onSrc!)).toBe(ids.L3)
  })
})


const unlocked = () => exampleRecords().map((r) => (r.id === ids.L2 ? { ...r, locked: false } : r))
const roundTrip = (e: Editor, cmd: Command) => {
  const before = JSON.stringify(e.reader.allRecords())
  const op = e.prepare()
  const pv = op.preview(cmd)
  expect(pv.ok, JSON.stringify(pv)).toBe(true)
  const shown = pv.ok ? e.derived.preview(pv.puts, e.derived.previewChanges(pv.puts, pv.removals)) : undefined
  const r = op.commit()
  expect(r.ok && r.written, JSON.stringify(r)).toBe(true)
  if (!r.ok || !pv.ok) throw new Error()
  expect(r.affected).toEqual(pv.affected)
  expect(e.derived.evaluated()).toEqual(shown)
  expect(graphProblems(e.reader)).toEqual([])
  const after = JSON.stringify(e.reader.allRecords())
  expect(e.undo()).toBe(true)
  expect(JSON.stringify(e.reader.allRecords())).toBe(before)
  expect(e.redo()).toBe(true)
  expect(JSON.stringify(e.reader.allRecords())).toBe(after)
  expect(evaluate(Editor.open(JSON.parse(JSON.stringify(e.save()))).reader)).toEqual(evaluate(e.reader))
  return r
}

describe('duplicate (doc 18 §21.3)', () => {
  it('a container: new ids, internal dependencies re-pointed; a connection reaching outside is NOT copied; the reference keeps its uncopied source; the curve’s head-turn track goes along', () => {
    const e = new Editor(unlocked())
    expect(e.apply({ type: 'setPoseKey', curveId: ids.C1, yaw: 40, offsets: { a2: { x: 2, y: 1 } } }).ok).toBe(true)
    const r = roundTrip(e, { type: 'duplicate', ids: [ids.L1] })
    const copy = (id: string) => `${id}~copy`
    expect(r.affected.sort()).toEqual([copy(ids.C1), copy(ids.L1), copy(ids.R1), `forms:document/${copy(ids.C1)}`].sort())
    expect((e.reader.get(copy(ids.C1) as any) as any).parentId).toBe(copy(ids.L1))
    expect((e.reader.get(copy(ids.R1) as any) as any).sourceId).toBe(ids.L3) // a placement of the same source
    expect(e.reader.allRecords().filter((x) => x.typeName === 'connection').length).toBe(2) // J / J0 reach C2 (not copied): not copied
    // independent: editing the original leaves the copy alone
    const c = JSON.stringify(e.reader.get(copy(ids.C1) as any))
    expect(e.apply({ type: 'moveAnchors', targets: [{ curveId: ids.C1, anchorId: 'a2' }], delta: { x: 5, y: 0 } }).ok).toBe(true)
    expect(JSON.stringify(e.reader.get(copy(ids.C1) as any))).toBe(c)
  })

  it('both containers: the connections and the fill between them are copied and re-pointed to the copies', () => {
    const e = new Editor(unlocked())
    roundTrip(e, { type: 'duplicate', ids: [ids.L1, ids.L2] })
    const J = e.reader.get(`${ids.J}~copy` as any) as any
    expect(J.ends.map((x: any) => x.curveId)).toEqual([`${ids.C1}~copy`, `${ids.C2}~copy`])
    const F = e.reader.get(`${ids.F}~copy` as any) as any
    expect(new Set(F.boundary.map((b: any) => b.curveId))).toEqual(new Set([`${ids.C1}~copy`, `${ids.C2}~copy`]))
  })

  it('refused: a fill whose boundary curves are not all copied; preset-form (family) curves; creating inside a locked container', () => {
    const e = new Editor(unlocked())
    const r = e.apply({ type: 'duplicate', ids: [ids.F] })
    expect(r.ok === false && r.error.message).toMatch(/reads curve:C1, curve:C2, which is not being duplicated/)
    const s = JSON.parse(readFileSync('test/fixtures/stage1-valid.json', 'utf8')).records as DocRecord[]
    const f = Editor.open({ store: Object.fromEntries(s.map((x) => [x.id, x])), schema: schema.serialize() } as any)
    const g = f.apply({ type: 'duplicate', ids: ['curve:lid'] })
    expect(g.ok === false && g.error.message).toMatch(/preset family: duplicating preset-form curves is not supported yet/)
    const locked = new Editor(exampleRecords()) // L2 locked
    const h = locked.apply({ type: 'duplicate', ids: [ids.C2] })
    expect(h.ok === false && h.error.code).toBe('LOCKED')
  })

  it('a prepared duplicate previews and commits the same new ids; another selection gets its own', () => {
    const e = new Editor(unlocked())
    const op = e.prepare()
    const a = op.preview({ type: 'duplicate', ids: [ids.L3] })
    const b = op.preview({ type: 'duplicate', ids: [ids.L1] })
    const a2 = op.preview({ type: 'duplicate', ids: [ids.L3] })
    expect(a.ok && b.ok && a2.ok).toBe(true)
    if (!a.ok || !b.ok || !a2.ok) return
    expect(a2.affected).toEqual(a.affected)
    expect(b.affected.some((x) => a.affected.includes(x))).toBe(false)
  })
})

describe('review of stage 4 (dot 1791317224)', () => {
  it('a reference copied with one of its source curves but not the source container keeps its override keys (still the original source)', () => {
    const e = new Editor(unlocked())
    expect(e.apply({ type: 'moveOverride', referenceId: ids.R1, target: { curveId: ids.E1, anchorId: 'e1' }, delta: { x: 1, y: 2 } }).ok).toBe(true)
    roundTrip(e, { type: 'duplicate', ids: [ids.R1, ids.E1] })
    const r2 = e.reader.get(`${ids.R1}~copy` as any) as any
    expect(r2.sourceId).toBe(ids.L3)
    expect(Object.keys(r2.overrides)).toEqual([`${ids.E1}#e1`])
  })

  // dot 1791317344's counterexample: `curve:a` and `curve:a!` share an index, so the id breaks the tie (a < a!); copied
  // ids must not decide the copies' order (with '!copy', 'a!!copy' < 'a!copy' swapped them)
  const tied = (inside?: string) => {
    const rs = exampleRecords().map((r) => (r.id === ids.L2 ? { ...r, locked: false } : r)) as any[]
    const e1 = rs.find((r) => r.id === ids.E1)
    if (inside) rs.push({ ...structuredClone(rs.find((r) => r.id === ids.L1)), id: inside, index: 'a9' })
    const mk = (id: string) => ({ ...structuredClone(e1), id, index: 'a5', ...(inside ? { parentId: inside } : {}) })
    rs.push(mk('curve:a'), mk('curve:a!'))
    return new Editor(rs)
  }
  const orderOf = (e: Editor, re: RegExp) => e.derived.evaluated().paint.map((p) => p.item.address).filter((a) => re.test(a))

  it('top-level copies go as one block on top of their container, in the originals’ paint order (ids do not decide it)', () => {
    const e = tied()
    const parent = (e.reader.get('curve:a' as any) as any).parentId
    const before = orderOf(e, /./)
    roundTrip(e, { type: 'duplicate', ids: ['curve:a!', 'curve:a'] })
    expect(orderOf(e, /^curve:a!?(~copy)?$/)).toEqual(['curve:a', 'curve:a!', 'curve:a~copy', 'curve:a!~copy'])
    // nothing else moved, and the block is above every other child of that container
    expect(orderOf(e, /./).filter((a) => !/~copy/.test(a))).toEqual(before)
    const kids = e.reader.allRecords().filter((r: any) => r.parentId === parent && !/~copy/.test(r.id)).map((r: any) => r.index)
    for (const c of ['curve:a~copy', 'curve:a!~copy']) for (const k of kids) expect((e.reader.get(c as any) as any).index > k).toBe(true)
  })

  it('inside a copied container the copies get fresh indices in the originals’ total order (a tie of the originals cannot swap)', () => {
    const e = tied('container:X')
    roundTrip(e, { type: 'duplicate', ids: ['container:X'] })
    expect(orderOf(e, /^curve:a!?~copy$/)).toEqual(['curve:a~copy', 'curve:a!~copy'])
    const [a, b] = ['curve:a~copy', 'curve:a!~copy'].map((c) => (e.reader.get(c as any) as any).index)
    expect(a < b).toBe(true)
  })
})
