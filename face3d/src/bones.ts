// Surface bones (PLAN §3): fixed lines on the face, each point attached to the rough head as (u, y, h) — the surface
// point at angle u of the section at height y, pushed out by h along that section's outward radial direction. A head
// edit moves them with the surface; a view rotates them rigidly.
import { type Head, toHead } from './head'
import { type V3, add, len, norm, scale, sub } from './view'

export type Part = 'eye' | 'brow' | 'nose' | 'mouth' | 'chin' | 'ear' | 'neck'
export interface Attach { readonly u: number; readonly y: number; readonly h: number }
export interface BoneDef { readonly name: string; readonly part: Part; readonly closed: boolean; readonly pts: V3[] }
export interface Bone { readonly name: string; readonly part: Part; readonly closed: boolean; readonly at: (Attach | V3)[] }

// the midpoint between front and back: inside every (convex) section, so the section is star-shaped about it — the widest
// point's depth z0 is not, under the jaw it lies on the section's flat back
const centre = (head: Head, y: number): V3 => { const s = head.section(y); return [0, y, (s.f + s.b) / 2] }
const radial = (head: Head, u: number, y: number): V3 => { const s = head.at(u, y), c = centre(head, y); return norm([s[0] - c[0], 0, s[2] - c[2]]) }
const angleOf = (p: V3, c: V3) => Math.atan2(p[0] - c[0], p[2] - c[2])

/** Attach a head-space point: the section at its height, the angle whose surface point lies on the ray to it. */
export function attach(head: Head, p: V3): Attach | V3 {
  const { yMin, yMax } = head.shape
  if (p[1] < yMin || p[1] > yMax) return p // outside the loft (the neck): kept as a free point
  const c = centre(head, p[1]), target = angleOf(p, c)
  // the section is star-shaped about its centre: the angle of its point grows with u, so bisect
  let lo = -Math.PI, hi = Math.PI
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (angleOf(head.at(mid, p[1]), c) < target) lo = mid; else hi = mid }
  const u = (lo + hi) / 2, s = head.at(u, p[1])
  const h = len(sub(p, c)) - len(sub(s, c))
  return { u, y: p[1], h }
}

export const isAttach = (a: Attach | V3): a is Attach => !Array.isArray(a)
export const place = (head: Head, a: Attach | V3): V3 => isAttach(a) ? add(head.at(a.u, a.y), scale(radial(head, a.u, a.y), a.h)) : a

// ---- the default character's surface bones (level-sheet pixels, as in the landmark sheet; x mirrored for both sides) --
const halfDefs: { name: string; part: Part; closed: boolean; pts: V3[] }[] = [
  { name: '眼', part: 'eye', closed: true, pts: [[118, 2, -33], [95, 22, -12], [69, 24, -4], [40, 8, 8], [69, -24, -4], [100, -16, -20]] },
  { name: '虹膜', part: 'eye', closed: false, pts: [[69, 6, -1], [69, -6, -1]] },
  { name: '眉', part: 'brow', closed: false, pts: [[120, 45, -30], [71, 53, 2], [30, 44, 20]] },
  { name: '鼻翼', part: 'nose', closed: false, pts: [[0, -33, 60], [14, -55, 38], [0, -58, 47]] },
  { name: '嘴角', part: 'mouth', closed: false, pts: [[21, -101, 18], [0, -100, 32]] },
  { name: '耳廓', part: 'ear', closed: true, pts: [[125, 33, -150], [174, 33, -188], [186, 0, -217], [170, -45, -190], [129, -71, -158], [125, -68, -142]] },
  { name: '耳根', part: 'ear', closed: false, pts: [[125, 33, -150], [125, -68, -142]] },
  { name: '颈', part: 'neck', closed: false, pts: [[62, -150, -95], [60, -260, -95]] },
]
const midDefs: { name: string; part: Part; closed: boolean; pts: V3[] }[] = [
  { name: '鼻梁', part: 'nose', closed: false, pts: [[0, -11, 37], [0, -22, 49], [0, -33, 60]] },
  { name: '下巴尖', part: 'chin', closed: false, pts: [[-6, -160, -2], [6, -160, -2]] },
]
export const BONE_DEFS: BoneDef[] = [
  ...halfDefs.flatMap(d => [{ ...d, name: d.name + '（x+）', pts: d.pts.map(toHead) }, { ...d, name: d.name + '（x−）', pts: d.pts.map(p => toHead([-p[0], p[1], p[2]])) }]),
  ...midDefs.map(d => ({ ...d, pts: d.pts.map(toHead) })),
]

export const attachAll = (head: Head, defs: BoneDef[] = BONE_DEFS): Bone[] =>
  defs.map(d => ({ name: d.name, part: d.part, closed: d.closed, at: d.pts.map(p => attach(head, p)) }))
