// Test helper: an old file of a drawing written today. Versions 5–8 stored a line's widths on the line (`width` at its
// a end, `widthB` at its b end); version 9 stores them on the points (bowen 1791820396). `widthsOnLines` puts a parsed
// version 9 document's widths back on its lines and drops the points' widths, as those versions wrote them (and, as
// every version before 12, with `radiiPerView`).
export function widthsOnLines(f: { document: { network: { lines: { id: string; a: string; b: string }[]; shapes: { layers: { widths?: Record<string, number>; lines: Record<string, { stroke: Record<string, unknown> }> }[] } } } }) {
  radiiPerView(f)
  for (const L of f.document.network.shapes.layers) {
    const w = L.widths!
    for (const l of f.document.network.lines) {
      const s = L.lines[l.id]!.stroke
      L.lines[l.id]!.stroke = { width: w[l.a], ...(w[l.b] !== w[l.a] ? { widthB: w[l.b] } : {}), profile: s.profile }
    }
    delete L.widths
  }
  return f
}

/**
 * Versions 5–11 stored an arc's radius in every shape layer (`radius`, keyed by the join row); version 12 stores one
 * per join row (bowen 1791985326). `radiiPerView` puts a parsed version 12 document's row radii into every layer, the
 * same value in each, and drops them from the rows, as those versions wrote them.
 */
type ArcDoc = { document: { network: { shapes: { layers: { radius?: Record<string, number> }[] } }; joins: { rows: { point: string; lines: string[]; mode: string; radius?: number }[] } } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function radiiPerView<T>(parsed: T): T {
  const f = parsed as unknown as ArcDoc
  const radii = Object.fromEntries(f.document.joins.rows.filter(r => r.mode === 'arc').map(r => [JSON.stringify([r.point, ...r.lines]), r.radius!]))
  for (const L of f.document.network.shapes.layers) L.radius = { ...radii }
  for (const r of f.document.joins.rows) delete r.radius
  return parsed
}
