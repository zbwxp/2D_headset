import {endKey,type DrawingDocument,type DrawingCurve,type Endpoint,type Point2} from './model';
import {drawingControlDependencyIndex,drawingControlDependencyStats,type DrawingControlDependencyIndex} from './controlDependencyIndex';
export {drawingControlDependencyIndex,type DrawingControlDependencyIndex} from './controlDependencyIndex';
import {prepareDrawingLayerDomainPlan,type DrawingLayerDomainPlan} from './layerDomainEditPlan';
import {dragNode} from './nodeDrag';
import {moveHandle,transform} from './commands';
import {applyMirrorEditing,mirrorWritesForCurves} from './mirrorEditing';
import {applyScenePlacement} from '../recordingScene/tracks';
import type {ScenePlacementValue} from '../recordingScene/model';
import {markFinalizedGeometry} from './geometryEdit';
import {applyLayerDomainIntent,type LayerCageDomainIntent} from './layerDomainIntent';
import type {LayerCageStrokeScope} from '../recordingSnapshot/layerCageScope';

export type DrawingScalarControl={readonly kind:'node';readonly nodeId:string}|{readonly kind:'handle';readonly curveId:string;readonly end:0|1};
const work={plans:0,scopedAuthoring:0,fullAuthoring:0,authoredCurves:0,capturedControls:0,nodeArrayCopiedSlots:0,curveArrayCopiedSlots:0};
export const drawingControlEditStats=()=>({...drawingControlDependencyStats(),...work});
export type DrawingControlEditIntent=
 |{readonly kind:'node';readonly nodeId:string;readonly followStrength?:number}
 |{readonly kind:'handle';readonly endpoint:Endpoint}
 |{readonly kind:'curves';readonly curveIds:readonly string[];readonly preserveRelations?:boolean}
 |{readonly kind:'domain';readonly layerIds:readonly string[];readonly curveIds?:readonly string[];readonly strokeScope?:LayerCageStrokeScope};
export interface DrawingControlEditPlan {
 readonly before:DrawingDocument;readonly intent:DrawingControlEditIntent;readonly controls:readonly DrawingScalarControl[];
 readonly curveIds:readonly string[];readonly nodeIds:readonly string[];readonly structureUnchanged:true;
 /** Complex material/domain producers retain the canonical complete operation. */
 readonly fallbackReason?:string;
}
interface InternalPlan {domainPlan?:DrawingLayerDomainPlan;index:DrawingControlDependencyIndex;scope:DrawingDocument;nodeIds:ReadonlySet<string>;handleKeys:ReadonlySet<string>;curveIds:ReadonlySet<string>}
const planCache=new WeakMap<DrawingDocument,Map<string,DrawingControlEditPlan>>();
const plans=new WeakMap<DrawingControlEditPlan,InternalPlan>(),proofs=new WeakMap<DrawingDocument,DrawingControlEditPlan>();
/** Selection is a seed, never a dirty set. Nodes close over links and mirror
 * followers; adjacent relative handles then close over SMOOTH and mirrors. */
export function prepareDrawingControlEditPlan(before:DrawingDocument,intent:DrawingControlEditIntent):DrawingControlEditPlan {
 let cache=planCache.get(before);if(!cache){cache=new Map();planCache.set(before,cache);}const cacheKey=JSON.stringify(intent),known=cache.get(cacheKey);if(known)return known;
 const domainPlan=intent.kind==='domain'?prepareDrawingLayerDomainPlan(before,intent):undefined,index=drawingControlDependencyIndex(before),nodeIds=new Set<string>(),handles=new Map<string,Endpoint>(),directIds=intent.kind==='curves'?intent.curveIds:intent.kind==='domain'?intent.curveIds??domainPlan!.curveIds:[];
 const addHandle=(endpoint:Endpoint)=>{if(!index.curves.has(endpoint.curveId))throw Error('The selected curve no longer exists.');handles.set(endKey(endpoint),endpoint);};
 if(intent.kind==='node')nodeIds.add(intent.nodeId);else if(intent.kind==='handle')addHandle(intent.endpoint);else for(const id of directIds){const curve=index.curves.get(id);if(!curve)throw Error('The selected curve no longer exists.');for(const end of [0,1] as const){nodeIds.add(curve.nodes[end]);addHandle({curveId:id,end});}}
 const queue=[...nodeIds];for(const id of queue){if(!index.nodes.has(id))throw Error('The selected node no longer exists.');for(const other of index.nodeFollowers.get(id)??[])if(!nodeIds.has(other)){nodeIds.add(other);queue.push(other);}for(const endpoint of index.nodeIncidence.get(id)??[])addHandle(endpoint);}
 const handleQueue=[...handles.values()];for(const endpoint of handleQueue)for(const other of index.handleFollowers.get(endKey(endpoint))??[])if(!handles.has(endKey(other))){addHandle(other);handleQueue.push(other);}
 const curveIds=new Set([...handles.values()].map(e=>e.curveId)),readCurveIds=new Set(curveIds);
 // ARC does not propagate a handle write, but its incident relation still
 // constrains the grabbed handle. Retain its partner as a read dependency so
 // the canonical command sees joinAt and applies its own noncollapse guard.
 for(const join of before.joins)if(join.mode==='ARC'&&(handles.has(endKey(join.a))||handles.has(endKey(join.b)))){readCurveIds.add(join.a.curveId);readCurveIds.add(join.b.curveId);}
 const readNodes=new Set([...readCurveIds].flatMap(id=>index.curves.get(id)!.nodes)),hasCurves=(r:{a:Endpoint;b:Endpoint})=>readCurveIds.has(r.a.curveId)&&readCurveIds.has(r.b.curveId);
 const inCurveOrder=(ids:Iterable<string>)=>[...ids].sort((a,b)=>index.curvePositions.get(a)!-index.curvePositions.get(b)!);
 const curveList=inCurveOrder(curveIds),readCurveList=inCurveOrder(readCurveIds),nodeList=[...nodeIds].sort((a,b)=>index.nodePositions.get(a)!-index.nodePositions.get(b)!);
 const mirror=before.mirrorEditing,scope:DrawingDocument={...before,curves:readCurveList.map(id=>index.curves.get(id)!),nodes:[...readNodes].sort((a,b)=>index.nodePositions.get(a)!-index.nodePositions.get(b)!).map(id=>index.nodes.get(id)!),joins:before.joins.filter(hasCurves),endpointLinks:before.endpointLinks?.filter(hasCurves),fills:[],offsets:[],displayIntervals:[],mirrorEditing:mirror?{...mirror,curvePairs:mirror.curvePairs.filter(pair=>curveIds.has(pair.a)&&curveIds.has(pair.b)),axisNodeIds:mirror.axisNodeIds?.filter(id=>readNodes.has(id))}:undefined};
 const fallbackReason=intent.kind==='domain'?'live-domain-scope':curveList.some(id=>!index.curves.get(id)!.visible)?'hidden-container-members':undefined;
 const controls:DrawingScalarControl[]=[...nodeList.map(nodeId=>Object.freeze({kind:'node' as const,nodeId})),...handleQueue.map(e=>Object.freeze({kind:'handle' as const,curveId:e.curveId,end:e.end}))];
 const plan:DrawingControlEditPlan=Object.freeze({before,intent:structuredClone(intent),controls:Object.freeze(controls),curveIds:Object.freeze(curveList),nodeIds:Object.freeze(nodeList),structureUnchanged:true,...fallbackReason?{fallbackReason}:{}});plans.set(plan,{domainPlan,index,scope,nodeIds,handleKeys:new Set(handles.keys()),curveIds});work.plans++;cache.set(cacheKey,plan);return plan;
}
export type DrawingControlEditValue={kind:'point';position:Point2}|{kind:'map';map:(point:Point2)=>Point2;allowRelated?:boolean}|{kind:'transform';value:ScenePlacementValue}|{kind:'cage';intent:LayerCageDomainIntent};
/** Shared authoring adapter. Existing Drawing commands own all geometry math.
 * A scoped operation uses the compiled closure; merging preserves every other
 * control and all topology/appearance identities by construction. */
export function applyDrawingControlEditPlan(plan:DrawingControlEditPlan,value:DrawingControlEditValue):DrawingDocument {
 const internal=plans.get(plan);if(!internal)throw Error('Unknown Drawing control edit plan.');const {before,intent}=plan,base=plan.fallbackReason?before:internal.scope;
 const execute=(base:DrawingDocument):DrawingDocument=>{work[base===before?'fullAuthoring':'scopedAuthoring']++;work.authoredCurves+=base.curves.length;let next:DrawingDocument;
 if(intent.kind==='node'&&value.kind==='point')next=applyMirrorEditing(base,dragNode(base,intent.nodeId,value.position,intent.followStrength??0),{nodes:[{nodeId:intent.nodeId,position:value.position}]});
 else if(intent.kind==='handle'&&value.kind==='point')next=applyMirrorEditing(base,moveHandle(base,intent.endpoint,value.position),{handles:[{...intent.endpoint,position:value.position}]});
 else if(intent.kind==='curves'&&(value.kind==='transform'||value.kind==='map')){const raw=transform(base,[...intent.curveIds],value.kind==='map'?value.map:point=>applyScenePlacement(value.value,point),value.kind==='map'&&value.allowRelated===true),target=intent.preserveRelations?{...raw,joins:base.joins}:raw;next=applyMirrorEditing(base,target,value.kind==='map'?mirrorWritesForCurves(target,intent.curveIds):{});}
 else if(intent.kind==='domain'&&value.kind==='cage'){
  if(JSON.stringify(intent.layerIds)!==JSON.stringify(value.intent.scope.layerIds))throw Error('The cage scope changed during this gesture.');
  // Reuse the frozen semantic membership, while the canonical complete
  // operation still owns fitting, relations and material transport.
  next=applyLayerDomainIntent(before,value.intent,{scopePlan:internal.domainPlan}).document;

 }else throw Error('The Drawing operation does not match its frozen selection.');
 return next;};
 const next=execute(base);
 if(next.joins!==base.joins&&JSON.stringify(next.joins)!==JSON.stringify(base.joins)||next.displayIntervals!==base.displayIntervals&&JSON.stringify(next.displayIntervals)!==JSON.stringify(base.displayIntervals))return base===before?next:execute(before);
 const nodes=new Map(next.nodes.map(n=>[n.id,n])),curves=new Map(next.curves.map(c=>[c.id,c]));
 // Canonical fallback output is checked once in full. Never drop unexpected
 // followers merely because they were absent from the declared selection.
 for(const node of base.nodes)if(!internal.nodeIds.has(node.id)&&JSON.stringify(node.position)!==JSON.stringify(nodes.get(node.id)?.position))return execute(before);
 for(const curve of base.curves)for(const end of [0,1] as const)if(!internal.handleKeys.has(endKey({curveId:curve.id,end}))&&JSON.stringify(curve.handles[end])!==JSON.stringify(curves.get(curve.id)?.handles[end]))return execute(before);
 if(plan.fallbackReason){for(const node of before.nodes)if(!internal.nodeIds.has(node.id)&&JSON.stringify(node.position)!==JSON.stringify(nodes.get(node.id)?.position))return next;for(const curve of before.curves)for(const end of [0,1] as const)if(!internal.handleKeys.has(endKey({curveId:curve.id,end}))&&JSON.stringify(curve.handles[end])!==JSON.stringify(curves.get(curve.id)?.handles[end]))return next;}
 const nodePositions=new Map([...internal.nodeIds].map(id=>[id,nodes.get(id)!.position])),handlePositions=[...internal.handleKeys].map(key=>{const endpoint=plan.controls.find(control=>control.kind==='handle'&&endKey(control)===key) as Extract<DrawingScalarControl,{kind:'handle'}>;return {...endpoint,position:curves.get(endpoint.curveId)!.handles[endpoint.end]};});
 const result=applyDrawingControlWrites(plan,{nodePositions,handlePositions});return before.displayIntervals?.length?result:markFinalizedGeometry(result);
}
/** The controlled scalar producer used by inverse basis edits. Explicit
 * addresses can only replace controls inside this compiled plan; all other
 * geometry and metadata come from its frozen source. */
export function applyDrawingControlWrites(plan:DrawingControlEditPlan,writes:{nodePositions?:ReadonlyMap<string,Point2>;handlePositions?:readonly (Endpoint&{position:Point2})[]}):DrawingDocument {
 const internal=plans.get(plan);if(!internal)throw Error('Unknown Drawing control edit plan.');const before=plan.before,nodes=writes.nodePositions?.size?before.nodes.slice():before.nodes,curves=writes.handlePositions?.length?before.curves.slice():before.curves,changedCurves=new Map<string,DrawingCurve>();
 if(nodes!==before.nodes)work.nodeArrayCopiedSlots+=nodes.length;if(curves!==before.curves)work.curveArrayCopiedSlots+=curves.length;
 for(const [id,position] of writes.nodePositions??[]){if(!internal.nodeIds.has(id)||position.length!==2||!position.every(Number.isFinite))throw Error('A node write is outside the frozen control plan.');const at=internal.index.nodePositions.get(id)!;nodes[at]={...nodes[at],position:[...position]};}
 for(const write of writes.handlePositions??[]){if(!internal.handleKeys.has(endKey(write))||write.position.length!==2||!write.position.every(Number.isFinite))throw Error('A handle write is outside the frozen control plan.');const at=internal.index.curvePositions.get(write.curveId)!;let curve=changedCurves.get(write.curveId);if(!curve){curve={...curves[at],handles:[...curves[at].handles]};changedCurves.set(write.curveId,curve);curves[at]=curve;}curve.handles[write.end]=[...write.position];}
 const result={...before,nodes,curves};proofs.set(result,plan);work.capturedControls+=plan.controls.length;return result;
}
/** Nonserializable provenance. Passing a selection or a fabricated descriptor
 * cannot bypass external target validation. */
export function drawingControlEditProof(before:DrawingDocument,wanted:DrawingDocument,plan?:DrawingControlEditPlan):DrawingControlEditPlan|undefined {const known=proofs.get(wanted);return known?.before===before&&(!plan||plan===known)?known:undefined;}
/** Build a bounded read view from existing indexed addresses. This carries the
 * full owner/relation metadata; it does not evaluate or alter any geometry. */
export function drawingControlPlanView(drawing:DrawingDocument,plan:DrawingControlEditPlan):DrawingDocument {
 const internal=plans.get(plan);if(!internal)throw Error('Unknown Drawing control edit plan.');const index=internal.index;
 const curves=plan.curveIds.map(id=>drawing.curves[index.curvePositions.get(id)!]);
 const nodeIds=new Set(curves.flatMap(curve=>curve.nodes));
 return {...drawing,curves,nodes:[...nodeIds].map(id=>drawing.nodes[index.nodePositions.get(id)!])};
}
