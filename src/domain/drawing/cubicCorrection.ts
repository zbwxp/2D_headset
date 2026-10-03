import {curveSamples,curveSampleDerivatives,mapCurveSource} from './curveProvenance';
import {createFittedGeometryProjector,type FittedGeometry,type GeometryFit} from './cageGeometry';
import {deriveSmoothComponents,projectSmoothComponent} from '../recordingSnapshot/smoothComponent';
import {fitCubicTarget,sourceParameter,sourceParameterSlope} from '../deformation/cubicDeformation';
import {derivative} from '../geometry/bezier';
import {point} from './sampling';
import {shapeOf,add,sub,mul,length,type Cubic,type Point2,type DrawingDocument} from './model';

/** Sparse control edits already resolved by applyDrawingShapeValue. Their
 * cubic displacement follows the retained material provenance on derived ARC
 * and route pieces; it never turns a deformed ARC back into a round join. */
export function createCubicCorrectionProjector(before:DrawingDocument,after:DrawingDocument,controlParameter:(id:string,t:number)=>number,controlSlope:(id:string,t:number)=>number,tolerance=.00004){
 const deltas=new Map<string,Cubic>(),old=new Map<string,Cubic>(),next=new Map<string,Cubic>();
 for(const curve of before.curves){if(!after.curves.some(value=>value.id===curve.id))continue;const a=shapeOf(before,curve.id),b=shapeOf(after,curve.id),delta=a.map((p,i)=>sub(b[i],p)) as Cubic;if(delta.some(p=>p.some(n=>n!==0))){deltas.set(curve.id,delta);old.set(curve.id,a);next.set(curve.id,b);}}
 const active=(shape:Cubic)=>[0,.5,1].some(t=>curveSamples(shape,t).some(sample=>deltas.has(sample.id)));
 const cache=new WeakMap<Cubic,ReturnType<typeof fitCubicTarget>>();
 const exact=(shape:Cubic)=>{
  for(const id of new Set(curveSamples(shape,.5).map(sample=>sample.id))){const a=old.get(id),b=next.get(id);if(!a||!b)continue;
   if(shape.every((p,i)=>p.every((v,axis)=>v===a[i][axis])))return b;
   if(shape.every((p,i)=>p.every((v,axis)=>v===a[3-i][axis])))return [...b].reverse() as Cubic;
  }
  return undefined;
 };
 const fit=(shape:Cubic,rays?:[Point2|undefined,Point2|undefined])=>{
  let found=rays?undefined:cache.get(shape);if(found)return found;
  const target=(t:number)=>curveSamples(shape,t).reduce((p,sample)=>{const delta=deltas.get(sample.id);return delta?add(p,mul(point(delta,controlParameter(sample.id,sample.t)),sample.weight)):p;},point(shape,t));
  const handle=(end:0|1):Point2=>{
   const v=derivative(shape.map(([x,y])=>[x,y,0]),end);let tangent:Point2=[v[0],v[1]];
   for(const sample of curveSampleDerivatives(shape,end)){const delta=deltas.get(sample.id);if(!delta)continue;const t=controlParameter(sample.id,sample.t),slope=controlSlope(sample.id,sample.t),p=point(delta,t),d=derivative(delta.map(([x,y])=>[x,y,0]),t);
    tangent=add(tangent,add(mul([d[0],d[1]],slope*sample.tDerivative*sample.weight),mul(p,sample.weightDerivative)));
   }
   return mul(tangent,end?-1/3:1/3);
  };
  const result=fitCubicTarget({point:target,handles:[rays?.[0]??handle(0),rays?.[1]??handle(1)],exactShape:rays?undefined:exact(shape)}),parameters=result.parameters;
  found={...result,shape:mapCurveSource(shape,result.shape.map(p=>[...p]) as Cubic,t=>sourceParameter(t,parameters),t=>sourceParameterSlope(t,parameters))};if(!rays)cache.set(shape,found);return found;
 };
 // ARC endpoint tangency is a relation constraint. The bridge's smoothstep
 // material weights transport positions, but do not encode its endpoint rays.
 // Resolve those rays with the same directed SMOOTH law, then refit the material
 // displacement target using the common fitter and its measured error.
 const refine=(geometry:FittedGeometry,fits:(GeometryFit|undefined)[])=>{
  const rays=new Map<number,[Point2|undefined,Point2|undefined]>(),bridge=(i:number)=>!!geometry.pieces[i].joinId||geometry.pieces[i].owners.length>1;
  const shape=(i:number)=>fits[i]?.shape??geometry.shapes[i];
  const constrain=(driver:number,driverEnd:0|1,follower:number,followerEnd:0|1)=>{
   if(!fits[follower]||!bridge(follower))return;
   const a=shape(driver),b=shape(follower),node=a[driverEnd?3:0],other=b[followerEnd?3:0];if(length(sub(node,other))>1e-7)return;
   const component=deriveSmoothComponents([{id:'derived-arc',a:{curveId:'driver',end:driverEnd},b:{curveId:'follower',end:followerEnd}}])[0];
   const projected=projectSmoothComponent(component,[{node,handle:a[driverEnd?2:1]},{node:other,handle:b[followerEnd?2:1]}]);
   const pair=rays.get(follower)??[undefined,undefined];pair[followerEnd]=projected.controls[1].vector;rays.set(follower,pair);
  };
  for(let i=0;i<geometry.pieces.length;i++){
   const j=(i+1)%geometry.pieces.length;
   if(bridge(j))constrain(i,1,j,0);
   else if(bridge(i))constrain(j,0,i,1);
  }
  return fits.map((value,i)=>rays.has(i)?fit(geometry.shapes[i],rays.get(i)):value);
 };
 return {...createFittedGeometryProjector(piece=>{
  if(!piece.owners.some(id=>deltas.has(id)))return undefined;
  if(!active(piece.shape))throw Error('The derived piece has no material provenance for this sparse control edit.');
  return fit(piece.shape);
 },fit,tolerance,refine),curveIds:new Set(deltas.keys())};
}
