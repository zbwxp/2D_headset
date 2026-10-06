// Scenario E, APPLICABILITY RANGE (dot/bowen 2026-10-06): a default expression rule should fit most
// eye shapes; special rules fit a narrower class and are still reusable — never one-off patches.
// So each rule is tested over a FAMILY of eye shapes, reporting where it holds and where it starts
// to fail; and a minimal selection mechanism picks a specific rule, falls back to the default, checks
// the result and fails EXPLICITLY (named rule, failed check) instead of silently drawing wrong eyes.
// Standalone experiment: not wired into the editor or the store.
import { add, anchor, CLOSE_RULES, lerp, lerpA, measure, v, type A, type Eye, type Lid, type Stage, type V } from './scenarioE'

// ---------- the eye family ----------
export type EyeFeatures = { hU: number; hL: number; tilt: number; shift: number; extraUpper: boolean }
export function makeEye(f: EyeFeatures): Eye {
  const inner = v(-10, 0)
  const outer = v(10, f.tilt) // tilt < 0: outer corner raised
  const upper: Lid = f.extraUpper
    ? [anchor(inner, v(0, 0), v(2, -2)), anchor(v(-4 + f.shift, f.hU), v(-3, 0), v(3, 0)), anchor(v(4 + f.shift, f.hU + f.tilt / 2), v(-3, 0), v(3, 0)), anchor(outer, v(-2, -2), v(0, 0))]
    : [anchor(inner, v(0, 0), v(3, -3)), anchor(v(f.shift, f.hU + f.tilt / 2), v(-5, 0), v(5, 0)), anchor(outer, v(-3, -3), v(0, 0))]
  const lower: Lid = [anchor(inner, v(0, 0), v(3, 3)), anchor(v(f.shift, f.hL + f.tilt / 2), v(-5, 0), v(5, 0)), anchor(outer, v(-3, 3), v(0, 0))]
  return { upper, lower, stroke: 1 }
}
export function family(): EyeFeatures[] {
  const out: EyeFeatures[] = []
  for (const hU of [-1, -3, -5, -7, -9]) for (const hL of [1, 3, 5, 7]) for (const tilt of [-3, 0, 3]) for (const shift of [-3, 0, 3]) out.push({ hU, hL, tilt, shift, extraUpper: false })
  for (const hU of [-3, -5, -7, -9]) for (const hL of [3, 5]) for (const tilt of [-3, 0, 3]) if (out.length < 200) out.push({ hU, hL, tilt, shift: 0, extraUpper: true })
  return out
}

// ---------- one more candidate: relational with an exact correspondence step ----------
// If the lids have different anchor counts, split each lid (de Casteljau — shapes unchanged) at the x
// positions of the other lid's inner anchors, then interpolate anchor by anchor.
function splitCubic(p0: V, c1: V, c2: V, p3: V, t: number) {
  const a = lerp(p0, c1, t), b = lerp(c1, c2, t), c = lerp(c2, p3, t)
  const d = lerp(a, b, t), e = lerp(b, c, t), m = lerp(d, e, t)
  return [[p0, a, d, m], [m, e, c, p3]] as const
}
function xAt(seg: readonly V[], t: number) {
  const u = 1 - t
  return u * u * u * seg[0].x + 3 * u * u * t * seg[1].x + 3 * u * t * t * seg[2].x + t * t * t * seg[3].x
}
export function matchAnchors(lower: Lid, xs: number[]): Lid {
  let segs = lower.slice(0, -1).map((a, i) => [a.p, a.hOut, lower[i + 1].hIn, lower[i + 1].p] as readonly V[])
  for (const x of xs) {
    const k = segs.findIndex((s) => (s[0].x - x) * (s[3].x - x) < 0)
    if (k < 0) continue // already an anchor there
    let lo = 0, hi = 1
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if ((xAt(segs[k], mid) - x) * (xAt(segs[k], lo) - x) <= 0) hi = mid
      else lo = mid
    }
    const [l, r] = splitCubic(segs[k][0], segs[k][1], segs[k][2], segs[k][3], (lo + hi) / 2)
    segs = [...segs.slice(0, k), l, r, ...segs.slice(k + 1)]
  }
  return segs.map((s, i) => ({ p: s[0], hIn: i === 0 ? lower[0].hIn : segs[i - 1][2], hOut: s[1] })).concat([{ p: segs.at(-1)![3], hIn: segs.at(-1)![2], hOut: lower.at(-1)!.hOut }])
}
export const closeRelationalMatched: Stage = {
  name: 'close: upper lid → lower lid, with an exact anchor correspondence step',
  kind: 'expression',
  reads: () => ['rule:close'],
  writesTo: 'rule',
  apply: (eye, ctx) => {
    // split EACH lid at the other's interior anchor positions (shapes unchanged), then pair 1:1
    const interiorXs = (lid: Lid) => lid.slice(1, -1).map((a) => a.p.x)
    const upper = eye.upper.length === eye.lower.length ? eye.upper : matchAnchors(eye.upper, interiorXs(eye.lower))
    const lower = eye.upper.length === eye.lower.length ? eye.lower : matchAnchors(eye.lower, interiorXs(eye.upper))
    if (upper.length !== lower.length) throw new Error(`no correspondence: upper ${upper.length} anchors, lower ${lower.length}`)
    return { ...eye, upper: upper.map((a, i) => lerpA(a, lower[i], ctx.params.close)), lower }
  },
}
export const RANGE_RULES: Record<string, Stage> = { ...CLOSE_RULES, relationalMatched: closeRelationalMatched }

// ---------- checks over the whole lids ----------
export type CheckName = 'closes' | 'noCrossingWhileClosing' | 'cornersJoined' | 'keepsOwnPosition'
const ctxAt = (w: number) => ({ character: 'family', params: { angle: 0, close: w, surprise: 0 }, read: () => true })
export function checkRule(stage: Stage, eye: Eye): { error?: string; failed: CheckName[]; strokeOverlap?: number } {
  try {
    const at = (w: number) => stage.apply(eye, ctxAt(w))
    const steps = [0.25, 0.5, 0.75].map((w) => measure(at(w)))
    const full = measure(at(1))
    const failed: CheckName[] = []
    if (full.maxGap > 0.01) failed.push('closes')
    if (steps.some((m) => m.crossings > 0 || m.area < -0.01)) failed.push('noCrossingWhileClosing')
    if (![...steps, full].every((m) => m.cornersJoined)) failed.push('cornersJoined')
    // an example criterion a template author might declare: the closed eye stays near its own midline
    const closed = at(1)
    const midU = eye.upper[Math.floor(eye.upper.length / 2)].p.y
    const midL = eye.lower[Math.floor(eye.lower.length / 2)].p.y
    const closedMid = closed.upper[Math.floor(closed.upper.length / 2)].p.y
    if (Math.abs(closedMid - (midU + midL) / 2) > 1.5) failed.push('keepsOwnPosition')
    return { failed, strokeOverlap: full.strokeOverlap }
  } catch (e) {
    return { error: String((e as Error).message ?? e), failed: [] }
  }
}

// ---------- minimal selection: specific rules first, then the default; check; fail explicitly ----------
export type RuleEntry = { name: string; scope: 'specific' | 'default'; appliesTo: (f: EyeFeatures) => boolean; stage: Stage; requires: CheckName[] }
export type ExpressionResult =
  | { ok: true; used: string; scope: 'specific' | 'default'; eye: Eye }
  | { ok: false; code: 'NO_APPLICABLE_RULE' | 'RULE_CHECK_FAILED' | 'RULE_ERROR'; rule?: string; failed?: CheckName[]; message: string }

export function applyExpression(entries: RuleEntry[], f: EyeFeatures, w: number): ExpressionResult {
  const eye = makeEye(f)
  const candidates = [...entries.filter((e) => e.scope === 'specific'), ...entries.filter((e) => e.scope === 'default')]
  const entry = candidates.find((e) => e.appliesTo(f))
  if (!entry) return { ok: false, code: 'NO_APPLICABLE_RULE', message: `no rule declares this eye shape in range: ${JSON.stringify(f)}` }
  const check = checkRule(entry.stage, eye)
  if (check.error) return { ok: false, code: 'RULE_ERROR', rule: entry.name, message: check.error }
  const failed = check.failed.filter((c) => entry.requires.includes(c))
  if (failed.length) return { ok: false, code: 'RULE_CHECK_FAILED', rule: entry.name, failed, message: `${entry.name} fails ${failed.join(', ')} for ${JSON.stringify(f)}` }
  return { ok: true, used: entry.name, scope: entry.scope, eye: entry.stage.apply(eye, ctxAt(w)) }
}
export type { A }
