import type {Cubic,DrawingDocument,Endpoint,Point2} from '../../domain/drawing/model';
import {layerFor,visible} from '../../domain/drawing/model';
import {subcurve} from '../../domain/drawing/roundedJoin';
import {evaluateRecordingSnapshot,type SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import type {RecordingSnapshotWorkspace,SnapshotRecording} from '../../domain/recordingSnapshot/model';
import {resolveSnapshotInterpolationWeight,snapshotInterpolationWeight,snapshotWeightNodeOwners} from '../../domain/recordingSnapshot/weights';
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
const lerpPoint=(a:Point2,b:Point2,t:number):Point2=>t===0?[...a]:t===1?[...b]:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const lerpCubic=(a:Cubic,b:Cubic,t:number):Cubic=>a.map((point,index)=>lerpPoint(point,b[index],t)) as Cubic;
/** A handle follows its one endpoint authority while its vector follows the
 * curve response. Shared nodes never acquire two absolute positions. */
function lerpOwnedCubic(a:Cubic,b:Cubic,t:number,nodeWeights:[number,number]):Cubic {
 const cubic=lerpCubic(a,b,t);
 for(const index of [0,1] as const){const endpoint=index===0?0:3,handle=index+1,node=lerpPoint(a[endpoint],b[endpoint],nodeWeights[index]);
  if(nodeWeights[index]!==t){const offset=lerpPoint([a[handle][0]-a[endpoint][0],a[handle][1]-a[endpoint][1]],[b[handle][0]-b[endpoint][0],b[handle][1]-b[endpoint][1]],t);cubic[handle]=[node[0]+offset[0],node[1]+offset[1]];}
  cubic[endpoint]=node;
 }return cubic;
}

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

type OnionWeightOwner={layerId:string;curveId?:string};
interface OnionGeometryPair {id:string;a:Cubic;b:Cubic;owner?:OnionWeightOwner;nodes?:[string,string];relationCurves?:[string,string];anchors?:Array<{end:0|1;source:Endpoint}>;coverage:(t:number,startWins:boolean)=>Array<[number,number]>}

/** Blend only final endpoint controls. Response assets map geometry progress;
 * stable material ranges and visibility retain their angle-based timing. */
export function interpolateEndpointOnion(start:EndpointOnionGeometry,end:EndpointOnionGeometry,step:5|10,recording?:SnapshotRecording):{frames:SceneOnionFrame[];diagnostics:string[]} {
 const diagnostics=new Set([...start.ink.diagnostics,...end.ink.diagnostics]),pairs:OnionGeometryPair[]=[];
 const startCurves=new Map(start.drawing.curves.map(curve=>[curve.id,curve])),endCurves=new Map(end.drawing.curves.map(curve=>[curve.id,curve]));
 const nodeOwners=snapshotWeightNodeOwners(start.drawing),curveOwners=new Map<string,OnionWeightOwner>();
 const weight=(owner:OnionWeightOwner|undefined,t:number)=>recording&&owner?snapshotInterpolationWeight(recording,start.snapshotId,end.snapshotId,owner.layerId,t,owner.curveId):t;
 for(const id of new Set([...startCurves.keys(),...endCurves.keys()])){
  const first=startCurves.get(id),last=endCurves.get(id),a=start.ink.curves[id],b=end.ink.curves[id];
  if(!first||!last||!a||!b||first.nodes.some((node,index)=>node!==last.nodes[index])){diagnostics.add(`Curve ${id} is missing or has different canonical topology; omitted without guessed matching.`);continue;}
  const left=a as typeof a&MaterialGeometry,right=b as typeof b&MaterialGeometry;
  const layer=layerFor(start.drawing,id),owner=layer?{layerId:layer.id,curveId:id}:undefined;if(owner)curveOwners.set(id,owner);
  pairs.push({id:`curve:${id}`,a:left.cubic,b:right.cubic,owner,nodes:first.nodes,coverage:materialPair(`Curve ${id}`,left,right,diagnostics)});
 }
 const startArcs=start.ink.arcGeometry??{},endArcs=end.ink.arcGeometry??{};
 for(const id of new Set([...Object.keys(startArcs),...Object.keys(endArcs)])){
  const a=startArcs[id],b=endArcs[id];
  if(!a||!b||a.length!==b.length||start.ink.arcPieceCounts?.[id]!==end.ink.arcPieceCounts?.[id]){diagnostics.add(`ARC ${id} has different endpoint topology; omitted without guessed matching.`);continue;}
  let owner:OnionWeightOwner|undefined,relationCurves:[string,string]|undefined,relationEnds:[Endpoint,Endpoint]|undefined;
  try{const [kind,relationId]=JSON.parse(id),relation=kind==='link'?start.drawing.endpointLinks?.find(link=>link.id===relationId):kind==='join'?start.drawing.joins.find(join=>join.id===relationId):undefined;
   if(relation){const nodeId=startCurves.get(relation.a.curveId)?.nodes[relation.a.end],nodeOwner=nodeId?nodeOwners.get(nodeId):undefined;owner=nodeOwner?{layerId:nodeOwner.layerId}:undefined;relationCurves=[relation.a.curveId,relation.b.curveId];relationEnds=[relation.a,relation.b];}
  }catch{ /* Unrecognized relation IDs retain the legacy linear response. */ }
  if(recording?.interpolationWeights?.length&&!owner)diagnostics.add(`ARC ${id} has no response owner; geometry uses the linear response.`);
  a.forEach(left=>{const right=b.find(piece=>piece.pieceIndex===left.pieceIndex);if(!right){diagnostics.add(`ARC ${id} is missing piece ${left.pieceIndex}; omitted.`);return;}
   const anchors:Array<{end:0|1;source:Endpoint}>=[];if(relationEnds){if(left.pieceIndex===0)anchors.push({end:0,source:relationEnds[0]});if(left.pieceIndex===a.length-1)anchors.push({end:1,source:relationEnds[1]});}
   pairs.push({id:`arc:${id}:${left.pieceIndex}`,a:left.cubic,b:right.cubic,owner,relationCurves,anchors,coverage:materialPair(`ARC ${id}/${left.pieceIndex}`,left,right,diagnostics)});
  });
 }
 const endNodes=new Map(end.drawing.nodes.map(node=>[node.id,node])),sharedNodes=start.drawing.nodes.filter(node=>endNodes.has(node.id)),nodeIds=new Set(sharedNodes.map(node=>node.id));
 const sharedCurves=start.drawing.curves.filter(curve=>endCurves.has(curve.id)&&curve.nodes.every((id,index)=>nodeIds.has(id)&&id===endCurves.get(curve.id)!.nodes[index]));
 const samples=sampleEndpointOnionAngles(start.angle,end.angle,step),curveFallbacks=new Map<string,OnionWeightOwner>(),nodeFallbacks=new Map<OnionWeightOwner,OnionWeightOwner>();
 // An ARC is already final geometry at each endpoint. Its neighboring curves
 // must share its response: independently retiming them would create a gap at
 // the derived trim rather than at a canonical node. No ARC is re-solved here.
 const parents=new Map<string,string>(),arcPairs=pairs.filter(pair=>pair.relationCurves&&pair.owner);
 const root=(id:string):string=>{const parent=parents.get(id);if(!parent||parent===id)return id;const result=root(parent);parents.set(id,result);return result;};
 const unite=(a:string,b:string)=>{const left=root(a),right=root(b);if(left!==right)parents.set(left<right?right:left,left<right?left:right);};
 for(const pair of arcPairs){const [a,b]=pair.relationCurves!;if(!parents.has(a))parents.set(a,a);if(!parents.has(b))parents.set(b,b);unite(a,b);}
 const arcsByNodeOwner=new Map<OnionWeightOwner,string>();
 for(const id of parents.keys())for(const nodeId of startCurves.get(id)?.nodes??[]){const owner=nodeOwners.get(nodeId);if(!owner)continue;const other=arcsByNodeOwner.get(owner);if(other)unite(id,other);else arcsByNodeOwner.set(owner,id);}
 const groups=new Map<string,string[]>();for(const id of parents.keys()){const key=root(id),ids=groups.get(key)??[];ids.push(id);groups.set(key,ids);}
 for(const [key,ids] of groups){
  const arcs=arcPairs.filter(pair=>root(pair.relationCurves![0])===key),owner=arcs.map(pair=>pair.owner!).sort((a,b)=>a.layerId.localeCompare(b.layerId))[0];
  const conflict=samples.some(({t})=>ids.some(id=>Math.abs(weight(curveOwners.get(id),t)-weight(owner,t))>1e-10||(startCurves.get(id)?.nodes??[]).some(nodeId=>Math.abs(weight(nodeOwners.get(nodeId),t)-weight(owner,t))>1e-10)));
  if(!conflict)continue;
  for(const id of ids){curveFallbacks.set(id,owner);for(const nodeId of startCurves.get(id)?.nodes??[]){const nodeOwner=nodeOwners.get(nodeId);if(nodeOwner)nodeFallbacks.set(nodeOwner,owner);}}
  for(const pair of arcs)pair.owner=owner;
  diagnostics.add(`ARC-connected curves ${ids.sort().join(', ')} have conflicting responses; their geometry uses the shared relation layer ${owner.layerId} response to keep trimmed ends connected.`);
 }
 const curveOwner=(id:string)=>curveFallbacks.get(id)??curveOwners.get(id);
 const startNodes=new Map(start.drawing.nodes.map(node=>[node.id,node])),nonlinearArcs=new Set(arcPairs.filter(pair=>{const owner=pair.owner!;return resolveSnapshotInterpolationWeight(recording,start.snapshotId,end.snapshotId,owner.layerId,owner.curveId).asset?.points.some(([x,y])=>Math.abs(x-y)>1e-10);}));
 const frames=samples.map(({angle,t}):SceneOnionFrame=>{
  const startWins=nearerOnionEndpoint(start.angle,end.angle,t)==='start';
  const nodeWeights=new Map(sharedNodes.map(node=>{const owner=nodeOwners.get(node.id);return [node.id,weight(owner?nodeFallbacks.get(owner)??owner:undefined,t)];}));
  const ownedCubic=(a:Cubic,b:Cubic,owner:OnionWeightOwner|undefined,nodes:[string,string])=>lerpOwnedCubic(a,b,weight(owner,t),nodes.map(id=>nodeWeights.get(id)??t) as [number,number]);
  const weightedCurves=new Map(pairs.filter(pair=>pair.nodes&&pair.owner?.curveId).map(pair=>[pair.owner!.curveId!,ownedCubic(pair.a,pair.b,curveOwner(pair.owner!.curveId!),pair.nodes!)]));
  return {angle,paintBatches:[],centerlines:pairs.flatMap(pair=>{const owner=pair.owner?.curveId?curveOwner(pair.owner.curveId):pair.owner,curveWeight=weight(owner,t),cubic=pair.nodes?(pair.owner?.curveId?weightedCurves.get(pair.owner.curveId):undefined)??ownedCubic(pair.a,pair.b,owner,pair.nodes):lerpCubic(pair.a,pair.b,curveWeight);
    if(pair.nodes)for(const nodeId of pair.nodes){const nodeWeight=nodeWeights.get(nodeId)??t;
     if(Math.abs(nodeWeight-curveWeight)>1e-10)diagnostics.add(`Node ${nodeId}: conflicting curve responses use the shared node or endpoint-link layer response to keep geometry connected.`);
    }
    // Trim positions remain on the raw material timeline. A nonlinear ARC
    // keeps those same boundary supports and its blended endpoint handle
    // vectors; exact endpoints and the legacy linear path remain untouched.
    if(t>0&&t<1&&nonlinearArcs.has(pair))for(const anchor of pair.anchors??[]){const id=anchor.source.curveId,source=weightedCurves.get(id),a=start.ink.curves[id]?.domain,b=end.ink.curves[id]?.domain;if(!source||!a||!b)continue;
     const key=anchor.source.end===0?'start':'end',trim=a[key]+(b[key]-a[key])*t,point=subcurve(source,0,trim)[3],index=anchor.end===0?0:3,handle=anchor.end+1,delta:Point2=[point[0]-cubic[index][0],point[1]-cubic[index][1]];cubic[index]=point;cubic[handle]=[cubic[handle][0]+delta[0],cubic[handle][1]+delta[1]];
    }
    return pair.coverage(t,startWins).map(([lo,hi],index)=>({id:`${pair.id}:${index}`,cubic:subcurve(cubic,lo,hi)}));}),
   drawing:{...start.drawing,nodes:sharedNodes.map(node=>({...node,position:lerpPoint(node.position,endNodes.get(node.id)!.position,nodeWeights.get(node.id)??t)})),curves:sharedCurves.map(curve=>{const last=endCurves.get(curve.id)!,a:Cubic=[startNodes.get(curve.nodes[0])!.position,...curve.handles,startNodes.get(curve.nodes[1])!.position],b:Cubic=[endNodes.get(curve.nodes[0])!.position,...last.handles,endNodes.get(curve.nodes[1])!.position],cubic=ownedCubic(a,b,curveOwner(curve.id),curve.nodes);return {...curve,handles:[cubic[1],cubic[2]] as [Point2,Point2],visible:startWins?visible(start.drawing,curve.id):visible(end.drawing,curve.id),inkVisible:startWins?curve.inkVisible:last.inkVisible};}),fills:[],offsets:[],joins:[],endpointLinks:[],displayIntervals:[]},
  };
 });
 const axis=Math.abs(end.angle.x-start.angle.x)>=Math.abs(end.angle.y-start.angle.y)?'x':'y',settings:SceneOnionSettings={enabled:true,axis,step,min:Math.min(start.angle[axis],end.angle[axis]),max:Math.max(start.angle[axis],end.angle[axis]),opacity:1};
 return {frames:markSceneOnionHighlights(frames,settings),diagnostics:[...diagnostics]};
}

/** Each endpoint is evaluated once per relevant saved/live state. The current
 * canvas result can be reused, and the other endpoint ignores unsaved edits. */
export function createEndpointOnionCache(evaluate:typeof evaluateRecordingSnapshot=evaluateRecordingSnapshot){
 const inspection=createSnapshotOnionInspectionCache(),evaluations=new WeakMap<RecordingSnapshotWorkspace,Map<string,EndpointOnionGeometry>>();
 // A response preserves its pair's exact endpoints. Editing it must not
 // rebuild either endpoint's final ink on every graph pointer move. Other
 // pairs can affect this endpoint, or a saved parent evaluated inside its own
 // pair; keep those dependencies in the inspection signature.
 function endpointWorkspace(workspace:RecordingSnapshotWorkspace,snapshotId:string):RecordingSnapshotWorkspace {
  const snapshots=new Map(workspace.snapshots.map(snapshot=>[snapshot.id,snapshot])),visited=new Set<string>(),angles:Angle[]=[];
  const visit=(id:string)=>{if(visited.has(id))return;visited.add(id);const snapshot=snapshots.get(id);if(!snapshot)return;angles.push(snapshot.angle);for(const layer of snapshot.layers)if(layer.kind==='reference')visit(layer.baseSnapshotId);};visit(snapshotId);
  return {...workspace,recordings:workspace.recordings.map(recording=>{
   const interpolationWeights=recording.interpolationWeights?.filter(asset=>{const start=snapshots.get(asset.startSnapshotId)?.angle,end=snapshots.get(asset.endSnapshotId)?.angle;if(!start||!end)return true;
    const dx=end.x-start.x,dy=end.y-start.y,axis=dx!==0&&dy===0?'x':dy!==0&&dx===0?'y':undefined;if(!axis)return true;const cross=axis==='x'?'y':'x';
    return angles.some(angle=>{const t=(angle[axis]-start[axis])/(end[axis]-start[axis]);return Math.abs(angle[cross]-start[cross])<1e-8&&t>1e-8&&t<1-1e-8;});
   });return {...recording,interpolationWeights:interpolationWeights?.length?interpolationWeights:undefined};
  })};
 }
 return {resolve(workspace:RecordingSnapshotWorkspace,recordingId:string,snapshotId:string,currentAngle:Angle,stopAtWarpId?:string,currentEvaluation?:SnapshotEvaluation):EndpointOnionGeometry{
  const snapshot=workspace.snapshots.find(value=>value.id===snapshotId);if(!snapshot)throw Error('Choose two existing view snapshots.');
  const current=sameAngle(snapshot.angle,currentAngle),prepared=inspection.get(endpointWorkspace(workspace,snapshotId),recordingId,current?currentAngle:{x:Infinity,y:Infinity});
  let saved=evaluations.get(prepared);if(!saved){saved=new Map();evaluations.set(prepared,saved);}
  const key=JSON.stringify([snapshotId,stopAtWarpId]);const cached=saved.get(key);if(cached)return cached;
  const evaluated=current&&currentEvaluation?.snapshotId===snapshotId&&sameAngle(currentEvaluation.angle,snapshot.angle)?currentEvaluation:evaluate(prepared,recordingId,{snapshotId,angle:snapshot.angle,useDraft:false,diagnostics:'preview',...(stopAtWarpId?{stopAtWarpId}:{})});
  const result={snapshotId,angle:{...snapshot.angle},drawing:evaluated.drawing,ink:extractEndpointOnionInk(evaluated.drawing)};saved.set(key,result);return result;
 }};
}
