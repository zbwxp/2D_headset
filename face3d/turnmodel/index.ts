// 转头模型 (bowen 1792849247: 打包): the turning head as one pure function — a yaw in, every line of that view out, each with
// the rule that decides what of it is seen. No drawing, no DOM. Data: bench-tasks/转头模型/model.json (build.py). The rules,
// their parameters and where each comes from: README.md beside this file.
export type V = [number, number]
export type Cubic = [V, V, V, V]

/** Who covers a line: it shows where it is inside at least one of `inside` (none: anywhere) and outside all of `outside`. */
export interface Show { inside?: Region[]; outside?: Region[] }
/** The face outline's closed region and the side face's closed region (bench 隐式遮挡). */
export type Region = 'face' | 'side'

export interface Line { name: string; c: Cubic; show: Show }
/** An eye line as samples; `seen[i]` false where the sphere frame turned the surface past edge-on (it faces away). */
export interface EyeLine { name: string; pts: V[]; seen: boolean[]; show: Show }

export interface Frame {
  yaw: number
  /** head pitch, −45 … 45, positive = 仰 (looking up) */
  pitch: number
  /** the face outline: near two lines (nearJaw, nearSkull), far three (farJaw, farCheek, farSkull); drawn outside the side face */
  outline: Line[]
  /** the side face (脸片: keyframes 0° and 90° with one speed curve); drawn outside the face outline */
  side: Line[]
  eyes: { near: EyeLine[]; far: EyeLine[] }
  ears: { near: Line[]; far: Line[]; fake: Line[] }
  /** named points of this view (crown, chin, nearRoot, zyg, temple, the sheet points, the ear points) */
  points: Record<string, V>
}

export interface ModelData {
  outline: { lines: { name: string; a: string; b: string }[]; keys: { yaw: number; pts: Record<string, V>; handles: Record<string, { ha: V; hb: V }> }[] }
  /** speed: [yaw, how far from the 0° keyframe to the 90° one], from [0, 0] to [90, 1], linear in between */
  sheet: { speed: [number, number][]; pts: Record<string, V>; lines: { name: string; a: string; b: string; ha: V; hb: V }[] }
  eyes: { base: Cubic[]; anchor: V; z: number; r: number }
  ear: { up: V; tip: V; low: V; upLine: { ha: V; hb: V }; lowLine: { ha: V; hb: V } }
  params: Record<keyof Params, { value: number; source: string }>
  /** 俯仰 (bowen 1793026490): bowen's keys at yaw 0 (−45 俯, 0, +45 仰) and the eyes' shared sphere */
  pitch: { keys: PitchKey[]; eyes: { anchorY: number; r: number; keys: { pitch: number; bend: number; s: number; oy: number }[] } }
}
export interface PitchKey { pitch: number; pts: Record<string, V>; handles: Record<string, { ha: V; hb: V }>; ref?: { file: string; x: number; y: number; w: number; h: number } }
export interface Params { eyeAlpha: number; eyeRate: number; eyeKappa: number; earFacing0: number; earUp: number; earLow: number; fakePush: number }

const rad = (d: number) => (d * Math.PI) / 180
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]]
export const bez = (c: Cubic, t: number): V => { const u = 1 - t; return [u * u * u * c[0][0] + 3 * u * u * t * c[1][0] + 3 * u * t * t * c[2][0] + t * t * t * c[3][0], u * u * u * c[0][1] + 3 * u * u * t * c[1][1] + 3 * u * t * t * c[2][1] + t * t * t * c[3][1]] }
const cubic = (a: V, ha: V, hb: V, b: V): Cubic => [a, add(a, ha), add(b, hb), b]

/**
 * 平滑插值 (bowen 1792761917, 1792762034): per coordinate a cubic through the keyframes whose speed is continuous — at an inner
 * keyframe the next stretch's mean speed (0 where the direction changes), the last stretch its own mean speed, the first
 * 2·its mean − that (clamped to 0 … 3·mean). 0 → 45° fast then slow, meeting 45 → 90° exactly; keyframes stay as drawn.
 */
export function smoothAt(ys: readonly number[], vs: readonly number[], x: number): number {
  const n = ys.length
  if (n < 3) return vs[0]! + ((vs[1]! - vs[0]!) * (x - ys[0]!)) / (ys[1]! - ys[0]!)
  const h = ys.slice(1).map((y, j) => y - ys[j]!), s = h.map((hj, j) => (vs[j + 1]! - vs[j]!) / hj), m = new Array<number>(n)
  m[n - 1] = s[n - 2]!
  for (let j = n - 2; j >= 1; j--) m[j] = s[j - 1]! * s[j]! > 0 ? s[j]! : 0
  m[0] = s[0] === 0 ? 0 : Math.min(3 * Math.abs(s[0]!), Math.max(0, (2 * s[0]! - m[1]!) * Math.sign(s[0]!))) * Math.sign(s[0]!)
  const i = Math.max(0, Math.min(n - 2, ys.findIndex(y => y >= x) - 1)), t = (x - ys[i]!) / h[i]!, t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * vs[i]! + (t3 - 2 * t2 + t) * h[i]! * m[i]! + (-2 * t3 + 3 * t2) * vs[i + 1]! + (t3 - t2) * h[i]! * m[i + 1]!
}
/** A speed curve's value at x: linear between its knots [x, value] (sorted by x). */
export function along(knots: readonly (readonly [number, number])[], x: number): number {
  for (let i = 1; i < knots.length; i++) { const [x0, v0] = knots[i - 1]!, [x1, v1] = knots[i]!; if (x <= x1) return v0 + ((v1 - v0) * (x - x0)) / (x1 - x0) }
  return knots[knots.length - 1]![1]
}
const smoothV = (ys: number[], vs: V[], x: number): V => [smoothAt(ys, vs.map(v => v[0]), x), smoothAt(ys, vs.map(v => v[1]), x)]

/** A parameter with no solution (dot 1792855783): refused rather than answered with a plausible-looking wrong view. */
export class ModelRefusal extends Error {}

/** The point of `c` at height `y`; refused when the curve does not reach that height. */
export function atHeight(c: Cubic, y: number, what = 'a point'): V {
  let best = bez(c, 0), bt = 0
  for (let i = 1; i <= 200; i++) { const p = bez(c, i / 200); if (Math.abs(p[1] - y) < Math.abs(best[1] - y)) { best = p; bt = i / 200 } }
  let lo = Math.max(0, bt - 1 / 200), hi = Math.min(1, bt + 1 / 200)
  if ((bez(c, lo)[1] - y) * (bez(c, hi)[1] - y) > 0 && Math.abs(best[1] - y) > 1e-9) throw new ModelRefusal(`${what}: height ${y} is not on its line (it reaches ${best[1].toFixed(2)} at most)`)
  for (let k = 0; k < 40; k++) { const md = (lo + hi) / 2, a = bez(c, lo)[1] - y, m = bez(c, md)[1] - y; if (a * m <= 0) hi = md; else lo = md }
  return bez(c, (lo + hi) / 2)
}

export const params = (m: ModelData): Params => Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, v.value])) as unknown as Params

/**
 * The view at `yaw` (−90 … 90; a turn to the other side is the mirror of the same turn, bowen 1792603165) and `pitch`
 * (−45 … 45, positive = 仰; bowen 1793026490). Pitch 0 is the turning head exactly.
 */
export function evaluate(m: ModelData, yaw: number, p: Params = params(m), pitch = 0): Frame {
  // every input a finite number (dot 1792856126): NaN or Infinity would give non-finite lines that look like a view
  if (!Number.isFinite(yaw)) throw new ModelRefusal(`yaw ${yaw} is not a finite number`)
  if (!Number.isFinite(pitch)) throw new ModelRefusal(`pitch ${pitch} is not a finite number`)
  if (Math.abs(pitch) > 45) throw new ModelRefusal(`pitch ${pitch}: only −45 … 45 has keys`)
  for (const [k, v] of Object.entries(p)) if (!Number.isFinite(v)) throw new ModelRefusal(`${k} ${v} is not a finite number`)
  const f = evaluateRight(m, Math.min(90, Math.abs(yaw)), p, pitch)
  if (yaw >= 0) return f
  const mx = (v: V): V => [-v[0], v[1]], mc = (c: Cubic): Cubic => c.map(mx) as Cubic
  const ml = (l: Line): Line => ({ ...l, c: mc(l.c) }), me = (e: EyeLine): EyeLine => ({ ...e, pts: e.pts.map(mx) })
  return { yaw, pitch, outline: f.outline.map(ml), side: f.side.map(ml), eyes: { near: f.eyes.near.map(me), far: f.eyes.far.map(me) },
    ears: { near: f.ears.near.map(ml), far: f.ears.far.map(ml), fake: f.ears.fake.map(ml) }, points: Object.fromEntries(Object.entries(f.points).map(([k, v]) => [k, mx(v)])) }
}

/**
 * 俯仰 as a change (bowen 1793025770 方案 a): bowen's keys at yaw 0 eased through −45 / 0 / 45 like the outline's, minus his
 * pitch-0 key — the change pitch makes, added on top of the turn at any yaw. Zero at pitch 0.
 */
function pitchChange(m: ModelData, pitch: number) {
  const K = m.pitch.keys, xs = K.map(k => k.pitch), k0 = K.find(k => k.pitch === 0)!
  const d = (get: (k: PitchKey) => V): V => (pitch === 0 ? [0, 0] : sub(smoothV(xs, K.map(get), pitch), get(k0)))
  return { pt: (n: string) => d(k => k.pts[n]!), ha: (n: string) => d(k => k.handles[n]!.ha), hb: (n: string) => d(k => k.handles[n]!.hb) }
}

function evaluateRight(m: ModelData, ay: number, p: Params, pitch: number): Frame {
  const D = pitchChange(m, pitch)
  const K = m.outline.keys, ys = K.map(k => k.yaw), k0 = K[0]!, k90 = K[K.length - 1]!
  // 脸片 (bowen 1792762758 rigid sheet → 1793026252 keyframes + a speed curve, 5 numbers): two keyframes, 0° = every point on the
  // midline, 90° = bowen's side face (a point's 90° x and height); between them one speed curve for the whole part says how far
  // the turn has got (S.speed, knots at 15 / 30 / 45 / 60 / 75°, linear in between). Heights kept; handles squeezed the same way.
  // Crown and chin are sheet points the outline shares
  const S = m.sheet, w = along(S.speed, ay), sq = (v: V): V => [v[0] * w, v[1]]
  const pts: Record<string, V> = {}
  for (const [id, v] of Object.entries(S.pts)) pts[id] = sq(v)
  // the outline's own points (near ear root, far 颧骨点 and 太阳穴点: heights fixed, only sideways) and every outline handle
  // eased through bowen's 0 / 45 / 90° keyframes
  for (const id of Object.keys(k0.pts)) pts[id] = smoothV(ys, K.map(k => k.pts[id]!), ay)
  // pitch: the outline's points (crown and chin too, which the side face shares) and handles move by bowen's pitch change.
  // The side face's other points have no pitch rule yet (未建模)
  for (const id of ['crown', 'chin', 'nearRoot', 'zyg', 'temple']) pts[id] = add(pts[id]!, D.pt(id))
  const outline: Line[] = m.outline.lines.map(l => ({ name: l.name, show: { outside: ['side'] },
    c: cubic(pts[l.a]!, add(smoothV(ys, K.map(k => k.handles[l.name]!.ha), ay), D.ha(l.name)), add(smoothV(ys, K.map(k => k.handles[l.name]!.hb), ay), D.hb(l.name)), pts[l.b]!) }))
  const side: Line[] = S.lines.map(l => ({ name: l.name, show: { outside: ['face'] }, c: cubic(pts[l.a]!, sq(l.ha), sq(l.hb), pts[l.b]!) }))
  const line = (n: string) => outline.find(l => l.name === n)!.c
  return { yaw: ay, pitch, outline, side, eyes: pitchEyes(m, eyes(m, ay, p), pitch), ears: ears(m, ay, p, pts, line, k0, k90, D), points: pts }
}

/**
 * 眼睛：朝向 + 远近 (bowen 1792769114 / 1792769914, final 1792811289): three rules on bowen's 0° eye.
 * 1. The centre turns with the head on its track: x = x0·cos ψ + z·sin ψ, height kept.
 * 2. The sphere frame counts from the eye facing the camera: at 0° each eye already faces α off it (bowen's 0° eye is the
 *    frame at −γα of a flat eye, inverted once); turning, the near eye's frame is γ·(ψ − α) (it first turns to the camera and
 *    widens), the far eye's −γ·(ψ + α) (bowen's 「反向弯」 1792686126, kept 1792770380). The part turned past edge-on is unseen.
 * 3. 近大远小: each eye scaled by its own depth d = z·cos ψ − x0·sin ψ, 1 / (1 − κ·(d − z)), across and up alike.
 * Seen: the near eye inside the face outline or the side face; the far eye inside the outline and outside the side face.
 */
function eyes(m: ModelData, ay: number, p: Params): Frame['eyes'] {
  const E = m.eyes, R = E.r, ps = rad(ay), names = ['upper', 'lowerIn', 'lowerOut']
  const bend = (fb: number, qx: number, qy: number) => Math.cos(fb) * qx + Math.sin(fb) * (Math.sqrt(Math.max(0, R * R - qx * qx - qy * qy)) - R)
  const one = (far: boolean): EyeLine[] => {
    const mside = far ? -1 : 1, f0 = rad(-p.eyeRate * p.eyeAlpha), f = rad(far ? -p.eyeRate * (ay + p.eyeAlpha) : p.eyeRate * (ay - p.eyeAlpha))
    const x0 = mside * E.anchor[0], cx = x0 * Math.cos(ps) + E.z * Math.sin(ps), d = E.z * Math.cos(ps) - x0 * Math.sin(ps), sc = 1 / (1 - p.eyeKappa * (d - E.z))
    return E.base.map((c, ci) => {
      const out: V[] = [], seen: boolean[] = []
      for (let i = 0; i <= 30; i++) {
        const q = bez(c, i / 30), qd = mside * (q[0] - E.anchor[0]), qy = q[1] - E.anchor[1], lim = Math.sqrt(Math.max(0, R * R - qy * qy))
        let lo = -0.8 * lim, hi = 0.8 * lim
        for (let k = 0; k < 40; k++) { const md = (lo + hi) / 2; if (bend(f0, md, qy) < qd) lo = md; else hi = md }
        const qf = (lo + hi) / 2, zz = Math.sqrt(Math.max(1e-9, R * R - qf * qf - qy * qy))
        // the 0° eye must come back from the inverse; when the frame at −γα cannot reach a sample (α or γ too large), refuse
        if (Math.abs(bend(f0, qf, qy) - qd) > 1e-6) throw new ModelRefusal(`eye: the 0° eye cannot be unbent at α ${p.eyeAlpha}°, γ ${p.eyeRate} (its sample ${i} is out of the sphere frame's reach)`)
        seen.push(Math.cos(f) - (Math.sin(f) * qf) / zz > 0)
        out.push([cx + sc * bend(f, qf, qy), E.anchor[1] + sc * qy])
      }
      return { name: names[ci] ?? String(ci), pts: out, seen, show: far ? { inside: ['face'], outside: ['side'] } : { inside: ['face', 'side'] } }
    })
  }
  return { near: one(false), far: one(true) }
}

/**
 * 俯仰的眼睛 (bowen 1792860996 「两眼共用一个球面框向上向下弯折」, 1793021900): both eyes on one sphere (centre height and radius
 * fitted to bowen's ±45 eye bones), turned about the horizontal axis by an angle eased through his keys, then scaled and
 * moved up or down: the sphere frame at yaw 0, roll 0 — q = p − A, out = A + (0, oy) + s·(qx, cos b·qy + sin b·(r − √(r² − |q|²))).
 * A sits between the eyes. A point beyond the sphere is refused.
 */
function pitchEyes(m: ModelData, e: Frame['eyes'], pitch: number): Frame['eyes'] {
  if (pitch === 0) return e
  const P = m.pitch.eyes, K = P.keys, xs = K.map(k => k.pitch), R = P.r
  const b = rad(smoothAt(xs, K.map(k => k.bend), pitch)), s = smoothAt(xs, K.map(k => k.s), pitch), oy = smoothAt(xs, K.map(k => k.oy), pitch)
  const all = [...e.near, ...e.far].flatMap(l => l.pts), ax = all.reduce((a, q) => a + q[0], 0) / all.length
  const map = (q: V): V => {
    const qx = q[0] - ax, qy = q[1] - P.anchorY, z2 = R * R - qx * qx - qy * qy
    if (!(z2 > 0)) throw new ModelRefusal(`pitch eyes: a point is beyond the sphere (r ${R})`)
    return [ax + s * qx, P.anchorY + oy + s * (Math.cos(b) * qy + Math.sin(b) * (R - Math.sqrt(z2)))]
  }
  const ml = (l: EyeLine): EyeLine => ({ ...l, pts: l.pts.map(map) })
  return { near: e.near.map(ml), far: e.far.map(ml) }
}

/**
 * 耳朵 (bowen 1792813942 / 1792814749 / 1792846244). The ear is bowen's 90° ear (a plate facing the camera at 90°), hung on
 * its upper point; sideways offsets × cos(facing), heights kept.
 * Near ear: 上耳点 / 下耳点 on the near outline (nearSkull / nearJaw) at fixed heights; facing φ0·(1 − yaw / 90).
 * Far ear: the mirror, hung on a 假线 — the symmetric two-line contour on the far side, turned with the head (its crown and
 * chin the sheet's), its ear root the near one's mirror turned rigidly plus push × how far the far 颧骨点 moved out since 0°;
 * its handles the near ones' mirrors turned the same way. Facing φ0·(1 + yaw / 90). Seen outside the face and the side face.
 */
function ears(m: ModelData, ay: number, p: Params, pts: Record<string, V>, line: (n: string) => Cubic, k0: ModelData['outline']['keys'][0], k90: ModelData['outline']['keys'][0], D: ReturnType<typeof pitchChange>): Frame['ears'] {
  // pitch (bowen 1793024823: the ear's hold on the outline slides with pitch): the two ear points' heights change by bowen's
  // pitch change and stay on the outline; the tip (from the upper point) and the handles change by his too, mirrored on the far side
  const up = p.earUp + D.pt('earUp')[1], lowH = p.earLow + D.pt('earLow')[1], dTip = sub(D.pt('earTip'), D.pt('earUp'))
  const A = m.ear, plate = (up: V, low: V, k: number, mirror: boolean): Line[] => {
    const mx = (v: V): V => [(mirror ? -1 : 1) * v[0], v[1]], sx = (v: V): V => [(mirror ? -1 : 1) * v[0] * k, v[1]]
    const tip: V = add([up[0] + sx([A.tip[0] - A.up[0], 0])[0], up[1] + A.tip[1] - A.up[1]], mx(dTip))
    pts[mirror ? 'farEarUp' : 'nearEarUp'] = up; pts[mirror ? 'farEarLow' : 'nearEarLow'] = low; pts[mirror ? 'farEarTip' : 'nearEarTip'] = tip
    const show: Show = mirror ? { outside: ['face', 'side'] } : {}
    return [{ name: 'upper', show, c: cubic(up, add(sx(A.upLine.ha), mx(D.ha('earUpper'))), add(sx(A.upLine.hb), mx(D.hb('earUpper'))), tip) },
      { name: 'lower', show, c: cubic(tip, add(sx(A.lowLine.ha), mx(D.ha('earLower'))), add(sx(A.lowLine.hb), mx(D.hb('earLower'))), low) }]
  }
  const near = plate(atHeight(line('nearSkull'), up, '上耳点 (nearSkull)'), atHeight(line('nearJaw'), lowH, '下耳点 (nearJaw)'), Math.cos(rad(p.earFacing0 * (1 - ay / 90))), false)
  const ps = rad(ay), cs = Math.cos(ps), sn = Math.sin(ps)
  const turn = (h0: V, h90: V): V => [-h0[0] * cs + h90[0] * sn, h0[1] * cs * cs + h90[1] * sn * sn]
  // the 假线 follows pitch like the near outline it mirrors: its root and handles change by the near side's pitch change, mirrored
  const mD = (v: V): V => [-v[0], v[1]], dz = D.pt('zyg'), dr = D.pt('nearRoot')
  const root: V = add([-k0.pts.nearRoot![0] * cs + k90.pts.nearRoot![0] * sn + p.fakePush * (pts.zyg![0] - dz[0] - k0.pts.zyg![0]), k0.pts.nearRoot![1]], mD(dr))
  const fake: Line[] = (['nearSkull', 'nearJaw'] as const).map(n => ({ name: n === 'nearSkull' ? 'fakeSkull' : 'fakeJaw', show: {},
    c: cubic(root, add(turn(k0.handles[n]!.ha, k90.handles[n]!.ha), mD(D.ha(n))), add(turn(k0.handles[n]!.hb, k90.handles[n]!.hb), mD(D.hb(n))), pts[n === 'nearSkull' ? 'crown' : 'chin']!) }))
  pts.fakeRoot = root
  const far = plate(atHeight(fake[0]!.c, up, '远侧上耳点 (假线)'), atHeight(fake[1]!.c, lowH, '远侧下耳点 (假线)'), Math.cos(rad(p.earFacing0 * (1 + ay / 90))), true)
  return { near, far, fake }
}
