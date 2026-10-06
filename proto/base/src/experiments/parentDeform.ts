// Parent-deformer combination experiment (headset-design doc 18 §8.8). STANDALONE: not wired into the
// editor, the store or the drawing chain. It checks ONE limited combination of tools on one eye:
//
//   L1 expression (key forms on the neutral face, part-local)
//   → L2 character shaping (a shared parent mapping driven by the character's slider)
//   → V  view deformation (one parent deformer; tier A affine, tier B non-affine)
//   → P  placement (affine)
//
// Mature references (doc 18 §8.1 / §8.1b / §8.6b): Live2D parent deformer + child key forms
// (the child's shape is interpolated first, then transformed by the parent); Character Creator 5
// shared expressions + per-character correction (not built here); Inkscape Lattice Deformation 2
// (whole-curve composition, then an approximate curve output — behaviour only, no code copied).
//
// Units: part-local (eye corners at x = ±10, base eye height 8; same as scenarioE.ts).
// Tolerances are fixed HERE, before the results (dot 1791284112):
//   FIT_TOL      — the fit's own stop condition (see fitSegment)
//   SOURCE_TOL   — judge for "same source position" checks (segment id + u → point)
import { PART, turnAffine, v, type A, type V } from './scenarioE'

export const FIT_TOL = 0.005 // part units; the fit stops when its sampled parametric error is below this
export const SOURCE_TOL = 0.005 // part units
export const SAMPLES_PER_SEGMENT = 200 // measured (not proven) deviation: u-uniform samples per source segment

// ---------- small vector / matrix helpers ----------
const add = (a: V, b: V): V => v(a.x + b.x, a.y + b.y)
const sub = (a: V, b: V): V => v(a.x - b.x, a.y - b.y)
const mul = (a: V, k: number): V => v(a.x * k, a.y * k)
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y)
export type Mat2 = [number, number, number, number] // [a, b, c, d]: x' = a x + c y, y' = b x + d y
export type Affine = { m: Mat2; t: V }
const applyM = (m: Mat2, p: V): V => v(m[0] * p.x + m[2] * p.y, m[1] * p.x + m[3] * p.y)
export const applyAffine = (f: Affine, p: V): V => add(applyM(f.m, p), f.t)
const det = (m: Mat2) => m[0] * m[3] - m[2] * m[1]
export function invertAffine(f: Affine): Affine {
  const d = det(f.m)
  const mi: Mat2 = [f.m[3] / d, -f.m[1] / d, -f.m[2] / d, f.m[0] / d]
  return { m: mi, t: mul(applyM(mi, f.t), -1) }
}

// ---------- author data (what the template author draws) ----------
export type SegId = 'U0' | 'U1' | 'L0' | 'L1'
export type Cubic = [V, V, V, V]
/** Control points of one lid as absolute points (anchors with their handles). */
export type LidCtrl = A[]
export type Part = { upper: LidCtrl; lower: LidCtrl }

const cloneLid = (l: LidCtrl): LidCtrl => l.map((a) => ({ p: { ...a.p }, hIn: { ...a.hIn }, hOut: { ...a.hOut } }))
export const basePart = (): Part => ({ upper: cloneLid(PART.upper), lower: cloneLid(PART.lower) })

/** Expression key forms on the NEUTRAL face (absolute control points at strength 1). */
export type Expressions = { close: Part; surprise: Part }
export function defaultExpressions(base: Part): Expressions {
  const shift = (a: A, d: V): A => ({ p: add(a.p, d), hIn: add(a.hIn, d), hOut: add(a.hOut, d) })
  return {
    // closed: the upper lid lies exactly on the lower lid (handles too)
    close: { upper: cloneLid(base.lower), lower: cloneLid(base.lower) },
    // surprised: upper middle −2, lower middle +1 (doc 17 §4's fixed amounts), as a key form
    surprise: {
      upper: base.upper.map((a, i) => (i === 1 ? shift(a, v(0, -2)) : a)),
      lower: base.lower.map((a, i) => (i === 1 ? shift(a, v(0, 1)) : a)),
    },
  }
}

/** Character shaping: a vertical scale about the eye's mid line, in the part's FIXED frame. */
export const CHARACTERS = { wide: { slider: 11 / 8 }, narrow: { slider: 5 / 8 } } as const
export type CharacterId = keyof typeof CHARACTERS
export const characterMap = (slider: number): Affine => ({ m: [1, 0, 0, slider], t: v(0, 0) })

/** The view deformer's fixed reference frame (on the part, shared by every child line and expression). */
export const VIEW_FRAME = { x0: -12, x1: 12, y0: -9, y1: 9 }

/** One parent deformer at 30°. */
export type ViewMap =
  | { kind: 'affine'; f: Affine }
  | { kind: 'map'; f: (p: V) => V; jac: (p: V) => Mat2 }

/** Tier A: the affine 30° turn of scenarioE (squeeze 0.8, tilt 10°, shift 3). */
export function viewA(): ViewMap {
  const t = turnAffine(30)
  const o = t.point(v(0, 0))
  const ex = sub(t.point(v(1, 0)), o)
  const ey = sub(t.point(v(0, 1)), o)
  return { kind: 'affine', f: { m: [ex.x, ex.y, ey.x, ey.y], t: o } }
}

/**
 * Tier B: a non-affine 30° turn — a polynomial patch of degree (2, 1) (inside the bicubic class),
 * defined over VIEW_FRAME: near side wider, far side narrower, vertical scale varying across x,
 * a slight sag, then the same 10° tilt and shift as tier A. Its Jacobian stays positive over the
 * frame (checked in the test, not assumed).
 */
export function viewB(): ViewMap {
  const th = (10 * Math.PI) / 180
  const c = Math.cos(th)
  const s = Math.sin(th)
  const raw = (p: V): V => v(0.8 * p.x + 0.008 * p.x * p.x, p.y * (1 + 0.015 * p.x) + 0.01 * p.x * p.x)
  const rawJ = (p: V): Mat2 => [0.8 + 0.016 * p.x, 0.015 * p.y + 0.02 * p.x, 0, 1 + 0.015 * p.x]
  const rot: Mat2 = [c, s, -s, c]
  const mm = (a: Mat2, b: Mat2): Mat2 => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3]]
  return { kind: 'map', f: (p) => add(applyM(rot, raw(p)), v(3, 0)), jac: (p) => mm(rot, rawJ(p)) }
}

export const PLACEMENT: Affine = (() => {
  const th = (5 * Math.PI) / 180
  const k = 1.2
  return { m: [k * Math.cos(th), k * Math.sin(th), -k * Math.sin(th), k * Math.cos(th)], t: v(40, 20) }
})()

export type Doc = { part: Part; expressions: Expressions; characters: Record<CharacterId, { slider: number }> }
export const defaultDoc = (): Doc => {
  const part = basePart()
  return { part, expressions: defaultExpressions(part), characters: { wide: { ...CHARACTERS.wide }, narrow: { ...CHARACTERS.narrow } } }
}
export type Params = { close: number; surprise: number }

// ---------- curves ----------
export const segIds: SegId[] = ['U0', 'U1', 'L0', 'L1']
export function segmentsOf(part: Part): Record<SegId, Cubic> {
  const seg = (l: LidCtrl, i: number): Cubic => [l[i].p, l[i].hOut, l[i + 1].hIn, l[i + 1].p]
  return { U0: seg(part.upper, 0), U1: seg(part.upper, 1), L0: seg(part.lower, 0), L1: seg(part.lower, 1) }
}
export function bez(c: Cubic, t: number): V {
  const u = 1 - t
  return v(
    u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x,
    u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y,
  )
}
export function bezD(c: Cubic, t: number): V {
  const u = 1 - t
  return v(
    3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x),
    3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y),
  )
}
const mapCubic = (c: Cubic, f: (p: V) => V): Cubic => c.map(f) as Cubic

/** An evaluation-only segment: carries its source segment and the u-range it covers (§8.3). */
export type TempSeg = { src: SegId; u0: number; u1: number; cubic: Cubic; depth: number }

/**
 * Fit the exact image g(u) = F(B(u)), u ∈ [u0, u1], by a cubic Hermite segment (end points exact,
 * end tangents by the chain rule). Same parameter: point t of the fit stands for u0 + t (u1 − u0),
 * so the fit's own error is the PARAMETRIC distance, sampled at 16 points. Above FIT_TOL: split in
 * half and recurse (the bisection mirrors lib2geom's build_from_sbasis; its stop test is an S-basis
 * tail bound, ours is this sampled parametric error — a different condition, reported as ours).
 */
function fitSegment(src: SegId, c: Cubic, F: (p: V) => V, J: (p: V) => Mat2, u0: number, u1: number, depth: number, out: TempSeg[]) {
  const g = (u: number) => F(bez(c, u))
  const dg = (u: number) => applyM(J(bez(c, u)), bezD(c, u))
  const h = u1 - u0
  const p0 = g(u0)
  const p3 = g(u1)
  const cubic: Cubic = [p0, add(p0, mul(dg(u0), h / 3)), sub(p3, mul(dg(u1), h / 3)), p3]
  let err = 0
  for (let i = 1; i < 16; i++) err = Math.max(err, dist(bez(cubic, i / 16), g(u0 + (h * i) / 16)))
  if (err <= FIT_TOL || depth >= 12) {
    out.push({ src, u0, u1, cubic, depth })
    return
  }
  const um = (u0 + u1) / 2
  fitSegment(src, c, F, J, u0, um, depth + 1, out)
  fitSegment(src, c, F, J, um, u1, depth + 1, out)
}

// ---------- the combination: L1 → L2 → V → P ----------
export type Evaluated = {
  /** evaluation-only segments in world coordinates, each mapped back to its source segment */
  segs: TempSeg[]
  /** exact world position of a source point (no fitting) — the reference for the checks */
  exact: (src: SegId, u: number) => V
  /** world position through the temp segments (what drawing / intervals / fills would read) */
  at: (src: SegId, u: number) => V
  /** composite linear part at a source point (for direction checks) */
  linearAt: (src: SegId, u: number) => Mat2
}

/** L1: expression key forms interpolated on the neutral face (strengths add, relative to the base). */
export function expressionShape(doc: Doc, p: Params): Part {
  const mix = (base: LidCtrl, a: LidCtrl, b: LidCtrl): LidCtrl =>
    base.map((x, i) => {
      const f = (k: 'p' | 'hIn' | 'hOut') => add(add(x[k], mul(sub(a[i][k], x[k]), p.close)), mul(sub(b[i][k], x[k]), p.surprise))
      return { p: f('p'), hIn: f('hIn'), hOut: f('hOut') }
    })
  const e = doc.expressions
  return { upper: mix(doc.part.upper, e.close.upper, e.surprise.upper), lower: mix(doc.part.lower, e.close.lower, e.surprise.lower) }
}

export function evaluate(doc: Doc, character: CharacterId, params: Params, view: ViewMap, placement: Affine = PLACEMENT): Evaluated {
  const local = segmentsOf(expressionShape(doc, params)) // L1
  const L2 = characterMap(doc.characters[character].slider) // L2 (affine: exact on control points)
  const P = placement
  const segs: TempSeg[] = []
  for (const id of segIds) {
    const c2 = mapCubic(local[id], (q) => applyAffine(L2, q))
    if (view.kind === 'affine') {
      segs.push({ src: id, u0: 0, u1: 1, cubic: mapCubic(c2, (q) => applyAffine(P, applyAffine(view.f, q))), depth: 0 })
    } else {
      const tmp: TempSeg[] = []
      fitSegment(id, c2, view.f, view.jac, 0, 1, 0, tmp)
      for (const s of tmp) segs.push({ ...s, cubic: mapCubic(s.cubic, (q) => applyAffine(P, q)) }) // P affine: exact after the fit
    }
  }
  const Vf = view.kind === 'affine' ? (q: V) => applyAffine(view.f, q) : view.f
  const VJ = view.kind === 'affine' ? () => view.f.m : view.jac
  const mm = (a: Mat2, b: Mat2): Mat2 => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3]]
  return {
    segs,
    exact: (src, u) => applyAffine(P, Vf(applyAffine(L2, bez(local[src], u)))),
    at: (src, u) => {
      const s = segs.find((x) => x.src === src && u >= x.u0 - 1e-12 && u <= x.u1 + 1e-12)!
      return bez(s.cubic, (u - s.u0) / (s.u1 - s.u0))
    },
    linearAt: (src, u) => {
      const q = applyAffine(L2, bez(local[src], u))
      return mm(P.m, mm(VJ(q), L2.m))
    },
  }
}

// ---------- T1 control: same author input, offsets per anchor (handles move with their anchor) ----------
/**
 * Screen = P( p₀ + o_character + w·o_expression + o_angle ), every offset recorded against the
 * NEUTRAL base drawing, per anchor (proto pose.ts semantics: the anchor's offset is added to the
 * anchor and both handles): o_character = L2(p₀) − p₀, o_expression = keyform − p₀,
 * o_angle = V(p₀) − p₀.
 */
export function evaluateT1(doc: Doc, character: CharacterId, params: Params, view: ViewMap, placement: Affine = PLACEMENT): Evaluated {
  const L2 = characterMap(doc.characters[character].slider)
  const Vf = view.kind === 'affine' ? (q: V) => applyAffine(view.f, q) : view.f
  const exprAt = expressionShape(doc, params)
  const lid = (base: LidCtrl, expr: LidCtrl): LidCtrl =>
    base.map((a, i) => {
      const oChar = sub(applyAffine(L2, a.p), a.p)
      const oAngle = sub(Vf(a.p), a.p)
      const shiftBy = (k: 'p' | 'hIn' | 'hOut') => add(add(add(a[k], oChar), sub(expr[i][k], a[k])), oAngle)
      return { p: shiftBy('p'), hIn: shiftBy('hIn'), hOut: shiftBy('hOut') }
    })
  const part: Part = { upper: lid(doc.part.upper, exprAt.upper), lower: lid(doc.part.lower, exprAt.lower) }
  const segsLocal = segmentsOf(part)
  const segs: TempSeg[] = segIds.map((id) => ({ src: id, u0: 0, u1: 1, cubic: mapCubic(segsLocal[id], (q) => applyAffine(placement, q)), depth: 0 }))
  const at = (src: SegId, u: number) => bez(segs.find((s) => s.src === src)!.cubic, u)
  return { segs, exact: at, at, linearAt: () => placement.m }
}

// ---------- write-back (§8.4): drag a screen point, invert every effective step after the target ----------
export type EditTarget = { kind: 'base' } | { kind: 'expression'; name: 'close' | 'surprise' }
export type EditResult = { ok: true; doc: Doc } | { ok: false; reason: string }
/**
 * Move the MIDDLE anchor of the upper lid (with its handles) so that it lands on `screen`.
 * Allowed only at key states (expression strengths 0 or 1) and only for an affine view (tier A);
 * the inverse chain is P⁻¹ → V⁻¹ → L2⁻¹ (→ L1, an identity at strength 0 for the base target).
 * `skipCharacterInverse` exists only to show that a partial inverse chain does NOT round-trip.
 */
export function dragUpperMiddle(doc: Doc, character: CharacterId, params: Params, view: ViewMap, target: EditTarget, screen: V, opts: { skipCharacterInverse?: boolean } = {}): EditResult {
  if (view.kind !== 'affine') return { ok: false, reason: 'view deformer is non-affine: editing in the deformed preview is not supported this round — edit the original form or in the neutral view' }
  const keyState = (w: number) => w === 0 || w === 1
  if (!keyState(params.close) || !keyState(params.surprise)) return { ok: false, reason: 'expression strengths must sit on a key value (0 or 1)' }
  let q = applyAffine(invertAffine(PLACEMENT), screen)
  q = applyAffine(invertAffine(view.f), q)
  if (!opts.skipCharacterInverse) q = applyAffine(invertAffine(characterMap(doc.characters[character].slider)), q)
  const next: Doc = JSON.parse(JSON.stringify(doc))
  if (target.kind === 'base') {
    if (params.close !== 0 || params.surprise !== 0) return { ok: false, reason: 'editing the base needs every expression at strength 0 (L1 = identity)' }
    const a = next.part.upper[1]
    const d = sub(q, a.p)
    next.part.upper[1] = { p: q, hIn: add(a.hIn, d), hOut: add(a.hOut, d) }
    // the expression key forms are absolute shapes: the base edit does not move them
  } else {
    const strength = params[target.name]
    const others = target.name === 'close' ? params.surprise : params.close
    if (strength !== 1 || others !== 0) return { ok: false, reason: `editing the ${target.name} key form needs ${target.name} = 1 and the other expressions at 0` }
    const a = next.expressions[target.name].upper[1]
    const d = sub(q, a.p)
    next.expressions[target.name].upper[1] = { p: q, hIn: add(a.hIn, d), hOut: add(a.hOut, d) }
  }
  return { ok: true, doc: next }
}

// ---------- dependency counting (§8.5): a character's result is recomputed only when what it read changed ----------
export class Evaluator {
  private versions = new Map<string, number>()
  private cache = new Map<string, { reads: Map<string, number>; value: Evaluated }>()
  evaluations = 0
  constructor(public doc: Doc) {}
  bump(key: string) {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1)
  }
  setSlider(ch: CharacterId, slider: number) {
    this.doc = { ...this.doc, characters: { ...this.doc.characters, [ch]: { slider } } }
    this.bump(`character:${ch}`)
  }
  get(ch: CharacterId, params: Params, view: ViewMap, viewKey: string): Evaluated {
    const key = `${ch}|${params.close}|${params.surprise}|${viewKey}`
    const hit = this.cache.get(key)
    if (hit && [...hit.reads].every(([k, ver]) => (this.versions.get(k) ?? 0) === ver)) return hit.value
    const reads = new Map(['part', 'expressions', `character:${ch}`, `view:${viewKey}`].map((k) => [k, this.versions.get(k) ?? 0] as [string, number]))
    this.evaluations++
    const value = evaluate(this.doc, ch, params, view)
    this.cache.set(key, { reads, value })
    return value
  }
}
