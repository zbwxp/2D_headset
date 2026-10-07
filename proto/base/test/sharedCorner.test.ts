// Shared eye corner (doc 18 §26.2 v3, dot 1791337766) and two independent eyes (§26.3) — standalone oracle.
import { describe, expect, it } from 'vitest'
import {
  characterCornerFix, characterLineFix, characterLower, characterUpper, clearNodeFix, cornerGap, fillUnion, independent, moveAnchor,
  presetLinkedEdit, presetLower, presetUpper, rule, type CharacterEye, type Eye, type Key, type PresetEye,
} from '../src/experiments/sharedCorner'
import type { Shape } from '../src/schema'

const pt = (x: number, y: number) => ({ x, y })
const shape = (pts: Record<string, [number, number]>): Shape =>
  Object.fromEntries(Object.entries(pts).map(([a, [x, y]]) => [a, { p: pt(x, y), hIn: pt(x - 1, y), hOut: pt(x + 1, y) }])) as Shape
// lower lid c–n–d, upper lid a–m–b; the corners c / a are one linked point
const lowerAt = (cy = 0, dx = 0) => shape({ c: [0 + dx, cy], n: [5 + dx, -2], d: [10 + dx, 0] })
const upperAt = (cy = 0, dx = 0) => shape({ a: [0 + dx, cy], m: [5 + dx, 3], b: [10 + dx, 0] })
const ruleKeys = (eye: Eye, pe: PresetEye, yaws: number[]): Key[] => yaws.map((y) => ({ yaw: y, target: rule(eye, presetLower(pe, y)), base: rule(eye, presetLower(pe, y)) }))
const preset = (neutral: { yaw: number; cy: number }[] = [{ yaw: 0, cy: 0 }, { yaw: 90, cy: 0 }]): PresetEye => ({
  neutral: { lower: neutral.map((k) => ({ yaw: k.yaw, shape: lowerAt(k.cy, k.yaw / 30) })), upper: neutral.map((k) => ({ yaw: k.yaw, shape: upperAt(k.cy, k.yaw / 30) })) },
  expr: { lower: [], upper: [] },
})
const eyeOf = (presets: Record<string, PresetEye>): Eye => {
  const eye: Eye = { presets, corr: { a: 'c', m: 'n', b: 'd' }, corner: { upper: 'a', lower: 'c' } }
  for (const pe of Object.values(presets)) pe.expr.upper = ruleKeys(eye, pe, [0, 90]) // the rule keys: upper closes onto lower
  return eye
}
const ch = (weights: Record<string, number>): CharacterEye => ({ weights, lineFix: { lower: [], upper: [] }, nodeFix: [] })
const YAWS = [0, 10, 20, 30, 45, 60, 75, 90]

describe('shared corner, preset author (§26.2 v3)', () => {
  it('dot’s 0.6 example: one linked lift → both corners 0.6 at weight 1, 0.3 / 0.3 at weight 0.5; the upper stores 0 at the corner', () => {
    let eye = eyeOf({ P: preset(), Q: preset() })
    const target = moveAnchor(presetUpper(eye, eye.presets.P, 0), 'a', pt(0, 0.6)) // the author drags the UPPER corner
    const r = presetLinkedEdit(eye, 'P', 0, { upper: target })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    eye = r.eye
    expect(presetLower(eye.presets.P, 0).c.p).toEqual(pt(0, 0.6))
    expect(presetUpper(eye, eye.presets.P, 0).a.p).toEqual(pt(0, 0.6))
    const k = eye.presets.P.expr.upper.find((x) => x.yaw === 0)!
    expect(k.target.a.p.y - k.base.a.p.y).toBe(0) // no position correction at the shared corner (no double lift)
    for (const [w, want] of [[{ P: 1 }, 0.6], [{ P: 0.5, Q: 0.5 }, 0.3]] as const) {
      const c = ch(w)
      const lo = characterLower(eye, c, 0), up = characterUpper(eye, c, 0)
      expect(lo.c.p.y).toBeCloseTo(want, 12)
      expect(up.a.p.y).toBeCloseTo(want, 12)
    }
  })

  it('why the base must be rule(final lower): correcting both lids by +0.6 against the old base lifts the upper by 1.2', () => {
    const eye = eyeOf({ P: preset() })
    const pe = eye.presets.P
    const lift = (s: Shape, a: string) => moveAnchor(s, a, pt(s[a].p.x, s[a].p.y + 0.6))
    pe.expr.lower = [{ yaw: 0, target: lift(presetLower(pe, 0), 'c'), base: presetLower(pe, 0) }]
    const oldBase = rule(eye, lowerAt())
    pe.expr.upper = [{ yaw: 0, target: lift(oldBase, 'a'), base: oldBase }]
    expect(presetUpper(eye, pe, 0).a.p.y).toBeCloseTo(1.2, 12)
    expect(cornerGap(eye, presetLower(pe, 0), presetUpper(eye, pe, 0))).toBeCloseTo(0.6, 12)
  })

  it('two given corners that differ → refused; nothing changes', () => {
    const eye = eyeOf({ P: preset() })
    const r = presetLinkedEdit(eye, 'P', 0, { lower: moveAnchor(presetLower(eye.presets.P, 0), 'c', pt(0, 1)), upper: moveAnchor(presetUpper(eye, eye.presets.P, 0), 'a', pt(0, 2)) })
    expect(r.ok).toBe(false)
  })

  it('dot’s union counterexample (lower keys 0/30/90, upper 0/90, edit at 45): no split anywhere after the fill; inserting alone changes nothing', () => {
    const eye = eyeOf({ P: preset() })
    const pe = eye.presets.P
    pe.expr.lower = [0, 30, 90].map((y) => ({ yaw: y, target: presetLower(pe, y), base: presetLower(pe, y) }))
    // naive: a key only at 45 on both sides
    const lowered = (s: Shape) => moveAnchor(s, 'c', pt(s.c.p.x, 1))
    const naive: Eye = structuredClone(eye)
    naive.presets.P.expr.lower = [...naive.presets.P.expr.lower, { yaw: 45, target: lowered(presetLower(pe, 45)), base: presetLower(pe, 45) }].sort((a, b) => a.yaw - b.yaw)
    naive.presets.P.expr.upper = [...naive.presets.P.expr.upper, { yaw: 45, target: moveAnchor(presetUpper(eye, pe, 45), 'a', pt(presetUpper(eye, pe, 45).a.p.x, 1)), base: rule(eye, lowered(presetLower(pe, 45))) }].sort((a, b) => a.yaw - b.yaw)
    expect(cornerGap(naive, presetLower(naive.presets.P, 30), presetUpper(naive, naive.presets.P, 30))).toBeCloseTo(2 / 3, 12)
    // the fill alone: every grid yaw unchanged
    const filled = fillUnion(eye, pe, [45])
    for (const y of YAWS) {
      expect(presetLower(filled, y)).toEqual(presetLower(pe, y))
      expect(presetUpper(eye, filled, y)).toEqual(presetUpper(eye, pe, y))
    }
    // the linked edit (fills first)
    const r = presetLinkedEdit(eye, 'P', 45, { lower: lowered(presetLower(pe, 45)) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const y of YAWS) expect(cornerGap(r.eye, presetLower(r.eye.presets.P, y), presetUpper(r.eye, r.eye.presets.P, y))).toBeCloseTo(0, 12)
    expect(presetLower(r.eye.presets.P, 45).c.p.y).toBe(1)
  })

  it('FINDING (§26.2 待核): a neutral key with no moved-role key at its yaw splits the corner BEFORE any edit; the pre-edit fill keeps it; a rule key at every neutral yaw keeps it closed', () => {
    // neutral corner y: 0 at 0°, 2 at 45°, 0 at 90°; the upper's (rule) keys only at 0 / 90
    const eye = eyeOf({ P: preset([{ yaw: 0, cy: 0 }, { yaw: 45, cy: 2 }, { yaw: 90, cy: 0 }]) })
    const pe = eye.presets.P
    expect(cornerGap(eye, presetLower(pe, 45), presetUpper(eye, pe, 45))).toBeCloseTo(2, 12) // split with no edit at all
    const r = presetLinkedEdit(eye, 'P', 0, { lower: moveAnchor(presetLower(pe, 0), 'c', pt(0, 0.5)) })
    if (!r.ok) throw new Error(r.reason)
    expect(cornerGap(r.eye, presetLower(r.eye.presets.P, 45), presetUpper(r.eye, r.eye.presets.P, 45))).toBeCloseTo(2, 12) // kept, not closed
    // with a rule key at every neutral key yaw (0 / 45 / 90) the same edit leaves no split anywhere
    const ok = eyeOf({ P: preset([{ yaw: 0, cy: 0 }, { yaw: 45, cy: 2 }, { yaw: 90, cy: 0 }]) })
    ok.presets.P.expr.upper = ruleKeys(ok, ok.presets.P, [0, 45, 90])
    const r2 = presetLinkedEdit(ok, 'P', 0, { lower: moveAnchor(presetLower(ok.presets.P, 0), 'c', pt(0, 0.5)) })
    if (!r2.ok) throw new Error(r2.reason)
    for (const y of YAWS) expect(cornerGap(r2.eye, presetLower(r2.eye.presets.P, y), presetUpper(r2.eye, r2.eye.presets.P, y))).toBeCloseTo(0, 12)
  })
})

describe('shared corner, character node fix (dot 1791337766 def. 1–3)', () => {
  const setup = () => {
    // neutral corner y = 10; the preset lifts it to 12 in the closed eye
    const eye = eyeOf({ P: preset([{ yaw: 0, cy: 10 }, { yaw: 90, cy: 10 }]) })
    const pe = eye.presets.P
    pe.expr.lower = [0, 90].map((y) => ({ yaw: y, target: moveAnchor(presetLower(pe, y), 'c', pt(presetLower(pe, y).c.p.x, 12)), base: presetLower(pe, y) }))
    pe.expr.upper = ruleKeys(eye, pe, [0, 90])
    return { eye, c: ch({ P: 1 }) }
  }
  it('neutral 10, preset 12, character target 13 → 13; neutral moved to 11 → 14; both corners together', () => {
    const { eye, c } = setup()
    expect(characterLower(eye, c, 0).c.p.y).toBe(12)
    const k = characterCornerFix(eye, c, 0, pt(0, 13))
    expect(characterLower(eye, k, 0).c.p.y).toBe(13)
    expect(characterUpper(eye, k, 0).a.p.y).toBe(13)
    for (const n of [...eye.presets.P.neutral.lower, ...eye.presets.P.neutral.upper]) n.shape = moveAnchor(n.shape, n.shape.c ? 'c' : 'a', pt(n.shape[n.shape.c ? 'c' : 'a'].p.x, 11))
    expect(characterLower(eye, k, 0).c.p.y).toBe(14)
    expect(characterUpper(eye, k, 0).a.p.y).toBe(14)
  })
  it('clearing the node fix returns to the preset result; only the corner was ever overridden (the rest of the lower lid still follows the preset)', () => {
    const { eye, c } = setup()
    const k = characterCornerFix(eye, c, 0, pt(0, 13))
    expect(k.lineFix.lower).toEqual([]) // no line fix created for the other curve (def. 3)
    expect(characterLower(eye, k, 0).n).toEqual(characterLower(eye, c, 0).n)
    expect(characterLower(eye, clearNodeFix(k), 0)).toEqual(characterLower(eye, c, 0))
  })
  it('a whole-line target disagreeing with the node fix → refused; with replace → the node track is cleared and the lines win', () => {
    const { eye, c } = setup()
    const k = characterCornerFix(eye, c, 0, pt(0, 13))
    const lo = moveAnchor(characterLower(eye, k, 0), 'c', pt(0, 15)), up = moveAnchor(characterUpper(eye, k, 0), 'a', pt(0, 15))
    expect(characterLineFix(eye, k, 0, { lower: lo, upper: up }).ok).toBe(false)
    const r = characterLineFix(eye, k, 0, { lower: lo, upper: up }, { replace: true })
    if (!r.ok) throw new Error(r.reason)
    expect(r.ch.nodeFix).toEqual([])
    expect(characterLower(eye, r.ch, 0).c.p.y).toBe(15)
    expect(characterUpper(eye, r.ch, 0).a.p.y).toBe(15)
  })
  it('a single node key applies at every yaw (clamp, like every sparse track); an unmodified neutral key inserted does not change its reach', () => {
    const { eye, c } = setup()
    const k = characterCornerFix(eye, c, 30, pt(1, 13))
    const before = YAWS.map((y) => characterLower(eye, k, y).c.p.y - eye.presets.P.neutral.lower[0].shape.c.p.y)
    expect(new Set(before.map((x) => x.toFixed(12))).size).toBe(1) // +3 everywhere
    const pe = eye.presets.P
    const mid = { yaw: 45, shape: structuredClone(presetLower({ ...pe, expr: { lower: [], upper: [] } }, 45)) }
    pe.neutral.lower = [...pe.neutral.lower, mid].sort((a, b) => a.yaw - b.yaw)
    expect(YAWS.map((y) => characterLower(eye, k, y).c.p.y - eye.presets.P.neutral.lower[0].shape.c.p.y)).toEqual(before)
  })
})

describe('two independent eyes (§26.3, dot 1791337766 def. 4)', () => {
  it('disjoint read/write dependencies → independent; a link or a shared source makes them dependent', () => {
    const L = { moved: 'lidL', source: 'lowL' }, R = { moved: 'lidR', source: 'lowR' }
    const corners: [string, string][] = [['lidL', 'lowL'], ['lidR', 'lowR']]
    expect(independent([L, R], corners)).toBe(true)
    expect(independent([L, R], [...corners, ['lowL', 'brow'], ['brow', 'lowR']])).toBe(false) // linked through a third curve
    expect(independent([{ moved: 'x', source: 'y' }, { moved: 'y', source: 'z' }], [])).toBe(false) // one reads what the other writes
  })
  it('each eye plays its own value: left closed, right open', () => {
    const left = eyeOf({ P: preset() }), right = eyeOf({ P: preset() })
    const c = ch({ P: 1 })
    const k = characterCornerFix(left, c, 0, pt(0, 0.4))
    // closed left = expression result; open right = neutral: no cross-talk by construction (separate curves)
    expect(characterLower(left, k, 0).c.p.y).toBeCloseTo(0.4, 12)
    expect(characterUpper(left, k, 0).a.p.y).toBeCloseTo(0.4, 12)
    expect(right.presets.P.neutral.lower[0].shape.c.p.y).toBe(0)
  })
})
