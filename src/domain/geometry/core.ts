import type {
  Vec2,
  Vec3,
  Triangle,
  SurfaceState,
  ViewState,
} from "../project/types";
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const dot = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const scale = (a: Vec3, t: number): Vec3 => [
  a[0] * t,
  a[1] * t,
  a[2] * t,
];
export const normalize = (v: Vec3): Vec3 =>
  scale(v, 1 / (Math.hypot(...v) || 1));
export function basis(v: Pick<ViewState, "camera">) {
  const forward = normalize(sub(v.camera.position, v.camera.target));
  const right = normalize(cross(v.camera.up, forward));
  return { right, up: cross(forward, right), forward };
}
export function project(p: Vec3, v: Pick<ViewState, "camera">): Vec2 {
  const { right, up } = basis(v);
  const q = sub(p, v.camera.target);
  return [dot(q, right), dot(q, up)];
}
export function normals(vertices: Vec3[], faces: Triangle[]): Vec3[] {
  const ns: Vec3[] = vertices.map(() => [0, 0, 0]);
  for (const [a, b, c] of faces) {
    const n = cross(
      sub(vertices[b], vertices[a]),
      sub(vertices[c], vertices[a]),
    );
    for (const i of [a, b, c]) ns[i] = add(ns[i], n);
  }
  return ns.map(normalize);
}
export function adjacency(n: number, faces: Triangle[]) {
  const adj = Array.from({ length: n }, () => new Set<number>());
  for (const [a, b, c] of faces) {
    adj[a].add(b).add(c);
    adj[b].add(a).add(c);
    adj[c].add(a).add(b);
  }
  return adj.map((s) => [...s]);
}
export function ellipsoid(segments = 32, rows = 32): SurfaceState {
  const vertices: Vec3[] = [[0, 1.22, 0]];
  const faces: Triangle[] = [];
  for (let r = 1; r < rows; r++)
    for (let j = 0; j < segments; j++) {
      const t = (Math.PI * r) / rows,
        p = (2 * Math.PI * j) / segments;
      vertices.push([
        0.86 * Math.sin(t) * Math.cos(p),
        1.22 * Math.cos(t),
        0.94 * Math.sin(t) * Math.sin(p),
      ]);
    }
  const bottom = vertices.push([0, -1.22, 0]) - 1;
  const id = (r: number, j: number) =>
    1 + (r - 1) * segments + ((j + segments) % segments);
  for (let j = 0; j < segments; j++) {
    faces.push([0, id(1, j + 1), id(1, j)]);
    for (let r = 1; r < rows - 1; r++) {
      faces.push([id(r, j), id(r, j + 1), id(r + 1, j)]);
      faces.push([id(r, j + 1), id(r + 1, j + 1), id(r + 1, j)]);
    }
    faces.push([id(rows - 1, j), id(rows - 1, j + 1), bottom]);
  }
  const pairs: [number, number][] = [
    [0, 0],
    [bottom, bottom],
  ];
  for (let r = 1; r < rows; r++)
    for (let j = 0; j < segments; j++) {
      const m = (segments / 2 - j + segments) % segments;
      if (j <= m) pairs.push([id(r, j), id(r, m)]);
    }
  return {
    vertices,
    faces,
    normals: normals(vertices, faces),
    baseVertices: structuredClone(vertices),
    previousVertices: structuredClone(vertices),
    symmetryPairs: pairs,
    anchorVertexIds: [
      0,
      bottom,
      id(rows / 2, 0),
      id(rows / 2, segments / 2),
      id(rows - 2, segments / 4),
    ],
  };
}
export function silhouette(
  vertices: Vec3[],
  faces: Triangle[],
  view: ViewState,
): number[] {
  const { forward } = basis(view);
  const projected = vertices.map((v) => project(v, view));
  // Directed boundary of the front-facing triangle patch. Track EDGES rather
  // than visited vertices: tangent/saddle vertices can belong to several loops.
  const edges = new Map<
    string,
    { a: number; b: number; front: boolean; count: number }
  >();
  for (const [a, b, c] of faces) {
    const normal = cross(
      sub(vertices[b], vertices[a]),
      sub(vertices[c], vertices[a]),
    );
    const front = dot(normal, forward) > 1e-10 * Math.hypot(...normal);
    for (const [i, j] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      const old = edges.get(key);
      if (!old) edges.set(key, { a: i, b: j, front, count: 1 });
      else {
        old.count++;
        if (old.front === front) edges.delete(key);
        else if (front) {
          old.a = i;
          old.b = j;
          old.front = true;
        }
      }
    }
  }
  const boundary = [...edges.values()].filter((e) => e.front && e.count === 2);
  const outgoing = new Map<number, number[]>();
  boundary.forEach((e, i) =>
    outgoing.set(e.a, [...(outgoing.get(e.a) || []), i]),
  );
  const used = new Set<number>();
  let best: number[] = [],
    bestArea = 0;
  for (let seed = 0; seed < boundary.length; seed++) {
    if (used.has(seed)) continue;
    const chain: number[] = [];
    let edgeId = seed,
      closed = false;
    for (let step = 0; step <= boundary.length; step++) {
      if (used.has(edgeId)) break;
      used.add(edgeId);
      const edge = boundary[edgeId];
      chain.push(edge.a);
      if (edge.b === boundary[seed].a) {
        closed = true;
        break;
      }
      const choices = (outgoing.get(edge.b) || []).filter((i) => !used.has(i));
      if (!choices.length) break;
      const a = projected[edge.a],
        b = projected[edge.b];
      const incoming = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const turn = (i: number) => {
        const c = projected[boundary[i].b];
        let t = Math.atan2(c[1] - b[1], c[0] - b[0]) - incoming;
        while (t <= -Math.PI) t += 2 * Math.PI;
        while (t > Math.PI) t -= 2 * Math.PI;
        return t;
      };
      choices.sort((a, b) => turn(a) - turn(b));
      edgeId = choices[0];
    }
    // Never close an unfinished chain with an invented cross-head chord.
    if (!closed || chain.length < 3) continue;
    let area = 0;
    for (let i = 0; i < chain.length; i++) {
      const a = projected[chain[i]],
        b = projected[chain[(i + 1) % chain.length]];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area);
      best = area < 0 ? chain.reverse() : chain;
    }
  }
  if (best.length < 3) best = convexHull(projected);
  let top = 0;
  best.forEach((id, i) => {
    if (projected[id][1] > projected[best[top]][1] + 1e-10) top = i;
  });
  return [...best.slice(top), ...best.slice(0, top)];
}

function convexHull(points: Vec2[]) {
  const ids = points
    .map((_, i) => i)
    .sort((a, b) => points[a][0] - points[b][0] || points[a][1] - points[b][1]);
  const turn = (a: number, b: number, c: number) =>
    (points[b][0] - points[a][0]) * (points[c][1] - points[a][1]) -
    (points[b][1] - points[a][1]) * (points[c][0] - points[a][0]);
  const lower: number[] = [],
    upper: number[] = [];
  for (const id of ids) {
    while (lower.length > 1 && turn(lower.at(-2)!, lower.at(-1)!, id) <= 0)
      lower.pop();
    lower.push(id);
  }
  for (const id of ids.reverse()) {
    while (upper.length > 1 && turn(upper.at(-2)!, upper.at(-1)!, id) <= 0)
      upper.pop();
    upper.push(id);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
export function subdivide(vertices: Vec3[], faces: Triangle[]) {
  const output = vertices.map((v) => [...v] as Vec3);
  const mids = new Map<string, number>();
  const mid = (a: number, b: number) => {
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!mids.has(k))
      mids.set(k, output.push(scale(add(vertices[a], vertices[b]), 0.5)) - 1);
    return mids.get(k)!;
  };
  const triangles: Triangle[] = [];
  for (const [a, b, c] of faces) {
    const ab = mid(a, b),
      bc = mid(b, c),
      ca = mid(c, a);
    triangles.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
  }
  return { vertices: output, faces: triangles };
}
export function centroid(v: Vec3[]): Vec3 {
  return scale(v.reduce(add, [0, 0, 0]), 1 / v.length);
}
