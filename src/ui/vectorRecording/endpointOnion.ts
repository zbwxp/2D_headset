import type {Cubic,DrawingDocument,Point2} from '../../domain/drawing/model';
import {visible} from '../../domain/drawing/model';
import {subcurve} from '../../domain/drawing/roundedJoin';
import {evaluateRecordingSnapshot,type SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {sameAngle,type Angle} from '../../domain/vectorRecording/interpolation';
import {createSnapshotOnionInspectionCache,markSceneOnionHighlights,type SceneOnionFrame,type SceneOnionSettings} from './angleInspection';
import {extractEndpointOnionInk,type EndpointOnionInk} from './endpointOnionInk';

export interface SceneOnionEndpoints {startSnapshotId:string;endSnapshotId:string}
export interface EndpointOnionView {id:string;name:string;angle:Angle}
export interface OnionCenterline {id:string;cubic:Cubic}
export interface EndpointOnionGeometry {drawing:DrawingDocument;ink:EndpointOnionInk;angle:Angle;snapshotId:string}

export function defaultSceneOnionEndpoints(views:readonly EndpointOnionView[]):SceneOnionEndpoints {
 const start=views.find(view=>sameAngle(view.angle,{x:0,y:0}))??views[0];
 const end=views.find(view=>sameAngle(view.angle,{x:-90,y:0}))??views.filter(view=>view!==start).sort((a,b)=>Math.hypot(b.angle.x-(start?.angle.x??0),b.angle.y-(start?.angle.y??0))-Math.hypot(a.angle.x-(start?.angle.x??0),a.angle.y-(start?.angle.y??0)))[0];
 return {startSnapshotId:start?.id??'',endSnapshotId:end?.id??start?.id??''};
}
const lerpPoint=(a:Point2,b:Point2,t:number):Point2=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const lerpCubic=(a:Cubic,b:Cubic,t:number):Cubic=>a.map((point,index)=>lerpPoint(point,b[index],t)) as Cubic;

/** Sample the straight line between selected saved angles in degree steps. */
export function sampleEndpointOnionAngles(start:Angle,end:Angle,step:5|10):Array<{angle:Angle;t:number}> {
 const distance=Math.hypot(end.x-start.x,end.y-start.y);if(distance<1e-8)return [];
 const result:Array<{angle:Angle;t:number}>=[];
 for(let value=0;value<distance-1e-8;value+=step){const t=value/distance;result.push({t,angle:{x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t}});}
 result.push({t:1,angle:{...end}});return result;
}

export interface OnionMaterialMask {id:string;trackId:string;rangeId:string;mode:'SHOW'|'HIDE';enabled:boolean;scope:'PATH'|'CURVE';spans:Array<{start:number;end:number}>}
interface MaterialGeometry {cubic:Cubic;visible:boolean;domain?:{start:number;end:number};masks?:OnionMaterialMask[]}
const merged=(spans:Array<[number,number]>):Array<[number,number]>=>{
 const result:Array<[number,number]>=[];for(const [lo,hi] of spans.map(([a,b]):[number,number]=>[Math.max(0,a),Math.min(1,b)]).filter(([a,b])=>b-a>1e-10).sort((a,b)=>a[0]-b[0])){const last=result.at(-1);if(last&&lo<=last[1]+1e-10)last[1]=Math.max(last[1],hi);else result.push([lo,hi]);}return result;
};
const subtract=(base:Array<[number,number]>,gaps:Array<[number,number]>)=>{let result=base;for(const [lo,hi] of merged(gaps))result=result.flatMap(([a,b]):Array<[number,number]>=>hi<=a||lo>=b?[[a,b]]:[...(lo>a?[[a,lo] as [number,number]]:[]),...(hi<b?[[hi,b] as [number,number]]:[])]);return result;};
function materialCoverage(masks:OnionMaterialMask[]):Array<[number,number]> {
 const enabled=masks.filter(mask=>mask.enabled),path=enabled.filter(mask=>mask.scope==='PATH'),shown=path.filter(mask=>mask.mode==='SHOW'),spans=(values:OnionMaterialMask[])=>values.flatMap(value=>value.spans.map(span=>[span.start,span.end] as [number,number]));
 let result=subtract(shown.length?merged(spans(shown)):[[0,1]],spans(path.filter(mask=>mask.mode==='HIDE')));
 const local=enabled.filter(mask=>mask.scope==='CURVE');for(const id of new Set(local.map(mask=>mask.trackId))){const group=local.filter(mask=>mask.trackId===id),shows=group.filter(mask=>mask.mode==='SHOW');if(shows.length){const coverage=merged(spans(shows));result=merged(result.flatMap(([a,b])=>coverage.map(([c,d])=>[Math.max(a,c),Math.min(b,d)] as [number,number])));}result=subtract(result,spans(group.filter(mask=>mask.mode==='HIDE')));}
 return result;
}
/** Greatest endpoint weight wins; a tie follows the runtime's lower-X/Y order. */
export function nearerOnionEndpoint(start:Angle,end:Angle,t:number):'start'|'end' {
 return t<.5?'start':t>.5?'end':start.x<end.x||start.x===end.x&&start.y<=end.y?'start':'end';
}
function materialPair(id:string,a:MaterialGeometry,b:MaterialGeometry,diagnostics:Set<string>){
 const left=a.masks??[],right=b.masks??[],byId=new Map(right.map(mask=>[mask.id,mask]));
 const compatible=left.length===right.length&&left.every(mask=>byId.get(mask.id)?.spans.length===mask.spans.length);
 if(!compatible)diagnostics.add(`${id}: interval IDs or range structure differ; material follows the nearer endpoint without guessed matching.`);
 return (t:number,startWins:boolean):Array<[number,number]>=>{
  if(!(startWins?a.visible:b.visible))return [];
  const masks=!compatible?(startWins?left:right):left.map(mask=>{const other=byId.get(mask.id)!,discrete=startWins?mask:other;return {...discrete,spans:mask.spans.map((span,index)=>({start:span.start+(other.spans[index].start-span.start)*t,end:span.end+(other.spans[index].end-span.end)*t}))};});
  const lo=(a.domain?.start??0)+((b.domain?.start??0)-(a.domain?.start??0))*t,hi=(a.domain?.end??1)+((b.domain?.end??1)-(a.domain?.end??1))*t;
  return merged(materialCoverage(masks).map(([start,end])=>[Math.max(start,lo),Math.min(end,hi)]));
 };
}

/** Blend final endpoint controls and stable material t ranges only. Boolean
 * visibility uses the existing strongest-weight/lower-angle tie convention. */
export function interpolateEndpointOnion(start:EndpointOnionGeometry,end:EndpointOnionGeometry,step:5|10):{frames:SceneOnionFrame[];diagnostics:string[]} {
 const diagnostics=new Set([...start.ink.diagnostics,...end.ink.diagnostics]),pairs:Array<{id:string;a:Cubic;b:Cubic;coverage:(t:number,startWins:boolean)=>Array<[number,number]>}>=[];
 const startCurves=new Map(start.drawing.curves.map(curve=>[curve.id,curve])),endCurves=new Map(end.drawing.curves.map(curve=>[curve.id,curve]));
 for(const id of new Set([...startCurves.keys(),...endCurves.keys()])){
  const first=startCurves.get(id),last=endCurves.get(id),a=start.ink.curves[id],b=end.ink.curves[id];
  if(!first||!last||!a||!b||first.nodes.some((node,index)=>node!==last.nodes[index])){diagnostics.add(`Curve ${id} is missing or has different canonical topology; omitted without guessed matching.`);continue;}
  const left=a as typeof a&MaterialGeometry,right=b as typeof b&MaterialGeometry;
  pairs.push({id:`curve:${id}`,a:left.cubic,b:right.cubic,coverage:materialPair(`Curve ${id}`,left,right,diagnostics)});
 }
 const startArcs=start.ink.arcGeometry??{},endArcs=end.ink.arcGeometry??{};
 for(const id of new Set([...Object.keys(startArcs),...Object.keys(endArcs)])){
  const a=startArcs[id],b=endArcs[id];
  if(!a||!b||a.length!==b.length||start.ink.arcPieceCounts?.[id]!==end.ink.arcPieceCounts?.[id]){diagnostics.add(`ARC ${id} has different endpoint topology; omitted without guessed matching.`);continue;}
  a.forEach(left=>{const right=b.find(piece=>piece.pieceIndex===left.pieceIndex);if(!right){diagnostics.add(`ARC ${id} is missing piece ${left.pieceIndex}; omitted.`);return;}pairs.push({id:`arc:${id}:${left.pieceIndex}`,a:left.cubic,b:right.cubic,coverage:materialPair(`ARC ${id}/${left.pieceIndex}`,left,right,diagnostics)});});
 }
 const endNodes=new Map(end.drawing.nodes.map(node=>[node.id,node])),sharedNodes=start.drawing.nodes.filter(node=>endNodes.has(node.id)),nodeIds=new Set(sharedNodes.map(node=>node.id));
 const sharedCurves=start.drawing.curves.filter(curve=>endCurves.has(curve.id)&&curve.nodes.every((id,index)=>nodeIds.has(id)&&id===endCurves.get(curve.id)!.nodes[index]));
 const frames=sampleEndpointOnionAngles(start.angle,end.angle,step).map(({angle,t}):SceneOnionFrame=>{
  const startWins=nearerOnionEndpoint(start.angle,end.angle,t)==='start';
  return {angle,paintBatches:[],centerlines:pairs.flatMap(pair=>{const cubic=lerpCubic(pair.a,pair.b,t);return pair.coverage(t,startWins).map(([lo,hi],index)=>({id:`${pair.id}:${index}`,cubic:subcurve(cubic,lo,hi)}));}),
   drawing:{...start.drawing,nodes:sharedNodes.map(node=>({...node,position:lerpPoint(node.position,endNodes.get(node.id)!.position,t)})),curves:sharedCurves.map(curve=>({...curve,handles:curve.handles.map((point,index)=>lerpPoint(point,endCurves.get(curve.id)!.handles[index],t)) as [Point2,Point2],visible:startWins?visible(start.drawing,curve.id):visible(end.drawing,curve.id),inkVisible:startWins?curve.inkVisible:endCurves.get(curve.id)!.inkVisible})),fills:[],offsets:[],joins:[],endpointLinks:[],displayIntervals:[]},
  };
 });
 const axis=Math.abs(end.angle.x-start.angle.x)>=Math.abs(end.angle.y-start.angle.y)?'x':'y',settings:SceneOnionSettings={enabled:true,axis,step,min:Math.min(start.angle[axis],end.angle[axis]),max:Math.max(start.angle[axis],end.angle[axis]),opacity:1};
 return {frames:markSceneOnionHighlights(frames,settings),diagnostics:[...diagnostics]};
}

/** Each endpoint is evaluated once per relevant saved/live state. The current
 * canvas result can be reused, and the other endpoint ignores unsaved edits. */
export function createEndpointOnionCache(evaluate:typeof evaluateRecordingSnapshot=evaluateRecordingSnapshot){
 const inspection=createSnapshotOnionInspectionCache(),evaluations=new WeakMap<RecordingSnapshotWorkspace,Map<string,EndpointOnionGeometry>>();
 return {resolve(workspace:RecordingSnapshotWorkspace,recordingId:string,snapshotId:string,currentAngle:Angle,stopAtWarpId?:string,currentEvaluation?:SnapshotEvaluation):EndpointOnionGeometry{
  const snapshot=workspace.snapshots.find(value=>value.id===snapshotId);if(!snapshot)throw Error('Choose two existing view snapshots.');
  const current=sameAngle(snapshot.angle,currentAngle),prepared=inspection.get(workspace,recordingId,current?currentAngle:{x:Infinity,y:Infinity});
  let saved=evaluations.get(prepared);if(!saved){saved=new Map();evaluations.set(prepared,saved);}
  const key=JSON.stringify([snapshotId,stopAtWarpId]);const cached=saved.get(key);if(cached)return cached;
  const evaluated=current&&currentEvaluation?.snapshotId===snapshotId&&sameAngle(currentEvaluation.angle,snapshot.angle)?currentEvaluation:evaluate(prepared,recordingId,{snapshotId,angle:snapshot.angle,useDraft:false,diagnostics:'preview',...(stopAtWarpId?{stopAtWarpId}:{})});
  const result={snapshotId,angle:{...snapshot.angle},drawing:evaluated.drawing,ink:extractEndpointOnionInk(evaluated.drawing)};saved.set(key,result);return result;
 }};
}
