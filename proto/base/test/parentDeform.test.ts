// Parent-deformer combination experiment (headset-design doc 18 §8.8). Prints the result table; asserts
// only the checks the design names, with the tolerances fixed in the module BEFORE the run.
// A pass proves only this limited combination on this example — not full recording, not editing in a
// non-affine preview, not every eye shape (doc 18 §8.8 "结论范围").
import { describe, expect, it } from 'vitest'
import {
  applyAffine,
  bez,
  characterMap,
  defaultDoc,
  DISPLAY_PX_PER_UNIT,
  invertAffine,
  dragUpperMiddle,
  evaluate,
  evaluateT1,
  Evaluator,
  FIT_TOL,
  SAMPLES_PER_SEGMENT,
  segIds,
  SOURCE_TOL,
  VIEW_FRAME,
  viewA,
  viewB,
  type Affine,
  type CharacterId,
  type Evaluated,
  type Params,
  type SegId,
  type ViewMap,
} from '../src/experiments/parentDeform'
import { v, type V } from '../src/experiments/scenarioE'

const IDENTITY_VIEW: ViewMap = { kind: 'affine', f: { m: [1, 0, 0, 1], t: v(0, 0) } }
const tiers: Record<string, ViewMap> = { A: viewA(), B: viewB() }
const chars: CharacterId[] = ['wide', 'narrow']
const P = (close = 0, surprise = 0): Params => ({ close, surprise })
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y)
const report: Record<string, unknown>[] = []
const row = (r: Record<string, unknown>) => report.push(r)

/**
 * Measured (sampled, not a bound) deviations against the exact composite map. Judged in PART-LOCAL
 * units, i.e. after P⁻¹ — the same space as the fit's stop condition (review of bfe665a: the first
 * report compared world-space error, scaled ×1.2 by P, with the local tolerance). World error is
 * reported for reference only.
 */
function deviations(e: Evaluated) {
  const toLocal = (q: V) => applyAffine(invertAffine(e.placement), q)
  let source = 0 // same source position: (segment, u) through the temp segments vs exact, local units
  let sourceWorld = 0
  let shape = 0 // nearest distance from the exact point to the output curve (shape only), local units
  // output curve as a fine polyline (1000 chords per piece); shape = distance to the nearest CHORD
  const chords = e.segs.flatMap((s) => Array.from({ length: 1000 }, (_, i) => [toLocal(bez(s.cubic, i / 1000)), toLocal(bez(s.cubic, (i + 1) / 1000))] as [V, V]))
  const toChord = (p: V, [a, b]: [V, V]) => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
    return dist(p, { x: a.x + t * dx, y: a.y + t * dy })
  }
  for (const id of segIds)
    for (let i = 0; i <= SAMPLES_PER_SEGMENT; i++) {
      const u = i / SAMPLES_PER_SEGMENT
      const exW = e.exact(id, u)
      const ex = toLocal(exW)
      sourceWorld = Math.max(sourceWorld, dist(e.at(id, u), exW))
      source = Math.max(source, dist(toLocal(e.at(id, u)), ex))
      let best = Infinity
      for (const c of chords) best = Math.min(best, toChord(ex, c))
      shape = Math.max(shape, best)
    }
  return { source, sourcePx: source * DISPLAY_PX_PER_UNIT, shape, sourceWorld, segments: e.segs.length, maxDepth: Math.max(...e.segs.map((s) => s.depth)), fitOk: e.fitOk }
}
const closureGap = (e: Evaluated) => {
  let g = 0
  for (let i = 0; i <= 100; i++) {
    const u = i / 100
    g = Math.max(g, dist(e.at('U0', u), e.at('L0', u)), dist(e.at('U1', u), e.at('L1', u)))
  }
  return g
}
const eyeHeight = (e: Evaluated) => dist(e.at('U0', 1), e.at('L0', 1)) // the two middle anchors
const angleDeg = (d: V) => (Math.atan2(d.y, d.x) * 180) / Math.PI
const openDirection = (e: Evaluated) => {
  const d = { x: e.at('U0', 1).x - e.at('L0', 1).x, y: e.at('U0', 1).y - e.at('L0', 1).y }
  return angleDeg(d)
}
/** the direction a vertical (part-local) vector should take under the composite map at the eye middle */
const expectedDirection = (e: Evaluated) => {
  const m = e.linearAt('L0', 1)
  return angleDeg({ x: m[2] * -1, y: m[3] * -1 })
}
function signedArea(e: Evaluated) {
  const pts: V[] = []
  for (const id of ['U0', 'U1'] as SegId[]) for (let i = 0; i < 50; i++) pts.push(e.at(id, i / 50))
  for (const id of ['L1', 'L0'] as SegId[]) for (let i = 50; i > 0; i--) pts.push(e.at(id, i / 50))
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}
function selfCrossings(pts: V[]) {
  const cross = (a: V, b: V, c: V) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  let n = 0
  for (let i = 0; i < pts.length - 1; i++)
    for (let j = i + 2; j < pts.length - 1; j++) {
      const [a, b, c, d] = [pts[i], pts[i + 1], pts[j], pts[j + 1]]
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) n++
    }
  return n
}
const lidPolyline = (e: Evaluated, lid: 'U' | 'L') =>
  ([`${lid}0`, `${lid}1`] as SegId[]).flatMap((id, k) => Array.from({ length: 60 + (k ? 1 : 0) }, (_, i) => e.at(id, i / 60)))

describe('parent-deformer combination (doc 18 §8.8)', () => {
  const doc = defaultDoc()

  it('1. forward geometry (local units, measured by sampling): tier A exact; tier B within SOURCE_TOL, fit status met', () => {
    for (const [tier, view] of Object.entries(tiers))
      for (const ch of chars) {
        const d = deviations(evaluate(doc, ch, P(), view))
        row({ check: 1, tier, ch, ...d, FIT_TOL, SOURCE_TOL, pxPerUnitAssumed: DISPLAY_PX_PER_UNIT })
        expect(d.fitOk).toBe(true)
        if (tier === 'A') expect(d.source).toBeLessThan(1e-9)
        else expect(d.source).toBeLessThanOrEqual(SOURCE_TOL)
      }
  })

  it('2. closed eye stays closed at 30° for both characters (same map ⇒ coincident points stay coincident)', () => {
    for (const [tier, view] of Object.entries(tiers))
      for (const ch of chars) {
        const g = closureGap(evaluate(doc, ch, P(1), view))
        row({ check: 2, tier, ch, closureGap: g })
        expect(g).toBeLessThan(1e-9)
      }
  })

  it('3. surprise keeps the wide / narrow difference at 30°', () => {
    for (const [tier, view] of Object.entries(tiers)) {
      const r0 = eyeHeight(evaluate(doc, 'wide', P(0, 1), IDENTITY_VIEW)) / eyeHeight(evaluate(doc, 'narrow', P(0, 1), IDENTITY_VIEW))
      const r30 = eyeHeight(evaluate(doc, 'wide', P(0, 1), view)) / eyeHeight(evaluate(doc, 'narrow', P(0, 1), view))
      row({ check: 3, tier, ratio0: r0, ratio30: r30 })
      expect(Math.abs(r30 - r0)).toBeLessThan(1e-6)
    }
  })

  it('4. customisation and expression follow the tilt (eye-open direction = mapped vertical)', () => {
    for (const [tier, view] of Object.entries(tiers))
      for (const ch of chars) {
        const e = evaluate(doc, ch, P(0, 1), view)
        const got = openDirection(e)
        const want = expectedDirection(e)
        row({ check: 4, tier, ch, directionDeg: got, expectedDeg: want })
        expect(Math.abs(got - want)).toBeLessThan(0.05)
      }
  })

  it('5. changing the wide character does not recompute the narrow one (hand-declared read versions in this experiment, not automatic dependency capture)', () => {
    const ev = new Evaluator(defaultDoc())
    for (const ch of chars) ev.get(ch, P(), tiers.B, 'B')
    const before = ev.evaluations
    const narrowBefore = ev.get('narrow', P(), tiers.B, 'B')
    ev.setSlider('wide', 1.6)
    const narrowAfter = ev.get('narrow', P(), tiers.B, 'B')
    ev.get('wide', P(), tiers.B, 'B')
    row({ check: 5, evaluationsBefore: before, evaluationsAfter: ev.evaluations, narrowSameObject: narrowAfter === narrowBefore })
    expect(narrowAfter).toBe(narrowBefore)
    expect(ev.evaluations - before).toBe(1)
  })

  it('6. queries by (source segment, u) resolve inside fitted pieces; the four fill-boundary joints meet (no interval records, visible-range cutting or fill objects in this experiment)', () => {
    for (const [tier, view] of Object.entries(tiers))
      for (const ch of chars)
        for (const params of [P(), P(1), P(0, 1)]) {
          const e = evaluate(doc, ch, params, view)
          const ends = [0.3, 0.8].map((u) => {
            const s = e.segs.find((x) => x.src === 'L1' && u >= x.u0 && u <= x.u1)!
            return { u, insidePiece: u > s.u0 && u < s.u1, piece: [s.u0, s.u1], error: dist(e.at('L1', u), e.exact('L1', u)) }
          })
          // fill boundary U0 → U1 → (L1 reversed) → (L0 reversed): the joints must meet
          const joints = [dist(e.at('U0', 1), e.at('U1', 0)), dist(e.at('U1', 1), e.at('L1', 1)), dist(e.at('L1', 0), e.at('L0', 1)), dist(e.at('L0', 0), e.at('U0', 0))]
          row({ check: 6, tier, ch, params, intervalEnds: ends, fillJointGap: Math.max(...joints) })
          for (const x of ends) expect(x.error).toBeLessThanOrEqual(tier === 'A' ? 1e-9 : SOURCE_TOL)
          expect(Math.max(...joints)).toBeLessThan(1e-9)
        }
  })

  it('7. editing the original form is picked up at 30°', () => {
    const ev = new Evaluator(defaultDoc())
    const before = ev.get('wide', P(), tiers.B, 'B').at('U0', 1)
    ev.doc.part.upper[1].p.y -= 0.5
    ev.doc.part.upper[1].hIn.y -= 0.5
    ev.doc.part.upper[1].hOut.y -= 0.5
    ev.bump('part')
    const after = ev.get('wide', P(), tiers.B, 'B').at('U0', 1)
    const fresh = evaluate(ev.doc, 'wide', P(), tiers.B).at('U0', 1)
    row({ check: 7, moved: dist(before, after), vsFresh: dist(after, fresh) })
    expect(dist(before, after)).toBeGreaterThan(0.1)
    expect(dist(after, fresh)).toBe(0)
  })

  it('8. edit round trip (tier A): the full inverse chain lands the point; a partial chain does not; tier B refuses', () => {
    const cases: { name: string; params: Params; target: Parameters<typeof dragUpperMiddle>[4] }[] = [
      { name: '① expressions at 0, target = base', params: P(), target: { kind: 'base' } },
      { name: '② close = 1, target = close key form', params: P(1), target: { kind: 'expression', name: 'close' } },
    ]
    for (const c of cases) {
      const start = evaluate(doc, 'wide', c.params, tiers.A).at('U0', 1)
      const goal = { x: start.x + 1.5, y: start.y - 0.7 }
      const full = dragUpperMiddle(doc, 'wide', c.params, tiers.A, c.target, goal)
      const partial = dragUpperMiddle(doc, 'wide', c.params, tiers.A, c.target, goal, { skipCharacterInverse: true })
      if (!full.ok || !partial.ok) throw new Error('unexpected refusal')
      const landed = dist(evaluate(full.doc, 'wide', c.params, tiers.A).at('U0', 1), goal)
      const partialMiss = dist(evaluate(partial.doc, 'wide', c.params, tiers.A).at('U0', 1), goal)
      const b = dragUpperMiddle(doc, 'wide', c.params, tiers.B, c.target, goal)
      row({ check: 8, case: c.name, landed, partialChainMiss: partialMiss, tierB: b.ok ? 'accepted' : b.reason })
      expect(landed).toBeLessThan(1e-9)
      expect(partialMiss).toBeGreaterThan(0.1)
      expect(b.ok).toBe(false)
    }
    // a placement other than the default: passed in, the same one the result was evaluated with
    const customP: Affine = { m: [2, 0, 0.3, 1], t: v(3, 5) }
    const start = evaluate(doc, 'wide', P(), tiers.A, customP).at('U0', 1)
    const goal = { x: start.x - 0.9, y: start.y + 1.3 }
    const custom = dragUpperMiddle(doc, 'wide', P(), tiers.A, { kind: 'base' }, goal, { placement: customP })
    if (!custom.ok) throw new Error(custom.reason)
    const customLanded = dist(evaluate(custom.doc, 'wide', P(), tiers.A, customP).at('U0', 1), goal)
    row({ check: 8, case: 'custom placement passed in', landed: customLanded })
    expect(customLanded).toBeLessThan(1e-9)
    // refusals: a singular step, a non-finite input — never a success carrying NaN
    const flat = { ...doc, characters: { ...doc.characters, wide: { slider: 0 } } }
    const singular = dragUpperMiddle(flat, 'wide', P(), tiers.A, { kind: 'base' }, goal)
    const nanIn = dragUpperMiddle(doc, 'wide', P(), tiers.A, { kind: 'base' }, v(Number.NaN, 0))
    const infIn = dragUpperMiddle(doc, 'wide', P(), tiers.A, { kind: 'base' }, v(Number.POSITIVE_INFINITY, 0))
    row({ check: 8, case: 'refusals', singular: singular.ok ? 'accepted' : singular.reason, nan: nanIn.ok ? 'accepted' : nanIn.reason, inf: infIn.ok ? 'accepted' : infIn.reason })
    expect(singular.ok).toBe(false)
    expect(nanIn.ok).toBe(false)
    expect(infIn.ok).toBe(false)
    // between key values: refused
    const mid = dragUpperMiddle(doc, 'wide', P(0.5), tiers.A, { kind: 'expression', name: 'close' }, v(0, 0))
    row({ check: 8, case: 'close = 0.5 (between key values)', refused: !mid.ok, reason: mid.ok ? '' : mid.reason })
    expect(mid.ok).toBe(false)
  })

  it('8b. deformation quality, checked separately from closure: fold, self-crossing, fill orientation', () => {
    const B = tiers.B
    if (B.kind !== 'map') throw new Error()
    let minDet = Infinity
    for (let i = 0; i <= 48; i++)
      for (let j = 0; j <= 36; j++) {
        const m = B.jac(v(VIEW_FRAME.x0 + ((VIEW_FRAME.x1 - VIEW_FRAME.x0) * i) / 48, VIEW_FRAME.y0 + ((VIEW_FRAME.y1 - VIEW_FRAME.y0) * j) / 36))
        minDet = Math.min(minDet, m[0] * m[3] - m[2] * m[1])
      }
    for (const [tier, view] of Object.entries(tiers))
      for (const ch of chars)
        for (const params of [P(), P(0, 1)]) {
          const e = evaluate(doc, ch, params, view)
          const neutral = evaluate(doc, ch, params, IDENTITY_VIEW)
          const crossings = selfCrossings(lidPolyline(e, 'U')) + selfCrossings(lidPolyline(e, 'L'))
          const sameOrientation = Math.sign(signedArea(e)) === Math.sign(signedArea(neutral))
          row({ check: '8b', tier, ch, params, tierBMinJacobianDet: tier === 'B' ? minDet : undefined, lidSelfCrossings: crossings, fillOrientationKept: sameOrientation })
          expect(crossings).toBe(0)
          expect(sameOrientation).toBe(true)
        }
    expect(minDet).toBeGreaterThan(0)
  })

  it('9a. T1 follows its declared formula: one offset per anchor, added to the anchor and both handles', () => {
    // identity view and placement isolate the formula; the left corner anchor (−10, 0) does not move
    // in the closed key form, so its offset is 0 and its handles must stay where the base has them
    const I: Affine = { m: [1, 0, 0, 1], t: v(0, 0) }
    const e = evaluateT1(doc, 'wide', P(1), IDENTITY_VIEW, I)
    const L2: Affine = characterMap(doc.characters.wide.slider)
    for (const [lidKey, segFirst, segSecond] of [['upper', 'U0', 'U1'], ['lower', 'L0', 'L1']] as const) {
      const base = doc.part[lidKey]
      const key = doc.expressions.close[lidKey]
      const off = base.map((a, i) => {
        const pc = applyAffine(L2, a.p)
        return { x: pc.x - a.p.x + key[i].p.x - a.p.x, y: pc.y - a.p.y + key[i].p.y - a.p.y }
      })
      const want = base.map((a, i) => ({ p: v(a.p.x + off[i].x, a.p.y + off[i].y), hIn: v(a.hIn.x + off[i].x, a.hIn.y + off[i].y), hOut: v(a.hOut.x + off[i].x, a.hOut.y + off[i].y) }))
      const c0 = e.segs.find((x) => x.src === segFirst)!.cubic
      const c1 = e.segs.find((x) => x.src === segSecond)!.cubic
      const got = [c0[0], c0[1], c0[2], c0[3], c1[1], c1[2], c1[3]]
      const exp = [want[0].p, want[0].hOut, want[1].hIn, want[1].p, want[1].hOut, want[2].hIn, want[2].p]
      const worst = Math.max(...got.map((g, i) => dist(g, exp[i])))
      row({ check: '9a', lid: lidKey, worst })
      expect(worst).toBeLessThan(1e-12)
    }
  })

  it('9. T1 control (same author input): computed and reported only — differences may come from T1 representation limits as well as from the order of steps', () => {
    for (const [tier, view] of Object.entries(tiers))
      for (const ch of chars) {
        const closed = evaluateT1(doc, ch, P(1), view)
        const surprised = evaluateT1(doc, ch, P(0, 1), view)
        const combo = evaluate(doc, ch, P(0, 1), view)
        row({
          check: 9,
          tier,
          ch,
          T1closureGap: closureGap(closed),
          T1directionDeg: openDirection(surprised),
          comboDirectionDeg: openDirection(combo),
          T1eyeHeight: eyeHeight(surprised),
          comboEyeHeight: eyeHeight(combo),
          T1vsComboMaxDistance: Math.max(...segIds.map((id) => Math.max(...Array.from({ length: 21 }, (_, i) => dist(surprised.at(id, i / 20), combo.exact(id, i / 20)))))),
        })
      }
  })

  it('prints the table', () => {
    const fmt = (x: unknown): unknown => (typeof x === 'number' ? Number(x.toPrecision(4)) : Array.isArray(x) ? x.map(fmt) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fmt(y)])) : x)
    console.log('[parentDeform]\n' + report.map((r) => JSON.stringify(fmt(r))).join('\n'))
  })
})
