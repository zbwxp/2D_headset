// clipboard — copy and paste (graph rows "Copy (layer, lines, groups)" and "Cut, paste /
// copy"; docs/clipboard-plan.md). A clip is plain data, outside the document and its
// history: lines with their end points, the joins, end strokes and fills inside the range,
// the names. Corrections (responses) are not copied (bowen 1791993536; docs/correction-cleanup-checklist.md §1):
// a ratio means a position only between the views it was made on. Endpoint links and mirror pairs are never part of it. Pasting writes the
// clip through each module's own insert, with new ids.
import * as net from '../network'
import * as groups from '../groups'
import * as joins from '../joins'
import * as fills from '../fills'
import * as masks from '../masks'
import * as names from '../names'
import * as views from '../views'
import * as shapes from '../shapes'
import * as animation from '../animation'
import * as bones from '../bones'

type Id = net.Id

export interface Clip {
  network: net.LinesData
  /** Join modes and arc radii once; every shape layer's zones and end strokes (step 4). */
  joins: joins.RangeData
  fills: fills.FillData[]
  names: { lines: [Id, string][]; groups: { name: string; lines: Id[] }[] }
  /** The masks whose target and every source are in the clip; absent in a clip made before masks (inserts none). */
  masks?: masks.Mask[]
  /** Responses of a clip made before docs/correction-cleanup-checklist.md: still checked on paste, never written. */
  animation?: animation.ResponsesData
  /** Bones in the range, and attachments whose line and bone are both in it (docs/bone-lines-checklist.md §4); absent in older clips. */
  bones?: { bones: Id[]; attach: { line: Id; bone: Id }[] }
}

export interface Parts { network: net.NetworkState; groups: groups.GroupsState; joins: joins.JoinsState; fills: fills.FillsState; masks: masks.MasksState; names: names.NamesState; animation: animation.ResponsesState; bones: bones.BonesState }

/** The range as a clip: these lines (read from `d`) and everything inside them. */
export function extract(d: Parts, lines: readonly Id[]): Clip {
  const ids = [...new Set(lines)]
  if (!ids.length) throw new net.Refusal('select-lines-to-copy', 'select-lines-to-copy: copy takes lines; select lines to copy')
  const network = net.linesData(d.network, ids)
  const lineSet = new Set(ids), pointSet = new Set(network.points.map(p => p.id))
  return structuredClone({
    network,
    joins: joins.rangeData(d.joins, lineSet, pointSet),
    fills: fills.rangeData(d.fills, lineSet),
    masks: masks.rangeData(d.masks, lineSet, new Set(fills.rangeData(d.fills, lineSet).map(f => f.id))),
    names: names.rangeData(d.names, d.groups, d.network, ids),
    bones: bones.rangeData(d.bones, lineSet),
  })
}

/**
 * A clip is public plain data, so a paste checks it first (dot 1791513520): types, and
 * that every reference points inside the clip. The writers it goes through check the
 * rest (positions, stroke, join modes and radii). A bad clip refuses the whole paste.
 */
export function check(v: unknown): Clip {
  const d = net.data, o = d.obj(v, 'clip')
  const nw = d.obj(o.network, 'clip lines')
  // strokes are one per meta-curve (docs/shared-strokes-checklist.md §3): a point carries its width, a line its profile
  const points = d.arr(nw.points, 'clip points').map((x, i) => {
    const P = d.obj(x, `clip point ${i}`), id = d.str(P.id, `clip point ${i} id`), width = d.num(P.width, `clip point ${id} width`)
    if (!(width > 0)) d.fail(`clip point ${id} has a width that is not positive`)
    return { id, width }
  })
  d.unique(points.map(p => p.id), 'clip point')
  const pointIds = new Set(points.map(p => p.id))
  const lines = d.arr(nw.lines, 'clip lines').map((x, i) => {
    const L = d.obj(x, `clip line ${i}`), id = d.str(L.id, `clip line ${i} id`), a = d.str(L.a, `clip line ${id} a`), b = d.str(L.b, `clip line ${id} b`)
    if (!pointIds.has(a) || !pointIds.has(b) || a === b) d.fail(`clip line ${id} needs two of the clip's points`)
    const st = d.obj(L.state, `clip line ${id} state`), sk = d.obj(L.stroke, `clip line ${id} stroke`)
    return { id, a, b, state: { visible: d.bool(st.visible, `clip line ${id} visible`), locked: d.bool(st.locked, `clip line ${id} locked`) }, stroke: { profile: d.str(sk.profile, `clip line ${id} stroke profile`) } }
  })
  if (!lines.length) d.fail('the clip has no lines')
  d.unique(lines.map(l => l.id), 'clip line')
  const lineIds = new Set(lines.map(l => l.id))
  // every shape layer of the copied drawing: exactly the clip's points and lines (architecture §1)
  const source = d.str(nw.source, 'clip source layer')
  const layers = d.arr(nw.layers, 'clip shape layers').map((x, i) => {
    const L = d.obj(x, `clip shape layer ${i}`), key = d.str(L.key, `clip shape layer ${i} key`)
    // one list of kinds, the shapes module's (ledger row 5)
    const kind = d.str(L.kind, `clip shape layer ${key} kind`) as shapes.LayerKind
    if (!shapes.KINDS.includes(kind)) d.fail(`clip shape layer ${key} has an unknown kind`)
    // a clip from before shared strokes (a width or stroke per layer) is a bad clip
    const lp = d.arr(L.points, `clip shape layer ${key} points`).map((y, k) => {
      const P = d.obj(y, `clip shape layer ${key} point ${k}`)
      if (Object.hasOwn(P, 'width')) d.fail(`clip shape layer ${key} point ${k} holds a width (a clip from before shared strokes)`)
      return { id: d.str(P.id, `clip shape layer ${key} point ${k} id`), position: d.vec(P.position, `clip shape layer ${key} point ${k} position`) }
    })
    const ll = d.arr(L.lines, `clip shape layer ${key} lines`).map((y, k) => {
      const S = d.obj(y, `clip shape layer ${key} line ${k}`), id = d.str(S.id, `clip shape layer ${key} line ${k} id`)
      if (Object.hasOwn(S, 'stroke')) d.fail(`clip shape layer ${key} line ${id} holds a stroke (a clip from before shared strokes)`)
      return { id, ha: d.vec(S.ha, `clip shape layer ${key} line ${id} ha`), hb: d.vec(S.hb, `clip shape layer ${key} line ${id} hb`) }
    })
    d.unique(lp.map(p => p.id), `clip shape layer ${key} point`); d.unique(ll.map(l => l.id), `clip shape layer ${key} line`)
    if (lp.length !== pointIds.size || lp.some(p => !pointIds.has(p.id))) d.fail(`clip shape layer ${key} does not hold exactly the clip's points`)
    if (ll.length !== lineIds.size || ll.some(l => !lineIds.has(l.id))) d.fail(`clip shape layer ${key} does not hold exactly the clip's lines`)
    return { key, kind, points: lp, lines: ll }
  })
  d.unique(layers.map(L => L.key), 'clip shape layer')
  if (!layers.some(L => L.key === source)) d.fail(`the clip has no shape layer ${source}, its source`)
  const jo = d.obj(o.joins, 'clip joins')
  const rowsIn = (v: unknown, what: string) => d.arr(v, what)
  const rows = rowsIn(jo.rows, 'clip join rows').map((x, i) => {
    const R = d.obj(x, `clip join ${i}`), ls = d.arr(R.lines, `clip join ${i} lines`)
    const row = { point: d.str(R.point, `clip join ${i} point`), lines: [d.str(ls[0], `clip join ${i} line`), d.str(ls[1], `clip join ${i} line`)] as [Id, Id], mode: d.str(R.mode, `clip join ${i} mode`) as joins.JoinMode }
    if (row.mode !== 'bound' && row.mode !== 'smooth' && row.mode !== 'cusp' && row.mode !== 'arc') throw new Error(`Unknown join mode ${String(row.mode)}`)
    if (ls.length !== 2 || !pointIds.has(row.point) || !lineIds.has(row.lines[0]) || !lineIds.has(row.lines[1])) d.fail(`clip join ${i} points outside the clip`)
    // an arc's radius is one per join, in the row (bowen 1791985326); other joins have none
    // a manual zone is one per join too (bowen 1792057731)
    let zone: number | undefined
    if (Object.hasOwn(R, 'zone')) { zone = d.num(R.zone, `clip join ${i} zone`); if (!(zone > 0)) d.fail(`clip join ${i} has a zone that is not above zero`) }
    const z = zone !== undefined ? { zone } : {}
    if (row.mode !== 'arc') { if (Object.hasOwn(R, 'radius')) d.fail(`clip join ${i} is not an arc but has a radius`); return { ...row, ...z } }
    const radius = d.num(R.radius, `clip join ${i} radius`)
    if (!(radius > 0)) d.fail(`clip join ${i} has a radius that is not above zero`)
    return { ...row, radius, ...z }
  })
  // the points' end strokes, one per point for every view; a clip with per-layer join data is from before shared strokes
  if (Object.hasOwn(jo, 'layers')) d.fail('the clip holds zones and end strokes per layer (a clip from before shared strokes)')
  const endStrokes = d.arr(jo.endStrokes, 'clip end strokes').map((y, k) => {
    const E = d.obj(y, `clip end stroke ${k}`), point = d.str(E.point, `clip end stroke ${k} point`)
    if (!pointIds.has(point)) d.fail(`clip end stroke ${k} points outside the clip`)
    return { point, stroke: d.obj(E.stroke, `clip end stroke ${k} stroke`) as joins.EndStroke }
  })
  const fillsData = d.arr(o.fills, 'clip fills').map((x, i) => {
    const F = d.obj(x, `clip fill ${i}`), ls = d.arr(F.lines, `clip fill ${i} lines`).map((l, k) => d.str(l, `clip fill ${i} line ${k}`))
    if (!ls.length || ls.some(l => !lineIds.has(l))) d.fail(`clip fill ${i} points outside the clip`)
    return { id: d.str(F.id, `clip fill ${i} id`), lines: ls, color: d.str(F.color, `clip fill ${i} colour`), visible: d.bool(F.visible, `clip fill ${i} visible`), locked: d.bool(F.locked, `clip fill ${i} locked`) }
  })
  const nm = d.obj(o.names, 'clip names')
  const lineNames = d.arr(nm.lines, 'clip line names').map((x, i): [Id, string] => {
    const e = d.arr(x, `clip line name ${i}`), id = d.str(e[0], `clip line name ${i} id`)
    if (!lineIds.has(id)) d.fail(`clip line name ${i} points outside the clip`)
    return [id, d.str(e[1], `clip line name ${i}`)]
  })
  const groupNames = d.arr(nm.groups, 'clip group names').map((x, i) => {
    const G = d.obj(x, `clip group name ${i}`), ls = d.arr(G.lines, `clip group name ${i} lines`).map((l, k) => d.str(l, `clip group name ${i} line ${k}`))
    if (!ls.length || ls.some(l => !lineIds.has(l))) d.fail(`clip group name ${i} points outside the clip`)
    return { name: d.str(G.name, `clip group name ${i}`), lines: ls }
  })
  // the responses part, when present, is checked in full and returned; a bad one refuses the
  // paste, never read as "no responses" (dot 1791689360)
  let responses: animation.ResponsesData | undefined
  if (Object.hasOwn(o, 'animation')) {
    try { responses = animation.checkResponses(o.animation, pointIds, lineIds, 'clip responses') }
    catch (err) { throw new net.Refusal('clip-invalid', `clip-invalid: ${(err as Error).message}`) }
  }
  // the masks, when present: every reference inside the clip, else the paste is refused
  const maskData = o.masks === undefined ? undefined : masks.checkData(o.masks, lineIds, new Set(fillsData.map(f => f.id)), 'clip masks')
  const boneData = o.bones === undefined ? undefined : bones.checkClip(o.bones, lineIds, 'clip bones')
  return { network: { points, lines, source, layers }, joins: { rows, endStrokes }, fills: fillsData, names: { lines: lineNames, groups: groupNames }, ...(maskData ? { masks: maskData } : {}), ...(responses ? { animation: responses } : {}), ...(boneData ? { bones: boneData } : {}) }
}

/**
 * The clip's lines and points in `layer`, moved by `offset`, with new ids from `idOf`.
 * Run inside a topology step; joins, fills and names follow with `attach` after it, when
 * the new lines have their groups.
 */
/**
 * The correspondence a paste uses (dot 1791652760): each view layer of the drawing takes
 * the clip's view layer of the same key. A non-view layer whose owner declared copyNew
 * (stage 2: the angle baseline) takes the clip's layer of the same key and kind, else the
 * clip's front, so its baseline starts equal to the front. Any other layer, or a view the
 * clip lacks, has none, and the paste is refused.
 */
export function viewLayerMap(d: Parts, clip: Clip): Map<string, string> {
  const inClip = new Map(clip.network.layers.map(L => [L.key, L.kind]))
  const out = new Map<string, string>()
  for (const l of net.shapeLayers(d.network)) {
    if (l.kind === 'view') { if (inClip.get(l.key) === 'view') out.set(l.key, l.key); continue }
    if (!l.copyNew) continue
    if (inClip.get(l.key) === l.kind) out.set(l.key, l.key)
    else if (inClip.get(views.FRONT) === 'view') out.set(l.key, views.FRONT)
  }
  return out
}
/**
 * A paste needs a correspondence both ways: every drawing layer has a clip layer
 * (network checks it), and every clip layer is used — a clip layer left over (an
 * expression or record layer, or a view the drawing lacks) is refused, never dropped
 * (dot 1791653018).
 */
export function insert(d: Parts, ch: net.Changes, clip: Clip, layer: Id, offset: { x: number; y: number }, idOf: (old: Id) => Id): { map: net.CopyMap; layers: Map<string, string> } {
  const layers = viewLayerMap(d, clip), used = new Set(layers.values())
  // every clip layer is used: a target layer that maps to it by its own key (a view, or an owned record layer)
  const left = clip.network.layers.filter(L => !used.has(L.key)).map(L => L.key)
  if (left.length) throw new net.Refusal('paste-layer-unmatched', `paste-layer-unmatched: the copy's shape layer(s) ${left.join(', ')} have no place in this drawing`)
  return { map: net.insertLines(d.network, ch, clip.network, layer, idOf, offset, layers), layers }
}
/** Joins, fills, masks and names after `insert`, with the same layer correspondence (dot 1791654260). */
export function attach(d: Parts, clip: Clip, map: net.CopyMap, idOf: (old: Id) => Id, layers: ReadonlyMap<string, string>) {
  joins.insert(d.joins, d.network, clip.joins, map)
  const fillMap = fills.insert(d.fills, d.network, clip.fills, map, idOf)
  // after the fills, with their old → new ids (dot 1791903786)
  if (clip.masks) masks.insert(d.masks, clip.masks, map.lines, fillMap, idOf)
  names.copyFrom(d.names, d.network, d.groups, map.lines, clip.names)
  // bones keep their mark; attachments come with their bones, based on the pasted shapes (nothing moves)
  if (clip.bones) bones.insert(d.bones, net.of(d.network, views.FRONT), clip.bones, map.lines)
  // corrections are never pasted: the copy blends linearly until corrected (bowen 1791993536)
}
