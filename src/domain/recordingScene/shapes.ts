import {add,sub,mul,length,finitePoint,nodeAt,curveById,shapeOf,type DrawingDocument,type Point2,type Cubic} from '../drawing/model';
import {moveNode,moveHandle} from '../drawing/commands';
import {applyDrawingShapeValue,drawingShapeRevision,type DrawingShapeApplication,type DrawingShapeChanges} from '../drawing/sparseShape';
export type {DrawingShapeControl,DrawingShapeChanges} from '../drawing/sparseShape';
export {projectDrawingSmoothHandle as projectSceneSmoothHandle} from '../drawing/smoothHandleAuthoring';
import {transportDeformedIntervals} from '../drawing/deform';
import {displayPath} from '../drawing/displayIntervals';
import {resolveDisplayRoute} from '../drawing/displayRoutes';
import {drawingMaterialPathDependencies,withDrawingReadScope} from '../drawing/readContext';
import {hasEvaluatedDeformation} from '../drawing/evaluatedDeformation';
import {evaluatedAffineSource} from '../drawing/evaluatedAffine';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import type {DeformedDrawing} from '../vectorWarp/evaluation';
import {instanceObjectId,identitySceneShape,type RecordingScene,type SceneSourceResolver,type SceneShapeValue,type SceneSourceObject,type SceneDiagnostic,type Angle} from './model';
import {evaluateShapeTrack} from './tracks';
import {evaluateScene} from './evaluation';

const zero=():Point2=>[0,0];
const nonzero=(p:Point2)=>p[0]!==0||p[1]!==0;
const cubicAt=(shape:Cubic,t:number):Point2=>{const u=1-t,weights=[u*u*u,3*u*u*t,3*u*t*t,t*t*t];return shape.reduce<Point2>((p,q,i)=>add(p,mul(q,weights[i])),[0,0]);};
export interface SceneShapeEvaluationOptions {
 /** The immutable evaluator owns source, provenance and every retained result. */
 retainRevision?:boolean;
 previous?:DeformedDrawing;
 /** Complete canonical Drawing addresses written by the controlled transaction. */
 changes?:DrawingShapeChanges;
}
export interface SceneShapeRevision {readonly previous:DeformedDrawing;readonly dirtyCurveIds:readonly string[]}
const sceneRevisions=new WeakMap<DeformedDrawing,SceneShapeRevision>();
export const sceneShapeRevision=(result:DeformedDrawing)=>sceneRevisions.get(result);
const work={fullApplications:0,revisionApplications:0,materialPlans:0,materialPathPlans:0,transportedTracks:0,reusedTracks:0,fitShifts:0,copiedControlSlots:0,copiedMaterialSlots:0,copiedDiagnosticSlots:0,routePortChecks:0};
export const sceneShapeWorkStats=()=>({...work});
export function resetSceneShapeWorkStats():void {for(const key of Object.keys(work) as (keyof typeof work)[])work[key]=0;}
interface MaterialPlan {
 consumers:Map<string,Set<number>>;
 routeConsumers:Map<string,Set<number>>;
 routes:(readonly [number,number])[][];
}
interface TrackIssue {error:DeformedDrawing['intervalTransportErrors'][number];diagnostic:SceneDiagnostic}
interface SceneShapeProduct {
 before:DeformedDrawing;
 provenance:Record<string,SceneSourceObject>;
 stamp:readonly unknown[];
 shape:DrawingShapeApplication;
 canonical:SceneShapeValue;
 nodes:Set<string>;
 curves:Set<string>;
 nodeSlots:Map<string,number>;
 curveSlots:Map<string,number>;
 fitConsumers:Map<string,number[]>;
 material?:MaterialPlan;
 trackIssues:(TrackIssue|undefined)[];
}
const products=new WeakMap<DeformedDrawing,SceneShapeProduct>();
const sceneStamp=(angle:Angle,useDraft:boolean):readonly unknown[]=>[angle.x,angle.y,useDraft];
const sourceStamp=(result:DeformedDrawing):readonly unknown[]=>[result.drawing,result.drawing.nodes,result.drawing.curves,result.drawing.joins,result.drawing.endpointLinks,result.drawing.layers,result.drawing.fills,result.drawing.offsets,result.drawing.groups,result.drawing.displayIntervals,result.diagnostics,result.intervalTransportErrors,result.warningCurveIds,result.conflictingNodeIds,result.maxError,result.diagnosticStage];
const addConsumer=(map:Map<string,Set<number>>,id:string,index:number)=>{let entries=map.get(id);if(!entries){entries=new Set();map.set(id,entries);}entries.add(index);};
/** Source and destination path support both matter: a per-track source omits
 * other tracks' route choices, while the destination sees the full collection.
 * Existing Drawing path dependencies supply ARC/LINK neighbours. No material
 * formulas are duplicated here. Unknown inherited programs retain full transport. */
function prepareMaterial(before:DrawingDocument,drawing:DrawingDocument):MaterialPlan|undefined {
 if(hasEvaluatedDeformation(before)||evaluatedAffineSource(before))return undefined;
 work.materialPlans++;const consumers=new Map<string,Set<number>>(),routeConsumers=new Map<string,Set<number>>(),routes:MaterialPlan['routes']=[],nodeSlots=new Map(before.nodes.map((node,index)=>[node.id,index])),curves=new Map(before.curves.map(curve=>[curve.id,curve])),tracks=before.displayIntervals??[];
 if(nodeSlots.size!==before.nodes.length||curves.size!==before.curves.length||new Set(tracks.map(track=>track.id)).size!==tracks.length)return undefined;
 return withDrawingReadScope(()=>{
  try{
   for(const track of tracks)if(track.displayRoute){
    if(resolveDisplayRoute(before,track.displayRoute).diagnostics.length||resolveDisplayRoute(drawing,track.displayRoute).diagnostics.length)return undefined;
    const pairs:(readonly [number,number])[]=[],index=routes.length;
    for(const id of track.displayRoute.throughLinkIds){const link=before.endpointLinks?.find(link=>link.id===id);if(!link)return undefined;const a=curves.get(link.a.curveId),b=curves.get(link.b.curveId),ai=a&&nodeSlots.get(a.nodes[link.a.end]),bi=b&&nodeSlots.get(b.nodes[link.b.end]);if(ai===undefined||bi===undefined)return undefined;pairs.push([ai,bi]);addConsumer(routeConsumers,link.a.curveId,index);addConsumer(routeConsumers,link.b.curveId,index);}
    routes.push(pairs);
   }
   for(const [index,track] of tracks.entries()){
    const source={...before,displayIntervals:[track]},paths=[displayPath(source,track.anchor.id),displayPath(drawing,track.anchor.id)];work.materialPathPlans++;
    for(const path of paths){if(!path)return undefined;const closure=drawingMaterialPathDependencies(before,path.segments.map(segment=>segment.id));if(!closure)return undefined;for(const id of closure.dependencies.curveIds)addConsumer(consumers,id,index);}
   }
   return {consumers,routeConsumers,routes};
  }catch{return undefined;}
 });
}
function affectedMaterial(plan:MaterialPlan,drawing:DrawingDocument,dirty:readonly string[]):Set<number>|undefined {
 const affected=new Set<number>(),routes=new Set<number>();
 for(const id of dirty){for(const index of plan.consumers.get(id)??[])affected.add(index);for(const index of plan.routeConsumers.get(id)??[])routes.add(index);}
 for(const index of routes)for(const [a,b] of plan.routes[index]){work.routePortChecks++;const p=drawing.nodes[a]?.position,q=drawing.nodes[b]?.position;if(!p||!q||Math.hypot(p[0]-q[0],p[1]-q[1])>1e-7)return undefined;}
 return affected;
}
function transportTrack(before:DrawingDocument,drawing:DrawingDocument,index:number,provenance:Record<string,SceneSourceObject>):{track:NonNullable<DrawingDocument['displayIntervals']>[number];issue?:TrackIssue} {
 work.transportedTracks++;const track=before.displayIntervals![index];
 try{const next=transportDeformedIntervals({...before,displayIntervals:[track]},drawing).displayIntervals![0],strengths=new Map(track.ranges.map(range=>[range.id,intervalPinch(range)]));return {track:{...structuredClone(next),ranges:next.ranges.map(range=>withIntervalPinch({...range},strengths.get(range.id)??0))}};}
 catch(error){let sourceCurveIds=[track.anchor.id];try{sourceCurveIds=displayPath(before,track.anchor.id).segments.map(segment=>segment.id);}catch{/* Keep the anchor as local diagnostic context. */}const message=error instanceof Error?error.message:String(error),p=provenance[track.id];return {track:structuredClone(track),issue:{error:{trackId:track.id,sourceCurveIds,message},diagnostic:{code:'SHAPE',instanceId:p?.instanceId,trackId:p?.sourceId,message:`Shape material transport: ${message}`}}};}
}
function shiftFit(d:DeformedDrawing['diagnostics'][number],before:DrawingDocument,drawing:DrawingDocument,nodeSlots:ReadonlyMap<string,number>,curveSlots:ReadonlyMap<string,number>){
 const localShape=(drawing:DrawingDocument,id:string)=>{const curve=drawing.curves[curveSlots.get(id)!];return shapeOf({...drawing,curves:[curve],nodes:curve.nodes.map(id=>drawing.nodes[nodeSlots.get(id)!])},id);};
 work.fitShifts++;const curveId=d.sourceCurveId!,old=localShape(before,curveId),cubic=localShape(drawing,curveId),delta=cubic.map((p,i)=>sub(p,old[i])) as Cubic,shift=cubicAt(delta,d.peakT);return {...d,cubic,peakExpected:add(d.peakExpected,shift),peakActual:add(d.peakActual,shift)};
}

/** Apply all instance channels coherently to one transient, post-Warp document.
 * No authoring commands run here: locks never disable an already-authored pose. */
export function applySceneShapes(result:DeformedDrawing,scene:RecordingScene,angle:Angle,useDraft:boolean,provenance:Record<string,SceneSourceObject>,diagnostics:SceneDiagnostic[],options:SceneShapeEvaluationOptions={}):DeformedDrawing {
 if(!scene.shapeTracks?.length&&!options.retainRevision&&!options.previous)return result;
 const before=result.drawing,previous=options.previous,candidate=previous&&products.get(previous),stamp=[...sourceStamp(result),...sceneStamp(angle,useDraft)];
 const prior=candidate&&options.changes?.structureUnchanged&&candidate.provenance===provenance&&stamp.length===candidate.stamp.length&&stamp.every((entry,index)=>entry===candidate.stamp[index])?candidate:undefined;
 const nodes=prior?.nodes??new Set(before.nodes.map(node=>node.id)),curves=prior?.curves??new Set(before.curves.map(curve=>curve.id)),values=new Map((scene.shapeTracks??[]).map(track=>[track.instanceId,{track,value:evaluateShapeTrack(track,angle,useDraft)}]));
 for(const [instanceId,{track,value}] of values){
  for(const id of Object.keys(value.nodes))if(!nodes.has(instanceObjectId(instanceId,id)))diagnostics.push({code:'SHAPE',instanceId,trackId:track.id,sourceObjectId:id,message:'The shape node is missing or outside this instance; its offset is retained.'});
  for(const id of Object.keys(value.handles))if(!curves.has(instanceObjectId(instanceId,id)))diagnostics.push({code:'SHAPE',instanceId,trackId:track.id,sourceObjectId:id,message:'The shape curve is missing or outside this instance; its handle offsets are retained.'});
 }
 let canonical:SceneShapeValue;
 if(prior){
  canonical={nodes:{...prior.canonical.nodes},handles:{...prior.canonical.handles}};
  work.copiedControlSlots+=Object.keys(canonical.nodes).length+Object.keys(canonical.handles).length;
  for(const control of options.changes!.controls){const id=control.kind==='node'?control.nodeId:control.curveId,p=provenance[id],value=p&&values.get(p.instanceId)?.value,kind=control.kind==='node'?'nodes':'handles';if(!(kind==='nodes'?nodes:curves).has(id))continue;
   if(value&&Object.hasOwn(value[kind],p.sourceId))Object.defineProperty(canonical[kind],id,{value:value[kind][p.sourceId],enumerable:true,writable:true,configurable:true});else delete canonical[kind][id];
  }
 }else canonical={
  nodes:Object.fromEntries(before.nodes.flatMap(node=>{const p=provenance[node.id],value=p&&values.get(p.instanceId)?.value;return value&&Object.hasOwn(value.nodes,p.sourceId)?[[node.id,value.nodes[p.sourceId]]]:[];})),
  handles:Object.fromEntries(before.curves.flatMap(curve=>{const p=provenance[curve.id],value=p&&values.get(p.instanceId)?.value;return value&&Object.hasOwn(value.handles,p.sourceId)?[[curve.id,value.handles[p.sourceId]]]:[];})),
 };
 const shape=applyDrawingShapeValue(before,canonical,{retainRevision:options.retainRevision,previous:prior?.shape,changes:prior?options.changes:undefined}),revision=drawingShapeRevision(shape),revising=!!(prior&&revision);
 if(revising)work.revisionApplications++;else work.fullApplications++;
 const {drawing,changed,issues}=shape;for(const issue of issues){const p=issue.targetId===undefined?undefined:provenance[issue.targetId];diagnostics.push({code:'SHAPE',instanceId:p?.instanceId,sourceObjectId:p?.sourceId,message:issue.message});}
 const nodeSlots=prior?.nodeSlots??new Map(before.nodes.map((node,index)=>[node.id,index])),curveSlots=prior?.curveSlots??new Map(before.curves.map((curve,index)=>[curve.id,index]));
 const fitConsumers=prior?.fitConsumers??new Map<string,number[]>();if(!prior)result.diagnostics.forEach((diagnostic,index)=>{if(diagnostic.sourceCurveId&&curves.has(diagnostic.sourceCurveId))fitConsumers.set(diagnostic.sourceCurveId,[...fitConsumers.get(diagnostic.sourceCurveId)??[],index]);});
 let output=result,trackIssues:SceneShapeProduct['trackIssues']=[];
 if(changed){
  const affected=revising&&prior.material?affectedMaterial(prior.material,drawing,revision!.dirtyCurveIds):undefined;
  if(before.displayIntervals?.length){
   trackIssues=revising?[...prior.trackIssues]:[];if(revising){work.copiedMaterialSlots+=before.displayIntervals.length;work.copiedDiagnosticSlots+=prior.trackIssues.length;}
   drawing.displayIntervals=before.displayIntervals.map((_,index)=>{
    if(affected&&!affected.has(index)){work.reusedTracks++;return previous!.drawing.displayIntervals![index];}
    const transported=transportTrack(before,drawing,index,provenance);trackIssues[index]=transported.issue;return transported.track;
   });
  }
  const intervalTransportErrors=[...result.intervalTransportErrors];for(const issue of trackIssues)if(issue){intervalTransportErrors.push(issue.error);diagnostics.push(issue.diagnostic);}
  // Shape intentionally corrects the fitted cubic AND reference target; it
  // shifts diagnostic locations without changing the Warp approximation error.
  if(revising)work.copiedDiagnosticSlots+=previous!.diagnostics.length;
  const fit=revising?[...previous!.diagnostics]:result.diagnostics.map(d=>curves.has(d.sourceCurveId!)?shiftFit(d,before,drawing,nodeSlots,curveSlots):d);
  if(revising)for(const id of revision!.dirtyCurveIds)for(const index of fitConsumers.get(id)??[])fit[index]=shiftFit(result.diagnostics[index],before,drawing,nodeSlots,curveSlots);
  output={...result,drawing,diagnostics:fit,intervalTransportErrors};
 }
 if(options.retainRevision){const material=revising?prior.material:prepareMaterial(before,drawing);products.set(output,{before:result,provenance,stamp,shape,canonical,nodes,curves,nodeSlots,curveSlots,fitConsumers,material,trackIssues});}
 if(revising)sceneRevisions.set(output,Object.freeze({previous:previous!,dirtyCurveIds:revision!.dirtyCurveIds}));
 return output;
}

export interface SceneShapeEdit {instanceId:string;kind:'node'|'handle';nodeId?:string;curveId?:string;end?:0|1;/** Unplaced, post-Warp coordinates. */position:Point2}
/** Drawing's move semantics act on the current evaluated pose. The result is
 * diffed against today's Warp baseline, retaining absent-source authored IDs. */
export function deriveSceneShapeEdit(scene:RecordingScene,resolve:SceneSourceResolver,edit:SceneShapeEdit):SceneShapeValue {
 if(!scene.instances.some(i=>i.id===edit.instanceId))throw Error('Missing scene instance');if(!finitePoint(edit.position))throw Error('Shape position must be finite.');
 const evaluated=evaluateScene(scene,resolve,{omitPlacements:true,diagnostics:'preview'}),base=evaluated.preShapeDrawing,current=evaluated.drawing;
 let next:DrawingDocument;
 if(edit.kind==='node'){
  const id=edit.nodeId&&instanceObjectId(edit.instanceId,edit.nodeId);if(!id||!current.nodes.some(n=>n.id===id))throw Error('The source shape node is missing from this instance.');next=moveNode(current,id,edit.position,true);
 }else{
  const id=edit.curveId&&instanceObjectId(edit.instanceId,edit.curveId);if(!id||!current.curves.some(c=>c.id===id)||edit.end!==0&&edit.end!==1)throw Error('The source shape handle is missing from this instance.');const endpoint={curveId:id,end:edit.end};
  next=moveHandle(current,endpoint,edit.position,true);
 }
 const track=scene.shapeTracks?.find(t=>t.instanceId===edit.instanceId),prior=track?evaluateShapeTrack(track,scene.angle):identitySceneShape();
 const nodes=Object.fromEntries(Object.entries(prior.nodes)),handles=Object.fromEntries(Object.entries(prior.handles));
 const baseNodes=new Map(base.nodes.map(n=>[n.id,n.position])),baseCurves=new Map(base.curves.map(c=>[c.id,c])),currentNodes=new Map(current.nodes.map(n=>[n.id,n.position]));
 const clean=(p:Point2):Point2=>p.map(n=>Math.abs(n)<1e-12?0:n) as Point2;
 for(const node of next.nodes){const p=evaluated.provenance[node.id];if(p?.instanceId!==edit.instanceId||length(sub(node.position,currentNodes.get(node.id)!))<1e-12)continue;const delta=clean(sub(node.position,baseNodes.get(node.id)!));if(nonzero(delta))Object.defineProperty(nodes,p.sourceId,{value:delta,enumerable:true,writable:true,configurable:true});else delete nodes[p.sourceId];}
 for(const curve of next.curves){const p=evaluated.provenance[curve.id];if(p?.instanceId!==edit.instanceId)continue;const old=baseCurves.get(curve.id)!,now=curveById(current,curve.id),priorDelta=Object.hasOwn(handles,p.sourceId)?handles[p.sourceId]:[zero(),zero()];let changed=false;
  const delta=([0,1] as const).map(end=>{const vector=sub(curve.handles[end],nodeAt(next,{curveId:curve.id,end}).position),currentVector=sub(now.handles[end],currentNodes.get(now.nodes[end])!);if(length(sub(vector,currentVector))<1e-12)return priorDelta[end];changed=true;return clean(sub(vector,sub(old.handles[end],baseNodes.get(old.nodes[end])!)));}) as [Point2,Point2];
  if(changed){if(delta.some(nonzero))Object.defineProperty(handles,p.sourceId,{value:delta,enumerable:true,writable:true,configurable:true});else delete handles[p.sourceId];}
 }
 return {nodes,handles};
}
