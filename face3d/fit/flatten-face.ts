// The head shell without its nose and mouth (bowen 1793155916 「把鼻子区域和头壳分成两个部分，它们分别是两套轮廓然后按照前后关系互相
// 穿插」, 1793155937 「和我把耳朵先压扁了是一个思路」): the front of the face round the nose and lips is fitted with a smooth surface
// z = s(x, y) (a cubic, from the front skin round the zone); every skin vertex in the zone standing out past it is pressed back
// onto it, fully inside the zone's inner part and less and less towards its edge (no step at the edge). What was pressed off is
// the nose part: the thin volume between the pressed surface and the real one, whose outline is the union of the two patches'.
// The head's outline = the union of the shell's and the nose part's on the screen. Drawing glue, as flatten-ears.ts.
type P = number[]
const ZONE = { cx: 0, cy: -1.0, rx: 0.32, ry: 0.43, zMin: 0.55 }
/** 1 well inside the zone, falling to 0 at its edge (an ellipse round the nose and lips, seen from the front) */
export function faceWeight(p: P) {
  if (p[2]! < ZONE.zMin) return 0
  const e = Math.hypot((p[0]! - ZONE.cx) / ZONE.rx, (p[1]! - ZONE.cy) / ZONE.ry); if (e >= 1) return 0; if (e <= 0.7) return 1
  const t = (1 - e) / 0.3; return t * t * (3 - 2 * t)
}
const basis = (x: number, y: number) => [1, x, y, x * x, x * y, y * y, x * x * x, x * x * y, x * y * y, y * y * y]
function fit(pts: P[]) {
  const NB = 10, A = Array.from({ length: NB }, () => new Array<number>(NB + 1).fill(0))
  for (const p of pts) { const f = basis(p[0]!, p[1]!); for (let i = 0; i < NB; i++) { for (let j = 0; j < NB; j++) A[i]![j]! += f[i]! * f[j]!; A[i]![NB]! += f[i]! * p[2]! } }
  for (let i = 0; i < NB; i++) { let m = i; for (let r = i + 1; r < NB; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[m]![i]!)) m = r; [A[i], A[m]] = [A[m]!, A[i]!]
    for (let r = 0; r < NB; r++) if (r !== i) { const k = A[r]![i]! / A[i]![i]!; for (let c = i; c <= NB; c++) A[r]![c]! -= k * A[i]![c]! } }
  const co = A.map((r, i) => r[NB]! / r[i]!)
  return (x: number, y: number) => basis(x, y).reduce((a, f, i) => a + f * co[i]!, 0)
}
/** P, N: the head's vertices and normals (changed in place); skin: the skin vertex indices. Returns the indices pressed and their
 * places before (the nose part's outer patch). */
export function flattenFace(P: P[], N: P[], skin: Iterable<number>) {
  const S = [...new Set(skin)]
  const ring = S.map(i => P[i]!).filter(p => p[2]! > 0.45 && Math.abs(p[0]!) < 0.6 && p[1]! > -1.5 && p[1]! < -0.35 && faceWeight(p) === 0 && Math.hypot((p[0]! - ZONE.cx) / ZONE.rx, (p[1]! - ZONE.cy) / ZONE.ry) < 1.6)
  const s = fit(ring), h = 1e-3, moved: { i: number; before: P }[] = []
  for (const i of S) { const p = P[i]!, w = faceWeight(p); if (!w) continue
    const z = s(p[0]!, p[1]!); if (p[2]! <= z + 0.002) continue
    moved.push({ i, before: [...p] }); p[2] = z + (p[2]! - z) * (1 - w)
    if (w === 1) { const sx = (s(p[0]! + h, p[1]!) - s(p[0]! - h, p[1]!)) / (2 * h), sy = (s(p[0]!, p[1]! + h) - s(p[0]!, p[1]! - h)) / (2 * h), m = Math.hypot(sx, sy, 1); N[i] = [-sx / m, -sy / m, 1 / m] } }
  return moved
}
