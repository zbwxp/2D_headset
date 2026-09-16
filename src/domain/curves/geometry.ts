import {isAnalytic,isSection} from './model';
import {symmetryNormal,mirrorPoint,mirrorVector} from '../head/frame';
import {dirtyDescendants} from "../geometry/dependencies";
import {evaluationContext,pointPosition} from "../geometry/evaluation";
import {
  add,
  sub,
  scale,
  dot,
  cross,
  normalize,
  basis,
  project,
} from "../geometry/core";
import {
  mirror,
  type LandmarkProject,
  type LandmarkView,
} from "../landmarks/model";
import type { Vec2, Vec3 } from "../project/types";
import type { CurveEdge, CanonicalCurve, PlanarShape } from "./model";
export const CURVE_EPS = 1e-8;
export type ControlPoints = [Vec3, Vec3, Vec3, Vec3];
const axes: Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
export function perpendicular(d: Vec3, candidates: Vec3[] = []): Vec3 {
  for (const v of [
    ...candidates,
    ...[...axes].sort((a, b) => Math.abs(dot(a, d)) - Math.abs(dot(b, d))),
  ]) {
    const n = sub(v, scale(d, dot(v, d)));
    if (Math.hypot(...n) > CURVE_EPS) return normalize(n);
  }
  return [1, 0, 0];
}
export function defaultNormal(d: Vec3, v: LandmarkView): Vec3 {
  const { forward, up, right } = basis(v);
  return perpendicular(d, [forward, up, right]);
}
export function canonical(p: LandmarkProject, c: CurveEdge): CanonicalCurve {
  if(isAnalytic(c))throw Error('Section 不使用 Bézier shape');
  return (
    c.role === "canonical"
      ? c
      : p.curves.find((x) => x.id === c.canonicalCurveId)
  ) as CanonicalCurve;
}
export function endpoints(p: LandmarkProject, c: CurveEdge): [Vec3, Vec3] {
  if(isSection(c))throw Error('闭合 Section 没有端点');
  return [
    pointPosition(p,c.startLandmarkId),
    pointPosition(p,c.endLandmarkId),
  ];
}
export function isCenterCurve(p: LandmarkProject, c: CurveEdge): boolean {
  return [c.startLandmarkId, c.endLandmarkId].every(
    (id) => p.landmarks.find((l) => l.id === id)?.type === "CENTERLINE",
  );
}
export function frame(p: LandmarkProject, c: CanonicalCurve) {
  const [a, z] = endpoints(p, c),
    chord = sub(z, a),
    length = Math.hypot(...chord);
  const d = normalize(chord),
    n = c.shape.planeNormal,
    b = normalize(cross(n, d));
  return { a, z, d, n, b, length };
}
export function controls(p:LandmarkProject,c:CurveEdge,context=evaluationContext(p)):ControlPoints {
  return context.curveControls(c.id);
}
export function bezier(c: ControlPoints, t: number): Vec3 {
  const u = 1 - t;
  return add(
    add(scale(c[0], u * u * u), scale(c[1], 3 * u * u * t)),
    add(scale(c[2], 3 * u * t * t), scale(c[3], t * t * t)),
  );
}
export function sampleCurve(
  p: LandmarkProject,
  c: CurveEdge,
  segments = 64,
): Vec3[] {
  return evaluationContext(p).curve(c.id).sample(segments);
}
export function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  return add(
    add(scale(v, Math.cos(angle)), scale(cross(axis, v), Math.sin(angle))),
    scale(axis, dot(axis, v) * (1 - Math.cos(angle))),
  );
}
export function transportNormal(n: Vec3, oldD: Vec3, newD: Vec3): Vec3 {
  const c = Math.max(-1, Math.min(1, dot(oldD, newD))),
    v = cross(oldD, newD),
    sin = Math.hypot(...v);
  let result: Vec3;
  if (sin > 1e-10) result = rotate(n, scale(v, 1 / sin), Math.atan2(sin, c));
  else if (c < 0) result = rotate(n, perpendicular(oldD, [n]), Math.PI);
  else result = n;
  // Roundoff cleanup only; transport above is the shortest-arc rotation.
  return perpendicular(newD, [result]);
}
export function followEndpoints(
  old: LandmarkProject,
  next: LandmarkProject,
): LandmarkProject {
  let result=next;
  for(const key of dirtyDescendants(old,next).order){
    if(!key.startsWith('curve:'))continue;
    const id=key.slice(6),c=result.curves.find(c=>c.id===id)!;
    if(c.role!=='canonical'||isAnalytic(c))continue;
    const oldCurve=old.curves.find(x=>x.id===id);if(!oldCurve||oldCurve.role!=='canonical'||isAnalytic(oldCurve))continue;
    const [a,b]=endpoints(old,oldCurve),[an,bn]=endpoints(result,c),oldChord=sub(b,a),newChord=sub(bn,an);
    const moved=!a.every((v,i)=>v===an[i])||!b.every((v,i)=>v===bn[i]);
    let n=c.shape.planeNormal;
    if(moved){n=oldCurve.shape.planeNormal;
      if(isCenterCurve(result,c))n=symmetryNormal(result);
      else if(Math.hypot(...newChord)>0)n=Math.hypot(...oldChord)>0?transportNormal(n,normalize(oldChord),normalize(newChord)):perpendicular(normalize(newChord),[n]);
    }
    if(!moved)continue;
    result={...result,curves:result.curves.map(x=>x.id===id?{...c,shape:{...c.shape,planeNormal:n}}:x)};
  }
  return result;
}
export function nearestParameter(
  cp: ControlPoints,
  v: LandmarkView,
  q: Vec2,
): number {
  const dist = (t: number) => {
    const x = project(bezier(cp, t), v);
    return (x[0] - q[0]) ** 2 + (x[1] - q[1]) ** 2;
  };
  let best = 0;
  for (let i = 1; i <= 128; i++) if (dist(i / 128) < dist(best)) best = i / 128;
  let lo = Math.max(0, best - 1 / 128),
    hi = Math.min(1, best + 1 / 128);
  for (let i = 0; i < 24; i++) {
    const a = lo + (hi - lo) / 3,
      b = hi - (hi - lo) / 3;
    if (dist(a) < dist(b)) hi = b;
    else lo = a;
  }
  return Math.max(0.05, Math.min(0.95, (lo + hi) / 2));
}
export function planeTarget(
  p: LandmarkProject,
  c: CurveEdge,
  v: LandmarkView,
  q: Vec2,
): Vec3 | null {
  const base = canonical(p, c),
    f = frame(p, base);
  if (f.length < CURVE_EPS) return null;
  const a = c.role === "mirror" ? mirrorPoint(p,f.a) : f.a,
    n = c.role === "mirror" ? mirrorVector(p,f.n) : f.n;
  const { right, up, forward } = basis(v),
    denominator = dot(forward, n);
  if (Math.abs(denominator) < 1e-5) return null;
  const origin = add(v.camera.target, add(scale(right, q[0]), scale(up, q[1])));
  const target = add(
    origin,
    scale(forward, dot(sub(a, origin), n) / denominator),
  );
  return c.role === "mirror" ? mirrorPoint(p,target) : target;
}
export function bodyShape(
  p: LandmarkProject,
  c: CanonicalCurve,
  t: number,
  target: Vec3,
): PlanarShape {
  const f = frame(p, c);
  if (f.length < CURVE_EPS) return c.shape;
  t = Math.max(0.05, Math.min(0.95, t));
  const delta = dot(sub(target, bezier(controls(p, c), t)), f.b) / f.length;
  const w1 = 3 * (1 - t) ** 2 * t,
    w2 = 3 * (1 - t) * t * t,
    den = w1 * w1 + w2 * w2;
  return {
    ...c.shape,
    startHandle: {
      ...c.shape.startHandle,
      offset: c.shape.startHandle.offset + (w1 / den) * delta,
    },
    endHandle: {
      ...c.shape.endHandle,
      offset: c.shape.endHandle.offset + (w2 / den) * delta,
    },
  };
}
export function handleShape(
  p: LandmarkProject,
  c: CanonicalCurve,
  index: 1 | 2,
  target: Vec3,
): PlanarShape {
  const { a, z, d, b, length: L } = frame(p, c);
  if (L < CURVE_EPS) return c.shape;
  const along = dot(index === 1 ? sub(target, a) : sub(z, target), d) / L,
    offset = dot(sub(target, a), b) / L;
  return {
    ...c.shape,
    [index === 1 ? "startHandle" : "endHandle"]: {
      along: Math.max(0, Math.min(1, along)),
      offset,
    },
  };
}
