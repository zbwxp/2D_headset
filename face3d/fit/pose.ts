// The viewing pose (VTuber / Live2D: camera fixed; head turns X, nods about its own ear axis Y (+ = up), tilts Z,
// pivoting at the neck) split into the modelling view B (face3d's camera yaw / pitch) plus an in-picture roll and the
// pivot's shift: M_A = Ry(X)·Rx(Y)·Rz(Z) = Rz(roll)·M_B(yaw, pitch) (bowen 1792514145 / 1792514171).
export type M3 = number[][]
const D = Math.PI / 180
/** the pivot: VRoid test.vrm's NECK joint (J_Bip_C_Neck) in head-ball radii from the ball centre — the head joint
 *  ((0, −1.045, 0.320)) sits so close below the centre that nodding barely moves the head in the picture; a VTuber's
 *  nod moves neck and head together, so the neck joint is the pivot */
export const PIVOT = [0, -2.079, 0.324]
export const mul = (a: M3, b: M3): M3 => a.map(r => [0, 1, 2].map(j => r[0]! * b[0]![j]! + r[1]! * b[1]![j]! + r[2]! * b[2]![j]!))
export const Ry = (t: number): M3 => { const c = Math.cos(t * D), s = Math.sin(t * D); return [[c, 0, s], [0, 1, 0], [-s, 0, c]] }
export const Rx = (t: number): M3 => { const c = Math.cos(t * D), s = Math.sin(t * D); return [[1, 0, 0], [0, c, s], [0, -s, c]] }
export const Rz = (t: number): M3 => { const c = Math.cos(t * D), s = Math.sin(t * D); return [[c, -s, 0], [s, c, 0], [0, 0, 1]] }
export const B = (yaw: number, pitch: number): M3 => mul(Rx(pitch), Ry(yaw)) // = face3d's rotate(): yaw, then pitch about screen x
export function split(X: number, Y: number, Z: number, pivot: number[] = PIVOT) {
  const A = mul(mul(Ry(X), Rx(Y)), Rz(Z)), [a, b, c] = A[2]!
  const pitch = Math.asin(Math.max(-1, Math.min(1, -b!))) / D, yaw = Math.atan2(-a!, c!) / D, Bm = B(yaw, pitch)
  const d = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!
  const roll = Math.atan2(d(A[1]!, Bm[0]!), d(A[0]!, Bm[0]!)) / D
  const moved = [0, 1, 2].map(i => d(A[i]!, pivot)), shift = [pivot[0]! - moved[0]!, pivot[1]! - moved[1]!] // head units, y up
  return { yaw, pitch, roll, shift, A }
}

