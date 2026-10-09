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
  joins: { rows: joins.JoinRow[]; endStrokes: { point: Id; stroke: joins.EndStroke }[] }
  fills: fills.FillData[]
  names: { lines: [Id, string][]; groups: { name: string; lines: Id[] }[] }
}

export interface Parts { network: net.NetworkState; groups: groups.GroupsState; joins: joins.JoinsState; fills: fills.FillsState; names: names.NamesState }

/** The range as a clip: these lines (read from `d`) and everything inside them. */
export function extract(d: Parts, lines: readonly Id[]): Clip {
  const ids = [...new Set(lines)]
  if (!ids.length) throw new Error('select-lines-to-copy: copy takes lines; select lines to copy')
  const network = net.linesData(d.network, ids)
  const lineSet = new Set(ids), pointSet = new Set(network.points.map(p => p.id))
  return structuredClone({
    network,
    joins: joins.rangeData(d.joins, lineSet, pointSet),
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
  const points = d.arr(nw.points, 'clip points').map((x, i) => { const P = d.obj(x, `clip point ${i}`); return { id: d.str(P.id, `clip point ${i} id`), position: d.vec(P.position, `clip point ${i} position`) } })
  d.unique(points.map(p => p.id), 'clip point')
  const pointIds = new Set(points.map(p => p.id))
  const lines = d.arr(nw.lines, 'clip lines').map((x, i) => {
    const L = d.obj(x, `clip line ${i}`), id = d.str(L.id, `clip line ${i} id`), a = d.str(L.a, `clip line ${id} a`), b = d.str(L.b, `clip line ${id} b`)
    if (!pointIds.has(a) || !pointIds.has(b) || a === b) d.fail(`clip line ${id} needs two of the clip's points`)
    const st = d.obj(L.state, `clip line ${id} state`), sk = d.obj(L.stroke, `clip line ${id} stroke`)
    return {
      id, a, b, ha: d.vec(L.ha, `clip line ${id} ha`), hb: d.vec(L.hb, `clip line ${id} hb`),
      state: { visible: d.bool(st.visible, `clip line ${id} visible`), locked: d.bool(st.locked, `clip line ${id} locked`) },
      stroke: { width: d.num(sk.width, `clip line ${id} stroke width`), profile: d.str(sk.profile, `clip line ${id} stroke profile`) },
    }
  })
  if (!lines.length) d.fail('the clip has no lines')
  d.unique(lines.map(l => l.id), 'clip line')
  const lineIds = new Set(lines.map(l => l.id))
  const jo = d.obj(o.joins, 'clip joins')
  const rows = d.arr(jo.rows, 'clip join rows').map((x, i) => {
    const R = d.obj(x, `clip join ${i}`), ls = d.arr(R.lines, `clip join ${i} lines`)
    const row = { point: d.str(R.point, `clip join ${i} point`), lines: [d.str(ls[0], `clip join ${i} line`), d.str(ls[1], `clip join ${i} line`)] as [Id, Id], mode: d.str(R.mode, `clip join ${i} mode`) as joins.JoinMode, ...(R.radius !== undefined ? { radius: d.num(R.radius, `clip join ${i} radius`) } : {}) }
    if (ls.length !== 2 || !pointIds.has(row.point) || !lineIds.has(row.lines[0]) || !lineIds.has(row.lines[1])) d.fail(`clip join ${i} points outside the clip`)
    return row
  })
  const endStrokes = d.arr(jo.endStrokes, 'clip end strokes').map((x, i) => {
    const E = d.obj(x, `clip end stroke ${i}`), point = d.str(E.point, `clip end stroke ${i} point`)
    if (!pointIds.has(point)) d.fail(`clip end stroke ${i} points outside the clip`)
    return { point, stroke: d.obj(E.stroke, `clip end stroke ${i} stroke`) as joins.EndStroke }
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
  return { network: { points, lines }, joins: { rows, endStrokes }, fills: fillsData, names: { lines: lineNames, groups: groupNames } }
}

/**
 * The clip's lines and points in `layer`, moved by `offset`, with new ids from `idOf`.
 * Run inside a topology step; joins, fills and names follow with `attach` after it, when
 * the new lines have their groups.
 */
export function insert(d: Parts, clip: Clip, layer: Id, offset: { x: number; y: number }, idOf: (old: Id) => Id): net.CopyMap {
  return net.insertLines(d.network, clip.network, layer, idOf, offset)
}
export function attach(d: Parts, clip: Clip, map: net.CopyMap, idOf: (old: Id) => Id) {
  joins.insert(d.joins, d.network, clip.joins, map)
  fills.insert(d.fills, clip.fills, map, idOf)
  names.copyFrom(d.names, d.network, d.groups, map.lines, clip.names)
}
