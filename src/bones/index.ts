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
/** A standard (B3): one layer's bones in the nine views, under a name; `id` is what a made face refers to. */
export interface Standard { readonly id: Id; readonly name: string; readonly layer: Id; readonly bones: readonly { readonly name: string; readonly views: Readonly<Record<string, Cubic>> }[] }

declare const opaque: unique symbol
export type BonesState = { readonly [opaque]: 'bones' }
interface Store {
  bones: Id[]
  attach: { line: Id; bone: Id; base: { line: Cubic; bone: Cubic } }[]
  /** A point shared by attached lines on different bones: the bone it follows (chosen when attaching, stored). */
  owners: { point: Id; bone: Id }[]
  standards: Standard[]
  /** Per layer of bones, the standard a made face uses (B3). */
  choice: { layer: Id; standard: Id }[]
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
      release(s, n, S(s).attach.filter(a => a.bone === id).map(a => a.line))
    }
  }
  S(s).bones.sort()
}

/**
 * Attach lines to a bone (绑骨), reading the front `front`: the base is both shapes as they are now, so attaching never
 * moves a line (checklist §8). Refused: not a bone, a bone or the bone itself as the line, a line with links (dot,
 * checklist §4: unlink first — `linked` = the lines with links), a bone too short, a line point ambiguous on it.
 */
export function attach(s: BonesState, front: net.NetworkState, lines: readonly Id[], bone: Id, linked: ReadonlySet<Id>) {
  if (!S(s).bones.includes(bone)) throw new net.Refusal('not-a-bone', `not-a-bone: ${bone} is not a bone`, net.lineObjects([bone]))
  const boneShape = cubicOf(front, bone)
  for (const id of lines) {
    if (!net.hasLine(front, id)) throw new Error(`No line ${id}`)
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
  S(s).attach.sort((p, q) => (p.line < q.line ? -1 : p.line > q.line ? 1 : 0))
  void n
}
/** De Casteljau at t: the two halves of a cubic. */
function halves(c: Cubic, t: number): [Cubic, Cubic] {
  const lerp = (p: Vec, q: Vec): Vec => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
  const p01 = lerp(c[0], c[1]), p12 = lerp(c[1], c[2]), p23 = lerp(c[2], c[3]), p012 = lerp(p01, p12), p123 = lerp(p12, p23), m = lerp(p012, p123)
  return [[{ ...c[0] }, p01, p012, m], [{ ...m }, p123, p23, { ...c[3] }]]
}

/** The largest fit error a derived line may have (drawing units): 2 % of its base length, at least 0.25. */
export const fitLimit = (line: Cubic) => { let L = 0; for (let i = 1; i <= 32; i++) { const p = at(line, (i - 1) / 32), q = at(line, i / 32); L += Math.hypot(q.x - p.x, q.y - p.y) } return Math.max(0.25, 0.02 * L) }

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
    if (!carried.length) { out.set(key, made); continue }
    // one target per shared point: the owner's carrying of it (the attachment with the smallest line id on that bone)
    const target = new Map<Id, Vec>()
    for (const o of S(s).owners) {
      const by = live.filter(a => a.bone === o.bone && [net.line(n, a.line).a, net.line(n, a.line).b].includes(o.point))[0]
      if (!by) continue
      const l = net.line(n, by.line), base = l.a === o.point ? by.base.line[0] : by.base.line[3]
      try { target.set(o.point, boneMap(by.base.bone, boneNow.get(by.bone)!)(base)) }
      catch (e) { refuse(e, net.lineObjects([by.line, by.bone])) }
    }
    for (const a of carried) {
      const l = net.line(n, a.line)
      let r: { shape: Cubic; maxError: number }
      const ta = target.get(l.a), tb = target.get(l.b)
      if (same(a.base.bone, boneNow.get(a.bone)!) && !ta && !tb) r = { shape: copyCubic(a.base.line), maxError: 0 }
      else {
        try { r = boneLine(a.base.line, a.base.bone, boneNow.get(a.bone)!, { a: ta, b: tb }) }
        catch (e) { return refuse(e, net.lineObjects([a.line, a.bone])) }
      }
      if (r.maxError > fitLimit(a.base.line)) throw new net.Refusal('bone-fit', `bone-fit: in ${key}, ${a.line} cannot follow its bone as one curve (fit error ${r.maxError.toFixed(3)}); nothing was published`, net.lineObjects([a.line, a.bone]))
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
    out.set(key, new Map([...made.keys()].map(id => [id, cubicOf(n, id)])))
  }
  return out
}
const same = (p: Cubic, q: Cubic) => p.every((v, i) => v.x === q[i]!.x && v.y === q[i]!.y)

/** As plain data (archive). */
export const data = (s: BonesState): unknown => structuredClone(S(s))

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
  S(s).standards = d.arr(o.standards, 'bones standards').map((x, i) => {
    const T = d.obj(x, `standard ${i}`), V = (y: unknown, what: string) => { const r = d.obj(y, what); return Object.fromEntries(Object.entries(r).map(([k, c]) => [k, cubic(c, `${what} ${k}`)])) }
    return { id: d.str(T.id, `standard ${i} id`), name: d.str(T.name, `standard ${i} name`), layer: d.str(T.layer, `standard ${i} layer`), bones: d.arr(T.bones, `standard ${i} bones`).map((y, k) => { const Y = d.obj(y, `standard ${i} bone ${k}`); return { name: d.str(Y.name, `standard ${i} bone ${k} name`), views: V(Y.views, `standard ${i} bone ${k} views`) } }) }
  })
  d.unique(S(s).standards.map(x => x.id), 'standard')
  S(s).choice = d.arr(o.choice, 'bones choice').map((x, i) => { const C = d.obj(x, `choice ${i}`), std = d.str(C.standard, `choice ${i} standard`); if (!S(s).standards.some(t => t.id === std)) d.fail(`choice ${i}: no standard ${std}`); return { layer: d.str(C.layer, `choice ${i} layer`), standard: std } })
  const m = d.str(o.mode, 'bones mode')
  if (m !== 'record' && m !== 'make') d.fail(`bones mode ${m} is unknown`)
  S(s).mode = m as Mode
  return s
}

// ---- copy and paste (checklist §4; dot 1792296347) ------------------------------------------------

/** The bones and attachments inside a copied range: every bone among `lines`; an attachment when its line and bone are both there. */
export function rangeData(s: BonesState, lines: ReadonlySet<Id>): { bones: Id[]; attach: { line: Id; bone: Id }[] } {
  return { bones: S(s).bones.filter(b => lines.has(b)), attach: S(s).attach.filter(a => lines.has(a.line) && lines.has(a.bone)).map(a => ({ line: a.line, bone: a.bone })) }
}
/** A clip's bones part, checked: every reference inside the clip (`lines`), each attachment on one of its bones. */
export function checkClip(v: unknown, lines: ReadonlySet<Id>, what: string): { bones: Id[]; attach: { line: Id; bone: Id }[] } {
  const d = net.data, o = d.obj(v, what)
  const bonesIn = d.arr(o.bones, `${what} bones`).map((x, i) => { const id = d.str(x, `${what} bone ${i}`); if (!lines.has(id)) d.fail(`${what} bone ${id} is outside the clip`); return id })
  d.unique(bonesIn, `${what} bone`)
  const attach = d.arr(o.attach, `${what} attach`).map((x, i) => {
    const A = d.obj(x, `${what} attachment ${i}`), line = d.str(A.line, `${what} attachment ${i} line`), bone = d.str(A.bone, `${what} attachment ${i} bone`)
    if (!lines.has(line) || !bonesIn.includes(bone) || bonesIn.includes(line)) d.fail(`${what} attachment ${i} does not attach a line of the clip to one of its bones`)
    return { line, bone }
  })
  d.unique(attach.map(a => a.line), `${what} attached line`)
  return { bones: bonesIn, attach }
}
/**
 * A pasted clip's bones and attachments, on the new ids (`lines`: old → new). A bone pasted alone stays a bone; an
 * attachment comes along only with its bone. The bases are the pasted shapes at 0,0 (`front`), so a paste moves nothing.
 */
export function insert(s: BonesState, front: net.NetworkState, data: { bones: Id[]; attach: { line: Id; bone: Id }[] }, lines: ReadonlyMap<Id, Id>) {
  for (const b of data.bones) { const id = lines.get(b); if (id !== undefined && !S(s).bones.includes(id)) S(s).bones.push(id) }
  S(s).bones.sort()
  const added: Id[] = []
  for (const a of data.attach) {
    const line = lines.get(a.line), bone = lines.get(a.bone)
    if (line === undefined || bone === undefined || !net.hasLine(front, line) || !net.hasLine(front, bone)) continue
    S(s).attach = S(s).attach.filter(x => x.line !== line)
    S(s).attach.push({ line, bone, base: { line: cubicOf(front, line), bone: cubicOf(front, bone) } })
    added.push(line)
  }
  S(s).attach.sort((p, q) => (p.line < q.line ? -1 : p.line > q.line ? 1 : 0))
  chooseOwners(s, front, added.flatMap(id => [net.line(front, id).a, net.line(front, id).b]))
}
