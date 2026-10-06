// Batch 2 limited experiment (doc 18 §20.8 v2). Tolerance for "picture unchanged" is explicit: TOL.
import { describe, expect, it } from 'vitest'
import {
  blinkRule, characterOpen, clearClosedFix, closedAt, closedAtKey, closedKeyYaws, deleteYawKey, fixClosed, fixture, grid,
  insertYawKey, lerpShape, maxDiff, play, presetOpen, visibleAt, type Doc, type Eval, type Shape,
} from '../src/experiments/stateTracks'

const TOL = 1e-9
const report: Record<string, unknown>[] = []
const got = (r: Eval): Shape => {
  if (!r.ok) throw new Error(r.reason)
  return r.shape
}
const isZero = (s: Shape) => Object.values(s).every((a) => [a.p, a.hIn, a.hOut].every((q) => q.x === 0 && q.y === 0))
const only = (d: Doc, w: Record<string, number>): Doc => ({ ...structuredClone(d), character: { ...structuredClone(d.character), weights: w } })
const yaws = Array.from({ length: 43 }, (_, i) => -120 + i * 5) // −120 … 90 step 5, plus outside the key range

describe('§20 where each state comes from', () => {
  it('evaluation context: no yaw vs yaw = 0 on the same document; arbitrary signed keys; clamp outside', () => {
    const d = only(fixture(), { P: 1 })
    const pc = d.presets.P.lid
    const noYaw = got(presetOpen(pc, {}))
    const yaw0 = got(presetOpen(pc, { yaw: 0 }))
    expect(noYaw).toEqual(pc.original) // the drawing context reads the original
    expect(yaw0).toEqual(pc.yaw[1].shape) // yaw = 0 reads the 0° key …
    expect(maxDiff(noYaw, yaw0)).toBeGreaterThan(0.1) // … which is a different, explicit form
    expect(got(presetOpen(pc, { yaw: -90 }))).toEqual(pc.yaw[0].shape) // clamp below −60
    expect(got(presetOpen(pc, { yaw: 120 }))).toEqual(pc.yaw[2].shape) // clamp above 90
    // a curve with an original and no yaw keys: both contexts give the original
    const brow = d.presets.P.brow
    expect(got(presetOpen(brow, {}))).toEqual(brow.original)
    expect(got(presetOpen(brow, { yaw: 37 }))).toEqual(brow.original)
    // only drawn at 90: no original in the no-yaw context (missing, not (0,0)); with a yaw the old clamp rule applies
    const strand = d.presets.P.strand
    const s0 = presetOpen(strand, {})
    expect(s0.ok).toBe(false)
    expect(got(presetOpen(strand, { yaw: 0 }))).toEqual(strand.yaw[0].shape)
    for (const s of [noYaw, yaw0, brow.original!]) expect(isZero(s)).toBe(false)
    report.push({ case: 'context', lidNoYawVsYaw0: +maxDiff(noYaw, yaw0).toFixed(3), strandNoYaw: s0.ok ? 'ok' : s0.reason })
  })

  it('inserting an unmodified key keeps the picture (tolerance); deleting re-evaluates, does not hide', () => {
    const d = fixture()
    const before = Object.fromEntries(yaws.map((y) => [y, got(characterOpen(d, 'lid', { yaw: y }))]))
    const ins = insertYawKey(d, 'P', 'lid', 30)
    let worst = 0
    for (const y of yaws) worst = Math.max(worst, maxDiff(got(characterOpen(ins, 'lid', { yaw: y })), before[y]))
    expect(worst).toBeLessThan(TOL)
    const del = deleteYawKey(d, 'P', 'lid', 0)
    const pc = d.presets.P.lid
    // P at 0 now interpolates its −60 and 90 keys
    expect(maxDiff(got(presetOpen(del.presets.P.lid, { yaw: 0 })), lerpShape(pc.yaw[0].shape, pc.yaw[2].shape, 60 / 150))).toBeLessThan(TOL)
    expect(del.visibility).toEqual(d.visibility) // deleting a shape key does not touch visibility
    report.push({ case: 'insert / delete key', insertWorst: worst })
  })

  it("dot's counterexample: an unmodified open key does not change the closed track anywhere", () => {
    const d = only(fixture(), { P: 1 })
    const keysBefore = closedKeyYaws(d, 'lid')
    const before = Object.fromEntries(yaws.map((y) => [y, got(closedAt(d, 'lid', y))]))
    // closed at 45 before = interpolation between the author key at 0 and the rule key at 90
    const k0 = got(closedAtKey(d, 'lid', 0)), k90 = got(closedAtKey(d, 'lid', 90))
    expect(maxDiff(before[45], lerpShape(k0, k90, 0.5))).toBeLessThan(TOL)
    const ins = insertYawKey(d, 'P', 'lid', 45)
    let worst = 0
    for (const y of yaws) worst = Math.max(worst, maxDiff(got(closedAt(ins, 'lid', y)), before[y]))
    expect(worst).toBeLessThan(TOL)
    expect(closedKeyYaws(ins, 'lid')).toEqual(keysBefore) // no closed key added
    expect(ins.presets.P.lid.closed).toEqual(d.presets.P.lid.closed) // no author key created
    // the rule at 45 would have given something else (what the rejected union-grid rule would have done)
    const ruleAt45 = blinkRule(got(characterOpen(ins, 'lid', { yaw: 45 })))
    report.push({ case: 'counterexample', closedWorst: worst, closedKeys: keysBefore, ruleAt45WouldMove: +maxDiff(ruleAt45, before[45]).toFixed(3) })
    expect(maxDiff(ruleAt45, before[45])).toBeGreaterThan(0.01)
  })

  it('grid: union of yaws, every cell a resample of its own track; playback bilinear, reads only the grid', () => {
    const d = fixture()
    const g = grid(d, 'lid')
    expect(g.map((c) => c.yaw)).toEqual([-60, 0, 45, 90])
    for (const c of g) {
      expect(c.open.ok && c.closed.ok).toBe(true)
      expect(play(g, c.yaw, 0)).toEqual(got(c.open))
      expect(maxDiff(play(g, c.yaw, 1), got(c.closed))).toBeLessThan(TOL)
    }
    const mid = play(g, 20, 0.3)
    const a = lerpShape(got(g[1].open), got(g[1].closed), 0.3), b = lerpShape(got(g[2].open), got(g[2].closed), 0.3)
    expect(maxDiff(mid, lerpShape(a, b, 20 / 45))).toBeLessThan(TOL)
    expect(maxDiff(play(JSON.parse(JSON.stringify(g)), 20, 0.3), mid)).toBeLessThan(TOL) // grid survives JSON
    report.push({ case: 'grid', yaws: g.map((c) => c.yaw), sources: g.map((c) => (c.closed.ok ? c.closed.source : c.closed.reason)) })
  })

  it('blending: a non-zero participant without the curve is reported, not dropped; weight 0 is ignored', () => {
    const d = fixture()
    const r = characterOpen(d, 'strand', { yaw: 90 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('preset Q (weight 0.4)')
    const zero = only(d, { P: 1, Q: 0 })
    expect(got(characterOpen(zero, 'strand', { yaw: 90 }))).toEqual(d.presets.P.strand.yaw[0].shape)
    // a whole participating preset missing: the same reported result, not an exception (review of 2c916f5/002ea9f)
    const gone = only(d, { P: 0.6, R: 0.4 })
    for (const ev of [characterOpen(gone, 'lid', { yaw: 0 }), closedAt(gone, 'lid', 0), closedAtKey(gone, 'lid', 0)]) {
      expect(ev.ok).toBe(false)
      if (!ev.ok) expect(ev.reason).toContain('preset R (weight 0.4): preset missing')
    }
    expect(() => grid(gone, 'lid')).not.toThrow()
    report.push({ case: 'missing participant', reason: r.ok ? 'ok' : r.reason })
  })

  it('character closed fix: reproduces its target, wins over preset corrections, clearing restores the inherited result; presets untouched', () => {
    const d = fixture()
    const presetsBefore = JSON.stringify(d.presets)
    const inherited = Object.fromEntries(yaws.map((y) => [y, got(closedAt(d, 'lid', y))]))
    const target: Shape = { a: { p: { x: -10, y: 2 }, hIn: { x: -12, y: 2 }, hOut: { x: -8, y: 2 } }, m: { p: { x: 0, y: 3 }, hIn: { x: -4, y: 3 }, hOut: { x: 4, y: 3 } }, b: { p: { x: 10, y: 2 }, hIn: { x: 8, y: 2 }, hOut: { x: 12, y: 2 } } }
    const f = fixClosed(d, 'lid', 0, target) // at a yaw where the preset already has an author target
    expect(maxDiff(got(closedAtKey(f, 'lid', 0)), target)).toBeLessThan(TOL) // 10 / 12 / 13: reproduces 13, not 15
    expect(JSON.stringify(f.presets)).toBe(presetsBefore) // character edit never writes the preset
    const c = clearClosedFix(f, 'lid')
    let worst = 0
    for (const y of yaws) worst = Math.max(worst, maxDiff(got(closedAt(c, 'lid', y)), inherited[y]))
    expect(worst).toBe(0)
    report.push({ case: 'character fix', clearedWorst: worst })
  })

  it('visibility: separate stepped track; hidden curves still evaluate', () => {
    const d = only(fixture(), { P: 1 })
    const vis = d.visibility.strand
    expect([-120, -90, 0, 29.9, 30, 90].map((y) => visibleAt(vis, y))).toEqual([false, false, false, false, true, true])
    expect(got(characterOpen(d, 'strand', { yaw: 0 }))).toEqual(d.presets.P.strand.yaw[0].shape) // hidden at 0, still readable
    expect(visibleAt(d.visibility.lid, 0)).toBe(true) // no track = visible
    report.push({ case: 'visibility', at: { '-90': false, '30': true } })
  })

  it('prints the table', () => {
    console.log('[stateTracks]\n' + report.map((r) => JSON.stringify(r)).join('\n'))
  })
})
