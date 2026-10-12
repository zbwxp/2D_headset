// Test helper: an old file of a drawing written today. Versions 5–8 stored a line's widths on the line (`width` at its
// a end, `widthB` at its b end); version 9 stores them on the points (bowen 1791820396). `widthsOnLines` puts a parsed
// version 9 document's widths back on its lines and drops the points' widths, as those versions wrote them.
export function widthsOnLines(f: { document: { network: { lines: { id: string; a: string; b: string }[]; shapes: { layers: { widths?: Record<string, number>; lines: Record<string, { stroke: Record<string, unknown> }> }[] } } } }) {
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
