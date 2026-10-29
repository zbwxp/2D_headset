// The head without its neck, and the neck as its own part, from bowen's two drawn rings (bowen 1793156878 「仰视的时候…真正重要的是
// 下颌线…俯视应该也不需要脖子那部分」, 1793156931 「我不是绘制过线框吗」, 1793156971 「对脖子截止位置有一个圆环」): the ring where the
// head meets the neck (线12 front/back, both sides: 下巴底拐点 → 交点4 → 头颈交界点) and the neck's base ring (线11: 后颈 → 交点3 → 颈前).
// The head: VRoid's skin on the neck side of the upper ring (inside the neck's tube, below the ring at that angle round the neck)
// pressed onto the ring, the hole closed by a fan over the ring. The neck: a tube from the upper ring to the base ring, made from the rings alone
// (VRoid's neck mesh has holes at the throat). Drawing glue.
type P3 = [number, number, number]
export interface WireLine { name: string; c: number[][] }
const bez = (c: number[][], t: number): P3 => { const u = 1 - t; return [0, 1, 2].map(k => u * u * u * c[0]![k]! + 3 * u * u * t * c[1]![k]! + 3 * u * t * t * c[2]![k]! + t * t * t * c[3]![k]!) as P3 }
const AX = [0, -0.035] as const // the neck's axis (x, z), upright
const ang = (p: readonly number[]) => Math.atan2(p[0]!, p[2]! - AX[1])
/** a ring as K points by angle round the neck's axis (front = 0, clockwise seen from above = +x first) */
function ring(lines: WireLine[], names: string[], K: number): P3[] {
  const pts = names.flatMap(n => { const l = lines.find(q => q.name === n); if (!l) throw Error(`no line ${n}`); return Array.from({ length: 65 }, (_, i) => bez(l.c, i / 64)) })
  return Array.from({ length: K }, (_, k) => { const th = -Math.PI + (2 * Math.PI * k) / K; let best = pts[0]!, bd = Infinity
    for (const p of pts) { const d = Math.abs(((ang(p) - th + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (d < bd) { bd = d; best = p } } return best })
}
export function splitNeck(P: number[][], N: number[][], parts: { tris: number[]; cornerN: number[] }[], lines: WireLine[], K = 96) {
  const up = ring(lines, ['线12前', '线12后', '右线12前', '右线12后'], K), base = ring(lines, ['线11前', '线11后', '右线11前', '右线11后'], K)
  const at = (R: P3[], th: number) => R[Math.round(((th + Math.PI) / (2 * Math.PI)) * K) % K]!
  // on the neck side: below the upper ring at its angle, and no farther from the axis than the ring there (+0.04)
  const neckSide = (p: number[]) => { const r = at(up, ang(p)); return p[1]! < r[1] && Math.hypot(p[0]! - AX[0], p[2]! - AX[1]) < Math.hypot(r[0] - AX[0], r[2] - AX[1]) + 0.04 }
  // the neck side pressed onto the ring (each vertex to the ring's point at its angle) rather than dropped: the head's edge then
  // runs along the ring itself (VRoid's skin is two meshes with open seams, so its own hole edge does not chain into one loop);
  // triangles left with all three corners on the ring dropped
  const onRing = P.map(neckSide)
  P.forEach((p, i) => { if (onRing[i]) { const r = at(up, ang(p)); p[0] = r[0]; p[1] = r[1]; p[2] = r[2] } })
  for (const p of parts) { const t: number[] = [], cn: number[] = []; for (let i = 0; i < p.tris.length; i += 3) { if ([0, 1, 2].every(k => onRing[p.tris[i + k]!])) continue; t.push(p.tris[i]!, p.tris[i + 1]!, p.tris[i + 2]!); cn.push(...p.cornerN.slice(3 * i, 3 * i + 9)) } p.tris = t; p.cornerN = cn }
  // the cap: a fan over the ring from its middle, facing down
  const m = [0, 1, 2].map(k => up.reduce((a, q) => a + q[k]!, 0) / K), c0 = P.length; P.push(m); N.push([0, -1, 0])
  const r0 = P.length; for (const q of up) { P.push([...q]); N.push([0, -1, 0]) }
  const cap: number[] = []; for (let k = 0; k < K; k++) { const a = r0 + k, b = r0 + ((k + 1) % K)
    const u = [0, 1, 2].map(i => P[a]![i]! - m[i]!), w = [0, 1, 2].map(i => P[b]![i]! - m[i]!), ny = u[2]! * w[0]! - u[0]! * w[2]!; cap.push(...(ny < 0 ? [c0, a, b] : [c0, b, a])) }
  parts.push({ ...(parts[0] as object), tris: cap, cornerN: new Array(cap.length * 3).fill(NaN) } as (typeof parts)[0])
  // the neck: rings from the upper to the base, the sides straight between them, wound to face away from the axis
  const RINGS = 8, n0 = P.length, tube: number[] = []
  for (let r = 0; r <= RINGS; r++) for (let k = 0; k < K; k++) { const a = up[k]!, b = base[k]!, t = r / RINGS, p = [0, 1, 2].map(i => a[i]! + (b[i]! - a[i]!) * t); P.push(p); const d = Math.hypot(p[0]! - AX[0], p[2]! - AX[1]) || 1; N.push([(p[0]! - AX[0]) / d, 0, (p[2]! - AX[1]) / d]) }
  for (let r = 0; r < RINGS; r++) for (let k = 0; k < K; k++) { const a = n0 + r * K + k, b = n0 + r * K + ((k + 1) % K), c = a + K, d = b + K
    for (const t of [[a, c, b], [b, c, d]]) { const [x, y, z] = t.map(i => P[i]!) as [number[], number[], number[]], u = [0, 1, 2].map(i => y[i]! - x[i]!), w = [0, 1, 2].map(i => z[i]! - x[i]!)
      const nx = u[1]! * w[2]! - u[2]! * w[1]!, nz = u[0]! * w[1]! - u[1]! * w[0]!; tube.push(...(nx * (x[0]! - AX[0]) + nz * (x[2]! - AX[1]) >= 0 ? t : [t[0]!, t[2]!, t[1]!])) } }
  /** a point of the neck at its bottom: within 0.05 above the base ring at its angle */
  const nearBase = (p: readonly number[]) => p[1]! < at(base, ang(p))[1] + 0.05
  return { tube, nearBase }
}
