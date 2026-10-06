// Stage 3a (doc 18 §24 v2): prepare a character once, play it read-only; cache and runtime entry.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ctxOf, playCharacter, prepareCharacter, type CharacterGrid } from '../src/character'
import { counters } from '../src/counters'
import { Editor } from '../src/editor'
import { RULES } from '../src/forms'
import { evaluateSaved } from '../src/runtime'
import { schema, type DocRecord, type Shape } from '../src/schema'

const json = (f: string) => JSON.parse(readFileSync(`test/fixtures/${f}`, 'utf8'))
const sample = (): any[] => json('stage1-valid.json').records
const openRecords = (rs: DocRecord[]) => Editor.open({ store: Object.fromEntries(rs.map((r) => [r.id, r])), schema: schema.serialize() } as any)
const K = 'character:K'
const prep = (rs: any[]) => prepareCharacter(ctxOf({ get: (id: string) => rs.find((r) => r.id === id), allRecords: () => rs } as any), K)
const ok = (p: ReturnType<typeof prep>): CharacterGrid => {
  if (!p.ok) throw new Error(p.problems.join('; '))
  return p.grid
}
const play = (g: CharacterGrid, yaw?: number, blink = 0) => {
  const r = playCharacter(g, { yaw, params: { blink } })
  if (!r.ok) throw new Error(r.problems.join('; '))
  return r
}
const gap = (s: Record<string, Shape>) => Math.hypot(s['curve:lid'].b.p.x - s['curve:lowerLid'].d.p.x, s['curve:lid'].b.p.y - s['curve:lowerLid'].d.p.y)
const maxDiff = (a: Shape, b: Shape) => Math.max(...Object.keys(a).flatMap((k) => (['p', 'hIn', 'hOut'] as const).map((h) => Math.hypot(a[k][h].x - b[k][h].x, a[k][h].y - b[k][h].y))))
const YAWS = [-120, -60, -30, 0, 15, 30, 45, 60, 75, 89, 90, 120]

describe('prepare / play on the stage-1 sample', () => {
  it('the positive sample prepares; the grid covers every key yaw; shared corners coincide everywhere (neutral and closed)', () => {
    const g = ok(prep(sample()))
    expect(g.yaws).toEqual([-60, 0, 45, 90])
    expect(g.params).toEqual(['blink'])
    for (const y of YAWS) for (const b of [0, 0.5, 1]) expect(gap(play(g, y, b).shapes)).toBe(0)
  })

  it('the negative sample (Q has only the identity of the strand) is reported, never renormalised', () => {
    const p = prep(json('stage1-invalid-missing.json').records)
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.problems.join()).toMatch(/preset:Q \(weight 0.4\) has no shape for curve:strand \(identity only\)/)
  })

  it('weights must sum to 1 (never renormalised); presets disagreeing on visibility are refused', () => {
    const rs = sample()
    rs.find((r) => r.id === K).weights['preset:Q'] = 0.5
    expect(prep(rs).ok).toBe(false)
    const vis = sample()
    vis.find((r) => r.id === 'visibility:preset:Q/curve:strand').keys[1].yaw = 40
    const p = prep(vis)
    expect(p.ok === false && p.problems.join()).toMatch(/disagree on visibility at yaw 30/)
  })

  it('T(0) = 0: without fine-tune a preset key with no helper domain is read as drawn (Q strand@90); with fine-tune the basis is reported missing', () => {
    expect(prep(sample()).ok).toBe(true) // Q has no helper domain at 90, strand has no fine-tune
    const rs = sample()
    rs.find((r) => r.id === K).fineTune['curve:strand'] = { w: { dp: { x: 1, y: 0 }, dIn: { x: 1, y: 0 }, dOut: { x: 1, y: 0 } } }
    const p = prep(rs)
    expect(p.ok === false && p.problems.join()).toMatch(/preset:Q has no helper domain at yaw 90 to carry the fine-tune of curve:strand/)
  })

  it('a curve with no original still plays from its yaw track; only the no-yaw context needs the original', () => {
    const g = ok(prep(sample()))
    const s = play(g, 120).shapes['curve:strand']
    expect(s.u.p.x).toBeCloseTo(0.6 * 35 + 0.4 * 34, 12) // P strand(5) / Q strand(4), clamped at 90
    const noYaw = playCharacter(g, {})
    expect(noYaw.ok === false && noYaw.problems.join()).toMatch(/no-yaw context needs an original/)
  })

  it('visibility is the agreed stepped track (hidden below 30)', () => {
    const g = ok(prep(sample()))
    expect(play(g, 29).visible['curve:strand']).toBe(false)
    expect(play(g, 30).visible['curve:strand']).toBe(true)
    expect(play(g, 0).visible['curve:lid']).toBe(true)
  })
})

describe('takeovers and expressions', () => {
  it('a line takeover that does not take the node leaves the shared corner at the normal node result', () => {
    const rs = sample()
    const k = rs.find((r) => r.id === K)
    k.takeovers = k.takeovers.filter((t: any) => t.kind === 'line') // no node takeover
    const g = ok(prep(rs))
    const base = sample()
    const kb = base.find((r) => r.id === K)
    kb.takeovers = []
    const g0 = ok(prep(base))
    for (const y of YAWS) {
      const a = play(g, y).shapes, b = play(g0, y).shapes
      expect(a['curve:lowerLid'].d.p).toEqual(b['curve:lowerLid'].d.p) // the node did not move …
      expect(gap(a)).toBe(0) // … and the taken-over line still ends on it
    }
  })

  it('a node takeover covers its whole range 0 → θₜ: no gap at any in-between angle (0.45 at 45° if it covered 90° only)', () => {
    const g = ok(prep(sample()))
    for (const y of [0, 10, 30, 45, 60, 75, 89, 90]) expect(gap(play(g, y).shapes)).toBe(0)
    const at90 = play(g, 90).shapes['curve:lowerLid'].d.p
    expect(at90).toEqual({ x: 15.5, y: -0.4 }) // basisFront (10, 0) = the current front: target exactly
  })

  it('takeovers ending inside a direction, or overlapping, are refused', () => {
    const rs = sample()
    const k = rs.find((r) => r.id === K)
    k.takeovers[0].state.yaw = 45
    k.takeovers[0].direction.to = 45
    expect(prep(rs).ok === false && (prep(rs) as any).problems.join()).toMatch(/inside the positive range/)
    const ov = sample()
    const k2 = ov.find((r) => r.id === K)
    k2.takeovers.push({ ...structuredClone(k2.takeovers[0]), id: 'takeover:lid@90b' })
    expect((prep(ov) as any).problems.join()).toMatch(/overlaps another takeover/)
  })

  it('a character expression fix reproduces its target when the base is unchanged (10 / 12 / 13 → 13); clearing it restores the inherited result', () => {
    const rs = sample()
    const k = rs.find((r) => r.id === K)
    k.exprFixes = []
    const inherited = ok(prep(rs))
    // capture the current base at 90 as fixExpression would: the rule on the character's lower lid there
    const i90 = inherited.yaws.indexOf(90)
    const rule = rs.find((r) => r.id === 'rule:eye/blink')
    const base = RULES.lidClose.apply(inherited.curves['curve:lowerLid'].neutral[i90], rule.correspondence)!
    const target = Object.fromEntries(Object.entries(base).map(([a, q]) => [a, a === 'm' ? { p: { x: q.p.x, y: q.p.y - 2 }, hIn: { x: q.hIn.x, y: q.hIn.y - 2 }, hOut: { x: q.hOut.x, y: q.hOut.y - 2 } } : q])) as Shape
    k.exprFixes = [{ id: 'fix', curveId: 'curve:lid', state: { yaw: 90, blink: 1 }, target, base, ruleVersion: 1 }]
    const fixed = ok(prep(rs))
    expect(maxDiff(play(fixed, 90, 1).shapes['curve:lid'], target)).toBeLessThan(1e-12)
    k.exprFixes = []
    for (const y of YAWS) expect(play(ok(prep(rs)), y, 1).shapes).toEqual(play(inherited, y, 1).shapes)
  })

  it('an unmodified extra preset key never changes the closed track (sampling angles run no rule)', () => {
    const rs = sample()
    rs.find((r) => r.id === K).fineTune = {}
    const g = ok(prep(rs))
    // add a P neutral key at 30 equal to P's current interpolated form (what setPresetKey will capture)
    const extra = structuredClone(rs)
    for (const c of ['curve:lid', 'curve:lowerLid']) {
      const f = extra.find((r) => r.id === `forms:preset:P/${c}`)
      const k0 = f.yaw.find((k: any) => k.yaw === 0).shape, k90 = f.yaw.find((k: any) => k.yaw === 90).shape
      const at30 = Object.fromEntries(Object.keys(k0).map((a) => [a, Object.fromEntries((['p', 'hIn', 'hOut'] as const).map((h) => [h, { x: k0[a][h].x + (k90[a][h].x - k0[a][h].x) * (30 / 90), y: k0[a][h].y + (k90[a][h].y - k0[a][h].y) * (30 / 90) }]))]))
      f.yaw.splice(2, 0, { yaw: 30, shape: at30 })
    }
    const g2 = ok(prep(extra))
    for (const y of YAWS) expect(maxDiff(play(g2, y, 1).shapes['curve:lid'], play(g, y, 1).shapes['curve:lid'])).toBeLessThan(1e-12)
  })
})

describe('cache, budget and the runtime entry', () => {
  it('prepare once, play many; edits elsewhere do not rebuild; an edit the character reads does; undo returns the same grid', () => {
    const e = openRecords(sample())
    const before = counters.characterPrepares
    const first = e.derived.characterAt(K, { yaw: 30, params: { blink: 0.5 } })
    expect(first.ok).toBe(true)
    for (const y of [-60, 0, 45, 90]) e.derived.characterAt(K, { yaw: y })
    expect(counters.characterPrepares - before).toBe(1)
    expect(e.apply({ type: 'moveAnchors', targets: [{ curveId: 'curve:C1' as any, anchorId: 'a2' }], delta: { x: 1, y: 0 } }).ok).toBe(true) // not read by the character
    e.derived.characterAt(K, { yaw: 30 })
    expect(counters.characterPrepares - before).toBe(1)
    const grid = JSON.stringify(e.derived.character(K))
    expect(e.apply({ type: 'deleteRecords', ids: ['helperDomain:Q/45'] }).ok).toBe(true) // read (fine-tune transfer)
    const missing = e.derived.characterAt(K, { yaw: 30 })
    expect(missing.ok === false && missing.problems.join()).toMatch(/preset:Q has no helper domain at yaw 45/)
    expect(counters.characterPrepares - before).toBe(2)
    expect(e.undo()).toBe(true)
    expect(JSON.stringify(e.derived.character(K))).toBe(grid) // the same grid as before the deletion
  })

  it('the cache is weighed by the shapes it retains, in the shared budget', () => {
    const e = openRecords(sample())
    const used = e.derived.yawRetainedItems.used
    const p = e.derived.character(K)
    expect(p.ok).toBe(true)
    if (p.ok) expect(e.derived.yawRetainedItems.used - used).toBe(p.grid.retained)
    if (p.ok) expect(p.grid.retained).toBe(3 * 4 * 2 + 2) // 3 curves × 4 yaws × (neutral + blink) + the fronts of the two lids (strand has no original)
    expect(e.derived.yawRetainedItems.consistent()).toBe(true)
  })

  it('runtime evaluateSaved with a character = the maker’s cached view (family curves played, legacy curves unchanged)', () => {
    const e = openRecords(sample())
    for (const y of [-60, 10, 45, 90]) {
      const maker = e.derived.characterAt(K, { yaw: y, params: { blink: 0.25 } })
      if (!maker.ok) throw new Error()
      const rt = evaluateSaved(e.reader.allRecords(), { yaw: y, character: K, expr: { blink: 0.25 } })
      expect(rt).toEqual(maker.evaluated)
      expect(rt.curves.find((c) => c.address === 'curve:C1')).toEqual(e.derived.atYaw(y).curves.find((c) => c.address === 'curve:C1'))
    }
    expect(() => evaluateSaved(json('stage1-invalid-missing.json').records, { yaw: 0, character: K })).toThrow(/cannot be prepared: .*identity only/)
  })
})
