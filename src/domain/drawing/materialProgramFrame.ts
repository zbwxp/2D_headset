import type {DrawingDocument,Point2,CurveUse,Endpoint,InkEnds} from './model';
import type {MaterialReflectionFrame} from './materialProgram';
import {evaluatedDeformationSource,remapEvaluatedDeformations} from './evaluatedDeformation';
import {evaluatedAffine,evaluatedAffineSource,registerEvaluatedAffine} from './evaluatedAffine';
import {intervalPinch,withIntervalPinch} from './intervalPinch';

/** Change only the fitting frame of owned material. IDs stay owned by the
 * caller; parity changes endpoint addresses, never membership or curve order.
 * This involution does not infer mirror partners or create source geometry. */
export function reflectMaterialProgramFrame(input:DrawingDocument,frame:MaterialReflectionFrame):DrawingDocument {
 const reversed=new Set(frame.reverseCurveIds),reverse=(id:string)=>reversed.has(id),point=([x,y]:Point2):Point2=>[2*frame.axisX-x,y],end=(id:string,value:0|1):0|1=>reverse(id)?value===0?1:0:value;
 const use=(value:CurveUse):CurveUse=>({...value,reverse:value.reverse!==reverse(value.id)}),endpoint=(value:Endpoint):Endpoint=>({...value,end:end(value.curveId,value.end)});
 const result:DrawingDocument={...input,
  nodes:input.nodes.map(node=>({...node,position:point(node.position)})),
  curves:input.curves.map(curve=>{const order=reverse(curve.id)?[1,0] as const:[0,1] as const;return {...curve,nodes:order.map(i=>curve.nodes[i]) as [string,string],handles:order.map(i=>point(curve.handles[i])) as [Point2,Point2],...(curve.inkEnds?{inkEnds:order.map(i=>curve.inkEnds![i]) as InkEnds}:{})};}),
  fills:input.fills.map(fill=>({...fill,boundary:fill.boundary.map(use)})),
  offsets:input.offsets.map(offset=>({...offset,source:offset.source.map(use),distance:-offset.distance,...(offset.translation?{translation:[-offset.translation[0],offset.translation[1]] as Point2}:{})})),
  joins:input.joins.map(join=>({...join,a:endpoint(join.a),b:endpoint(join.b)})),
  endpointLinks:input.endpointLinks?.map(link=>({...link,a:endpoint(link.a),b:endpoint(link.b)})),
  displayIntervals:input.displayIntervals?.map(track=>({...track,anchor:use(track.anchor),...(track.revealFrom!==undefined?{revealFrom:end(track.anchor.id,track.revealFrom)}:{}),...(track.displayRoute?{displayRoute:{...track.displayRoute,seed:{...track.displayRoute.seed,segments:track.displayRoute.seed.segments.map(use)}}}:{}),ranges:track.ranges.map(range=>withIntervalPinch({...range},intervalPinch(range)))})),
 };
 const material=evaluatedDeformationSource(input),identity=(id:string)=>id;
 if(material)remapEvaluatedDeformations(result,input,reflectMaterialProgramFrame(material,frame),identity,identity,{point,reverse,key:JSON.stringify(['owned-material-frame',frame]),frame});
 const affineMaterial=evaluatedAffineSource(input);
 if(affineMaterial){const source=reflectMaterialProgramFrame(affineMaterial,frame);registerEvaluatedAffine(result,source,id=>{const affine=evaluatedAffine(input,id);return affine?{point:p=>point(affine.point(point(p))),maxScale:affine.maxScale}:undefined;});}
 return result;
}
