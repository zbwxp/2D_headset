// Scenario E experiment (docs/design/architecture/16 §2, 17 §7). STANDALONE: not wired into the
// editor or the store. Purpose: compare ways to combine customisation (捏形), head turn and expressions
// on COMPLETE eyelid curves, and report effect, cost and failure conditions of each — no aesthetic
// is fixed here (template authors choose expression rules; 17 §8).
//
// Every capability is a Stage with the common interface of 17 §2: what it reads (declared and
// logged), which params it takes, what it outputs (the eye), and where an edit would be written.

export type V = { x: number; y: number }
/** Handles are ABSOLUTE points here (so affine maps apply to them directly). */
export type A = { p: V; hIn: V; hOut: V }
export type Lid = [A, A, A] // corner, middle, corner
export type Eye = { upper: Lid; lower: Lid; stroke: number }

const v = (x: number, y: number): V => ({ x, y })
const add = (a: V, b: V): V => v(a.x + b.x, a.y + b.y)
const sub = (a: V, b: V): V => v(a.x - b.x, a.y - b.y)
const mul = (a: V, k: number): V => v(a.x * k, a.y * k)
const lerp = (a: V, b: V, t: number): V => add(a, mul(sub(b, a), t))
const anchor = (p: V, hIn: V, hOut: V): A => ({ p, hIn: add(p, hIn), hOut: add(p, hOut) })
const mapA = (a: A, f: (p: V) => V): A => ({ p: f(a.p), hIn: f(a.hIn), hOut: f(a.hOut) })
const mapEye = (e: Eye, f: (p: V, lid: 'upper' | 'lower', i: number) => V): Eye => ({
  ...e,
  upper: e.upper.map((a, i) => mapA(a, (p) => f(p, 'upper', i))) as Lid,
  lower: e.lower.map((a, i) => mapA(a, (p) => f(p, 'lower', i))) as Lid,
})
const zipEye = (e: Eye, g: (a: A, b: A, lid: 'upper' | 'lower', i: number) => A, other: Eye): Eye => ({
  ...e,
  upper: e.upper.map((a, i) => g(a, other.upper[i], 'upper', i)) as Lid,
  lower: e.lower.map((a, i) => g(a, other.lower[i], 'lower', i)) as Lid,
})
const lerpA = (a: A, b: A, t: number): A => ({ p: lerp(a.p, b.p, t), hIn: lerp(a.hIn, b.hIn, t), hOut: lerp(a.hOut, b.hOut, t) })

// ---------- data: one eye PART shared by three CHARACTERS ----------
/** The part's base drawing (eye-local coordinates, y down). Corners are shared by both lids. */
export const PART: Eye = {
  upper: [anchor(v(-10, 0), v(0, 0), v(3, -3)), anchor(v(0, -4), v(-5, 0), v(5, 0)), anchor(v(10, 0), v(-3, -3), v(0, 0))],
  lower: [anchor(v(-10, 0), v(0, 0), v(3, 3)), anchor(v(0, 4), v(-5, 0), v(5, 0)), anchor(v(10, 0), v(-3, 3), v(0, 0))],
  stroke: 1,
}
/** Customisation per character: offsets of the middle anchors (handles move with their anchor). */
export const CHARACTERS: Record<string, { upperMid: V; lowerMid: V }> = {
  base: { upperMid: v(0, 0), lowerMid: v(0, 0) },
  wide: { upperMid: v(0, -2), lowerMid: v(0, 1) },
  narrow: { upperMid: v(0, 2), lowerMid: v(0, -1) },
}
/** The 30° head turn recorded on the PART, here an affine form: tilt θ, horizontal squeeze, shift. */
export function turnAffine(deg: number, tiltDeg = 10) {
  const k = deg / 30
  const s = 1 - 0.2 * k
  const th = (tiltDeg * k * Math.PI) / 180
  const lin = (p: V) => v(Math.cos(th) * s * p.x - Math.sin(th) * p.y, Math.sin(th) * s * p.x + Math.cos(th) * p.y)
  return { point: (p: V) => add(lin(p), v(3 * k, 0)), linear: lin }
}

// ---------- the common interface ----------
export type Params = { angle: number; close: number; surprise: number }
export type Ctx = { character: string; params: Params; read: (key: string) => unknown }
export type Stage = {
  name: string
  kind: 'customise' | 'turn' | 'expression'
  /** declared reads; the evaluator logs actual reads so the declaration can be checked */
  reads: (character: string) => string[]
  writesTo: 'character' | 'part' | 'rule'
  apply: (eye: Eye, ctx: Ctx) => Eye
}

// customisation (writes to the character)
const customiseShape = (eye: Eye, c: { upperMid: V; lowerMid: V }) =>
  mapEye(eye, (p, lid, i) => (i === 1 ? add(p, lid === 'upper' ? c.upperMid : c.lowerMid) : p))
export const customise: Stage = {
  name: 'customise',
  kind: 'customise',
  reads: (ch) => [`character:${ch}`],
  writesTo: 'character',
  apply: (eye, ctx) => customiseShape(eye, ctx.read(`character:${ctx.character}`) as { upperMid: V; lowerMid: V }),
}

// head turn: T1 = customisation offset added untransformed after turning the PART; T2 = turn the
// customised shape (offset carried in the part's local frame).
export const turnT2: Stage = {
  name: 'turn T2 (customisation carried by the turn)',
  kind: 'turn',
  reads: () => ['part:turn'],
  writesTo: 'part',
  apply: (eye, ctx) => mapEye(eye, turnAffine(ctx.params.angle).point),
}
export const customiseThenTurnT1: Stage = {
  name: 'turn T1 (part turned, customisation offset added as-is)',
  kind: 'turn',
  reads: (ch) => ['part:turn', `character:${ch}`],
  writesTo: 'part',
  apply: (_eye, ctx) => {
    const turned = mapEye(PART, turnAffine(ctx.params.angle).point)
    return customiseShape(turned, ctx.read(`character:${ctx.character}`) as { upperMid: V; lowerMid: V })
  },
}

// closing rules (template authors would pick one; 17 §8)
const closeFixedOffset: Stage = {
  // authored once on the PART so that the PART closes along its whole length (corner handles too)
  name: 'close: fixed offsets authored on the part',
  kind: 'expression',
  reads: () => ['rule:close'],
  writesTo: 'rule',
  apply: (eye, ctx) => {
    const target = PART.lower
    const deltas = PART.upper.map((a, i) => ({ p: sub(target[i].p, a.p), hIn: sub(target[i].hIn, a.hIn), hOut: sub(target[i].hOut, a.hOut) }))
    const w = ctx.params.close
    return { ...eye, upper: eye.upper.map((a, i) => ({ p: add(a.p, mul(deltas[i].p, w)), hIn: add(a.hIn, mul(deltas[i].hIn, w)), hOut: add(a.hOut, mul(deltas[i].hOut, w)) })) as Lid }
  },
}
const closeRelational: Stage = {
  name: 'close: upper lid → lower lid of the CURRENT shape',
  kind: 'expression',
  reads: () => ['rule:close'],
  writesTo: 'rule',
  apply: (eye, ctx) => ({ ...eye, upper: eye.upper.map((a, i) => lerpA(a, eye.lower[i], ctx.params.close)) as Lid }),
}
const closePresetTarget: Stage = {
  name: 'close: both lids → one preset closed line (same for all)',
  kind: 'expression',
  reads: () => ['rule:close'],
  writesTo: 'rule',
  apply: (eye, ctx) => {
    const line: Lid = [anchor(v(-10, 0), v(0, 0), v(3, 1)), anchor(v(0, 2), v(-5, 0), v(5, 0)), anchor(v(10, 0), v(-3, 1), v(0, 0))]
    const t = ctx.params.angle ? mapEye({ ...PART, upper: line, lower: line }, turnAffine(ctx.params.angle).point).upper : line
    const w = ctx.params.close
    return { ...eye, upper: eye.upper.map((a, i) => lerpA(a, t[i], w)) as Lid, lower: eye.lower.map((a, i) => lerpA(a, t[i], w)) as Lid }
  },
}
const closeGeneratedTarget: Stage = {
  name: "close: both lids → the character's own midline (target generated from character data)",
  kind: 'expression',
  reads: () => ['rule:close'],
  writesTo: 'rule',
  apply: (eye, ctx) => {
    const midLid = eye.upper.map((a, i) => lerpA(a, eye.lower[i], 0.5)) as Lid
    const w = ctx.params.close
    return { ...eye, upper: eye.upper.map((a, i) => lerpA(a, midLid[i], w)) as Lid, lower: eye.lower.map((a, i) => lerpA(a, midLid[i], w)) as Lid }
  },
}
const closeMidpointOnly: Stage = {
  // the naive version of a fixed offset: only the middle anchor moves (what a two-point check sees)
  name: 'close: middle anchor only, fixed offset',
  kind: 'expression',
  reads: () => ['rule:close'],
  writesTo: 'rule',
  apply: (eye, ctx) => mapEye(eye, (p, lid, i) => (lid === 'upper' && i === 1 ? add(p, mul(v(0, 8), ctx.params.close)) : p)),
}
export const CLOSE_RULES = { midpointOnly: closeMidpointOnly, fixedOffset: closeFixedOffset, relational: closeRelational, presetTarget: closePresetTarget, generatedTarget: closeGeneratedTarget }

// surprise rules
const centreOf = (eye: Eye) => mul(add(eye.upper[0].p, eye.upper[2].p), 0.5)
export const SURPRISE_RULES: Record<string, Stage> = {
  fixedAmount: {
    name: 'surprise: same amount for everyone',
    kind: 'expression',
    reads: () => ['rule:surprise'],
    writesTo: 'rule',
    apply: (eye, ctx) => mapEye(eye, (p, lid, i) => (i === 1 ? add(p, mul(lid === 'upper' ? v(0, -2) : v(0, 1), ctx.params.surprise)) : p)),
  },
  proportional: {
    name: 'surprise: open by 25% of the current height',
    kind: 'expression',
    reads: () => ['rule:surprise'],
    writesTo: 'rule',
    apply: (eye, ctx) => {
      const c = centreOf(eye)
      const k = 1 + 0.25 * ctx.params.surprise
      return mapEye(eye, (p) => add(c, v(p.x - c.x, (p.y - c.y) * k)))
    },
  },
  presetShape: {
    name: 'surprise: move toward one preset surprised shape',
    kind: 'expression',
    reads: () => ['rule:surprise'],
    writesTo: 'rule',
    apply: (eye, ctx) => {
      const target = customiseShape(PART, { upperMid: v(0, -3), lowerMid: v(0, 2) })
      return zipEye(eye, (a, b) => lerpA(a, b, ctx.params.surprise), target)
    },
  },
}

// ---------- evaluation with logged reads ----------
export type Run = { eye: Eye; reads: string[] }
export function evaluateEye(character: string, params: Params, pipeline: Stage[], data: Record<string, unknown>): Run {
  const reads: string[] = []
  const read = (key: string) => {
    reads.push(key)
    return data[key]
  }
  let eye = PART
  for (const s of pipeline) eye = s.apply(eye, { character, params, read })
  return { eye, reads }
}
export const defaultData = (): Record<string, unknown> => ({
  ...Object.fromEntries(Object.entries(CHARACTERS).map(([k, c]) => [`character:${k}`, c])),
  'part:turn': true,
  'rule:close': true,
  'rule:surprise': true,
})

// ---------- measurements over the WHOLE lids ----------
function cubic(p0: V, c1: V, c2: V, p3: V, t: number): V {
  const u = 1 - t
  return v(u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x, u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y)
}
export function sampleLid(lid: Lid, n = 64): V[] {
  const out: V[] = []
  for (let s = 0; s < 2; s++) for (let i = 0; i < n; i++) out.push(cubic(lid[s].p, lid[s].hOut, lid[s + 1].hIn, lid[s + 1].p, i / n))
  out.push(lid[2].p)
  return out
}
const distToSeg = (p: V, a: V, b: V) => {
  const ab = sub(b, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y || 1)))
  const q = add(a, mul(ab, t))
  return Math.hypot(p.x - q.x, p.y - q.y)
}
const distToPoly = (p: V, poly: V[]) => Math.min(...poly.slice(1).map((b, i) => distToSeg(p, poly[i], b)))
function crossings(a: V[], b: V[]) {
  const cross = (o: V, p: V, q: V) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  let n = 0
  // skip the first/last few samples: the corners are shared on purpose
  for (let i = 2; i < a.length - 3; i++)
    for (let j = 2; j < b.length - 3; j++) {
      const [p1, p2, q1, q2] = [a[i], a[i + 1], b[j], b[j + 1]]
      const d1 = cross(q1, q2, p1)
      const d2 = cross(q1, q2, p2)
      const d3 = cross(p1, p2, q1)
      const d4 = cross(p1, p2, q2)
      if (d1 * d2 < -1e-9 && d3 * d4 < -1e-9) n++
    }
  return n
}
export type Metrics = {
  /** largest distance between the two lids along their whole length (0 = closed everywhere) */
  maxGap: number
  /** the lid gap at the middle only (what a two-point check would see) */
  midGap: number
  /** proper crossings between upper and lower lid (excluding the shared corners) */
  crossings: number
  /** both corners joined (upper and lower share each corner point) */
  cornersJoined: boolean
  /** signed area between the lids (>0 open, ≈0 closed, <0 lids inverted) */
  area: number
  /** fraction of the lid length where the two strokes overlap (stroke doubling risk) */
  strokeOverlap: number
}
export function measure(eye: Eye): Metrics {
  const up = sampleLid(eye.upper)
  const lo = sampleLid(eye.lower)
  const maxGap = Math.max(Math.max(...up.map((p) => distToPoly(p, lo))), Math.max(...lo.map((p) => distToPoly(p, up))))
  const poly = [...up, ...[...lo].reverse()]
  let a2 = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a2 += p.x * q.y - q.x * p.y
  }
  const overlap = up.filter((p) => distToPoly(p, lo) < eye.stroke).length / up.length
  return {
    maxGap: +maxGap.toFixed(3),
    midGap: +Math.hypot(eye.upper[1].p.x - eye.lower[1].p.x, eye.upper[1].p.y - eye.lower[1].p.y).toFixed(3),
    crossings: crossings(up, lo),
    cornersJoined: [0, 2].every((i) => Math.hypot(eye.upper[i].p.x - eye.lower[i].p.x, eye.upper[i].p.y - eye.lower[i].p.y) < 1e-9),
    area: +(a2 / 2).toFixed(2), // y-down coordinates: upper lid left→right, lower lid back → positive when open
    strokeOverlap: +overlap.toFixed(2),
  }
}
