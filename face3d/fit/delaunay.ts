// Incremental Delaunay triangles (Bowyer–Watson) over points with whole-number coordinates (the incircle test stays exact), each
// triangle holding the items that lie in it — face3d/fit/contour-adaptive.ts adds keyframes one at a time and re-scores only the
// views of the triangles each one replaced; the viewer rebuilds the triangles from the keyframes.
export type Pt = [number, number]
type Tri = { v: [number, number, number]; items: number[]; alive: boolean }
const orient = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
/** > 0 when d is strictly inside the circle through the counter-clockwise a, b, c */
function incircle(a: Pt, b: Pt, c: Pt, d: Pt) {
  const r = [a, b, c].map(p => [p[0] - d[0], p[1] - d[1], (p[0] - d[0]) ** 2 + (p[1] - d[1]) ** 2])
  return r[0]![0]! * (r[1]![1]! * r[2]![2]! - r[2]![1]! * r[1]![2]!) - r[0]![1]! * (r[1]![0]! * r[2]![2]! - r[2]![0]! * r[1]![2]!) + r[0]![2]! * (r[1]![0]! * r[2]![1]! - r[2]![0]! * r[1]![1]!)
}
/** the barycentric weights of q in triangle a, b, c */
export function bary(a: Pt, b: Pt, c: Pt, q: Pt): [number, number, number] {
  const d = orient(a, b, c), w1 = orient(a, q, c) / d, w2 = orient(a, b, q) / d
  return [1 - w1 - w2, w1, w2]
}
/** the triangles of a rectangle given as its four corners (counter-clockwise), with points added one by one */
export function delaunay(corners: Pt[]) {
  const pts = [...corners], tris: Tri[] = []
  const add = (a: number, b: number, c: number, items: number[] = []) => { if (orient(pts[a]!, pts[b]!, pts[c]!) < 0) [b, c] = [c, b]; const t: Tri = { v: [a, b, c], items, alive: true }; tris.push(t); return t }
  add(0, 1, 2); add(0, 2, 3)
  let pos: (item: number) => Pt = () => [0, 0]
  const inside = (t: Tri, q: Pt) => { const w = bary(pts[t.v[0]]!, pts[t.v[1]]!, pts[t.v[2]]!, q); return w.every(x => x >= -1e-9) }
  const out = (ts: Tri[]) => ts.map(t => [t.v, t.items] as [[number, number, number], number[]])
  return {
    pts,
    /** put the items in the triangles (pos = an item's place); returns each triangle with its items */
    assign(items: number[], p: (item: number) => Pt) { pos = p; const live = tris.filter(t => t.alive); for (const it of items) live.find(t => inside(t, pos(it)))!.items.push(it); return out(live) },
    /** add a point; returns the new triangles with their items */
    insert(q: Pt) {
      const i = pts.push(q) - 1, bad = tris.filter(t => t.alive && (incircle(pts[t.v[0]]!, pts[t.v[1]]!, pts[t.v[2]]!, q) > 0 || inside(t, q)))
      const edges = new Map<string, [number, number]>()
      for (const t of bad) { t.alive = false; for (let k = 0; k < 3; k++) { const a = t.v[k]!, b = t.v[(k + 1) % 3]!, key = a < b ? `${a},${b}` : `${b},${a}`; if (edges.has(key)) edges.delete(key); else edges.set(key, [a, b]) } }
      const made = [...edges.values()].filter(([a, b]) => orient(pts[a]!, pts[b]!, q) !== 0).map(([a, b]) => add(a, b, i))
      for (const it of bad.flatMap(t => t.items)) (made.find(t => inside(t, pos(it))) ?? made[0]!).items.push(it)
      for (const t of bad) t.items = []
      return out(made)
    },
    views: () => tris.filter(t => t.alive).map(t => t.items),
    triangles: () => tris.filter(t => t.alive).map(t => t.v),
  }
}
