// legacy — opening drawings saved in older formats (bowen 1791820592, dot 1791820713): this one module turns a version
// 5–13 document into version 14; the archive's normal reader then takes it. Nothing else in the program knows an old
// format. For a release that drops old files: delete this folder and its one call in src/archive/index.ts.
// The conversions, each approved by bowen: 5 → 6 (1791726456), 6 → 7 (1791808493), 7 / 8 → 9 (1791820592); 9 → 10 (1791907933) only adds an empty mask list (docs/mask-p2-checklist.md §3); 10 → 11 (1791976935) changes nothing (11 only allows playback pictures); 11 → 12 (1791985326) keeps one arc radius per join, the front's; 12 → 13 changes nothing (13 only adds the optional left layer order); 13 → 14 (1792057731, 旧稿按照0，0 的为准) keeps one value per meta-curve for every stroke value, the front's.
import * as net from '../network'
import * as joins from '../joins'
import * as reference from '../reference'

/** A version 9 drawing as version 10: no masks (docs/mask-p2-checklist.md §3); everything else as stored. */
export function fromV9(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('open-failed: the document must be an object')
  return { ...(doc as object), masks: { masks: [] } }
}

/** A version 10 drawing as version 11: as stored (11 only adds playback pictures; docs/playback-edit-checklist.md §5). */
export function fromV10(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('open-failed: the document must be an object')
  return doc
}

/**
 * A version 11 drawing as version 12 (docs/arc-radius-shared-checklist.md §4; bowen 1791985326): an arc's radius
 * becomes one value of its join row, the front view's (`view:0,0`). First every shape layer's radii are checked as
 * the version 11 reader checked them — every arc row has one in every layer, none belongs to anything else, each a
 * finite number above zero — so invalid old data refuses the file instead of being dropped (dot 1791985599); a
 * missing front value is refused, never defaulted. Then the layers' radii go. Malformed structure is left as it is,
 * to be refused by importState as for any file.
 */
export function fromV11(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return doc
  const d = doc as { network?: { shapes?: { layers?: unknown } }; joins?: { rows?: unknown } }
  const nw = d.network, jo = d.joins
  if (!nw || !nw.shapes || !Array.isArray(nw.shapes.layers) || !jo || !Array.isArray(jo.rows)) return doc
  const fail = (why: string): never => { throw new Error(`open-failed: ${why}`) }
  const rows = jo.rows as Record<string, unknown>[]
  const keyOf = (r: Record<string, unknown>) => JSON.stringify([r.point, ...(Array.isArray(r.lines) ? r.lines : [])])
  // a version 11 row held no radius (v11 refused it as an extra value): one there is not taken over the front's
  rows.forEach((r, i) => { if (r && typeof r === 'object' && Object.hasOwn(r, 'radius')) fail(`join ${i} carries an extra value`) })
  const arcKeys = new Set(rows.filter(r => r && typeof r === 'object' && r.mode === 'arc').map(keyOf))
  const layers = nw.shapes.layers as Record<string, unknown>[]
  for (const L of layers) {
    if (!L || typeof L !== 'object') continue // refused by the reader as for any file
    const R = L.radius
    if (!R || typeof R !== 'object' || Array.isArray(R)) fail(`shape layer ${String(L.key)} radius is not an object`)
    const own = R as Record<string, unknown>
    for (const k of arcKeys) if (!Object.hasOwn(own, k)) fail(`arc join ${k} has no radius in ${String(L.key)}`)
    for (const [k, v] of Object.entries(own)) {
      if (!arcKeys.has(k)) fail(`radius ${k} in ${String(L.key)} belongs to no arc join`)
      if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) fail(`radius ${k} in ${String(L.key)} is not a finite number above zero`)
    }
  }
  const front = layers.find(L => L && typeof L === 'object' && L.key === 'view:0,0')
  if (arcKeys.size && !front) fail('there is no front view (view:0,0) to take the arc radii from')
  const frontRadius = (front?.radius ?? {}) as Record<string, number>
  return {
    ...d,
    network: { ...nw, shapes: { ...nw.shapes, layers: layers.map(L => { if (!L || typeof L !== 'object') return L; const { radius: _, ...rest } = L; return rest }) } },
    joins: { ...jo, rows: rows.map(r => (r && typeof r === 'object' && r.mode === 'arc' ? { ...r, radius: frontRadius[keyOf(r)] } : r)) },
  }
}

/** A version 12 drawing as version 13: as stored (13 only adds the optional left layer order). */
export function fromV12(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('open-failed: the document must be an object')
  return doc
}

/**
 * A version 13 drawing as version 14 (docs/shared-strokes-checklist.md §4; bowen 1792057731, "旧稿按照0，0 的为准"):
 * every stroke value becomes one per meta-curve, the front view's (`view:0,0`) — a point's width, a line's profile,
 * a join's manual zone (none in the front: automatic) and a point's end stroke (none in the front: none). First every
 * shape layer, views, expression and record layers alike, is checked as the version 13 reader checked it — a width
 * for every point and nothing else, finite and above zero; a profile, text, for every line and nothing else in its
 * stroke; zones only under existing rows, finite and above zero; end strokes only on existing points, in their
 * stored form — so invalid old data refuses the file instead of being dropped with the side values (dot 1791985599,
 * dot after 9c7cf05). A missing front is refused, never defaulted. Then the layers keep only positions and handles.
 * Malformed structure is left as it is, to be refused by importState as for any file.
 */
export function fromV13(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return doc
  type O = Record<string, unknown>
  const d = doc as { network?: { points?: unknown; lines?: unknown; shapes?: { layers?: unknown } }; joins?: { rows?: unknown } }
  const nw = d.network, jo = d.joins
  if (!nw || !Array.isArray(nw.points) || !Array.isArray(nw.lines) || !nw.shapes || !Array.isArray(nw.shapes.layers) || !jo || !Array.isArray(jo.rows)) return doc
  const fail = (why: string): never => { throw new Error(`open-failed: ${why}`) }
  const isObj = (v: unknown): v is O => !!v && typeof v === 'object' && !Array.isArray(v)
  const points = nw.points as O[], lines = nw.lines as O[], rows = jo.rows as O[]
  const pointIds = points.filter(isObj).map(p => p.id), lineIds = lines.filter(isObj).map(l => l.id)
  // a version 13 point, line, row or joins held no stroke value (v13 refused them as extra values): none is taken over the front's
  points.forEach((p, i) => { if (isObj(p) && Object.hasOwn(p, 'width')) fail(`point ${i} carries an extra value`) })
  lines.forEach((l, i) => { if (isObj(l) && Object.hasOwn(l, 'stroke')) fail(`line ${i} carries an extra value`) })
  rows.forEach((r, i) => { if (isObj(r) && Object.hasOwn(r, 'zone')) fail(`join ${i} carries an extra value`) })
  if (Object.hasOwn(jo, 'ends')) fail('joins carry an extra value')
  const keyOf = (r: O) => JSON.stringify([r.point, ...(Array.isArray(r.lines) ? r.lines : [])])
  const rowKeys = new Set(rows.filter(isObj).map(keyOf)), pointSet = new Set(pointIds)
  const layers = nw.shapes.layers as O[]
  for (const L of layers) {
    if (!isObj(L)) continue // refused by the reader as for any file
    const at = String(L.key)
    const W = L.widths, Ls = L.lines, Z = L.zone, E = L.end
    if (!isObj(W)) fail(`shape layer ${at} widths is not an object`)
    if (!isObj(Ls)) fail(`shape layer ${at} lines is not an object`)
    if (!isObj(Z)) fail(`shape layer ${at} zone is not an object`)
    if (!isObj(E)) fail(`shape layer ${at} end strokes is not an object`)
    const w = W as O, ls = Ls as O, z = Z as O, e = E as O
    for (const id of pointIds) {
      if (!Object.hasOwn(w, String(id))) fail(`shape layer ${at} has no width for point ${String(id)}`)
      const v = w[String(id)]
      if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) fail(`point ${String(id)} has a width that is not a finite number above zero in ${at}`)
    }
    if (Object.keys(w).length !== pointIds.length) fail(`shape layer ${at} has widths for points that do not exist`)
    for (const id of lineIds) {
      const s = ls[String(id)]
      if (!isObj(s)) continue // refused by the reader (no shape for the line)
      const k = s.stroke
      if (!isObj(k) || typeof k.profile !== 'string') fail(`line ${String(id)} stroke profile in ${at} is not text`)
      if (Object.keys(k as O).length !== 1) fail(`line ${String(id)} stroke in ${at} holds more than its profile (widths belong to points)`)
    }
    for (const [k, v] of Object.entries(z)) {
      if (!rowKeys.has(k)) fail(`zone ${k} in ${at} belongs to no join`)
      if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) fail(`zone ${k} in ${at} is not a finite number above zero`)
    }
    for (const [p, v] of Object.entries(e)) {
      if (!pointSet.has(p)) fail(`end stroke in ${at} is on a missing point ${p}`)
      if (!isObj(v)) fail(`end stroke ${p} in ${at} is not an object`)
      let kept: unknown
      try { kept = joins.endIn(v as joins.EndStrokeIn) } catch (err) { fail(`end stroke ${p} in ${at}: ${(err as Error).message}`) }
      if (JSON.stringify(kept) !== JSON.stringify(v)) fail(`end stroke ${p} in ${at} is not in its stored form`)
    }
  }
  const front = layers.find(L => isObj(L) && L.key === 'view:0,0')
  if (!front) fail('there is no front view (view:0,0) to take the strokes from')
  const fw = front!.widths as O, fl = front!.lines as O, fz = front!.zone as O, fe = front!.end as O
  const own = (r: O, k: string) => (Object.hasOwn(r, k) ? r[k] : undefined)
  return {
    ...d,
    network: {
      ...nw,
      points: points.map(p => (isObj(p) ? { ...p, width: own(fw, String(p.id)) } : p)),
      lines: lines.map(l => { if (!isObj(l)) return l; const s = own(fl, String(l.id)); return isObj(s) && isObj(s.stroke) ? { ...l, stroke: { ...s.stroke } } : l }),
      shapes: {
        ...nw.shapes,
        layers: layers.map(L => {
          if (!isObj(L)) return L
          const { widths: _w, zone: _z, end: _e, ...rest } = L
          const ls = isObj(L.lines) ? Object.fromEntries(Object.entries(L.lines).map(([id, s]) => { if (!isObj(s)) return [id, s]; const { stroke: _s, ...shape } = s; return [id, shape] })) : L.lines
          return { ...rest, lines: ls }
        }),
      },
    },
    joins: {
      ...jo,
      rows: rows.map(r => { if (!isObj(r)) return r; const v = own(fz, keyOf(r)); return v === undefined ? r : { ...r, zone: v } }),
      ends: { ...fe },
    },
  }
}

/** An old document as version 14, or a refusal for a version that cannot be read. */
export function upgrade(version: unknown, doc: unknown): unknown {
  if (version === 5) return fromV13(fromV12(fromV11(fromV10(fromV9(fromV8(fromV6(fromV5(doc))))))))
  if (version === 6) return fromV13(fromV12(fromV11(fromV10(fromV9(fromV8(fromV6(doc)))))))
  if (version === 7 || version === 8) return fromV13(fromV12(fromV11(fromV10(fromV9(fromV8(doc))))))
  if (version === 9) return fromV13(fromV12(fromV11(fromV10(fromV9(doc)))))
  if (version === 10) return fromV13(fromV12(fromV11(fromV10(doc))))
  if (version === 11) return fromV13(fromV12(fromV11(doc)))
  if (version === 12) return fromV13(fromV12(doc))
  if (version === 13) return fromV13(doc)
  throw new Error(`open-failed: unsupported version ${String(version)}`)
}

const refuse = (code: string, why: string): never => { throw new net.Refusal(code, `${code}: ${why}`) }
const openFailed = (f: () => void) => { try { f() } catch (err) { const m = (err as Error).message; throw new Error(m.startsWith('open-failed') ? m : `open-failed: reference: ${m}`) } }

/**
 * The one conversion, version 5 → 6 (bowen 1791726456: this once): every image checked as version 5 checked
 * it, then its inline picture moved into the library — identical contents become one entry, named by the
 * first image's id, with its size as the default — and the image names it by `asset`, keeping its own size,
 * placement, `flipped` and slots. Plain data in, plain data out; `restore` checks the result.
 */
function referenceFromV5(v: unknown): { images: unknown[]; library: reference.Asset[] } {
  const images = (v as { images?: unknown } | null)?.images
  if (!Array.isArray(images)) throw new Error('open-failed: reference: images must be a list')
  const s = reference.create()
  for (let k = 0; k < images.length; k++) openFailed(() => {
    if (!Object.hasOwn(images, k)) throw new Error(`image ${k} is missing`)
    const i = images[k] as Record<string, unknown> | null
    if (i && typeof i === 'object' && Object.hasOwn(i, 'asset')) refuse('reference-bad-value', 'a version-5 image holds its picture inline')
    reference.place(s, i)
  })
  // the reference state is plain data (the document exports it as it is)
  const plain = structuredClone(s) as unknown as { images: unknown[]; library: reference.Asset[] }
  return { images: plain.images, library: plain.library }
}

/**
 * Version 5's document with its reference pictures converted to the library form (the one conversion, for
 * version 5 only; bowen 1791726456). Nothing else differs between 5 and 6; `importState` checks the result.
 */
export function fromV5(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return doc
  const d = doc as Record<string, unknown>
  if (!d.reference || typeof d.reference !== 'object') return doc // missing: refused by importState as for any file
  return { ...d, reference: referenceFromV5(d.reference) }
}

/**
 * Format 6 → 7 (docs/ink-joins-principle.md §2.6, bowen 1791808493): binding becomes a join, so a
 * point carrying exactly two line ends and no join gets a 'bound' join — what the two lines were
 * (仅绑定) before; a fork gets none; each shape layer gains an empty zone table (every zone
 * automatic). Only for a version-6 file: a version-7 drawing is opened as stored.
 */
export function fromV6(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return doc
  const d = doc as { network?: { lines?: unknown }; joins?: { rows?: unknown } }
  if (!d.network || !Array.isArray(d.network.lines) || !d.joins || !Array.isArray(d.joins.rows)) return doc // refused by importState as for any file
  const ends = new Map<string, string[]>()
  for (const l of d.network.lines as { id?: unknown; a?: unknown; b?: unknown }[]) {
    for (const p of [l.a, l.b]) if (typeof p === 'string' && typeof l.id === 'string') ends.set(p, [...(ends.get(p) ?? []), l.id])
  }
  // the shape layers gain the per-view zone table (empty: every join's zone automatic)
  const net6 = d.network as { shapes?: { layers?: unknown } }
  const network = net6.shapes && Array.isArray(net6.shapes.layers)
    ? { ...d.network, shapes: { ...net6.shapes, layers: (net6.shapes.layers as Record<string, unknown>[]).map(L => (L && typeof L === 'object' && !('zone' in L) ? { ...L, zone: {} } : L)) } }
    : d.network
  const joined = new Set((d.joins.rows as { point?: unknown }[]).map(r => r.point))
  const added = [...ends].filter(([p, ls]) => ls.length === 2 && ls[0] !== ls[1] && !joined.has(p))
    .map(([point, ls]) => ({ point, lines: ls[0]! < ls[1]! ? [ls[0], ls[1]] : [ls[1], ls[0]], mode: 'bound' }))
  return { ...d, network, joins: { ...d.joins, rows: [...(d.joins.rows as unknown[]), ...added] } }
}

/**
 * A version 8 (or 7) drawing as version 9 (docs/point-widths-checklist.md, bowen 1791820396 — widths belong to points):
 * in every shape layer each point gets a width — the largest width any line had at that point there (`width` at its a
 * end, `widthB ?? width` at its b end), 1 for a point with no line — and the lines keep only their profile. Anything
 * malformed is left as it is, to be refused by importState as for any file.
 */
export function fromV8(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return doc
  const d = doc as { network?: { points?: unknown; lines?: unknown; shapes?: { layers?: unknown } } }
  const nw = d.network
  if (!nw || !Array.isArray(nw.points) || !Array.isArray(nw.lines) || !nw.shapes || !Array.isArray(nw.shapes.layers)) return doc
  const lines = nw.lines as { id?: unknown; a?: unknown; b?: unknown }[], points = nw.points as { id?: unknown }[]
  const layers = (nw.shapes.layers as Record<string, unknown>[]).map(L => {
    if (!L || typeof L !== 'object' || !L.lines || typeof L.lines !== 'object') return L
    const Ls = L.lines as Record<string, { ha?: unknown; hb?: unknown; stroke?: { width?: unknown; widthB?: unknown; profile?: unknown } }>
    const widths: Record<string, number> = {}
    for (const p of points) if (typeof p.id === 'string') widths[p.id] = 1
    const seen = new Set<string>()
    // every old width checked as the version 8 reader checked it, before any is merged: a bad one refuses the file
    // instead of being covered by a neighbour's width or the default (dot 1791821589)
    const ok = (w: unknown) => typeof w === 'number' && Number.isFinite(w) && w > 0
    for (const [id, l] of Object.entries(Ls)) {
      const st = l && typeof l === 'object' ? l.stroke : undefined
      if (!st || typeof st !== 'object') continue // refused by the reader as for any file
      if (!ok(st.width)) throw new Error(`open-failed: line ${id} has a stroke width that is not a positive number in ${String(L.key)}`)
      if (st.widthB !== undefined && !ok(st.widthB)) throw new Error(`open-failed: line ${id} has a stroke end width that is not a positive number in ${String(L.key)}`)
    }
    for (const l of lines) {
      const st = typeof l.id === 'string' ? Ls[l.id]?.stroke : undefined
      if (!st || typeof st.width !== 'number') continue
      const at: [unknown, unknown][] = [[l.a, st.width], [l.b, typeof st.widthB === 'number' ? st.widthB : st.width]]
      for (const [p, w] of at) if (typeof p === 'string' && typeof w === 'number') { widths[p] = seen.has(p) ? Math.max(widths[p]!, w) : w; seen.add(p) }
    }
    const kept = Object.fromEntries(Object.entries(Ls).map(([id, l]) => [id, l && typeof l === 'object' && l.stroke && typeof l.stroke === 'object' ? { ...l, stroke: { profile: l.stroke.profile } } : l]))
    return { ...L, lines: kept, widths }
  })
  return { ...d, network: { ...nw, shapes: { ...nw.shapes, layers } } }
}

