// The VRoid head without its ears, for now (bowen 1793121631 「你能先暂时把模型耳朵去掉吗？」): on each side the head's side
// round the ear is fitted with a smooth surface |x| = s(y, z) (a cubic in y, z, from the side skin around the ear zone); every
// skin vertex in the ear zone standing out past it is pressed back onto it, its normal the surface's. The ear lies flat on the
// head — no hole, the triangles stay. Shared by the viewers and the outline checks (drawing glue).
type P = number[]
const ZONE = { z0: -0.38, z1: 0.12, y0: -1.1, y1: -0.28 }
const inZone = (p: P) => p[2]! > ZONE.z0 && p[2]! < ZONE.z1 && p[1]! < ZONE.y1 && p[1]! > ZONE.y0
const basis = (y: number, z: number) => [1, y, z, y * y, y * z, z * z, y * y * y, y * y * z, y * z * z, z * z * z]
function fitSide(pts: P[], sign: number) {
  const NB = 10, A = Array.from({ length: NB }, () => new Array<number>(NB + 1).fill(0))
  for (const p of pts) { const f = basis(p[1]!, p[2]!); for (let i = 0; i < NB; i++) { for (let j = 0; j < NB; j++) A[i]![j]! += f[i]! * f[j]!; A[i]![NB]! += f[i]! * sign * p[0]! } }
  for (let i = 0; i < NB; i++) { let m = i; for (let r = i + 1; r < NB; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[m]![i]!)) m = r; [A[i], A[m]] = [A[m]!, A[i]!]
    for (let r = 0; r < NB; r++) if (r !== i) { const k = A[r]![i]! / A[i]![i]!; for (let c = i; c <= NB; c++) A[r]![c]! -= k * A[i]![c]! } }
  const co = A.map((r, i) => r[NB]! / r[i]!)
  return (y: number, z: number) => basis(y, z).reduce((a, f, i) => a + f * co[i]!, 0)
}
/** P, N: the head's vertices and normals (changed in place); skin: the skin vertex indices. Returns how many were pressed. */
export function flattenEars(P: P[], N: P[], skin: Iterable<number>): number {
  const S = [...new Set(skin)]; let n = 0
  for (const sign of [-1, 1]) {
    const ring = S.map(i => P[i]!).filter(p => sign * p[0]! > 0.5 && p[2]! > -0.7 && p[2]! < 0.4 && p[1]! < 0 && p[1]! > -1.3 && !inZone(p))
    const s = fitSide(ring, sign), h = 1e-3
    for (const i of S) { const p = P[i]!; if (sign * p[0]! <= 0.5 || !inZone(p)) continue
      const w = s(p[1]!, p[2]!); if (sign * p[0]! <= w + 0.002) continue
      p[0] = sign * w
      const sy = (s(p[1]! + h, p[2]!) - s(p[1]! - h, p[2]!)) / (2 * h), sz = (s(p[1]!, p[2]! + h) - s(p[1]!, p[2]! - h)) / (2 * h), m = Math.hypot(1, sy, sz)
      N[i] = [sign / m, -sy / m, -sz / m]; n++ }
  }
  return n
}
