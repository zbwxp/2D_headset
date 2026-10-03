import type {Cubic,DrawingDocument,Endpoint,Point2} from '../../domain/drawing/model';
import {layerFor,shapeOf,visible} from '../../domain/drawing/model';
import {evaluateRecordingSnapshot,type SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import {applyEndpointPairSmoothConstraints,interpolateEndpointPairGeometry} from '../../domain/recordingSnapshot/endpointPair';
import type {RecordingSnapshotWorkspace,SnapshotEndpointResponses,SnapshotRecording} from '../../domain/recordingSnapshot/model';
import {snapshotInterpolationWeight,snapshotWeightNodeOwners} from '../../domain/recordingSnapshot/weights';
import {sameAngle,type Angle} from '../../domain/vectorRecording/interpolation';
import {createSnapshotOnionInspectionCache,markSceneOnionHighlights,type SceneOnionFrame,type SceneOnionSettings} from './angleInspection';

export interface SceneOnionEndpoints {startSnapshotId:string;endSnapshotId:string}
export interface EndpointOnionView {id:string;name:string;angle:Angle}
export interface OnionCenterline {id:string;cubic:Cubic}
export interface EndpointOnionGeometry {drawing:DrawingDocument;angle:Angle;snapshotId:string}

/** Evaluated snapshots contain only their included source geometry. */
function sourceCenterlines(drawing:DrawingDocument):OnionCenterline[] {
 const nodes=new Map(drawing.nodes.map(node=>[node.id,node.position]));
 return drawing.curves.map(curve=>({id:`curve:${curve.id}:0`,cubic:[nodes.get(curve.nodes[0])!,...curve.handles,nodes.get(curve.nodes[1])!] as Cubic}));
}

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

/** Greatest endpoint weight wins; a tie follows the runtime's lower-X/Y order. */
export function nearerOnionEndpoint(start:Angle,end:Angle,t:number):'start'|'end' {
 return t<.5?'start':t>.5?'end':start.x<end.x||start.x===end.x&&start.y<=end.y?'start':'end';
}
type OnionWeightOwner={layerId:string;curveId?:string};
interface OnionGeometryPair {id:string;curveId:string;a:Cubic;b:Cubic;owner?:OnionWeightOwner;nodes:[string,string]}

/** Full source centerlines from the two final endpoint bases. Curve/layer
 * responses retain their shared-node authority; visibility and material never
 * clip ghosts, and derived ARC geometry is not sampled. */
export function interpolateEndpointOnion(start:EndpointOnionGeometry,end:EndpointOnionGeometry,step:5|10,recording?:SnapshotRecording):{frames:SceneOnionFrame[];diagnostics:string[]} {
 const diagnostics=new Set<string>(),pairs:OnionGeometryPair[]=[],startNodes=new Map(start.drawing.nodes.map(node=>[node.id,node])),endNodes=new Map(end.drawing.nodes.map(node=>[node.id,node]));
 const startCurves=new Map(start.drawing.curves.map(curve=>[curve.id,curve])),endCurves=new Map(end.drawing.curves.map(curve=>[curve.id,curve])),nodeOwners=snapshotWeightNodeOwners(start.drawing);
 const weight=(owner:OnionWeightOwner|undefined,t:number)=>recording&&owner?snapshotInterpolationWeight(recording,start.snapshotId,end.snapshotId,owner.layerId,t,owner.curveId):t;
 for(const id of new Set([...startCurves.keys(),...endCurves.keys()])){
  const first=startCurves.get(id),last=endCurves.get(id);
  if(!first||!last||first.nodes.some((node,index)=>node!==last.nodes[index]||!startNodes.has(node)||!endNodes.has(node))){diagnostics.add(`Curve ${id} is missing or has different canonical topology; omitted without guessed matching.`);continue;}
  const layer=layerFor(start.drawing,id),owner=layer?{layerId:layer.id,curveId:id}:undefined;
  pairs.push({id:`curve:${id}:0`,curveId:id,a:shapeOf(start.drawing,id),b:shapeOf(end.drawing,id),owner,nodes:first.nodes});
 }
 const sharedNodes=start.drawing.nodes.filter(node=>endNodes.has(node.id)),curveIds=new Set(pairs.map(pair=>pair.curveId));
 const sameEnds=(a:{a:Endpoint;b:Endpoint},b:{a:Endpoint;b:Endpoint}|undefined)=>!!b&&a.a.curveId===b.a.curveId&&a.a.end===b.a.end&&a.b.curveId===b.b.curveId&&a.b.end===b.b.end&&curveIds.has(a.a.curveId)&&curveIds.has(a.b.curveId);
 const smoothJoins=start.drawing.joins.filter(join=>join.mode==='SMOOTH'&&sameEnds(join,end.drawing.joins.find(other=>other.id===join.id&&other.mode==='SMOOTH')));
 const smoothLinks=(start.drawing.endpointLinks??[]).filter(link=>link.joinBrush?.kind==='SMOOTH'&&sameEnds(link,end.drawing.endpointLinks?.find(other=>other.id===link.id&&other.joinBrush?.kind==='SMOOTH')));
 const frames=sampleEndpointOnionAngles(start.angle,end.angle,step).map(({angle,t}):SceneOnionFrame=>{
  const startWins=nearerOnionEndpoint(start.angle,end.angle,t)==='start',nodeWeights=new Map(sharedNodes.map(node=>[node.id,weight(nodeOwners.get(node.id),t)]));
  const centerlines=pairs.map(pair=>{
   const curveWeight=weight(pair.owner,t),weights=pair.nodes.map(id=>nodeWeights.get(id)??t) as [number,number];
   pair.nodes.forEach((id,index)=>{if(Math.abs(weights[index]-curveWeight)>1e-10)diagnostics.add(`Node ${id}: conflicting curve responses use the shared node or endpoint-link layer response to keep geometry connected.`);});
   return {id:pair.id,cubic:lerpOwnedCubic(pair.a,pair.b,curveWeight,weights)};
  });
  let drawing:DrawingDocument={...start.drawing,
   nodes:sharedNodes.map(node=>({...node,position:lerpPoint(node.position,endNodes.get(node.id)!.position,nodeWeights.get(node.id)??t)})),
   curves:pairs.map((pair,index)=>{const first=startCurves.get(pair.curveId)!,last=endCurves.get(pair.curveId)!,cubic=centerlines[index].cubic;return {...first,handles:[cubic[1],cubic[2]] as [Point2,Point2],visible:startWins?visible(start.drawing,pair.curveId):visible(end.drawing,pair.curveId),inkVisible:startWins?first.inkVisible:last.inkVisible};}),
   fills:[],offsets:[],joins:smoothJoins,endpointLinks:smoothLinks,displayIntervals:[],
  };
  if(t>0&&t<1&&(smoothJoins.length||smoothLinks.length)){
   const smooth=applyEndpointPairSmoothConstraints(drawing);drawing=smooth.drawing;for(const message of smooth.diagnostics)diagnostics.add(message);
   return {angle,paintBatches:[],drawing,centerlines:sourceCenterlines(drawing)};
  }
  return {angle,paintBatches:[],centerlines,drawing};
 });
 const axis=Math.abs(end.angle.x-start.angle.x)>=Math.abs(end.angle.y-start.angle.y)?'x':'y',settings:SceneOnionSettings={enabled:true,axis,step,min:Math.min(start.angle[axis],end.angle[axis]),max:Math.max(start.angle[axis],end.angle[axis]),opacity:1};
 return {frames:markSceneOnionHighlights(frames,settings),diagnostics:[...diagnostics]};
}

/** Explicit pair ghosts share the canvas's final node/relative-handle and
 * explicit SMOOTH algebra, then draw each complete source cubic. Visibility,
 * interval clipping, ARC trims and ink generation belong to the main renderer. */
export function interpolateEndpointPairOnion(start:Pick<EndpointOnionGeometry,'drawing'|'angle'>,end:Pick<EndpointOnionGeometry,'drawing'|'angle'>,step:5|10,responses?:SnapshotEndpointResponses):{frames:SceneOnionFrame[];diagnostics:string[]} {
 const diagnostics=new Set<string>(),frames=sampleEndpointOnionAngles(start.angle,end.angle,step).map(({angle,t}):SceneOnionFrame=>{
  const sampled=interpolateEndpointPairGeometry(start.drawing,end.drawing,t,responses,{startWins:nearerOnionEndpoint(start.angle,end.angle,t)==='start'});
  for(const message of sampled.diagnostics)diagnostics.add(message);
  const centerlines=sourceCenterlines(sampled.drawing);
  return {angle,drawing:sampled.drawing,paintBatches:[],centerlines};
 });
 const settings:SceneOnionSettings={enabled:true,axis:'x',step,min:Math.min(start.angle.x,end.angle.x),max:Math.max(start.angle.x,end.angle.x),opacity:1};
 return {frames:markSceneOnionHighlights(frames,settings),diagnostics:[...diagnostics]};
}

/** Each endpoint is evaluated once per relevant saved/live state. The current
 * canvas result can be reused, and the other endpoint ignores unsaved edits. */
export function createEndpointOnionCache(evaluate:typeof evaluateRecordingSnapshot=evaluateRecordingSnapshot){
 const inspection=createSnapshotOnionInspectionCache(),evaluations=new WeakMap<RecordingSnapshotWorkspace,Map<string,EndpointOnionGeometry>>();
 // A response preserves its pair's exact endpoints. Editing it must not
 // rebuild either endpoint's final geometry on every graph pointer move. Other
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
  const result={snapshotId,angle:{...snapshot.angle},drawing:evaluated.drawing};saved.set(key,result);return result;
 }};
}
