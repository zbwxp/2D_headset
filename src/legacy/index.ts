// legacy — opening drawings saved in older formats (bowen 1791820592, dot 1791820713): this one module turns a version
// 5–12 document into version 13; the archive's normal reader then takes it. Nothing else in the program knows an old
// format. For a release that drops old files: delete this folder and its one call in src/archive/index.ts.
// The conversions, each approved by bowen: 5 → 6 (1791726456), 6 → 7 (1791808493), 7 / 8 → 9 (1791820592); 9 → 10 (1791907933) only adds an empty mask list (docs/mask-p2-checklist.md §3); 10 → 11 (1791976935) changes nothing (11 only allows playback pictures); 11 → 12 (1791985326) keeps one arc radius per join, the front's; 12 → 13 changes nothing (13 only adds the optional left layer order).
import * as net from '../network'
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

/** An old document as version 13, or a refusal for a version that cannot be read. */
export function upgrade(version: unknown, doc: unknown): unknown {
  if (version === 5) return fromV12(fromV11(fromV10(fromV9(fromV8(fromV6(fromV5(doc)))))))
  if (version === 6) return fromV12(fromV11(fromV10(fromV9(fromV8(fromV6(doc))))))
  if (version === 7 || version === 8) return fromV12(fromV11(fromV10(fromV9(fromV8(doc)))))
  if (version === 9) return fromV12(fromV11(fromV10(fromV9(doc))))
  if (version === 10) return fromV12(fromV11(fromV10(doc)))
  if (version === 11) return fromV12(fromV11(doc))
  if (version === 12) return fromV12(doc)
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

