import {hasEvaluatedDeformation,appendEvaluatedDeformation} from './evaluatedDeformation';
import {createFittedGeometryProjector} from './cageGeometry';
import {copyCurveSource} from './curveProvenance';
import type {DrawingDocument,Point2,Cubic} from './model';
import {evaluatedAffine,evaluatedAffineSource,registerEvaluatedAffine,type EvaluatedAffine} from './evaluatedAffine';
import {scaleEvaluatedDisplayRouteBrush} from './displayRouteBrush';
import {affine2DMaxScale,applyAffine2D,applyAffine2DVector,identityAffine2D,isIdentityAffine2D,type Affine2D} from '../geometry/affine2d';

/** One affine application for evaluated Drawing geometry and derived material.
 * Actual point/handle coordinates are transient; nonuniform/reflected/singular
 * ARC geometry keeps its pre-affine material source. Ink widths stay fixed.
 * Owned-program replay retains source material units even for a similarity. */
export function placeDrawingAffines(before:DrawingDocument,matrices:Record<string,Affine2D>,owner:(objectId:string)=>string|undefined,options:{retainMaterial?:boolean}={}):DrawingDocument {
 const identity=identityAffine2D(),value=(id:string)=>matrices[owner(id)??'']??identity,active=(id:string)=>!isIdentityAffine2D(value(id));
 if(!Object.values(matrices).some(matrix=>!isIdentityAffine2D(matrix)))return before;
 const point=(id:string,p:Point2):Point2=>{const result=applyAffine2D(value(id),p);if(!result.every(Number.isFinite))throw Error('The layer affine produces non-finite geometry.');return result;};
 const similarity=(id:string)=>{const [a,b,c,d]=value(id);return !options.retainMaterial&&active(id)&&a===d&&b===-c&&Math.hypot(a,b)>0&&!evaluatedAffine(before,id)&&!hasEvaluatedDeformation(before);};
 const drawing:DrawingDocument={...before,
  nodes:before.nodes.map(node=>active(node.id)?{...node,position:point(node.id,node.position)}:node),
  curves:before.curves.map(curve=>active(curve.id)?{...curve,handles:curve.handles.map(p=>point(curve.id,p)) as [Point2,Point2]}:curve),
  offsets:before.offsets.map(offset=>offset.translation&&active(offset.id)?{...offset,translation:applyAffine2DVector(value(offset.id),offset.translation)}:offset),
  joins:before.joins.map(join=>join.radius!==undefined&&similarity(join.a.curveId)?{...join,radius:join.radius*affine2DMaxScale(value(join.a.curveId))}:join),
  endpointLinks:before.endpointLinks?.map(link=>link.joinBrush?.kind==='ARC'&&similarity(link.a.curveId)?{...link,joinBrush:scaleEvaluatedDisplayRouteBrush(link.joinBrush,affine2DMaxScale(value(link.a.curveId)))}:link),
 };
 if(hasEvaluatedDeformation(before)||options.retainMaterial){
  const groups=new Map<string,{matrix:Affine2D;ids:Set<string>}>();
  for(const curve of before.curves)if(active(curve.id)){const matrix=value(curve.id),key=JSON.stringify(matrix);let group=groups.get(key);if(!group){group={matrix,ids:new Set()};groups.set(key,group);}group.ids.add(curve.id);}
  // Each new program must start from its own pre-affine controls. Another
  // layer's retained program does not make an untouched curve's already-placed
  // controls a material source. Advance groups in order so later new programs
  // also see their original input, while earlier programs stay registered.
  let placed=before;
  for(const [key,{matrix,ids}] of groups){
   const next:DrawingDocument={...placed,nodes:placed.nodes.map(node=>active(node.id)&&JSON.stringify(value(node.id))===key?{...node,position:point(node.id,node.position)}:node),curves:placed.curves.map(curve=>ids.has(curve.id)?{...curve,handles:curve.handles.map(p=>point(curve.id,p)) as [Point2,Point2]}:curve),offsets:drawing.offsets};
   const fit=(shape:Cubic)=>({shape:copyCurveSource(shape,shape.map(p=>applyAffine2D(matrix,p)) as Cubic),parameters:{values:Array.from({length:129},(_,i)=>i/128)},maxError:0}),projector=createFittedGeometryProjector(piece=>fit(piece.shape),fit);
   placed=appendEvaluatedDeformation(next,placed,ids,projector,`affine:${key}`,new Map(),{kind:'affine',matrix});
  }
  return {...placed,offsets:drawing.offsets};
 }
 const affines=new Map<string,EvaluatedAffine>();
 for(const object of [...before.nodes,...before.curves,...before.fills,...before.offsets]){
  const prior=evaluatedAffine(before,object.id),matrix=value(object.id);if(!prior&&(!active(object.id)||similarity(object.id)))continue;
  affines.set(object.id,{point:p=>applyAffine2D(matrix,prior?prior.point(p):p),maxScale:affine2DMaxScale(matrix)*(prior?.maxScale??1)});
 }
 if(affines.size)registerEvaluatedAffine(drawing,evaluatedAffineSource(before)??before,id=>affines.get(id));return drawing;
}
export function drawingLayerObjectOwners(drawing:DrawingDocument):Map<string,string> {
 const owners=new Map(drawing.layers.flatMap(layer=>layer.items.map(id=>[id,layer.id] as const)));for(const curve of drawing.curves)for(const node of curve.nodes)owners.set(node,owners.get(curve.id)!);return owners;
}
