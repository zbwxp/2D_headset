// name-labels — which names to show beside the selection (bowen 1791731823; docs/name-labels-plan.md):
// line names, one per selected line at its middle; or curve names, one per continuous curve touched, at
// the middle of its middle line (stored order, index ⌊(n − 1) / 2⌋). Plain data in, plain data out; the
// app records the kind and draws. No imports.

export type Kind = 'line' | 'curve'
export interface Vec { readonly x: number; readonly y: number }
/** A line as drawn in the view: its id, name and the middle of its curve. */
export interface LineInfo { readonly id: string; readonly name: string; readonly mid: Vec }
/** A continuous curve: its id, name and lines in stored order. */
export interface CurveInfo { readonly id: string; readonly name: string; readonly lines: readonly string[] }
export interface Label { readonly key: string; readonly text: string; readonly at: Vec }

export function labelsFor(lines: readonly LineInfo[], curves: readonly CurveInfo[], selected: readonly string[], kind: Kind): Label[] {
  const byId = new Map(lines.map(l => [l.id, l]))
  const chosen = new Set(selected.filter(id => byId.has(id))) // an id with no line drawn here is ignored
  if (kind === 'line') return [...chosen].map(id => { const l = byId.get(id)!; return { key: `line:${id}`, text: l.name, at: l.mid } })
  const out: Label[] = []
  for (const c of curves) {
    if (!c.lines.some(id => chosen.has(id))) continue
    const middle = byId.get(c.lines[Math.floor((c.lines.length - 1) / 2)]!)
    if (middle) out.push({ key: `curve:${c.id}`, text: c.name, at: middle.mid })
  }
  return out
}

/** The middle of a cubic Bézier (t = ½). */
export const middleOf = (c: readonly Vec[]): Vec => ({ x: (c[0]!.x + 3 * c[1]!.x + 3 * c[2]!.x + c[3]!.x) / 8, y: (c[0]!.y + 3 * c[1]!.y + 3 * c[2]!.y + c[3]!.y) / 8 })
