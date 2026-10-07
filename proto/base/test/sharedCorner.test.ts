// Shared eye corner (doc 18 §26.2 v3, dot 1791337766) and two independent eyes (§26.3) — standalone oracle, v2 after
// dot's review of 5b76ee2 (final node coordination; completed preset tracks; no union written; empty upper refused).
import { describe, expect, it } from 'vitest'
import {
  characterCornerFix, characterLineFix, characterLower, characterUpper, clearNodeFix, cornerGap, fillUnion, independent, initClosedState,
  InvalidEyeData, moveAnchor, playEyes, presetLinkedEdit, presetLower, presetUpper, rule, storedCornerProblems, type CharacterEye, type Eye,
  type Key, type PresetEye,
} from '../src/experiments/sharedCorner'
import type { Shape } from '../src/schema'

const pt = (x: number, y: number) => ({ x, y })
const shape = (pts: Record<string, [number, number]>): Shape =>
  Object.fromEntries(Object.entries(pts).map(([a, [x, y]]) => [a, { p: pt(x, y), hIn: pt(x - 1, y), hOut: pt(x + 1, y) }])) as Shape
// lower lid c–n–d, upper lid a–m–b; the corners c / a are one linked point
const lowerAt = (cy = 0, dx = 0, ny = -2) => shape({ c: [0 + dx, cy], n: [5 + dx, ny], d: [10 + dx, 0] })
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
const YAWS = [-30, 0, 10, 15, 20, 30, 45, 60, 75, 90, 120]
const noGap = (eye: Eye, lo: (y: number) => Shape, up: (y: number) => Shape) => {
  for (const y of YAWS) expect(cornerGap(eye, lo(y), up(y))).toBeCloseTo(0, 12)
}

describe('shared corner, preset author', () => {
  it('dot’s 0.6 example: one linked lift → both corners 0.6 at weight 1, 0.3 / 0.3 at weight 0.5; the upper stores 0 at the corner', () => {
    let eye = eyeOf({ P: preset(), Q: preset() })
    const r = presetLinkedEdit(eye, 'P', 0, { upper: moveAnchor(presetUpper(eye, eye.presets.P, 0), 'a', pt(0, 0.6)) })
    if (!r.ok) throw new Error(r.reason)
    eye = r.eye
    const k = eye.presets.P.expr.upper.find((x) => x.yaw === 0)!
    expect(k.target.a.p.y - k.base.a.p.y).toBe(0)
    expect(storedCornerProblems(eye, eye.presets.P)).toEqual([])
    for (const [w, want] of [[{ P: 1 }, 0.6], [{ P: 0.5, Q: 0.5 }, 0.3]] as const) {
      expect(characterLower(eye, ch(w), 0).c.p.y).toBeCloseTo(want, 12)
      expect(characterUpper(eye, ch(w), 0).a.p.y).toBeCloseTo(want, 12)
    }
  })

  it('a corner correction stored on the upper against the old base (the double lift) is REPORTED, not hidden by the coordination', () => {
    const eye = eyeOf({ P: preset() })
    const pe = eye.presets.P
    const oldBase = rule(eye, lowerAt())
    pe.expr.upper = [{ yaw: 0, target: moveAnchor(oldBase, 'a', pt(0, 0.6)), base: oldBase }, ...pe.expr.upper.filter((k) => k.yaw !== 0)]
    expect(storedCornerProblems(eye, pe)).toHaveLength(1)
  })

  it('two given corners that differ → refused; an empty upper track (no closed state) → refused, not "rule everywhere"', () => {
    const eye = eyeOf({ P: preset() })
    const r = presetLinkedEdit(eye, 'P', 0, { lower: moveAnchor(presetLower(eye.presets.P, 0), 'c', pt(0, 1)), upper: moveAnchor(presetUpper(eye, eye.presets.P, 0), 'a', pt(0, 2)) })
    expect(r.ok).toBe(false)
    eye.presets.P.expr.upper = []
    expect(presetLinkedEdit(eye, 'P', 30, { lower: presetLower(eye.presets.P, 30) }).ok).toBe(false)
    expect(() => presetUpper(eye, eye.presets.P, 30)).toThrow(/no expression keys/)
    expect(() => fillUnion(eye, eye.presets.P, [30])).toThrow(/no expression keys/)
  })

  it('unequal key sets (lower 0/30/90, upper 0/90), edit at 45: no split at any yaw; the upper track is not written; its interior is untouched', () => {
    const eye = eyeOf({ P: preset() })
    const pe = eye.presets.P
    pe.expr.lower = [0, 30, 90].map((y) => ({ yaw: y, target: presetLower(pe, y), base: presetLower(pe, y) }))
    const upperBefore = structuredClone(pe.expr.upper)
    const interior = YAWS.map((y) => presetUpper(eye, pe, y).m)
    const r = presetLinkedEdit(eye, 'P', 45, { lower: moveAnchor(presetLower(pe, 45), 'c', pt(presetLower(pe, 45).c.p.x, 1)) })
    if (!r.ok) throw new Error(r.reason)
    const p2 = r.eye.presets.P
    expect(p2.expr.upper).toEqual(upperBefore)
    expect(p2.expr.lower.map((k) => k.yaw)).toEqual([0, 30, 45, 90])
    noGap(r.eye, (y) => presetLower(p2, y), (y) => presetUpper(r.eye, p2, y))
    expect(YAWS.map((y) => presetUpper(r.eye, p2, y).m)).toEqual(interior)
  })

  it('a first lower key clamps its own correction (no zero endpoints synthesised); the upper follows only at the corner', () => {
    const eye = eyeOf({ P: preset() })
    const pe = eye.presets.P
    const r = presetLinkedEdit(eye, 'P', 30, { lower: moveAnchor(presetLower(pe, 30), 'c', pt(presetLower(pe, 30).c.p.x, 1)) })
    if (!r.ok) throw new Error(r.reason)
    expect(r.eye.presets.P.expr.lower.map((k) => k.yaw)).toEqual([30])
    for (const y of YAWS) {
      expect(presetLower(r.eye.presets.P, y).c.p.y).toBeCloseTo(1, 12)
      expect(presetUpper(r.eye, r.eye.presets.P, y).a.p.y).toBeCloseTo(1, 12)
    }
  })

  it('a neutral breakpoint that is no upper key (neutral corner 0/2/0 at 0/45/90, upper keys 0/90): coordinated with no edit; the interior stays the upper’s own interpolation', () => {
    const eye = eyeOf({ P: preset([{ yaw: 0, cy: 0 }, { yaw: 45, cy: 2 }, { yaw: 90, cy: 0 }]) })
    const pe = eye.presets.P
    noGap(eye, (y) => presetLower(pe, y), (y) => presetUpper(eye, pe, y))
    // m (not shared) is the upper's own interpolation between its 0° and 90° keys
    const m0 = presetUpper(eye, pe, 0).m.p, m90 = presetUpper(eye, pe, 90).m.p
    expect(presetUpper(eye, pe, 45).m.p).toEqual(pt((m0.x + m90.x) / 2, (m0.y + m90.y) / 2))
  })

  it('fillUnion (helper, not used by edits) keeps every displayed value', () => {
    const eye = eyeOf({ P: preset() })
    const pe = eye.presets.P
    pe.expr.lower = [0, 30, 90].map((y) => ({ yaw: y, target: presetLower(pe, y), base: presetLower(pe, y) }))
    const filled = fillUnion(eye, pe, [45])
    for (const y of YAWS) {
      expect(presetLower(filled, y)).toEqual(presetLower(pe, y))
      expect(presetUpper(eye, filled, y)).toEqual(presetUpper(eye, pe, y))
    }
  })
})

describe('character', () => {
  const setup = () => {
    // neutral corner y = 10; the preset lifts it to 12 in the closed eye
    const eye = eyeOf({ P: preset([{ yaw: 0, cy: 10 }, { yaw: 90, cy: 10 }]) })
    const pe = eye.presets.P
    pe.expr.lower = [0, 90].map((y) => ({ yaw: y, target: moveAnchor(presetLower(pe, y), 'c', pt(presetLower(pe, y).c.p.x, 12)), base: presetLower(pe, y) }))
    pe.expr.upper = ruleKeys(eye, pe, [0, 90])
    return { eye, c: ch({ P: 1 }) }
  }
  it('node fix: neutral 10, preset 12, target 13 → 13; neutral moved to 11 → 14; both corners', () => {
    const { eye, c } = setup()
    const k = characterCornerFix(eye, c, 0, pt(0, 13))
    expect([characterLower(eye, k, 0).c.p.y, characterUpper(eye, k, 0).a.p.y]).toEqual([13, 13])
    for (const n of [...eye.presets.P.neutral.lower, ...eye.presets.P.neutral.upper]) {
      const a = n.shape.c ? 'c' : 'a'
      n.shape = moveAnchor(n.shape, a, pt(n.shape[a].p.x, 11))
    }
    expect([characterLower(eye, k, 0).c.p.y, characterUpper(eye, k, 0).a.p.y]).toEqual([14, 14])
  })
  it('dot failure A: node fix breakpoints 0/45/90 = 0/2/0 between upper keys 0/90 → one coordinated corner at every yaw; the upper interior keeps its own interpolation', () => {
    const eye = eyeOf({ P: preset() })
    const pe = eye.presets.P
    pe.expr.upper = pe.expr.upper.map((k) => ({ ...k, target: moveAnchor({ ...k.target, m: { ...k.target.m, p: pt(k.target.m.p.x, k.yaw === 0 ? 4 : 6) } }, 'a', k.target.a.p) }))
    let c = ch({ P: 1 })
    for (const [y, py] of [[0, 0], [90, 0], [45, 2]] as const) c = characterCornerFix(eye, c, y, pt(presetLower(pe, y).c.p.x, py))
    noGap(eye, (y) => characterLower(eye, c, y), (y) => characterUpper(eye, c, y))
    expect(characterLower(eye, c, 45).c.p.y).toBeCloseTo(2, 12)
    expect(characterUpper(eye, c, 45).m.p.y).toBeCloseTo(-2 + (4 - -2 + 6 - -2) / 2, 12) // rule(n=-2) + mean of the m corrections (6, 8)
  })
  it('dot failure B: a character mixes the presets’ COMPLETED upper tracks — another preset’s key yaw never re-runs the rule', () => {
    const eye = eyeOf({ P: preset(), Q: preset() })
    const p = eye.presets.P, q = eye.presets.Q
    p.expr.lower = [0, 30, 90].map((y) => ({ yaw: y, target: { ...presetLower(p, y), n: { ...presetLower(p, y).n, p: pt(presetLower(p, y).n.p.x, y === 30 ? 6 : -2) } }, base: presetLower(p, y) }))
    p.expr.upper = ruleKeys(eye, p, [0, 90]) // P's upper: keys 0 / 90 only → its m at 30° is interpolated, not rule(6)
    q.expr.upper = ruleKeys(eye, q, [0, 30, 90])
    const pAt30 = presetUpper(eye, p, 30).m.p.y, qAt30 = presetUpper(eye, q, 30).m.p.y
    expect(characterUpper(eye, ch({ P: 0.5, Q: 0.5 }), 30).m.p.y).toBeCloseTo(0.5 * pAt30 + 0.5 * qAt30, 12)
    expect(pAt30).toBeCloseTo(-2, 12) // not 6: the rule did not run at 30° for P
  })
  it('clear returns to the preset result; a corner-only fix creates no line fix; whole-line conflict refused, replace clears the node track', () => {
    const { eye, c } = setup()
    const k = characterCornerFix(eye, c, 0, pt(0, 13))
    expect(k.lineFix).toEqual({ lower: [], upper: [] })
    expect(characterLower(eye, clearNodeFix(k), 0)).toEqual(characterLower(eye, c, 0))
    const lo = moveAnchor(characterLower(eye, k, 0), 'c', pt(0, 15)), up = moveAnchor(characterUpper(eye, k, 0), 'a', pt(0, 15))
    expect(characterLineFix(eye, k, 0, { lower: lo, upper: up }).ok).toBe(false)
    const r = characterLineFix(eye, k, 0, { lower: lo, upper: up }, { replace: true })
    if (!r.ok) throw new Error(r.reason)
    expect(r.ch.nodeFix).toEqual([])
    expect([characterLower(eye, r.ch, 0).c.p.y, characterUpper(eye, r.ch, 0).a.p.y]).toEqual([15, 15])
  })
  it('a single node key clamps at every yaw; an unmodified neutral key inserted does not change its reach', () => {
    const { eye, c } = setup()
    const k = characterCornerFix(eye, c, 30, pt(1, 13))
    const lift = () => YAWS.map((y) => characterLower(eye, k, y).c.p.y)
    const before = lift()
    expect(new Set(before.map((x) => x.toFixed(12))).size).toBe(1)
    const pe = eye.presets.P
    pe.neutral.lower = [...pe.neutral.lower, { yaw: 45, shape: structuredClone(presetLower({ ...pe, expr: { lower: [], upper: [] } }, 45)) }].sort((a, b) => a.yaw - b.yaw)
    expect(lift()).toEqual(before)
  })
})

describe('two independent eyes (§26.3)', () => {
  const rig = (side: 'L' | 'R', lift: number) => {
    const eye = eyeOf({ P: preset() })
    const c = lift ? characterCornerFix(eye, ch({ P: 1 }), 0, pt(0, lift)) : ch({ P: 1 })
    return { eye, ch: c, param: `blink${side}`, curves: { moved: `lid${side}`, source: `low${side}` } }
  }
  const corners: [string, string][] = [['lidL', 'lowL'], ['lidR', 'lowR']]
  it('dependency sets: independent eyes; linked through a third curve or one reading the other’s curve → dependent', () => {
    expect(independent([{ moved: 'lidL', source: 'lowL' }, { moved: 'lidR', source: 'lowR' }], corners)).toBe(true)
    expect(independent([{ moved: 'lidL', source: 'lowL' }, { moved: 'lidR', source: 'lowR' }], [...corners, ['lowL', 'brow'], ['brow', 'lowR']])).toBe(false)
    expect(independent([{ moved: 'x', source: 'y' }, { moved: 'y', source: 'z' }], [])).toBe(false)
  })
  it('joint playback yaw × blinkL × blinkR: each eye equals its single-eye result; corners never split; a shared link is refused', () => {
    const L = rig('L', 0.4), R = rig('R', 0)
    for (const y of [0, 30, 90]) for (const bl of [0, 0.5, 1]) for (const br of [0, 0.5, 1]) {
      const r = playEyes([L, R], corners, y, { blinkL: bl, blinkR: br })
      if (!r.ok) throw new Error(r.reason)
      const alone = playEyes([L], [], y, { blinkL: bl })
      const aloneR = playEyes([R], [], y, { blinkR: br })
      if (!alone.ok || !aloneR.ok) throw new Error()
      expect(r.curves.lidL).toEqual(alone.curves.lidL)
      expect(r.curves.lowR).toEqual(aloneR.curves.lowR)
      expect(cornerGap(L.eye, r.curves.lowL, r.curves.lidL)).toBeCloseTo(0, 12)
      expect(cornerGap(R.eye, r.curves.lowR, r.curves.lidR)).toBeCloseTo(0, 12)
    }
    // one eye closed, the other open: the open eye is exactly its neutral
    const wink = playEyes([L, R], corners, 30, { blinkL: 1, blinkR: 0 })
    if (!wink.ok) throw new Error()
    expect(wink.curves.lowR.c.p.y).toBe(0)
    expect(wink.curves.lowL.c.p.y).toBeCloseTo(0.4, 12)
    expect(playEyes([L, R], [...corners, ['lowL', 'brow'], ['brow', 'lowR']], 30, { blinkL: 1, blinkR: 1 }).ok).toBe(false)
  })
})

describe('v3 (dot, review of 283826e): the public entries validate; explicit closed-state initialisation', () => {
  const lifted = () => {
    const eye = eyeOf({ P: preset() })
    const k = eye.presets.P.expr.upper[0]
    for (const h of ['p', 'hIn', 'hOut'] as const) k.target.a[h] = pt(k.target.a[h].x, k.target.a[h].y + 2)
    return eye
  }
  it('a stored preset upper key moving the shared corner: presetUpper / characterUpper throw, playEyes refuses — never a coordinated shape', () => {
    const eye = lifted()
    expect(storedCornerProblems(eye, eye.presets.P)).toHaveLength(1)
    expect(() => presetUpper(eye, eye.presets.P, 0)).toThrow(InvalidEyeData)
    expect(() => characterUpper(eye, ch({ P: 1 }), 0)).toThrow(InvalidEyeData)
    const r = playEyes([{ eye, ch: ch({ P: 1 }), param: 'blinkL', curves: { moved: 'lidL', source: 'lowL' } }], [], 0, { blinkL: 1 })
    expect(r.ok === false && r.reason).toMatch(/moves the shared corner/)
    // a preset with weight 0 does not block the character
    const eye2 = lifted()
    eye2.presets.Q = preset()
    eye2.presets.Q.expr.upper = ruleKeys(eye2, eye2.presets.Q, [0, 90])
    expect(() => characterUpper(eye2, ch({ P: 0, Q: 1 }), 0)).not.toThrow()
  })
  it('a stored character upper fix moving the shared corner, and a one-sided character line fix (def. 3), are refused at the entry', () => {
    const eye = eyeOf({ P: preset() })
    const c0 = ch({ P: 1 })
    const r = characterLineFix(eye, c0, 0, { lower: characterLower(eye, c0, 0), upper: characterUpper(eye, c0, 0) })
    if (!r.ok) throw new Error(r.reason)
    const bad = structuredClone(r.ch)
    bad.lineFix.upper[0].target.a.p = pt(0, 3)
    expect(() => characterUpper(eye, bad, 0)).toThrow(/character upper fix at 0° moves the shared corner/)
    const oneSided = { ...structuredClone(r.ch), lineFix: { lower: structuredClone(r.ch.lineFix.lower), upper: [] } }
    expect(() => characterLower(eye, oneSided, 0)).toThrow(/two-line submissions/)
    expect(() => characterUpper(eye, oneSided, 0)).toThrow(/two-line submissions/)
  })
  it('initClosedState: an empty upper is refused until initialised; generated keys (target = base) then play and edit normally; a second init is refused', () => {
    const eye = eyeOf({ P: preset() })
    eye.presets.P.expr.upper = []
    const edit = presetLinkedEdit(eye, 'P', 30, { lower: presetLower(eye.presets.P, 30) })
    expect(edit.ok === false && edit.reason).toMatch(/initClosedState/)
    const init = initClosedState(eye, 'P')
    if (!init.ok) throw new Error(init.reason)
    expect(init.eye.presets.P.expr.upper.map((k) => k.yaw)).toEqual([0, 90])
    expect(init.eye.presets.P.expr.lower).toEqual([]) // nothing else written
    for (const y of YAWS) {
      expect(cornerGap(init.eye, presetLower(init.eye.presets.P, y), presetUpper(init.eye, init.eye.presets.P, y))).toBeCloseTo(0, 12)
      expect(presetUpper(init.eye, init.eye.presets.P, y).m.p.y).toBeCloseTo(presetLower(init.eye.presets.P, y).n.p.y, 12) // closed onto the lower
    }
    const r = presetLinkedEdit(init.eye, 'P', 30, { lower: moveAnchor(presetLower(init.eye.presets.P, 30), 'c', pt(1, 1)) })
    expect(r.ok).toBe(true)
    expect(initClosedState(init.eye, 'P').ok).toBe(false)
  })
})
