// bones — 骨骼线 and 绑骨 (docs/bone-lines-checklist.md): which lines are bones, which lines are attached to which
// bone (with the base each derivation starts from), the owner of a point shared by lines on different bones, and the
// standards (B3 behaviour; stored here so the data shape is complete). The derivation writes the attached lines of
// every view through the network's own operations, in the commit (document). Encapsulation as the other modules:
// the state is opaque outside; reads return copies.
import * as net from '../network'
import * as views from '../views'
import { BoneError, boneFrame, boneLine, boneMap, toBone, type Cubic, type Vec } from './coords'

type Id = net.Id
export type Mode = 'record' | 'make'
/** One attached line: its bone and the base it is carried from (its 0,0 shape and the bone's, when attached or last renewed). */
export interface Attachment { readonly line: Id; readonly bone: Id; readonly base: { readonly line: Cubic; readonly bone: Cubic } }
/**
 * A standard (B3; docs/bone-lines-checklist.md §6b): one layer's bones in the nine views, under a name; `id` is what a
 * made face refers to; each bone has a stable `key` (pairs refer to it — names are only for the first pairing).
 */
export interface StandardBone { readonly key: string; readonly name: string; readonly views: Readonly<Record<string, Cubic>> }
/**
 * A standard; `naming: 'curve·line'` marks its bones' names as 「连续曲线·线」 (docs/names-scope.md rule 9). A standard
 * without it was saved before (its bones by line name alone, 「·」 removed on reading, dot 1792309220).
 */
export interface Standard { readonly id: Id; readonly name: string; readonly layer: Id; readonly bones: readonly StandardBone[]; readonly naming?: 'curve·line' }
/** A layer's chosen standard and its stored pairs (bone id ↔ standard key), made once when choosing. */
export interface Choice { readonly layer: Id; readonly standard: Id; readonly pairs: readonly { readonly bone: Id; readonly key: string }[] }

declare const opaque: unique symbol
export type BonesState = { readonly [opaque]: 'bones' }
interface Store {
  bones: Id[]
  attach: { line: Id; bone: Id; base: { line: Cubic; bone: Cubic } }[]
  /** A point shared by attached lines on different bones: the bone it follows (chosen when attaching, stored). */
  owners: { point: Id; bone: Id }[]
  standards: Standard[]
  /** Per layer of bones, the standard a made face uses, with its pairs (B3). */
  choice: { layer: Id; standard: Id; pairs: { bone: Id; key: string }[] }[]
  mode: Mode
}
const S = (s: BonesState) => s as unknown as Store
const copyCubic = (c: Cubic): Cubic => c.map(p => ({ x: p.x, y: p.y })) as unknown as Cubic

export const create = (): BonesState => ({ bones: [], attach: [], owners: [], standards: [], choice: [], mode: 'record' }) as Store as unknown as BonesState
export const isBone = (s: BonesState, line: Id) => S(s).bones.includes(line)
export const bones = (s: BonesState): Id[] => [...S(s).bones]
export const attachments = (s: BonesState): Attachment[] => S(s).attach.map(a => ({ line: a.line, bone: a.bone, base: { line: copyCubic(a.base.line), bone: copyCubic(a.base.bone) } }))
export const attachmentOf = (s: BonesState, line: Id): Attachment | undefined => attachments(s).find(a => a.line === line)
export const isAttached = (s: BonesState, line: Id) => S(s).attach.some(a => a.line === line)
export const owners = (s: BonesState): { point: Id; bone: Id }[] => S(s).owners.map(o => ({ ...o }))
export const mode = (s: BonesState): Mode => S(s).mode
export const standards = (s: BonesState): Standard[] => structuredClone(S(s).standards)
export const choices = (s: BonesState): Choice[] => structuredClone(S(s).choice)

// ---- modes and standards (B3; docs/bone-lines-checklist.md §6b) --------------------------------------------------

/** 录制标准 / 捏脸. Switching never changes a standard (dot 1792302286). */
export function setMode(s: BonesState, m: Mode) {
  if (m !== 'record' && m !== 'make') throw new Error(`Unknown bone mode ${String(m)}`)
  S(s).mode = m
}
/** The bones whose 0,0 line is in `layer`. */
const bonesIn = (s: BonesState, front: net.NetworkState, layer: Id) => S(s).bones.filter(b => net.hasLine(front, b) && net.point(front, net.line(front, b).a).layer === layer)
/** Each bone's name, checked: none empty, none repeated (a standard pairs by name once). */
function namedBones(s: BonesState, front: net.NetworkState, layer: Id, nameOf: (line: Id) => string | undefined, code: string) {
  const list = bonesIn(s, front, layer).map(b => ({ bone: b, name: nameOf(b) ?? '' }))
  const empty = list.filter(x => !x.name.trim()).map(x => x.bone)
  if (empty.length) throw new net.Refusal(code, `${code}: the bones ${empty.join(', ')} have no name; a standard pairs bones by name`, net.lineObjects(empty))
  const seen = new Map<string, Id[]>(); for (const x of list) seen.set(x.name, [...(seen.get(x.name) ?? []), x.bone])
  const twice = [...seen].filter(([, ids]) => ids.length > 1)
  if (twice.length) throw new net.Refusal(code, `${code}: the name${twice.length > 1 ? 's' : ''} ${twice.map(([n]) => `「${n}」`).join(', ')} ${twice.length > 1 ? 'are' : 'is'} used by more than one bone in this layer; a standard pairs bones by name`, net.lineObjects(twice.flatMap(([, ids]) => ids)))
  return list
}
/**
 * The layer's bones in every view (`network`), saved as the standard `name` (存为标准). An existing name in this layer is
 * replaced only with `overwrite` (its id and the keys of same-named bones kept), else refused. `id` is used for a new one.
 */
export function saveStandard(s: BonesState, network: net.NetworkState, layer: Id, name: string, overwrite: boolean, id: Id, nameOf: (line: Id) => string | undefined) {
  if (!name.trim()) throw new net.Refusal('standard-name', 'standard-name: a standard needs a name')
  const front = net.of(network, views.FRONT), list = namedBones(s, front, layer, nameOf, 'standard-names')
  if (!list.length) throw new net.Refusal('standard-empty', `standard-empty: the layer ${layer} has no bones`)
  const was = S(s).standards.find(t => t.layer === layer && t.name === name)
  if (was && !overwrite) throw new net.Refusal('standard-exists', `standard-exists: 「${name}」 already exists for this layer; overwrite it explicitly`)
  if (!was && S(s).standards.some(t => t.id === id)) throw new Error(`Standard id ${id} is in use`)
  // a bone keeps its key: first the key it is paired with in this layer's choice of the replaced standard (a bone renamed
  // since stays paired, dot 1792304023), then a same-named bone's key, else its own id
  const keys = new Map((was?.bones ?? []).map(b => [b.name, b.key] as const)), used = new Set<string>()
  const paired = new Map((was ? S(s).choice.find(c => c.layer === layer && c.standard === was.id)?.pairs ?? [] : []).map(p => [p.bone, p.key] as const))
  const wanted = (bone: Id, n: string) => paired.get(bone) ?? (keys.has(n) && ![...paired.values()].includes(keys.get(n)!) ? keys.get(n)! : bone)
  const keyFor = (bone: Id, n: string) => { const w = wanted(bone, n); let k = w; for (let i = 2; used.has(k); i++) k = `${w}~${i}`; used.add(k); return k }
  const viewKeys = net.shapeLayers(network).filter(l => l.kind === 'view').map(l => l.key)
  const bones = list.map(x => ({ key: keyFor(x.bone, x.name), name: x.name, views: Object.fromEntries(viewKeys.map(k => [k, cubicOf(net.of(network, k), x.bone)])) }))
  const std: Standard = { id: was?.id ?? id, name, layer, bones, naming: 'curve·line' }
  S(s).standards = was ? S(s).standards.map(t => (t.id === was.id ? std : t)) : [...S(s).standards, std]
  // a layer using the replaced standard keeps its pairs where the key still exists
  S(s).choice = S(s).choice.map(c => (c.standard === std.id ? { ...c, pairs: c.pairs.filter(p => bones.some(b => b.key === p.key)) } : c))
}
/** A fresh standard id: `std-1`, `std-2`, … */
export const freshStandardId = (s: BonesState): Id => { let i = 1; while (S(s).standards.some(t => t.id === `std-${i}`)) i++; return `std-${i}` }
/** A standard removed (删除): refused while a layer uses it. */
export function removeStandard(s: BonesState, id: Id) {
  if (!S(s).standards.some(t => t.id === id)) throw new Error(`No standard ${id}`)
  if (S(s).choice.some(c => c.standard === id)) throw new net.Refusal('standard-in-use', `standard-in-use: a layer uses this standard; choose another (or none) first`)
  S(s).standards = S(s).standards.filter(t => t.id !== id)
}
/**
 * The standard a layer uses (用标准), or none (`null`). The layer's bones are paired with the standard's by name here,
 * once, and the pairs stored; a bone without a same-named standard bone stays unpaired. Empty or repeated names refuse.
 */
export function useStandard(s: BonesState, front: net.NetworkState, layer: Id, id: Id | null, nameOf: (line: Id) => string | undefined) {
  S(s).choice = S(s).choice.filter(c => c.layer !== layer)
  if (id === null) return
  const std = S(s).standards.find(t => t.id === id)
  if (!std) throw new Error(`No standard ${id}`)
  const list = namedBones(s, front, layer, nameOf, 'standard-names')
  // by 「连续曲线·线」 (marked); an unmarked standard was saved before the marker: a bone name without 「·」 is a line name
  // and pairs by the bone's line name when exactly one bone of the layer has it; a name with 「·」 is either an old line
  // name or an unmarked 「连续曲线·线」 (5eefb4b–30cddec) — it cannot be told which, so it is never paired: saving the
  // standard again marks it (docs/names-scope.md rule 9; dot 1792309220, 1792309505)
  const byName = new Map(std.bones.map(b => [b.name, b.key] as const)), linePart = (x: string) => x.slice(x.lastIndexOf('·') + 1)
  const old = (x: string) => { const b = std.bones.filter(t => !t.name.includes('·') && t.name === linePart(x)); return b.length === 1 && list.filter(y => linePart(y.name) === b[0]!.name).length === 1 ? b[0]!.key : undefined }
  S(s).choice.push({ layer, standard: id, pairs: list.flatMap(x => { const key = std.naming === 'curve·line' ? byName.get(x.name) : old(x.name); return key === undefined ? [] : [{ bone: x.bone, key }] }) })
  S(s).choice.sort((p, q) => (p.layer < q.layer ? -1 : p.layer > q.layer ? 1 : 0))
}
/**
 * A standard from elsewhere (从文件导入标准), copied into `layer` as a new standard `id`; a same-named standard of that
 * layer is replaced only with `overwrite` (keeping its id), else refused.
 */
export function addStandard(s: BonesState, layer: Id, data: { name: string; bones: readonly StandardBone[]; naming?: 'curve·line' }, overwrite: boolean, id: Id): Id {
  let bones: StandardBone[]
  const naming = data.naming === 'curve·line' ? data.naming : undefined
  try { bones = standardBones(data.bones, 'imported standard', naming) } catch (e) { throw new net.Refusal('standard-data', `standard-data: ${(e as Error).message}`) }
  if (typeof data.name !== 'string' || !data.name.trim()) throw new net.Refusal('standard-name', 'standard-name: a standard needs a name')
  if (!bones.length) throw new net.Refusal('standard-empty', 'standard-empty: the standard has no bones')
  const was = S(s).standards.find(t => t.layer === layer && t.name === data.name)
  if (was && !overwrite) throw new net.Refusal('standard-exists', `standard-exists: 「${data.name}」 already exists for this layer; overwrite it explicitly`)
  if (!was && S(s).standards.some(t => t.id === id)) throw new Error(`Standard id ${id} is in use`)
  const std: Standard = { id: was?.id ?? id, name: data.name, layer, bones, ...(naming ? { naming } : {}) }
  S(s).standards = was ? S(s).standards.map(t => (t.id === was.id ? std : t)) : [...S(s).standards, std]
  // a layer using the replaced standard keeps its pairs where the key still exists
  S(s).choice = S(s).choice.map(c => (c.standard === std.id ? { ...c, pairs: c.pairs.filter(p => bones.some(b => b.key === p.key)) } : c))
  return std.id
}

/** A line's cubic in a view. */
export function cubicOf(n: net.NetworkState, id: Id): Cubic {
  const l = net.line(n, id), a = net.point(n, l.a).position, b = net.point(n, l.b).position
  return [{ ...a }, { x: a.x + l.ha.x, y: a.y + l.ha.y }, { x: b.x + l.hb.x, y: b.y + l.hb.y }, { ...b }]
}
const refuse = (e: unknown, objects: net.RefusalObject[]): never => {
  if (e instanceof BoneError) throw new net.Refusal(e.code, `${e.code}: ${e.message}; nothing was published`, objects)
  throw e
}

/** Mark lines as bones (`on`) or not. A line attached to a bone cannot be a bone (no hierarchy, v1); a bone unmarked releases its lines. */
export function markBone(s: BonesState, n: net.NetworkState, lines: readonly Id[], on: boolean) {
  for (const id of lines) {
    if (!net.hasLine(n, id)) throw new Error(`No line ${id}`)
    if (on) {
      if (isAttached(s, id)) throw new net.Refusal('bone-attached', `bone-attached: ${id} is attached to a bone and cannot be a bone itself (no bone hierarchy); detach it first`, net.lineObjects([id]))
      if (!S(s).bones.includes(id)) S(s).bones.push(id)
    } else if (S(s).bones.includes(id)) {
      S(s).bones = S(s).bones.filter(b => b !== id)
      S(s).choice = S(s).choice.map(c => ({ ...c, pairs: c.pairs.filter(p => p.bone !== id) }))
      release(s, n, S(s).attach.filter(a => a.bone === id).map(a => a.line))
    }
  }
  S(s).bones.sort()
}

/**
 * Attach lines to a bone (绑骨), reading the front `front`: the base is both shapes as they are now, so attaching never
 * moves a line (checklist §8). Refused: not a bone, a line of another layer, a bone or the bone itself as the line, a line with links (dot,
 * checklist §4: unlink first — `linked` = the lines with links), a bone too short, a line point ambiguous on it.
 */
export function attach(s: BonesState, front: net.NetworkState, lines: readonly Id[], bone: Id, linked: ReadonlySet<Id>) {
  if (!S(s).bones.includes(bone)) throw new net.Refusal('not-a-bone', `not-a-bone: ${bone} is not a bone`, net.lineObjects([bone]))
  const boneShape = cubicOf(front, bone), layerOf = (id: Id) => net.point(front, net.line(front, id).a).layer
  for (const id of lines) {
    if (!net.hasLine(front, id)) throw new Error(`No line ${id}`)
    // a part is a layer (bowen 1792297720): a line is attached only to a bone of its own layer (bowen 1792307973)
    if (layerOf(id) !== layerOf(bone)) throw new net.Refusal('bone-layer', `bone-layer: ${id} is in another layer than the bone ${bone}; a line is attached only to a bone of its own layer`, net.lineObjects([id, bone]))
    if (id === bone || S(s).bones.includes(id)) throw new net.Refusal('bone-attached', `bone-attached: ${id} is a bone; a bone cannot be attached to a bone`, net.lineObjects([id]))
    if (linked.has(id)) throw new net.Refusal('bone-linked', `bone-linked: ${id} has links (联动); unlink it before attaching it to a bone`, net.lineObjects([id]))
    const shape = cubicOf(front, id)
    // the bone and the line must be usable now (the same checks run on every derivation)
    try { const f = boneFrame(boneShape); for (let i = 0; i <= 16; i++) toBone(f, at(shape, i / 16)) } catch (e) { refuse(e, net.lineObjects([id, bone])) }
    S(s).attach = S(s).attach.filter(a => a.line !== id)
    S(s).attach.push({ line: id, bone, base: { line: shape, bone: copyCubic(boneShape) } })
  }
  S(s).attach.sort((p, q) => (p.line < q.line ? -1 : p.line > q.line ? 1 : 0))
  chooseOwners(s, front, lines.flatMap(id => { const l = net.line(front, id); return [l.a, l.b] }))
}
/** Detach lines (解绑): they keep their positions in every view and become ordinary lines. */
export function detach(s: BonesState, n: net.NetworkState, lines: readonly Id[]) { release(s, n, lines) }
function release(s: BonesState, n: net.NetworkState, lines: readonly Id[]) {
  const gone = new Set(lines), points = S(s).attach.filter(a => gone.has(a.line)).flatMap(a => (net.hasLine(n, a.line) ? [net.line(n, a.line).a, net.line(n, a.line).b] : []))
  S(s).attach = S(s).attach.filter(a => !gone.has(a.line))
  chooseOwners(s, n, points)
}

const at = (c: Cubic, t: number): Vec => { const u = 1 - t; return { x: u * u * u * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t * t * t * c[3].x, y: u * u * u * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t * t * t * c[3].y } }

/**
 * The owner of each of `points` (dot 1792297855): among the bones of the attached lines meeting there, the nearest at
 * 0,0 (`front`); equal distances → the smaller bone id. Chosen only here — when an attachment touching the point
 * changes — never on a drag. A point on lines of one bone needs no owner.
 */
function chooseOwners(s: BonesState, front: net.NetworkState, points: readonly Id[]) {
  for (const p of new Set(points)) {
    S(s).owners = S(s).owners.filter(o => o.point !== p)
    if (!net.hasPoint(front, p)) continue
    const boneIds = [...new Set(S(s).attach.filter(a => net.hasLine(front, a.line) && [net.line(front, a.line).a, net.line(front, a.line).b].includes(p)).map(a => a.bone))].sort()
    if (boneIds.length < 2) continue
    const pos = net.point(front, p).position
    const dist = (b: Id) => { try { const c = toBone(boneFrame(cubicOf(front, b)), pos); return Math.hypot(c.off, c.along) } catch { return Infinity } }
    let best = boneIds[0]!, bd = dist(best)
    for (const b of boneIds.slice(1)) { const d = dist(b); if (d < bd) { best = b; bd = d } }
    S(s).owners.push({ point: p, bone: best })
  }
  S(s).owners.sort((p, q) => (p.point < q.point ? -1 : p.point > q.point ? 1 : 0))
}

/**
 * After a network operation (the same record as the other modules): a deleted or collapsed bone releases its lines;
 * a deleted attached line takes its record; a split attached line gives each piece the attachment, its base the
 * matching half of the old base (so neither piece moves). A bone split is refused before it happens (document).
 */
export function update(s: BonesState, n: net.NetworkState, ch: net.Changes) {
  for (const r of ch.replaced) {
    const a = S(s).attach.find(x => x.line === r.line)
    if (!a) continue
    const [first, second] = halves(a.base.line, r.t)
    S(s).attach = S(s).attach.filter(x => x.line !== r.line)
    S(s).attach.push({ line: r.pieces[0], bone: a.bone, base: { line: first, bone: copyCubic(a.base.bone) } }, { line: r.pieces[1], bone: a.bone, base: { line: second, bone: copyCubic(a.base.bone) } })
  }
  const gone = new Set([...ch.deletedLines, ...ch.collapsedLines])
  const bonesGone = S(s).bones.filter(b => gone.has(b))
  S(s).bones = S(s).bones.filter(b => !gone.has(b))
  S(s).attach = S(s).attach.filter(a => !gone.has(a.line) && !bonesGone.includes(a.bone))
  const deadPoints = new Set(ch.deletedPoints)
  S(s).owners = S(s).owners.filter(o => !deadPoints.has(o.point) && S(s).bones.includes(o.bone))
  // a bone gone leaves its pair (the standard keeps its data: it is a copy)
  S(s).choice = S(s).choice.map(c => ({ ...c, pairs: c.pairs.filter(p => S(s).bones.includes(p.bone)) }))
  S(s).attach.sort((p, q) => (p.line < q.line ? -1 : p.line > q.line ? 1 : 0))
  void n
}
/** De Casteljau at t: the two halves of a cubic. */
function halves(c: Cubic, t: number): [Cubic, Cubic] {
  const lerp = (p: Vec, q: Vec): Vec => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
  const p01 = lerp(c[0], c[1]), p12 = lerp(c[1], c[2]), p23 = lerp(c[2], c[3]), p012 = lerp(p01, p12), p123 = lerp(p12, p23), m = lerp(p012, p123)
  return [[{ ...c[0] }, p01, p012, m], [{ ...m }, p123, p23, { ...c[3] }]]
}

const lengthOf = (c: Cubic) => { let L = 0; for (let i = 1; i <= 32; i++) { const p = at(c, (i - 1) / 32), q = at(c, i / 32); L += Math.hypot(q.x - p.x, q.y - p.y) } return L }
/**
 * The largest fit error a derived line may have: 2 % of the larger of its base length and its bone's (scale-free; a
 * short line on a long bone — the crease on the lid — is judged at the bone's scale, at which it is seen). A setting to
 * review with real drawings.
 */
export const fitLimit = (line: Cubic, bone: Cubic) => 0.02 * Math.max(lengthOf(line), lengthOf(bone))

/**
 * The derivation (checklist §2, §3), in place, through the network's own operations so the settle sees it:
 * - at 0,0: a line edited in this edit (`edited`), or every line of a bone placed in this edit (`placing`), takes a new
 *   base (its shape as it is, the bone as it is); otherwise, if its bone moved since the base, the line is carried;
 * - in every other view: each attached line carried from its base onto that view's bone; a point shared by lines on
 *   different bones follows its owner. Returns the derived cubics per view, for the settle check.
 * Refused (nothing written, the edit fails): a degenerate bone, an ambiguous point, a line one cubic cannot follow.
 */
export function derive(s: BonesState, network: net.NetworkState, ch: net.Changes, edited: ReadonlySet<Id>, placing: ReadonlySet<Id>): Map<string, Map<Id, Cubic>> {
  const out = new Map<string, Map<Id, Cubic>>()
  // step 3 (捏脸): the paired bones' side views from their standards, written first; the attached lines then follow them
  if (S(s).mode === 'make') for (const [k, m] of bonesFromStandards(s, network, ch)) out.set(k, new Map(m))
  if (!S(s).attach.length) return out
  const front = net.of(network, views.FRONT)
  // the bases first (at 0,0, from the edit as it is)
  for (const a of S(s).attach) {
    if (!net.hasLine(front, a.line) || !net.hasLine(front, a.bone)) continue
    if (edited.has(a.line) || placing.has(a.bone)) a.base = { line: cubicOf(front, a.line), bone: cubicOf(front, a.bone) }
  }
  const keys = net.shapeLayers(network).filter(l => l.kind === 'view').map(l => l.key)
  for (const key of keys) {
    const n = net.of(network, key), isFront = key === views.FRONT, made = new Map<Id, Cubic>()
    const live = S(s).attach.filter(a => net.hasLine(n, a.line) && net.hasLine(n, a.bone))
    const boneNow = new Map(live.map(a => [a.bone, cubicOf(n, a.bone)]))
    // a bone as it was at the base carries its lines unchanged: at the front a line is then left exactly as it is,
    // elsewhere it takes its base shape exactly (the identity, never refit)
    const carried = live.filter(a => !isFront || !same(a.base.bone, boneNow.get(a.bone)!))
    if (!carried.length) { if (!out.has(key)) out.set(key, made); continue }
    // one target per shared point: the owner's carrying of it (the attachment with the smallest line id on that bone)
    const target = new Map<Id, Vec>()
    for (const o of S(s).owners) {
      const by = live.filter(a => a.bone === o.bone && [net.line(n, a.line).a, net.line(n, a.line).b].includes(o.point))[0]
      if (!by) continue
      const l = net.line(n, by.line), base = l.a === o.point ? by.base.line[0] : by.base.line[3], bone = boneNow.get(by.bone)!
      // the identity exactly when the owner's bone is as it was at the base (no rounding from the map)
      try { target.set(o.point, same(by.base.bone, bone) ? { x: base.x, y: base.y } : boneMap(by.base.bone, bone)(base)) }
      catch (e) { refuse(e, net.lineObjects([by.line, by.bone])) }
    }
    // a point a bone uses (a line merged onto a bone's point) stays where that bone has it: the bone is never moved by
    // the lines it carries (else the derivation has no fixed point and the file does not reopen)
    const bonePoint = (pt: Id) => net.linesAt(n, pt).some(x => S(s).bones.includes(x.line.id))
    for (const a of carried) for (const pt of [net.line(n, a.line).a, net.line(n, a.line).b]) if (bonePoint(pt)) { const q = net.point(n, pt).position; target.set(pt, { x: q.x, y: q.y }) }
    for (const a of carried) {
      const l = net.line(n, a.line)
      let r: { shape: Cubic; maxError: number }
      const ta = target.get(l.a), tb = target.get(l.b)
      if (same(a.base.bone, boneNow.get(a.bone)!) && !ta && !tb) r = { shape: copyCubic(a.base.line), maxError: 0 }
      else {
        try { r = boneLine(a.base.line, a.base.bone, boneNow.get(a.bone)!, { a: ta, b: tb }, 1, fitLimit(a.base.line, a.base.bone)) }
        catch (e) { return refuse(e, net.lineObjects([a.line, a.bone])) }
      }
      if (r.maxError > fitLimit(a.base.line, a.base.bone)) throw new net.Refusal('bone-fit', `bone-fit: in ${key}, ${a.line} cannot follow its bone as one curve (fit error ${r.maxError.toFixed(3)}); nothing was published`, net.lineObjects([a.line, a.bone]))
      made.set(a.line, r.shape)
    }
    // write: each point once, then the handles (held, so the springs leave them)
    const moves = new Map<Id, Vec>()
    for (const [id, c] of made) { const l = net.line(n, id); moves.set(l.a, c[0]); moves.set(l.b, c[3]) }
    net.move(n, ch, [...moves].map(([id, p]) => ({ id, target: p })))
    for (const [id, c] of made) {
      net.moveHandle(n, ch, id, 'a', { x: c[1].x - c[0].x, y: c[1].y - c[0].y })
      net.moveHandle(n, ch, id, 'b', { x: c[2].x - c[3].x, y: c[2].y - c[3].y })
    }
    // the cubics as written (a shared point's final position may differ from a line's own fit only when two lines on one
    // bone carried it differently — the last write wins and the check below reads what is there)
    out.set(key, new Map([...(out.get(key) ?? new Map<Id, Cubic>()), ...[...made.keys()].map(id => [id, cubicOf(n, id)] as const)]))
  }
  return out
}

/**
 * 捏脸's side bones (docs/bone-lines-checklist.md §6b): for each layer's chosen standard and each stored pair, the bone in
 * every other view = bone coordinates of 「the standard's bone at 0,0 → in that view」 applied to the bone as it is at 0,0,
 * refit as one cubic. An end shared by paired bones takes the smaller bone id's target; an end shared with a bone that
 * is not paired must land where that bone has it, else refused (dot 1792302286). Written through the network's own
 * operations (points as targets, handles held). Returns the bones written, per view.
 */
function bonesFromStandards(s: BonesState, network: net.NetworkState, ch: net.Changes): Map<string, Map<Id, Cubic>> {
  const out = new Map<string, Map<Id, Cubic>>(), front = net.of(network, views.FRONT)
  const paired = new Map<Id, StandardBone>()
  for (const c of S(s).choice) {
    const std = S(s).standards.find(t => t.id === c.standard)
    if (!std) continue
    for (const p of c.pairs) { const b = std.bones.find(x => x.key === p.key); if (b && net.hasLine(front, p.bone) && S(s).bones.includes(p.bone)) paired.set(p.bone, b) }
  }
  if (!paired.size) return out
  const ids = [...paired.keys()].sort()
  const sideKeys = net.shapeLayers(network).filter(l => l.kind === 'view' && l.key !== views.FRONT).map(l => l.key), firstSide = sideKeys[0]
  for (const key of sideKeys) {
    const n = net.of(network, key), made = new Map<Id, Cubic>()
    // each paired bone's end targets in this view, one per point (the smaller bone id first)
    const target = new Map<Id, Vec>(), mapped = new Map<Id, (p: Vec) => Vec>()
    for (const id of ids) {
      const std = paired.get(id)!, s0 = std.views[views.FRONT], sv = std.views[key]
      if (!s0 || !sv) continue
      // a made face is edited where the default face is (bowen 1792304469, ①): a bone farther than its standard bone's
      // length from it at 0,0 is refused, never carried with huge offsets (ledger row 26)
      if (key === firstSide) {
        const now0 = cubicOf(front, id), poly = Array.from({ length: 65 }, (_, k) => at(s0, k / 64)), L = lengthOf(s0)
        const far = Math.max(...Array.from({ length: 9 }, (_, k) => { const p = at(now0, k / 8); return Math.min(...poly.map(q => Math.hypot(q.x - p.x, q.y - p.y))) }))
        if (far > L) throw new net.Refusal('bone-standard-far', `bone-standard-far: at 0,0 the bone ${id} is ${far.toFixed(1)} from its standard's bone (more than that bone's length ${L.toFixed(1)}); a made face is edited where the standard was recorded; nothing was published`, net.lineObjects([id]))
      }
      let m: (p: Vec) => Vec
      try { m = boneMap(s0, sv) } catch (e) { return refuse(e, net.lineObjects([id])) }
      mapped.set(id, m)
      // a bone at 0,0 exactly as in its standard takes the standard's shape in this view exactly (as an unchanged bone keeps its base)
      const l = net.line(front, id), exact = same(cubicOf(front, id), s0)
      for (const [pt, end] of [[l.a, sv[0]], [l.b, sv[3]]] as const) {
        if (target.has(pt)) continue
        let q: Vec
        try { q = exact ? { x: end.x, y: end.y } : m(net.point(front, pt).position) } catch (e) { return refuse(e, net.lineObjects([id])) }
        // a point a bone that is not paired also uses stays where that bone has it in this view; a different target refuses
        const others = net.linesAt(n, pt).map(x => x.line.id).filter(b => b !== id && S(s).bones.includes(b) && !paired.has(b))
        if (others.length) {
          const here = net.point(n, pt).position
          if (Math.abs(here.x - q.x) > 1e-9 || Math.abs(here.y - q.y) > 1e-9) throw new net.Refusal('bone-standard-conflict', `bone-standard-conflict: in ${key} the point ${pt} is shared by ${id} (from its standard) and ${others.join(', ')} (not paired), which disagree; nothing was published`, net.lineObjects([id, ...others]))
        }
        target.set(pt, q)
      }
    }
    for (const id of ids) {
      if (!mapped.has(id)) continue
      const std = paired.get(id)!, l = net.line(front, id), now0 = cubicOf(front, id)
      let r: { shape: Cubic; maxError: number }
      const ta = target.get(l.a)!, tb = target.get(l.b)!, sv = std.views[key]!
      if (same(now0, std.views[views.FRONT]!) && ta.x === sv[0].x && ta.y === sv[0].y && tb.x === sv[3].x && tb.y === sv[3].y) r = { shape: copyCubic(sv), maxError: 0 }
      else try { r = boneLine(now0, std.views[views.FRONT]!, sv, { a: ta, b: tb }, 1, fitLimit(now0, std.views[views.FRONT]!)) }
      catch (e) { return refuse(e, net.lineObjects([id])) }
      if (r.maxError > fitLimit(now0, std.views[views.FRONT]!)) throw new net.Refusal('bone-fit', `bone-fit: in ${key}, the bone ${id} cannot follow its standard as one curve (fit error ${r.maxError.toFixed(3)}); nothing was published`, net.lineObjects([id]))
      made.set(id, r.shape)
    }
    if (!made.size) continue
    const moves = new Map<Id, Vec>()
    for (const [id, c] of made) { const l = net.line(n, id); moves.set(l.a, c[0]); moves.set(l.b, c[3]) }
    net.move(n, ch, [...moves].map(([id, p]) => ({ id, target: p })))
    for (const [id, c] of made) {
      net.moveHandle(n, ch, id, 'a', { x: c[1].x - c[0].x, y: c[1].y - c[0].y })
      net.moveHandle(n, ch, id, 'b', { x: c[2].x - c[3].x, y: c[2].y - c[3].y })
    }
    out.set(key, new Map([...made.keys()].map(id => [id, cubicOf(n, id)])))
  }
  return out
}

/** Why a bone cannot be edited off the front in 捏脸 (the refusal's words), or undefined when it can (录制标准). */
export function standardLock(s: BonesState, front: net.NetworkState, bone: Id): string | undefined {
  if (S(s).mode !== 'make' || !S(s).bones.includes(bone) || !net.hasLine(front, bone)) return undefined
  const layer = net.point(front, net.line(front, bone).a).layer, c = S(s).choice.find(x => x.layer === layer)
  if (!c) return `no standard is chosen for its layer ${layer} — choose one, or go back to 录制标准`
  if (!c.pairs.some(p => p.bone === bone)) return 'it is not paired with a bone of the chosen standard — go back to 录制标准 to edit it'
  const std = S(s).standards.find(t => t.id === c.standard)
  return `it comes from the standard 「${std?.name ?? c.standard}」 — change it in 录制标准`
}
const same = (p: Cubic, q: Cubic) => p.every((v, i) => v.x === q[i]!.x && v.y === q[i]!.y)

/** As plain data (archive). */
export const data = (s: BonesState): unknown => structuredClone(S(s))

/** A standard's bones from data, checked: names, finite cubics per view, keys unique (a missing key is the name). */
function standardBones(v: unknown, what: string, naming: 'curve·line' | undefined): StandardBone[] {
  void naming
  const d = net.data
  const cubic = (x: unknown, w: string): Cubic => { const a = d.arr(x, w); if (a.length !== 4) d.fail(`${w} is not a cubic`); return a.map((p, i) => d.vec(p, `${w} ${i}`)) as unknown as Cubic }
  const bones = d.arr(v, `${what} bones`).map((y, k) => {
    const Y = d.obj(y, `${what} bone ${k}`), name = d.str(Y.name, `${what} bone ${k} name`), V = d.obj(Y.views, `${what} bone ${k} views`)
    // a standard bone without a key (none could be made before B3, dot 1792302329): its name is its key
    const key = Y.key === undefined ? name : d.str(Y.key, `${what} bone ${k} key`)
    return { key, name, views: Object.fromEntries(Object.entries(V).map(([vk, c]) => [vk, cubic(c, `${what} bone ${k} views ${vk}`)])) }
  })
  d.unique(bones.map(b => b.key), `${what} bone key`)
  // a standard pairs by name: none empty, none repeated (dot 1792304023)
  if (bones.some(b => !b.name.trim())) d.fail(`${what} has a bone without a name`)
  d.unique(bones.map(b => b.name), `${what} bone name`)
  return bones
}

/** From saved data, checked: types, references to lines that exist, finite shapes; a bad file is refused, never repaired. */
export function restore(v: unknown, n: net.NetworkState): BonesState {
  const d = net.data, o = d.obj(v, 'bones'), s = create()
  const cubic = (x: unknown, what: string): Cubic => { const a = d.arr(x, what); if (a.length !== 4) d.fail(`${what} is not a cubic`); return a.map((p, i) => d.vec(p, `${what} ${i}`)) as unknown as Cubic }
  const line = (id: unknown, what: string) => { const x = d.str(id, what); if (!net.hasLine(n, x)) d.fail(`${what}: no line ${x}`); return x }
  S(s).bones = d.arr(o.bones, 'bones').map((x, i) => line(x, `bone ${i}`))
  d.unique(S(s).bones, 'bone')
  S(s).attach = d.arr(o.attach, 'bones attach').map((x, i) => {
    const A = d.obj(x, `attachment ${i}`), B = d.obj(A.base, `attachment ${i} base`), l = line(A.line, `attachment ${i} line`), b = line(A.bone, `attachment ${i} bone`)
    if (!S(s).bones.includes(b)) d.fail(`attachment ${i}: ${b} is not a bone`)
    if (S(s).bones.includes(l)) d.fail(`attachment ${i}: a bone cannot be attached`)
    return { line: l, bone: b, base: { line: cubic(B.line, `attachment ${i} base line`), bone: cubic(B.bone, `attachment ${i} base bone`) } }
  })
  d.unique(S(s).attach.map(a => a.line), 'attached line')
  S(s).owners = d.arr(o.owners, 'bones owners').map((x, i) => {
    const O = d.obj(x, `owner ${i}`), p = d.str(O.point, `owner ${i} point`), b = d.str(O.bone, `owner ${i} bone`)
    if (!net.hasPoint(n, p)) d.fail(`owner ${i}: no point ${p}`)
    if (!S(s).bones.includes(b)) d.fail(`owner ${i}: ${b} is not a bone`)
    return { point: p, bone: b }
  })
  d.unique(S(s).owners.map(x => x.point), 'owned point')
  S(s).standards = d.arr(o.standards, 'bones standards').map((x, i): Standard => {
    const T = d.obj(x, `standard ${i}`)
    const naming = T.naming === undefined ? undefined : d.str(T.naming, `standard ${i} naming`)
    if (naming !== undefined && naming !== 'curve·line') d.fail(`standard ${i}: unknown naming ${naming}`)
    return { id: d.str(T.id, `standard ${i} id`), name: d.str(T.name, `standard ${i} name`), layer: d.str(T.layer, `standard ${i} layer`), bones: standardBones(T.bones, `standard ${i}`, naming as 'curve·line' | undefined), ...(naming ? { naming: 'curve·line' as const } : {}) }
  })
  d.unique(S(s).standards.map(x => x.id), 'standard')
  S(s).choice = d.arr(o.choice, 'bones choice').map((x, i) => {
    const C = d.obj(x, `choice ${i}`), std = d.str(C.standard, `choice ${i} standard`), t = S(s).standards.find(u => u.id === std)
    if (!t) d.fail(`choice ${i}: no standard ${std}`)
    // a choice without pairs (none could be made before B3): unpaired until the standard is chosen again
    const pairs = C.pairs === undefined ? [] : d.arr(C.pairs, `choice ${i} pairs`).map((y, k) => {
      const Y = d.obj(y, `choice ${i} pair ${k}`), bone = d.str(Y.bone, `choice ${i} pair ${k} bone`), key = d.str(Y.key, `choice ${i} pair ${k} key`)
      if (!S(s).bones.includes(bone)) d.fail(`choice ${i} pair ${k}: ${bone} is not a bone`)
      if (!t!.bones.some(b => b.key === key)) d.fail(`choice ${i} pair ${k}: the standard has no bone ${key}`)
      return { bone, key }
    })
    d.unique(pairs.map(p => p.bone), `choice ${i} paired bone`)
    return { layer: d.str(C.layer, `choice ${i} layer`), standard: std, pairs }
  })
  d.unique(S(s).choice.map(c => c.layer), 'choice layer')
  const m = d.str(o.mode, 'bones mode')
  if (m !== 'record' && m !== 'make') d.fail(`bones mode ${m} is unknown`)
  S(s).mode = m as Mode
  return s
}

// ---- copy and paste (checklist §4; dot 1792296347) ------------------------------------------------

/** A clip's bones part: the bones in the range, and each attachment whose line and bone are both there, with its base. */
export interface ClipData { bones: Id[]; attach: { line: Id; bone: Id; base: { line: Cubic; bone: Cubic } }[] }
/** The bones and attachments inside a copied range: every bone among `lines`; an attachment, with its base, when its line and bone are both there. */
export function rangeData(s: BonesState, lines: ReadonlySet<Id>): ClipData {
  return { bones: S(s).bones.filter(b => lines.has(b)), attach: S(s).attach.filter(a => lines.has(a.line) && lines.has(a.bone)).map(a => ({ line: a.line, bone: a.bone, base: { line: copyCubic(a.base.line), bone: copyCubic(a.base.bone) } })) }
}
/** A clip's bones part, checked: every reference inside the clip (`lines`), each attachment on one of its bones. */
export function checkClip(v: unknown, lines: ReadonlySet<Id>, what: string): ClipData {
  const d = net.data, o = d.obj(v, what)
  const bonesIn = d.arr(o.bones, `${what} bones`).map((x, i) => { const id = d.str(x, `${what} bone ${i}`); if (!lines.has(id)) d.fail(`${what} bone ${id} is outside the clip`); return id })
  d.unique(bonesIn, `${what} bone`)
  const attach = d.arr(o.attach, `${what} attach`).map((x, i) => {
    const A = d.obj(x, `${what} attachment ${i}`), line = d.str(A.line, `${what} attachment ${i} line`), bone = d.str(A.bone, `${what} attachment ${i} bone`)
    if (!lines.has(line) || !bonesIn.includes(bone) || bonesIn.includes(line)) d.fail(`${what} attachment ${i} does not attach a line of the clip to one of its bones`)
    const B = d.obj(A.base, `${what} attachment ${i} base`)
    const cubic = (c: unknown, w: string): Cubic => { const a = d.arr(c, w); if (a.length !== 4) d.fail(`${w} is not a cubic`); return a.map((p, k) => d.vec(p, `${w} ${k}`)) as unknown as Cubic }
    return { line, bone, base: { line: cubic(B.line, `${what} attachment ${i} base line`), bone: cubic(B.bone, `${what} attachment ${i} base bone`) } }
  })
  d.unique(attach.map(a => a.line), `${what} attached line`)
  return { bones: bonesIn, attach }
}
/**
 * A pasted clip's bones and attachments, on the new ids (`lines`: old → new). A bone pasted alone stays a bone; an
 * attachment comes along only with its bone, and keeps its own base moved by the paste's `offset` (dot 1792299724: a
 * copy is not a new attachment — rebuilding the base from the fitted front would change the side views).
 */
export function insert(s: BonesState, front: net.NetworkState, data: ClipData, lines: ReadonlyMap<Id, Id>, offset: Vec = { x: 0, y: 0 }) {
  const moved = (c: Cubic): Cubic => c.map(p => ({ x: p.x + offset.x, y: p.y + offset.y })) as unknown as Cubic
  for (const b of data.bones) { const id = lines.get(b); if (id !== undefined && !S(s).bones.includes(id)) S(s).bones.push(id) }
  S(s).bones.sort()
  const added: Id[] = []
  for (const a of data.attach) {
    const line = lines.get(a.line), bone = lines.get(a.bone)
    if (line === undefined || bone === undefined || !net.hasLine(front, line) || !net.hasLine(front, bone)) continue
    S(s).attach = S(s).attach.filter(x => x.line !== line)
    S(s).attach.push({ line, bone, base: { line: offset.x || offset.y ? moved(a.base.line) : copyCubic(a.base.line), bone: offset.x || offset.y ? moved(a.base.bone) : copyCubic(a.base.bone) } })
    added.push(line)
  }
  S(s).attach.sort((p, q) => (p.line < q.line ? -1 : p.line > q.line ? 1 : 0))
  chooseOwners(s, front, added.flatMap(id => [net.line(front, id).a, net.line(front, id).b]))
}
