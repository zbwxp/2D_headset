// clipboard — copy and paste (graph rows "Copy (layer, lines, groups)" and "Cut, paste /
// copy"; docs/clipboard-plan.md). A clip is plain data, outside the document and its
// history: lines with their end points, the joins, end strokes and fills inside the range,
// and the names. Endpoint links and mirror pairs are never part of it. Pasting writes the
// clip through each module's own insert, with new ids.
import * as net from '../network'
import * as groups from '../groups'
import * as joins from '../joins'
import * as fills from '../fills'
import * as names from '../names'

type Id = net.Id

export interface Clip {
  network: net.LinesData
  /** Join modes once; every shape layer's radii and end strokes (step 4). */
  joins: joins.RangeData
  fills: fills.FillData[]
  names: { lines: [Id, string][]; groups: { name: string; lines: Id[] }[] }
}

export interface Parts { network: net.NetworkState; groups: groups.GroupsState; joins: joins.JoinsState; fills: fills.FillsState; names: names.NamesState }

/** The range as a clip: these lines (read from `d`) and everything inside them. */
export function extract(d: Parts, lines: readonly Id[]): Clip {
  const ids = [...new Set(lines)]
  if (!ids.length) throw new net.Refusal('select-lines-to-copy', 'select-lines-to-copy: copy takes lines; select lines to copy')
  const network = net.linesData(d.network, ids)
  const lineSet = new Set(ids), pointSet = new Set(network.points.map(p => p.id))
  return structuredClone({
    network,
    joins: joins.rangeData(d.joins, d.network, lineSet, pointSet),
    fills: fills.rangeData(d.fills, lineSet),
    names: names.rangeData(d.names, d.groups, d.network, ids),
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
  const points = d.arr(nw.points, 'clip points').map((x, i) => { const P = d.obj(x, `clip point ${i}`); return { id: d.str(P.id, `clip point ${i} id`) } })
  d.unique(points.map(p => p.id), 'clip point')
  const pointIds = new Set(points.map(p => p.id))
  const lines = d.arr(nw.lines, 'clip lines').map((x, i) => {
    const L = d.obj(x, `clip line ${i}`), id = d.str(L.id, `clip line ${i} id`), a = d.str(L.a, `clip line ${id} a`), b = d.str(L.b, `clip line ${id} b`)
    if (!pointIds.has(a) || !pointIds.has(b) || a === b) d.fail(`clip line ${id} needs two of the clip's points`)
    const st = d.obj(L.state, `clip line ${id} state`)
    return { id, a, b, state: { visible: d.bool(st.visible, `clip line ${id} visible`), locked: d.bool(st.locked, `clip line ${id} locked`) } }
  })
  if (!lines.length) d.fail('the clip has no lines')
  d.unique(lines.map(l => l.id), 'clip line')
  const lineIds = new Set(lines.map(l => l.id))
  // every shape layer of the copied drawing: exactly the clip's points and lines (architecture §1)
  const source = d.str(nw.source, 'clip source layer')
  const layers = d.arr(nw.layers, 'clip shape layers').map((x, i) => {
    const L = d.obj(x, `clip shape layer ${i}`), key = d.str(L.key, `clip shape layer ${i} key`)
    const kind = d.str(L.kind, `clip shape layer ${key} kind`) as 'view' | 'expression' | 'record'
    if (!['view', 'expression', 'record'].includes(kind)) d.fail(`clip shape layer ${key} has an unknown kind`)
    const lp = d.arr(L.points, `clip shape layer ${key} points`).map((y, k) => { const P = d.obj(y, `clip shape layer ${key} point ${k}`); return { id: d.str(P.id, `clip shape layer ${key} point ${k} id`), position: d.vec(P.position, `clip shape layer ${key} point ${k} position`) } })
    const ll = d.arr(L.lines, `clip shape layer ${key} lines`).map((y, k) => {
      const S = d.obj(y, `clip shape layer ${key} line ${k}`), id = d.str(S.id, `clip shape layer ${key} line ${k} id`), sk = d.obj(S.stroke, `clip shape layer ${key} line ${id} stroke`)
      return { id, ha: d.vec(S.ha, `clip shape layer ${key} line ${id} ha`), hb: d.vec(S.hb, `clip shape layer ${key} line ${id} hb`), stroke: { width: d.num(sk.width, `clip shape layer ${key} line ${id} stroke width`), profile: d.str(sk.profile, `clip shape layer ${key} line ${id} stroke profile`) } }
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
    if (row.mode !== 'smooth' && row.mode !== 'cusp' && row.mode !== 'arc') throw new Error(`Unknown join mode ${String(row.mode)}`)
    if (ls.length !== 2 || !pointIds.has(row.point) || !lineIds.has(row.lines[0]) || !lineIds.has(row.lines[1])) d.fail(`clip join ${i} points outside the clip`)
    return row
  })
  // every shape layer of the copy carries its own radii and end strokes (dot 1791654154)
  const joinLayers = d.arr(jo.layers, 'clip join layers').map((x, i) => {
    const L = d.obj(x, `clip join layer ${i}`), key = d.str(L.key, `clip join layer ${i} key`)
    const radii = d.arr(L.radii, `clip radii in ${key}`).map((y, k) => {
      const R = d.obj(y, `clip radius ${k} in ${key}`), ls = d.arr(R.lines, `clip radius ${k} lines in ${key}`)
      const r = { point: d.str(R.point, `clip radius ${k} point in ${key}`), lines: [d.str(ls[0], `clip radius ${k} line in ${key}`), d.str(ls[1], `clip radius ${k} line in ${key}`)] as [Id, Id], radius: d.num(R.radius, `clip radius ${k} in ${key}`) }
      if (!rows.some(row => row.mode === 'arc' && row.point === r.point && row.lines[0] === r.lines[0] && row.lines[1] === r.lines[1])) d.fail(`clip radius ${k} in ${key} belongs to no arc join of the clip`)
      return r
    })
    const endStrokes = d.arr(L.endStrokes, `clip end strokes in ${key}`).map((y, k) => {
      const E = d.obj(y, `clip end stroke ${k} in ${key}`), point = d.str(E.point, `clip end stroke ${k} point in ${key}`)
      if (!pointIds.has(point)) d.fail(`clip end stroke ${k} in ${key} points outside the clip`)
      return { point, stroke: d.obj(E.stroke, `clip end stroke ${k} stroke in ${key}`) as joins.EndStroke }
    })
    return { key, radii, endStrokes }
  })
  if (JSON.stringify(joinLayers.map(L => L.key).sort()) !== JSON.stringify(layers.map(L => L.key).sort())) d.fail("the clip's join layers do not match its shape layers")
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
  return { network: { points, lines, source, layers }, joins: { rows, layers: joinLayers }, fills: fillsData, names: { lines: lineNames, groups: groupNames } }
}

/**
 * The clip's lines and points in `layer`, moved by `offset`, with new ids from `idOf`.
 * Run inside a topology step; joins, fills and names follow with `attach` after it, when
 * the new lines have their groups.
 */
/**
 * The correspondence a paste uses: each view layer of the drawing takes the clip's view
 * layer of the same key. Any other layer (expression, record), or a view layer the clip
 * lacks, has none (dot 1791652760); those owners decide their own mapping later.
 */
export function viewLayerMap(d: Parts, clip: Clip): Map<string, string> {
  const views = new Set(clip.network.layers.filter(L => L.kind === 'view').map(L => L.key))
  return new Map(net.shapeLayers(d.network).filter(l => l.kind === 'view' && views.has(l.key)).map(l => [l.key, l.key]))
}
/**
 * A paste needs a correspondence both ways: every drawing layer has a clip layer
 * (network checks it), and every clip layer is used — a clip layer left over (an
 * expression or record layer, or a view the drawing lacks) is refused, never dropped
 * (dot 1791653018).
 */
export function insert(d: Parts, ch: net.Changes, clip: Clip, layer: Id, offset: { x: number; y: number }, idOf: (old: Id) => Id): { map: net.CopyMap; layers: Map<string, string> } {
  const layers = viewLayerMap(d, clip), used = new Set(layers.values())
  const left = clip.network.layers.filter(L => !used.has(L.key)).map(L => L.key)
  if (left.length) throw new net.Refusal('paste-layer-unmatched', `paste-layer-unmatched: the copy's shape layer(s) ${left.join(', ')} have no place in this drawing`)
  return { map: net.insertLines(d.network, ch, clip.network, layer, idOf, offset, layers), layers }
}
/** Joins, fills and names after `insert`, with the same layer correspondence (dot 1791654260). */
export function attach(d: Parts, clip: Clip, map: net.CopyMap, idOf: (old: Id) => Id, layers: ReadonlyMap<string, string>) {
  joins.insert(d.joins, d.network, clip.joins, map, layers)
  fills.insert(d.fills, d.network, clip.fills, map, idOf)
  names.copyFrom(d.names, d.network, d.groups, map.lines, clip.names)
}
