import type {Cubic,DrawingDocument as Doc,Point2} from './model';
import {copyCurveSource} from './curveProvenance';
import type {arcField} from './sampling';

/** Runtime-only geometry placement. Authored Drawing JSON never contains this
 * adapter: an evaluated document still exposes its placed nodes and handles. */
export interface EvaluatedAffine {
 point:(point:Point2)=>Point2;
 /** Largest singular value, used only to refine display sampling. */
 maxScale:number;
}
interface Evaluation {source:Doc;forObject:(id:string)=>EvaluatedAffine|undefined;sources:WeakMap<Doc,Doc>}
// Visibility and synthetic display-join clones preserve the node array. Geometry
// edits create a new one, so they cannot accidentally reuse an old placement.
const evaluations=new WeakMap<Doc['nodes'],Evaluation>();
export function registerEvaluatedAffine(drawing:Doc,source:Doc,forObject:Evaluation['forObject']):void {
 evaluations.set(drawing.nodes,{source,forObject,sources:new WeakMap()});
}
export function evaluatedAffine(drawing:Doc,id:string|undefined):EvaluatedAffine|undefined {
 return id===undefined?undefined:evaluations.get(drawing.nodes)?.forObject(id);
}
/** Retain the caller's current visibility, material and synthetic joins while
 * restoring only geometry that has a deferred derived-geometry placement. */
export function evaluatedAffineSource(drawing:Doc):Doc|undefined {
 const evaluation=evaluations.get(drawing.nodes);if(!evaluation)return undefined;
 const cached=evaluation.sources.get(drawing);if(cached)return cached;
 const nodes=new Map(evaluation.source.nodes.map(n=>[n.id,n])),curves=new Map(evaluation.source.curves.map(c=>[c.id,c]));
 const source:Doc={...drawing,
  nodes:drawing.nodes.map(n=>evaluation.forObject(n.id)?nodes.get(n.id)??n:n),
  curves:drawing.curves.map(c=>evaluation.forObject(c.id)&&curves.has(c.id)?{...c,handles:curves.get(c.id)!.handles}:c),
 };
 evaluation.sources.set(drawing,source);return source;
}
export function affineShape(shape:Cubic,affine:EvaluatedAffine):Cubic {
 return copyCurveSource(shape,shape.map(affine.point) as Cubic);
}
export function affineGeometry<T extends {shapes:Cubic[];pieces:Array<{shape:Cubic}>}>(geometry:T,affine:EvaluatedAffine):T {
 const pieces=geometry.pieces.map(piece=>({...piece,shape:affineShape(piece.shape,affine)}));
 return {...geometry,pieces,shapes:pieces.map(piece=>piece.shape)};
}
/** Display coordinates follow placement while the field retains its original
 * material coordinates. This remains defined when placement collapses an axis. */
export function affineMaterialField<T extends ReturnType<typeof arcField>>(field:T,affine:EvaluatedAffine):T {
 const sample=<Q extends {p:Point2}>(q:Q):Q=>({...q,p:affine.point(q.p)});
 return {...field,parts:field.parts.map(part=>({...part,shape:affineShape(part.shape,affine),pts:part.pts.map(sample),renderSamples:(quality?:Parameters<typeof part.renderSamples>[0])=>part.renderSamples(quality).map(sample)})),at:(s:number)=>{
  const q=field.at(s),p=affine.point(q.p),tip=affine.point([q.p[0]+q.tangent[0],q.p[1]+q.tangent[1]]),v:Point2=[tip[0]-p[0],tip[1]-p[1]],length=Math.hypot(...v);
  return {...q,p,shape:affineShape(q.shape,affine),tangent:[v[0]/(length||1),v[1]/(length||1)] as Point2};
 }};
}
