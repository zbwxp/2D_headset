import {blendWarpGrids} from '../vectorWarp/model';
import {bracket,clampAngle,latticeWeights,sameAngle,type Angle} from '../vectorRecording/interpolation';
import {blendIntervalOverrides,missingCornerIntervals} from '../vectorRecording/intervals';
import type {DrawingDocument,StrokeDisplayIntervals} from '../drawing/model';
import type {SceneTrack,SceneWarp,SceneVisibilityTrack,SceneDepthTrack,SceneIntervalTrack,SceneIntervalValue} from './model';

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
export function evaluateIntervalTrack(track:SceneIntervalTrack,source:DrawingDocument,angle:Angle,useDraft=true):SceneIntervalValue {
 const base=source.displayIntervals?.find(t=>t.id===track.sourceTrackId);if(!base)throw Error('The source interval track is missing.');
 const sourceTrack={...source,displayIntervals:[base]},overrides=(v:SceneIntervalValue):StrokeDisplayIntervals[]|undefined=>v.appearance?[v.appearance]:undefined;
 const mix=(samples:Sample<SceneIntervalValue>[]):SceneIntervalValue=>({appearance:blendIntervalOverrides(sourceTrack,samples.map(s=>({overrides:overrides(s.value),weight:s.weight})))[0],enabled:strongest(samples).enabled});
 return evaluate(track,angle,{appearance:null,enabled:{}},mix,(n,x,y,a)=>({appearance:missingCornerIntervals(sourceTrack,overrides(n),overrides(x),overrides(y),a)[0],enabled:{...n.enabled,...x.enabled,...y.enabled}}),useDraft);
}
