// 骨线 at a pose (docs/bone-poses-checklist.md, P0 — a prototype reached only through `atPose(pose, { followBones })`):
// between the views every attached line is generated from its bone as blended at that pose, by the rule of the views
// (boneLine from the base). Pure: plain data in, plain data out. At a view nothing is generated (the stored shapes).
import { boneLine, boneMap, fitLimit, type Cubic, type Vec } from './coords'

type Id = string

/** What the derivation needs, as plain data (§2.1): no network. */
export interface PoseBones {
  readonly bones: readonly Id[]
  readonly attach: readonly { readonly line: Id; readonly bone: Id; readonly base: { readonly line: Cubic; readonly bone: Cubic } }[]
  readonly owners: readonly { readonly point: Id; readonly bone: Id }[]
  /** The end points of every bone, every attached line and every ordinary line sharing a point with them. */
  readonly ends: Readonly<Record<Id, { readonly a: Id; readonly b: Id }>>
}
/** Blended shapes at a pose: positions, handle vectors. */
export interface PoseShapes { points: Record<Id, Vec>; lines: Record<Id, { ha: Vec; hb: Vec }> }
/** A group of attached lines drawn from the plain blend at this pose, and why (§3). */
export interface Fallback { readonly lines: Id[]; readonly reason: string }

/** Samples per line in a playback frame (§2.3; measured 1.0 ms / line on 标准tmp, docs/bone-poses-checklist.md §0). */
export const POSE_SAMPLES = 16

/**
 * The attached lines generated from their bones at a pose. Points a bone uses, and points an ordinary line shares
 * (prototype: §2.4 B, pinned where the blend puts them), stay; a point shared by lines on different bones follows its
 * owner. A line that cannot be generated takes its whole group (the attached lines connected to it through shared
 * points) back to the plain blend, atomically (§3). Returns new shapes; the input is not changed.
 */
/**
 * Per attached line, its stored shape at a view minus what `followBones` generates from that view's own bone (four
 * control-point differences): the 16-sample fit is not the views' fit, so the caller blends these offsets with the
 * pose's view weights — exact at every view, continuous in between (§6; dot 1792474630). Lines that cannot be generated
 * at the view get none.
 */
export function viewOffsets(data: PoseBones, view: PoseShapes): Map<Id, [Vec, Vec, Vec, Vec]> {
  const out = new Map<Id, [Vec, Vec, Vec, Vec]>()
  const made = generate(data, view)
  for (const [id, c] of made.made) {
    const e = data.ends[id]!, a = view.points[e.a]!, b = view.points[e.b]!, h = view.lines[id]!
    const stored: Cubic = [a, { x: a.x + h.ha.x, y: a.y + h.ha.y }, { x: b.x + h.hb.x, y: b.y + h.hb.y }, b]
    out.set(id, stored.map((p, i) => ({ x: p.x - c[i]!.x, y: p.y - c[i]!.y })) as [Vec, Vec, Vec, Vec])
  }
  return out
}

export function followBones(data: PoseBones, shapes: PoseShapes, offset?: (line: Id) => readonly Vec[] | undefined): { shapes: PoseShapes; fallback: Fallback[] } {
  const out: PoseShapes = { points: { ...shapes.points }, lines: { ...shapes.lines } }
  const { made, failed, users, attached } = generate(data, shapes)
  // the fallback groups: the transitive closure of 「shares a point with」 over the attached lines (§3)
  const fallback: Fallback[] = [], back = new Set<Id>()
  for (const [first, reason] of failed) {
    if (back.has(first)) continue
    const group: Id[] = [], todo = [first]
    while (todo.length) {
      const l = todo.pop()!
      if (back.has(l)) continue
      back.add(l); group.push(l)
      for (const p of [data.ends[l]!.a, data.ends[l]!.b]) for (const m of users.get(p) ?? []) if (attached.has(m) && !back.has(m)) todo.push(m)
    }
    fallback.push({ lines: group.sort(), reason })
  }
  for (const [id, c0] of made) {
    if (back.has(id)) continue
    const d = offset?.(id), c = d ? c0.map((p, i) => ({ x: p.x + d[i]!.x, y: p.y + d[i]!.y })) : c0
    const e = data.ends[id]!
    out.points[e.a] = c[0]!; out.points[e.b] = c[3]!
    out.lines[id] = { ha: { x: c[1]!.x - c[0]!.x, y: c[1]!.y - c[0]!.y }, hb: { x: c[2]!.x - c[3]!.x, y: c[2]!.y - c[3]!.y } }
  }
  return { shapes: out, fallback }
}

/** The generation itself (no fallback, no offsets): each attached line's cubic, or why it could not be made. */
function generate(data: PoseBones, shapes: PoseShapes) {
  const attached = new Map(data.attach.map(a => [a.line, a] as const)), bones = new Set(data.bones)
  const cubic = (id: Id): Cubic => {
    const e = data.ends[id]!, a = shapes.points[e.a]!, b = shapes.points[e.b]!, h = shapes.lines[id]!
    return [{ ...a }, { x: a.x + h.ha.x, y: a.y + h.ha.y }, { x: b.x + h.hb.x, y: b.y + h.hb.y }, { ...b }]
  }
  // who uses each point: bones, attached lines, ordinary lines (those listed in `ends`)
  const users = new Map<Id, Id[]>()
  for (const [line, e] of Object.entries(data.ends)) for (const p of [e.a, e.b]) users.set(p, [...(users.get(p) ?? []), line])
  const fixed = (p: Id) => (users.get(p) ?? []).some(l => bones.has(l) || !attached.has(l))
  // a point shared by lines on different bones: its owner's carrying of it
  const target = new Map<Id, Vec>(), failed = new Map<Id, string>()
  for (const o of data.owners) {
    if (fixed(o.point)) continue
    const by = data.attach.find(a => a.bone === o.bone && (data.ends[a.line]!.a === o.point || data.ends[a.line]!.b === o.point))
    if (!by) continue
    const end = data.ends[by.line]!.a === o.point ? by.base.line[0] : by.base.line[3]
    try { target.set(o.point, boneMap(by.base.bone, cubic(by.bone))(end)) } catch (err) { failed.set(by.line, (err as Error).message) }
  }
  const made = new Map<Id, Cubic>()
  for (const a of data.attach) {
    if (failed.has(a.line) || !data.ends[a.line] || !data.ends[a.bone]) continue
    const e = data.ends[a.line]!, here = cubic(a.line)
    const end = (p: Id, now: Vec) => (fixed(p) ? now : target.get(p))
    try {
      const limit = fitLimit(a.base.line, a.base.bone)
      const r = boneLine(a.base.line, a.base.bone, cubic(a.bone), { a: end(e.a, here[0]), b: end(e.b, here[3]) }, 1, limit, POSE_SAMPLES)
      if (!(r.maxError <= limit) || !r.shape.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) { failed.set(a.line, `fit error ${r.maxError.toFixed(3)}`); continue }
      made.set(a.line, r.shape)
    } catch (err) { failed.set(a.line, (err as Error).message) }
  }
  return { made, failed, users, attached }
}
