import {blendWarpGrids} from '../vectorWarp/model';
import {bracket,clampAngle,latticeWeights,sameAngle,type Angle} from '../vectorRecording/interpolation';
import {blendIntervalOverrides,missingCornerIntervals} from '../vectorRecording/intervals';
import type {DrawingDocument,StrokeDisplayIntervals,Point2} from '../drawing/model';
import {identityScenePlacement,identitySceneShape,type SceneShapeTrack,type SceneShapeValue,type SceneTrack,type SceneWarp,type SceneVisibilityTrack,type SceneDepthTrack,type SceneIntervalTrack,type SceneIntervalValue,type ScenePlacementTrack,type ScenePlacementValue} from './model';

interface Sample<T> {value:T;weight:number}
const strongest=<T>(samples:Sample<T>[]):T=>samples.reduce((a,b)=>b.weight>a.weight?b:a).value;
/** Independent tracks use only their own coordinate axes plus a neutral origin.
 * Legacy tracks preserve the original virtual -90/0/90 lattice explicitly. */
function weights<T>(track:SceneTrack<T>,angle:Angle){
 if(track.interpolation==='legacy')return latticeWeights(track.keys.map(k=>k.angle),angle);
 const [x0,x1,x]=bracket([0,...track.keys.map(k=>k.angle.x)],clampAngle(angle.x)),[y0,y1,y]=bracket([0,...track.keys.map(k=>k.angle.y)],clampAngle(angle.y));
 return [{angle:{x:x0,y:y0},weight:(1-x)*(1-y)},{angle:{x:x1,y:y0},weight:x*(1-y)},{angle:{x:x0,y:y1},weight:(1-x)*y},{angle:{x:x1,y:y1},weight:x*y}].filter(s=>s.weight>0);
}
function evaluate<T>(track:SceneTrack<T>,angle:Angle,base:T,mix:(s:Sample<T>[])=>T,corner:(neutral:T,x:T,y:T,angle:Angle)=>T,useDraft=true):T {
 const at={x:clampAngle(angle.x),y:clampAngle(angle.y)};
 if(useDraft&&track.draft&&sameAngle(track.draft.angle,at))return track.draft.value;
 const exact=track.keys.find(k=>sameAngle(k.angle,at));if(exact)return exact.value;
 if(!track.keys.length)return base;
 const neutralKey=track.keys.find(k=>sameAngle(k.angle,{x:0,y:0})),neutral=neutralKey?neutralKey.value:base;
 const axis=(axis:'x'|'y',value:number):T=>{
  const keys=track.keys.filter(k=>k.angle[axis==='x'?'y':'x']===0);
  if(!keys.length)return neutral;
  const coordinates=keys.map(k=>k.angle[axis]);if(track.interpolation!=='legacy')coordinates.push(0);
  const [lo,hi,t]=bracket(coordinates,value),ka=keys.find(k=>k.angle[axis]===lo),kb=keys.find(k=>k.angle[axis]===hi),a=ka?ka.value:neutral,b=kb?kb.value:neutral;
  return mix([{value:a,weight:1-t},{value:b,weight:t}]);
 };
 const sample=(a:Angle)=>{const key=track.keys.find(k=>sameAngle(k.angle,a));return key?key.value:corner(neutral,axis('x',a.x),axis('y',a.y),a);};
 return mix(weights(track,at).map(s=>({value:sample(s.angle),weight:s.weight})));
}
export function evaluateWarpTrack(track:SceneWarp,angle:Angle,useDraft=true){
 const mix=(samples:Sample<SceneWarp['restGrid']>[])=>blendWarpGrids(samples.map(s=>({grid:s.value,weight:s.weight})));
 return evaluate(track,angle,track.restGrid,mix,(n,x,y)=>blendWarpGrids([{grid:x,weight:1},{grid:y,weight:1},{grid:n,weight:-1}]),useDraft);
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
 * Positive scale interpolates linearly. Missing XY scale corrections multiply
 * relative to neutral, so two reductions cannot introduce a singular corner. */
export function evaluatePlacementTrack(track:ScenePlacementTrack,angle:Angle,useDraft=true):ScenePlacementValue {
 const mix=(samples:Sample<ScenePlacementValue>[]):ScenePlacementValue=>samples.reduce((v,s)=>({translation:[v.translation[0]+s.weight*s.value.translation[0],v.translation[1]+s.weight*s.value.translation[1]],rotation:v.rotation+s.weight*s.value.rotation,scale:v.scale+s.weight*s.value.scale}),{translation:[0,0],rotation:0,scale:0} as ScenePlacementValue);
 return evaluate(track,angle,identityScenePlacement(),mix,(n,x,y)=>({translation:[x.translation[0]+y.translation[0]-n.translation[0],x.translation[1]+y.translation[1]-n.translation[1]],rotation:x.rotation+y.rotation-n.rotation,scale:Math.max(1e-6,Math.min(1e6,x.scale*y.scale/n.scale))}),useDraft);
}
/** SVG affine ordering: x'=a*x+c*y+e, y'=b*x+d*y+f. */
export type ScenePlacementMatrix=[number,number,number,number,number,number];
export function placementMatrix(value:ScenePlacementValue):ScenePlacementMatrix {
 const a=value.rotation*Math.PI/180,c=Math.cos(a)*value.scale,s=Math.sin(a)*value.scale;
 return [c,s,-s,c,value.translation[0],value.translation[1]];
}
export function applyScenePlacement(value:ScenePlacementValue,point:Point2):Point2 {
 const [a,b,c,d,e,f]=placementMatrix(value);return [a*point[0]+c*point[1]+e,b*point[0]+d*point[1]+f];
}
export function inverseScenePlacement(value:ScenePlacementValue):ScenePlacementValue {
 const inverse={translation:[0,0] as Point2,rotation:-value.rotation,scale:1/value.scale};
 return {...inverse,translation:applyScenePlacement(inverse,[-value.translation[0],-value.translation[1]])};
}
/** Left-multiply a world-space gesture: the result maps p to delta(base(p)). */
export function composePlacementSimilarity(base:ScenePlacementValue,delta:ScenePlacementValue):ScenePlacementValue {
 return {translation:applyScenePlacement(delta,base.translation),rotation:base.rotation+delta.rotation,scale:base.scale*delta.scale};
}
export function evaluateIntervalTrack(track:SceneIntervalTrack,source:DrawingDocument,angle:Angle,useDraft=true):SceneIntervalValue {
 const base=source.displayIntervals?.find(t=>t.id===track.sourceTrackId);if(!base)throw Error('The source interval track is missing.');
 const sourceTrack={...source,displayIntervals:[base]},overrides=(v:SceneIntervalValue):StrokeDisplayIntervals[]|undefined=>v.appearance?[v.appearance]:undefined;
 const mix=(samples:Sample<SceneIntervalValue>[]):SceneIntervalValue=>({appearance:blendIntervalOverrides(sourceTrack,samples.map(s=>({overrides:overrides(s.value),weight:s.weight})))[0],enabled:strongest(samples).enabled});
 return evaluate(track,angle,{appearance:null,enabled:{}},mix,(n,x,y,a)=>({appearance:missingCornerIntervals(sourceTrack,overrides(n),overrides(x),overrides(y),a)[0],enabled:{...n.enabled,...x.enabled,...y.enabled}}),useDraft);
}

/** Sparse channels share one instance lattice; missing entries mean zero. */
export function evaluateShapeTrack(track:SceneShapeTrack,angle:Angle,useDraft=true):SceneShapeValue {
 const point=(record:Record<string,Point2>,id:string):Point2=>Object.hasOwn(record,id)?record[id]:[0,0];
 const handle=(record:SceneShapeValue['handles'],id:string):[Point2,Point2]=>Object.hasOwn(record,id)?record[id]:[[0,0],[0,0]];
 const mix=(samples:Sample<SceneShapeValue>[]):SceneShapeValue=>{
  const nodes=[...new Set(samples.flatMap(s=>Object.keys(s.value.nodes)))],curves=[...new Set(samples.flatMap(s=>Object.keys(s.value.handles)))];
  return {nodes:Object.fromEntries(nodes.map(id=>[id,samples.reduce<Point2>((v,s)=>{const p=point(s.value.nodes,id);return [v[0]+p[0]*s.weight,v[1]+p[1]*s.weight];},[0,0])])),handles:Object.fromEntries(curves.map(id=>[id,([0,1] as const).map(end=>samples.reduce<Point2>((v,s)=>{const p=handle(s.value.handles,id)[end];return [v[0]+p[0]*s.weight,v[1]+p[1]*s.weight];},[0,0]))])) as SceneShapeValue['handles']};
 };
 return evaluate(track,angle,identitySceneShape(),mix,(n,x,y)=>mix([{value:x,weight:1},{value:y,weight:1},{value:n,weight:-1}]),useDraft);
}
