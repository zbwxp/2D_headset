// deform — the maths of the 四角 / 曲边 transform (bowen 1791890087; docs/deform-p1-checklist.md): a Coons bend
// of a frame's four edges, then the homography of its four corners, and one cubic refitted per source cubic
// (bowen 1791891109, "A"). A port of v103 (7205381) src/domain/deformation/{homography,cageField,coons,
// cubicDeformation}.ts: the same arithmetic in the same order, points as { x, y } instead of [x, y]
// (deform/test compares it with a frozen copy of the original). Plain maths on plain data; no imports.

export interface Vec { readonly x: number; readonly y: number }
export type Cubic = readonly [Vec, Vec, Vec, Vec]
/** Counterclockwise in drawing coordinates: bottom left, bottom right, top right, top left. */
export type Quad = readonly [Vec, Vec, Vec, Vec]
export interface Rect { readonly min: Vec; readonly max: Vec }

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s })
const length = (a: Vec) => Math.hypot(a.x, a.y)
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x
const clamp = (x: number) => Math.max(0, Math.min(1, x))
// finite values only, in and out of every public function (dot 1791891870): refused, never passed on — beyond
// v103, which lets NaN and Infinity run through; finite inputs compute exactly as v103 does
const notFinite = () => Error('变形输入或结果不是有限数。')
const fv = (p: Vec): Vec => { if (!(p && Number.isFinite(p.x) && Number.isFinite(p.y))) throw notFinite(); return p }
const fn = (x: number): number => { if (!Number.isFinite(x)) throw notFinite(); return x }

// ---- homography (homography.ts) ---------------------------------------------------------------

export type Matrix3 = [number, number, number, number, number, number, number, number, number]
export function inverse3(m: Matrix3): Matrix3 {
  m.forEach(fn)
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-10) throw Error('当前图层接近侧立，请转回一些角度再调整四角。')
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map(v => fn(v / det)) as Matrix3
}
export function map3(m: Matrix3, p: Vec): Vec {
  m.forEach(fn); fv(p)
  const w = m[6] * p.x + m[7] * p.y + m[8]
  if (!Number.isFinite(w) || Math.abs(w) < 1e-8) throw Error('透视超出有效范围。')
  return fv({ x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w })
}

// ---- the four-corner homography (cageField.ts quadProjection) ----------------------------------

export const rectQuad = (r: Rect): Quad => { fv(r.min); fv(r.max); return [{ ...r.min }, { x: r.max.x, y: r.min.y }, { ...r.max }, { x: r.min.x, y: r.max.y }] }
const invalid = () => Error('四角不能交叉或压扁；已保留最后有效位置。')

export interface Field {
  /** A point of the rest frame → its deformed position. Throws past the projective horizon. */
  map(p: Vec): Vec
  /** The field's derivative at `p` applied to the direction `v`. */
  vector(p: Vec, v: Vec): Vec
  /** The projective denominator at `p` (1 where the field is affine). */
  denominator(p: Vec): number
  /** True when the field is affine: control points map exactly. */
  readonly affine: boolean
}

/** The unit square's homography onto `quad`, normalized before solving to avoid document-coordinate conditioning. */
export function quadProjection(rect: Rect, quad: Quad): Field & { matrix: Matrix3 } {
  const w = rect.max.x - rect.min.x, h = rect.max.y - rect.min.y, scale = Math.max(...quad.map((p, i) => length(sub(p, quad[(i + 1) % 4]!))))
  // beyond v103 (dot 1791891353): a non-finite frame is refused too (v103 let it through as NaN results)
  const finite = (p: Vec) => Number.isFinite(p.x) && Number.isFinite(p.y)
  if (!finite(rect.min) || !finite(rect.max)) throw invalid()
  if (w < 1e-7 || h < 1e-7 || !quad.every(finite) || scale < 1e-7) throw invalid()
  for (let i = 0; i < 4; i++) if (cross(sub(quad[(i + 1) % 4]!, quad[i]!), sub(quad[(i + 2) % 4]!, quad[(i + 1) % 4]!)) < scale * scale * 1e-5) throw invalid()
  const q = quad.map(p => mul(sub(p, quad[0]), 1 / scale)), uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]], rows: number[][] = []
  uv.forEach(([u, v], i) => { const { x, y } = q[i]!; rows.push([u, v, 1, 0, 0, 0, -x * u, -x * v, x], [0, 0, 0, u, v, 1, -y * u, -y * v, y]) })
  for (let k = 0; k < 8; k++) {
    let pivot = k
    for (let i = k + 1; i < 8; i++) if (Math.abs(rows[i]![k]!) > Math.abs(rows[pivot]![k]!)) pivot = i
    ;[rows[k], rows[pivot]] = [rows[pivot]!, rows[k]!]
    const den = rows[k]![k]!
    if (Math.abs(den) < 1e-12) throw invalid()
    for (let j = k; j <= 8; j++) rows[k]![j]! /= den
    for (let i = 0; i < 8; i++) if (i !== k) { const f = rows[i]![k]!; for (let j = k; j <= 8; j++) rows[i]![j]! -= f * rows[k]![j]! }
  }
  const a = rows.map(r => r[8]!)
  const coords = (p: Vec): [number, number] => [(p.x - rect.min.x) / w, (p.y - rect.min.y) / h]
  const denominator = (p: Vec) => { const [u, v] = coords(fv(p)); return fn(a[6]! * u + a[7]! * v + 1) }
  function map(p: Vec): Vec {
    const [u, v] = coords(p), den = denominator(p)
    if (den < 1e-4) throw invalid() // v103's rule, the positive side only; a non-finite den is refused above
    return fv(add(quad[0], mul({ x: (a[0]! * u + a[1]! * v + a[2]!) / den, y: (a[3]! * u + a[4]! * v + a[5]!) / den }, scale)))
  }
  function vector(p: Vec, v: Vec): Vec {
    fv(v)
    const [u, s] = coords(p), den = denominator(p), x = (a[0]! * u + a[1]! * s + a[2]!) / den, y = (a[3]! * u + a[4]! * s + a[5]!) / den
    return fv(mul({ x: (a[0]! - x * a[6]!) * v.x / w + (a[1]! - x * a[7]!) * v.y / h, y: (a[3]! - y * a[6]!) * v.x / w + (a[4]! - y * a[7]!) * v.y / h }, scale / den))
  }
  rectQuad(rect).forEach(map)
  // the exact row-major homography
  const x0 = (scale * a[0]! + quad[0].x * a[6]!) / w, x1 = (scale * a[1]! + quad[0].x * a[7]!) / h
  const y0 = (scale * a[3]! + quad[0].y * a[6]!) / w, y1 = (scale * a[4]! + quad[0].y * a[7]!) / h
  const z0 = a[6]! / w, z1 = a[7]! / h
  a.forEach(fn)
  const matrix: Matrix3 = [
    x0, x1, scale * a[2]! + quad[0].x - x0 * rect.min.x - x1 * rect.min.y,
    y0, y1, scale * a[5]! + quad[0].y - y0 * rect.min.x - y1 * rect.min.y,
    z0, z1, 1 - z0 * rect.min.x - z1 * rect.min.y]
  matrix.forEach(fn)
  return { map, vector, denominator, matrix, affine: Math.abs(a[6]!) + Math.abs(a[7]!) < 1e-10 }
}

// ---- the edge bend (coons.ts) -----------------------------------------------------------------

/** Counterclockwise: bottom, right, top, left; two handles each, in the unit square; the end points are the frame's corners. */
export type BendHandles = readonly [readonly [Vec, Vec], readonly [Vec, Vec], readonly [Vec, Vec], readonly [Vec, Vec]]
export interface Bend { readonly handles: BendHandles; readonly enabled: boolean }
const corners: Vec[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
export const neutralHandles = (): BendHandles => corners.map((a, i) => { const b = corners[(i + 1) % 4]!; return [1 / 3, 2 / 3].map(t => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) }) as unknown as BendHandles
export const neutralBend = (): Bend => ({ handles: neutralHandles(), enabled: true })
export const bendEdges = (value: Bend): Cubic[] => { checkBend(value); return corners.map((p, i) => [p, ...value.handles[i]!, corners[(i + 1) % 4]!] as unknown as Cubic) }
const straight = neutralHandles()
/** The container's own shape, checked at every function that takes a bend (dot 1791892166): `enabled` a boolean, four edges of two finite points. Not the ±8 range or the fold check — those are assertBend's. */
function checkBend(value: Bend): Bend {
  if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.handles) || value.handles.length !== 4 || !value.handles.every(e => Array.isArray(e) && e.length === 2)) throw Error('曲边变形参数无效')
  value.handles.forEach(e => e.forEach(fv))
  return value
}
/** Only the exact neutral value bypasses the nonlinear fit, keeping the homography exact. */
export const isNeutralBend = (value: Bend) => !checkBend(value).enabled || value.handles.every((edge, i) => edge.every((p, j) => p.x === straight[i]![j]!.x && p.y === straight[i]![j]!.y))
/** The bilinearly blended Coons patch in the unit square, as boundary displacements (the identity term cancelled). */
export function bendPoint(value: Bend, p: Vec): Vec {
  const u = fv(p).x, v = p.y
  if (!checkBend(value).enabled) return { x: u, y: v }
  let x = u, y = v
  const ts = [u, v, 1 - u, 1 - v], weights = [1 - v, u, v, 1 - u]
  for (let i = 0; i < 4; i++) {
    const t = ts[i]!, a = 3 * (1 - t) * (1 - t) * t * weights[i]!, b = 3 * (1 - t) * t * t * weights[i]!, H = value.handles[i]!, S = straight[i]!
    x += a * (H[0].x - S[0].x) + b * (H[1].x - S[1].x)
    y += a * (H[0].y - S[0].y) + b * (H[1].y - S[1].y)
  }
  return fv({ x, y })
}
/** The analytic directional derivative of the same patch. */
export function bendVector(value: Bend, p: Vec, d: Vec): Vec {
  const u = fv(p).x, v = p.y, du = fv(d).x, dv = d.y
  if (!checkBend(value).enabled) return { x: du, y: dv }
  let x = du, y = dv
  const ts = [u, v, 1 - u, 1 - v], weights = [1 - v, u, v, 1 - u], dt = [du, dv, -du, -dv], dw = [-dv, du, dv, -du]
  for (let i = 0; i < 4; i++) {
    const t = ts[i]!, s = 1 - t, a = 3 * s * (1 - 3 * t) * dt[i]! * weights[i]! + 3 * s * s * t * dw[i]!, b = 3 * t * (2 - 3 * t) * dt[i]! * weights[i]! + 3 * s * t * t * dw[i]!
    const H = value.handles[i]!, S = straight[i]!
    x += a * (H[0].x - S[0].x) + b * (H[1].x - S[1].x)
    y += a * (H[0].y - S[0].y) + b * (H[1].y - S[1].y)
  }
  return fv({ x, y })
}
/** A valid bend: four edges of two finite handles within ±8, and no fold or flattening at 17 × 17 sample points (a sampled guard, not a guarantee for the whole region). */
export function assertBend(value: Bend) {
  const ok = (p: Vec) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 8 && Math.abs(p.y) <= 8
  if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.handles) || value.handles.length !== 4 || !value.handles.every(e => Array.isArray(e) && e.length === 2 && e.every(ok))) throw Error('曲边变形参数无效')
  const h = 1e-4
  for (let j = 0; j <= 16; j++) for (let i = 0; i <= 16; i++) {
    const u = i / 16, v = j / 16, p = bendPoint(value, { x: u, y: v }), x = bendPoint(value, { x: u + h, y: v }), y = bendPoint(value, { x: u, y: v + h })
    const determinant = ((x.x - p.x) * (y.y - p.y) - (x.y - p.y) * (y.x - p.x)) / (h * h)
    if (!Number.isFinite(determinant) || determinant < 0.015) throw Error('曲边发生折叠或压扁，已保留最后有效形状。')
  }
}
export function inverseBend(value: Bend, target: Vec): Vec {
  if (!checkBend(value).enabled) return fv(target)
  fv(target)
  let p: Vec = { ...target }
  for (let k = 0; k < 18; k++) {
    const q = bendPoint(value, p), dx = q.x - target.x, dy = q.y - target.y
    if (Math.hypot(dx, dy) < 1e-8) return p
    const h = 1e-4, x = bendPoint(value, { x: p.x + h, y: p.y }), y = bendPoint(value, { x: p.x, y: p.y + h })
    const a = (x.x - q.x) / h, b = (y.x - q.x) / h, c = (x.y - q.y) / h, d = (y.y - q.y) / h, det = a * d - b * c
    if (Math.abs(det) < 1e-8) break
    const step = { x: (d * dx - b * dy) / det, y: (a * dy - c * dx) / det }
    let rate = 1
    while (rate > 0.015) {
      const next = { x: p.x - step.x * rate, y: p.y - step.y * rate }, v = bendPoint(value, next)
      if (Math.hypot(v.x - target.x, v.y - target.y) < Math.hypot(dx, dy)) { p = next; break }
      rate /= 2
    }
  }
  throw Error('这里的弯曲过大，请靠近曲线调整区间。')
}

// ---- the composed field (cageField.ts drawingDeformProjection) ---------------------------------

/** The shared editing field: the normalized Coons displacement, then the exact four-corner homography. A neutral or disabled bend returns the homography itself. */
export function deformField(rect: Rect, quad: Quad, bend?: Bend): Field {
  const projection = quadProjection(rect, quad)
  if (!bend) return projection
  assertBend(bend)
  if (isNeutralBend(bend)) return projection
  const w = rect.max.x - rect.min.x, h = rect.max.y - rect.min.y
  const normalized = (p: Vec): Vec => ({ x: (p.x - rect.min.x) / w, y: (p.y - rect.min.y) / h })
  const source = (p: Vec): Vec => ({ x: rect.min.x + p.x * w, y: rect.min.y + p.y * h })
  const bent = (p: Vec) => source(bendPoint(bend, normalized(p)))
  const map = (p: Vec) => projection.map(bent(p))
  const vector = (p: Vec, v: Vec): Vec => { const q = normalized(p), t = bendVector(bend, q, { x: v.x / w, y: v.y / h }); return projection.vector(source(bendPoint(bend, q)), { x: t.x * w, y: t.y * h }) }
  // the interior as well as the curves' later samples: the bend guard checks orientation, this the composed horizon
  for (let j = 0; j <= 16; j++) for (let i = 0; i <= 16; i++) map(source({ x: i / 16, y: j / 16 }))
  return { map, vector, denominator: (p: Vec) => projection.denominator(bent(p)), affine: false }
}

// ---- one cubic per source cubic (cubicDeformation.ts) ------------------------------------------

const point = (s: Cubic, t: number): Vec => { const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t; return { x: a * s[0].x + b * s[1].x + c * s[2].x + d * s[3].x, y: a * s[0].y + b * s[1].y + c * s[2].y + d * s[3].y } }
/** Projective reparameterization equalizing the rational cubic's endpoint weights. */
export const deformParameter = (t: number, scale: number) => fn(fn(scale) * fn(t) / (1 + (scale - 1) * t))
export interface CurveParameterMap { values: number[]; sourceKnots?: number[] }
/** The table's own shape, checked at every function that takes one (dot 1791892166): at least two finite values; source knots, when given, finite and as many. */
function checkMap(map: CurveParameterMap | undefined): CurveParameterMap | undefined {
  if (map === undefined) return map
  if (!map || !Array.isArray(map.values) || map.values.length < 2) throw Error('曲线参数表无效')
  map.values.forEach(fn)
  if (map.sourceKnots !== undefined) { if (!Array.isArray(map.sourceKnots) || map.sourceKnots.length !== map.values.length) throw Error('曲线参数表无效'); map.sourceKnots.forEach(fn) }
  return map
}
export function curveParameterSourceKnots(map?: CurveParameterMap): readonly number[] {
  checkMap(map)
  return map?.sourceKnots ?? (map ? map.values.map((_, i) => i / (map.values.length - 1)) : [0, 1])
}
const parameterInterval = (knots: readonly number[], value: number) => {
  let lo = 0, hi = knots.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (knots[mid]! <= value) lo = mid; else hi = mid }
  return lo
}
/** Source t → fitted t. */
export function mappedParameter(t: number, map?: CurveParameterMap) {
  fn(t); checkMap(map)
  if (!map) return t
  if (map.sourceKnots) { const value = clamp(t), i = parameterInterval(map.sourceKnots, value); return fn(map.values[i]! + (map.values[i + 1]! - map.values[i]!) * (value - map.sourceKnots[i]!) / (map.sourceKnots[i + 1]! - map.sourceKnots[i]!)) }
  const x = clamp(t) * (map.values.length - 1), i = Math.min(map.values.length - 2, Math.floor(x))
  return fn(map.values[i]! + (map.values[i + 1]! - map.values[i]!) * (x - i))
}
/** The target a fit follows: the deformed curve as a function of source t, and the deformed end derivatives / 3 (inward at the end). */
export interface CubicFitTarget { point: (t: number) => Vec; handles: readonly [Vec, Vec]; parameterScale?: number; exactShape?: Cubic }

/** Two positive handle lengths, fitted, and a monotonically refined point correspondence; end points and tangent rays exact. */
function fit(target: CubicFitTarget): { shape: Cubic; parameters: CurveParameterMap } {
  const count = 128, scale = target.parameterScale ?? 1
  const values = Array.from({ length: count + 1 }, (_, i) => (target.exactShape ? i / count : deformParameter(i / count, scale)))
  if (target.exactShape) return { shape: target.exactShape, parameters: { values } }
  const targets = values.map((_, i) => target.point(i / count)), a = targets[0]!, b = targets[count]!, va = mul(target.handles[0], 1 / scale), vb = mul(target.handles[1], scale)
  const la = length(va), lb = length(vb), ta = mul(va, 1 / (la || 1)), tb = mul(vb, 1 / (lb || 1)), loA = la ? la * 0.01 : 0, loB = lb ? lb * 0.01 : 0, hiA = la * 8, hiB = lb * 8
  const bound = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
  let fitted: Cubic = [a, add(a, va), add(b, vb), b]
  for (let iteration = 0; iteration < 10; iteration++) {
    let aa = 0, ab = 0, bb = 0, ra = 0, rb = 0
    for (let i = 1; i < count; i++) {
      const t = values[i]!, u = 1 - t, B1 = 3 * u * u * t, B2 = 3 * u * t * t, base = add(mul(a, u * u * u + B1), mul(b, B2 + t * t * t)), r = sub(targets[i]!, base), x = mul(ta, B1), y = mul(tb, B2)
      aa += dot(x, x); ab += dot(x, y); bb += dot(y, y); ra += dot(x, r); rb += dot(y, r)
    }
    const det = aa * bb - ab * ab, candidates: [number, number][] = []
    if (det > 1e-15) { const x = (ra * bb - rb * ab) / det, y = (rb * aa - ra * ab) / det; if (x >= loA && x <= hiA && y >= loB && y <= hiB) candidates.push([x, y]) }
    for (const x of [loA, hiA]) candidates.push([x, bound(bb ? (rb - ab * x) / bb : 0, loB, hiB)])
    for (const y of [loB, hiB]) candidates.push([bound(aa ? (ra - ab * y) / aa : 0, loA, hiA), y])
    const score = ([x, y]: [number, number]) => aa * x * x + 2 * ab * x * y + bb * y * y - 2 * ra * x - 2 * rb * y
    const [x, y] = candidates.sort((p, q) => score(p) - score(q))[0]!
    fitted = [a, add(a, mul(ta, x)), add(b, mul(tb, y)), b]
    // closest-point Newton steps, kept between neighbours so the material order holds
    for (let i = 1; i < count; i++) for (let step = 0; step < 3; step++) {
      const t = values[i]!, u = 1 - t
      const v = add(add(mul(sub(fitted[1], a), 3 * u * u), mul(sub(fitted[2], fitted[1]), 6 * u * t)), mul(sub(b, fitted[2]), 3 * t * t))
      const acc = add(mul(add(sub(fitted[2], mul(fitted[1], 2)), a), 6 * u), mul(add(sub(b, mul(fitted[2], 2)), fitted[1]), 6 * t))
      const r = sub(point(fitted, t), targets[i]!), den = dot(v, v) + dot(r, acc)
      if (den <= 1e-15) break
      const next = bound(t - dot(r, v) / den, values[i - 1]! + 1e-9, values[i + 1]! - 1e-9)
      if (length(sub(point(fitted, next), targets[i]!)) > length(r)) break
      values[i] = next
    }
    if (values.every((t, i) => length(sub(point(fitted, t), targets[i]!)) < 0.00004)) break
  }
  return { shape: fitted, parameters: { values } }
}
/** A fit and its diagnostic: `maxError` over 257 samples (not a certified bound). */
export function fitCubicTarget(target: CubicFitTarget) {
  target.handles.forEach(fv)
  if (target.parameterScale !== undefined) fn(target.parameterScale)
  target.exactShape?.forEach(fv)
  const result = fit(target)
  let maxError = 0
  for (let i = 0; i <= 256; i++) maxError = Math.max(maxError, length(sub(point(result.shape, mappedParameter(i / 256, result.parameters)), target.point(i / 256))))
  if (!Number.isFinite(maxError) || !result.shape.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) || !result.parameters.values.every(Number.isFinite)) throw Error('Cubic fitting produced non-finite geometry.')
  return { ...result, maxError }
}
/** One cubic per source cubic under the field (bowen 1791891109, "A"): affine → the control points mapped exactly; otherwise the fit. */
export function fitDeformedCubic(shape: Cubic, field: Field) {
  shape.forEach(field.map) // also guards control points outside the frame
  return fitCubicTarget({
    point: t => field.map(point(shape, t)),
    parameterScale: Math.cbrt(field.denominator(shape[3]) / field.denominator(shape[0])),
    handles: field.affine ? [{ x: 0, y: 0 }, { x: 0, y: 0 }] : [field.vector(shape[0], sub(shape[1], shape[0])), field.vector(shape[3], sub(shape[2], shape[3]))],
    exactShape: field.affine ? (shape.map(field.map) as unknown as Cubic) : undefined,
  })
}
/** The inverse of the fitted cubic's increasing source t → fitted t table. */
export function sourceParameter(t: number, map?: CurveParameterMap): number {
  fn(t); checkMap(map)
  if (!map) return t
  const value = clamp(t), values = map.values
  let lo = 0, hi = values.length - 1
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (values[mid]! <= value) lo = mid; else hi = mid }
  if (map.sourceKnots) return fn(map.sourceKnots[lo]! + (map.sourceKnots[hi]! - map.sourceKnots[lo]!) * (value - values[lo]!) / (values[hi]! - values[lo]!))
  return fn((lo + (value - values[lo]!) / (values[hi]! - values[lo]!)) / (values.length - 1))
}
export function mappedParameterSlope(t: number, map?: CurveParameterMap): number {
  fn(t); checkMap(map)
  if (!map) return 1
  if (map.sourceKnots) { const i = parameterInterval(map.sourceKnots, clamp(t)); return fn((map.values[i + 1]! - map.values[i]!) / (map.sourceKnots[i + 1]! - map.sourceKnots[i]!)) }
  const i = Math.min(map.values.length - 2, Math.floor(clamp(t) * (map.values.length - 1)))
  return fn((map.values[i + 1]! - map.values[i]!) * (map.values.length - 1))
}
export function sourceParameterSlope(t: number, map?: CurveParameterMap): number {
  fn(t); checkMap(map)
  if (!map) return 1
  return fn(1 / mappedParameterSlope(sourceParameter(t, map), map))
}

// ---- one edit's plan (package 2; docs/deform-p2-checklist.md) ----------------------------------

/** A line as drawn in a view: its id, its end point ids and its cubic. */
export interface PlanLine { readonly id: string; readonly a: string; readonly b: string; readonly curve: Cubic }
export interface Plan {
  /** One target per end point: a point shared by several lines is mapped once. */
  readonly points: { id: string; target: Vec }[]
  /** Each line's fitted handles, as offsets from their end points. */
  readonly handles: { line: string; end: 'a' | 'b'; offset: Vec }[]
  /** The largest of the lines' sampled fit errors, before any constraint (input units; not a bound). */
  readonly maxError: number
}
/** Every line refitted under the field (package 1's `fitDeformedCubic`); each end point mapped once, and every fitted end on it. */
export function deformPlan(lines: readonly PlanLine[], field: Field): Plan {
  const points = new Map<string, Vec>(), handles: Plan['handles'] = []
  let maxError = 0
  const at = (id: string, p: Vec) => {
    const was = points.get(id)
    if (was && (was.x !== p.x || was.y !== p.y)) throw Error(`变形计划不一致：点 ${id} 被映射到两个位置。`)
    points.set(id, p)
  }
  for (const l of lines) {
    const fit = fitDeformedCubic(l.curve, field), s = fit.shape
    at(l.a, s[0]); at(l.b, s[3])
    handles.push({ line: l.id, end: 'a', offset: sub(s[1], s[0]) }, { line: l.id, end: 'b', offset: sub(s[2], s[3]) })
    maxError = Math.max(maxError, fit.maxError)
  }
  return { points: [...points].map(([id, target]) => ({ id, target })), handles, maxError }
}
