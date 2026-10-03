import {blendWarpGrids} from '../vectorWarp/model';
import {bracket,clampAngle,latticeWeights,sameAngle,type Angle} from '../vectorRecording/interpolation';
import {blendIntervalOverrides,missingCornerIntervals} from '../vectorRecording/intervals';
import type {DrawingDocument,StrokeDisplayIntervals,Point2} from '../drawing/model';
import {identityScenePlacement,identitySceneShape,type SceneShapeTrack,type SceneShapeValue,type SceneTrack,type SceneWarp,type SceneVisibilityTrack,type SceneDepthTrack,type SceneIntervalTrack,type SceneIntervalValue,type ScenePlacementTrack,type ScenePlacementValue} from './model';

interface Sample<T> {value:T;weight:number}
/** Optional scalar response over one existing interpolation bracket. */
export type SceneProgressMapper=(start:Angle,end:Angle,progress:number)=>number;
const strongest=<T>(samples:Sample<T>[]):T=>samples.reduce((a,b)=>b.weight>a.weight?b:a).value;
/** Independent tracks use only their own coordinate axes plus a neutral origin.
 * Legacy tracks preserve the original virtual -90/0/90 lattice explicitly. */
function weights<T>(track:SceneTrack<T>,angle:Angle,mapProgress?:SceneProgressMapper){
 if(track.interpolation==='legacy'&&!mapProgress)return latticeWeights(track.keys.map(k=>k.angle),angle);
 const axes=track.interpolation==='legacy'?[-90,0,90]:[0];
 const [x0,x1,xt]=bracket([...axes,...track.keys.map(k=>k.angle.x)],clampAngle(angle.x)),[y0,y1,yt]=bracket([...axes,...track.keys.map(k=>k.angle.y)],clampAngle(angle.y));
 const x=mapProgress?mapProgress({x:x0,y:angle.y},{x:x1,y:angle.y},xt):xt,y=mapProgress?mapProgress({x:angle.x,y:y0},{x:angle.x,y:y1},yt):yt;
 return [{angle:{x:x0,y:y0},weight:(1-x)*(1-y)},{angle:{x:x1,y:y0},weight:x*(1-y)},{angle:{x:x0,y:y1},weight:(1-x)*y},{angle:{x:x1,y:y1},weight:x*y}].filter(s=>s.weight>0);
}
function evaluate<T>(track:SceneTrack<T>,angle:Angle,base:T,mix:(s:Sample<T>[])=>T,corner:(neutral:T,x:T,y:T,angle:Angle)=>T,useDraft=true,mapProgress?:SceneProgressMapper):T {
 const at={x:clampAngle(angle.x),y:clampAngle(angle.y)};
 if(useDraft&&track.draft&&sameAngle(track.draft.angle,at))return track.draft.value;
 const exact=track.keys.find(k=>sameAngle(k.angle,at));if(exact)return exact.value;
 if(!track.keys.length)return base;
 const neutralKey=track.keys.find(k=>sameAngle(k.angle,{x:0,y:0})),neutral=neutralKey?neutralKey.value:base;
 const axis=(axis:'x'|'y',value:number):T=>{
  const keys=track.keys.filter(k=>k.angle[axis==='x'?'y':'x']===0);
  if(!keys.length)return neutral;
  const coordinates=keys.map(k=>k.angle[axis]);if(track.interpolation!=='legacy')coordinates.push(0);
  const [lo,hi,raw]=bracket(coordinates,value),start={x:0,y:0,...{[axis]:lo}},end={x:0,y:0,...{[axis]:hi}},t=mapProgress?mapProgress(start,end,raw):raw,ka=keys.find(k=>k.angle[axis]===lo),kb=keys.find(k=>k.angle[axis]===hi),a=ka?ka.value:neutral,b=kb?kb.value:neutral;
  return mix([{value:a,weight:1-t},{value:b,weight:t}]);
 };
 const sample=(a:Angle)=>{const key=track.keys.find(k=>sameAngle(k.angle,a));return key?key.value:corner(neutral,axis('x',a.x),axis('y',a.y),a);};
 return mix(weights(track,at,mapProgress).map(s=>({value:sample(s.angle),weight:s.weight})));
}
export function evaluateWarpTrack(track:SceneWarp,angle:Angle,useDraft=true,mapProgress?:SceneProgressMapper){
 const mix=(samples:Sample<SceneWarp['restGrid']>[])=>blendWarpGrids(samples.map(s=>({grid:s.value,weight:s.weight})));
 return evaluate(track,angle,track.restGrid,mix,(n,x,y)=>blendWarpGrids([{grid:x,weight:1},{grid:y,weight:1},{grid:n,weight:-1}]),useDraft,mapProgress);
}
/** Null is source inheritance, not hidden. State uses the greatest corner weight;
 * ties follow the stable lower-X/lower-Y corner order. */
export function evaluateVisibilityTrack(track:SceneVisibilityTrack,angle:Angle,useDraft=true):boolean|null {
 return evaluate(track,angle,null,strongest,(n,x,y,a)=>track.interpolation==='legacy'?(y??x??n):x===n?y:y===n?x:Math.abs(a.y)>Math.abs(a.x)?y:x,useDraft);
}
export function evaluateDepthTrack(track:SceneDepthTrack,angle:Angle,useDraft=true):number {
 return evaluate(track,angle,0,s=>s.reduce((n,x)=>n+x.weight*x.value,0),(n,x,y)=>x+y-n,useDraft);
}
/** Scalar channels retain authored turns (0→360 really makes one revolution).
 * Axis scales interpolate through exact zero. Legacy uniform values retain
 * their original representation and interpolation. */
export function evaluatePlacementTrack(track:ScenePlacementTrack,angle:Angle,useDraft=true,mapProgress?:SceneProgressMapper):ScenePlacementValue {
 const mix=(samples:Sample<ScenePlacementValue>[]):ScenePlacementValue=>{
  const value=samples.reduce<ScenePlacementValue>((v,s)=>({translation:[v.translation[0]+s.weight*s.value.translation[0],v.translation[1]+s.weight*s.value.translation[1]],rotation:v.rotation+s.weight*s.value.rotation,scale:v.scale+s.weight*s.value.scale}),{translation:[0,0],rotation:0,scale:0});
  for(const axis of ['scaleX','scaleY'] as const)if(samples.some(s=>s.value[axis]!==undefined))value[axis]=samples.reduce((n,s)=>n+s.weight*(s.value[axis]??s.value.scale),0);
  return value;
 };
 return evaluate(track,angle,identityScenePlacement(),mix,(n,x,y)=>{
  const value:ScenePlacementValue={translation:[x.translation[0]+y.translation[0]-n.translation[0],x.translation[1]+y.translation[1]-n.translation[1]],rotation:x.rotation+y.rotation-n.rotation,scale:Math.max(1e-6,Math.min(1e6,x.scale*y.scale/n.scale))};
  for(const axis of ['scaleX','scaleY'] as const)if([n,x,y].some(v=>v[axis]!==undefined)){
   const nv=n[axis]??n.scale,xv=x[axis]??x.scale,yv=y[axis]??y.scale;
   // A collapsed neutral axis has no multiplicative reference. Add authored
   // corrections instead, so its saved neighbours can restore real geometry.
   value[axis]=Math.max(0,Math.min(1e6,nv===0?xv+yv:xv*yv/nv));
  }
  return value;
 },useDraft,mapProgress);
}
/** SVG affine ordering: x'=a*x+c*y+e, y'=b*x+d*y+f. */
export type ScenePlacementMatrix=[number,number,number,number,number,number];
export const scenePlacementScales=(value:ScenePlacementValue):Point2=>[value.scaleX??value.scale,value.scaleY??value.scale];
/** Largest singular value, also valid when one or both axes are collapsed. */
export const scenePlacementMaxScale=(value:ScenePlacementValue):number=>Math.max(...scenePlacementScales(value).map(Math.abs));
export function isScenePlacementSimilarity(value:ScenePlacementValue):boolean {const [x,y]=scenePlacementScales(value);return x===y&&x>0;}
export function placementMatrix(value:ScenePlacementValue):ScenePlacementMatrix {
 const a=value.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),[x,y]=scenePlacementScales(value);
 return [c*x,s*x,-s*y,c*y,value.translation[0],value.translation[1]];
}
export function applyScenePlacementMatrix(matrix:ScenePlacementMatrix,point:Point2):Point2 {const [a,b,c,d,e,f]=matrix;return [a*point[0]+c*point[1]+e,b*point[0]+d*point[1]+f];}
export function applyScenePlacement(value:ScenePlacementValue,point:Point2):Point2 {
 return applyScenePlacementMatrix(placementMatrix(value),point);
}
/** Singular placements have no inverse. Returning null keeps editing code from
 * turning a legitimate zero-width instance into NaN source coordinates. */
export function tryInverseScenePlacement(value:ScenePlacementValue):ScenePlacementMatrix|null {
 const [x,y]=scenePlacementScales(value);if(x===0||y===0)return null;
 const angle=value.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),a=c/x,b=-s/y,d=c/y,e=s/x,[tx,ty]=value.translation;
 const matrix:ScenePlacementMatrix=[a,b,e,d,-a*tx-e*ty,-b*tx-d*ty];
 return matrix.every(Number.isFinite)?matrix:null;
}
/** Compatibility helper for legacy similarities. General editing should use
 * the matrix inverse above because inverse anisotropy is not R·diag(X,Y). */
export function inverseScenePlacement(value:ScenePlacementValue):ScenePlacementValue {
 if(!isScenePlacementSimilarity(value))throw Error('Only nonsingular similarity placements have a similarity inverse. Use tryInverseScenePlacement.');
 const inverse={translation:[0,0] as Point2,rotation:-value.rotation,scale:1/scenePlacementScales(value)[0]};
 if(!Number.isFinite(inverse.scale))throw Error('The placement inverse is not finite.');
 return {...inverse,translation:applyScenePlacement(inverse,[-value.translation[0],-value.translation[1]])};
}
/** Left-multiply a world-space similarity, retaining the base's local axes.
 * Independent axis gestures use setScenePlacementAxisScale in that local frame;
 * arbitrary world-axis affine composition would require a shear component. */
export function composePlacementSimilarity(base:ScenePlacementValue,delta:ScenePlacementValue):ScenePlacementValue {
 if(!isScenePlacementSimilarity(delta))throw Error('Placement gesture must be a positive similarity; edit local axes with setScenePlacementAxisScale.');
 const scale=scenePlacementScales(delta)[0];
 return {translation:applyScenePlacement(delta,base.translation),rotation:base.rotation+delta.rotation,scale:base.scale*scale,...(base.scaleX===undefined?{}:{scaleX:base.scaleX*scale}),...(base.scaleY===undefined?{}:{scaleY:base.scaleY*scale})};
}
/** Set an absolute local-axis scale, including restoring zero. An optional
 * pre-placement anchor stays fixed in scene space; no inverse is needed. */
export function setScenePlacementAxisScale(value:ScenePlacementValue,axis:'x'|'y',scale:number,anchor:Point2=[0,0]):ScenePlacementValue {
 if(!Number.isFinite(scale)||scale<0||scale>1e6)throw Error('Instance axis scale must be finite and between 0 and 1000000.');
 const next={...value,[axis==='x'?'scaleX':'scaleY']:scale},before=applyScenePlacement(value,anchor),after=applyScenePlacement(next,anchor);
 return {...next,translation:[value.translation[0]+before[0]-after[0],value.translation[1]+before[1]-after[1]]};
}
export function evaluateIntervalTrack(track:SceneIntervalTrack,source:DrawingDocument,angle:Angle,useDraft=true):SceneIntervalValue {
 const base=source.displayIntervals?.find(t=>t.id===track.sourceTrackId);if(!base)throw Error('The source interval track is missing.');
 const sourceTrack={...source,displayIntervals:[base]},overrides=(v:SceneIntervalValue):StrokeDisplayIntervals[]|undefined=>v.appearance?[v.appearance]:undefined;
 const mix=(samples:Sample<SceneIntervalValue>[]):SceneIntervalValue=>({appearance:blendIntervalOverrides(sourceTrack,samples.map(s=>({overrides:overrides(s.value),weight:s.weight})))[0],enabled:strongest(samples).enabled});
 return evaluate(track,angle,{appearance:null,enabled:{}},mix,(n,x,y,a)=>({appearance:missingCornerIntervals(sourceTrack,overrides(n),overrides(x),overrides(y),a)[0],enabled:{...n.enabled,...x.enabled,...y.enabled}}),useDraft);
}

/** Sparse channels share one instance lattice; missing entries mean zero. */
export function evaluateShapeTrack(track:SceneShapeTrack,angle:Angle,useDraft=true,mapProgress?:SceneProgressMapper):SceneShapeValue {
 const point=(record:Record<string,Point2>,id:string):Point2=>Object.hasOwn(record,id)?record[id]:[0,0];
 const handle=(record:SceneShapeValue['handles'],id:string):[Point2,Point2]=>Object.hasOwn(record,id)?record[id]:[[0,0],[0,0]];
 const mix=(samples:Sample<SceneShapeValue>[]):SceneShapeValue=>{
  const nodes=[...new Set(samples.flatMap(s=>Object.keys(s.value.nodes)))],curves=[...new Set(samples.flatMap(s=>Object.keys(s.value.handles)))];
  return {nodes:Object.fromEntries(nodes.map(id=>[id,samples.reduce<Point2>((v,s)=>{const p=point(s.value.nodes,id);return [v[0]+p[0]*s.weight,v[1]+p[1]*s.weight];},[0,0])])),handles:Object.fromEntries(curves.map(id=>[id,([0,1] as const).map(end=>samples.reduce<Point2>((v,s)=>{const p=handle(s.value.handles,id)[end];return [v[0]+p[0]*s.weight,v[1]+p[1]*s.weight];},[0,0]))])) as SceneShapeValue['handles']};
 };
 return evaluate(track,angle,identitySceneShape(),mix,(n,x,y)=>mix([{value:x,weight:1},{value:y,weight:1},{value:n,weight:-1}]),useDraft,mapProgress);
}
