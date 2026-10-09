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
