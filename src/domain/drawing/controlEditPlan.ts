import {endKey,type DrawingDocument,type DrawingCurve,type DrawingNode,type Endpoint,type Point2} from './model';
import {deriveSmoothComponents} from '../endpointRelations/smoothComponent';
import {dragNode} from './nodeDrag';
import {moveHandle,transform} from './commands';
import {applyMirrorEditing,mirrorWritesForCurves} from './mirrorEditing';
import {applyScenePlacement} from '../recordingScene/tracks';
import type {ScenePlacementValue} from '../recordingScene/model';
import {markFinalizedGeometry} from './geometryEdit';
import {applyLayerDomainIntent,type LayerCageDomainIntent} from './layerDomainIntent';

export type DrawingScalarControl={readonly kind:'node';readonly nodeId:string}|{readonly kind:'handle';readonly curveId:string;readonly end:0|1};
type SmoothComponent=ReturnType<typeof deriveSmoothComponents>[number];
export interface DrawingControlDependencyIndex {
 readonly curves:ReadonlyMap<string,DrawingCurve>;readonly nodes:ReadonlyMap<string,DrawingNode>;
 readonly nodeIncidence:ReadonlyMap<string,readonly Endpoint[]>;readonly linkedNodes:ReadonlyMap<string,readonly string[]>;
 readonly nodeAuthorities:ReadonlyMap<string,string>;readonly smoothComponents:readonly SmoothComponent[];
 readonly smoothByHandle:ReadonlyMap<string,SmoothComponent>;readonly handleFollowers:ReadonlyMap<string,readonly Endpoint[]>;
 readonly nodeFollowers:ReadonlyMap<string,readonly string[]>;readonly curvePositions:ReadonlyMap<string,number>;readonly nodePositions:ReadonlyMap<string,number>;
}
const dependencies=new WeakMap<DrawingDocument,DrawingControlDependencyIndex>();
const work={dependencyIndexes:0,plans:0,scopedAuthoring:0,fullAuthoring:0,authoredCurves:0,capturedControls:0};
export const drawingControlEditStats=()=>({...work});
const append=<T>(map:Map<string,T[]>,key:string,value:T)=>{const values=map.get(key);if(values)values.push(value);else map.set(key,[value]);};
/** Frozen-document reverse addresses shared by authoring and recording. No
 * positions or relation graphs are rediscovered during a pointer update. */
export function drawingControlDependencyIndex(drawing:DrawingDocument):DrawingControlDependencyIndex {
 const known=dependencies.get(drawing);if(known)return known;work.dependencyIndexes++;
 const curves=new Map(drawing.curves.map(c=>[c.id,c])),nodes=new Map(drawing.nodes.map(n=>[n.id,n])),nodeIncidence=new Map<string,Endpoint[]>(),links=new Map<string,string[]>();
 for(const curve of drawing.curves)for(const end of [0,1] as const)append(nodeIncidence,curve.nodes[end],{curveId:curve.id,end});
 for(const link of drawing.endpointLinks??[]){const a=curves.get(link.a.curveId)?.nodes[link.a.end],b=curves.get(link.b.curveId)?.nodes[link.b.end];if(a&&b){append(links,a,b);append(links,b,a);}}
 const linkedNodes=new Map<string,readonly string[]>(),nodeAuthorities=new Map<string,string>();
 for(const id of nodes.keys())if(!linkedNodes.has(id)){const ids=[id],seen=new Set(ids);for(const next of ids)for(const other of links.get(next)??[])if(!seen.has(other)){seen.add(other);ids.push(other);}const authority=[...ids].sort()[0];for(const member of ids){linkedNodes.set(member,ids);nodeAuthorities.set(member,authority);}}
 const smoothComponents=deriveSmoothComponents([...drawing.joins.filter(j=>j.mode==='SMOOTH'),...(drawing.endpointLinks??[]).filter(l=>l.joinBrush?.kind==='SMOOTH')]),smoothByHandle=new Map<string,SmoothComponent>(),handleFollowers=new Map<string,Endpoint[]>(),nodeFollowers=new Map<string,string[]>();
 for(const component of smoothComponents)for(const member of component.members){smoothByHandle.set(endKey(member.endpoint),component);for(const other of component.members)append(handleFollowers,endKey(member.endpoint),other.endpoint);}
 for(const [id,ids] of linkedNodes)for(const other of ids)append(nodeFollowers,id,other);
 if(drawing.mirrorEditing?.enabled)for(const pair of drawing.mirrorEditing.curvePairs){const a=curves.get(pair.a),b=curves.get(pair.b);if(!a||!b)continue;for(const end of [0,1] as const){const other=(pair.reverse?1-end:end) as 0|1;append(handleFollowers,endKey({curveId:a.id,end}),{curveId:b.id,end:other});append(handleFollowers,endKey({curveId:b.id,end:other}),{curveId:a.id,end});append(nodeFollowers,a.nodes[end],b.nodes[other]);append(nodeFollowers,b.nodes[other],a.nodes[end]);}}
 const index:DrawingControlDependencyIndex={curves,nodes,nodeIncidence,linkedNodes,nodeAuthorities,smoothComponents,smoothByHandle,handleFollowers,nodeFollowers,curvePositions:new Map(drawing.curves.map((c,i)=>[c.id,i])),nodePositions:new Map(drawing.nodes.map((n,i)=>[n.id,i]))};dependencies.set(drawing,index);return index;
}
export type DrawingControlEditIntent=
 |{readonly kind:'node';readonly nodeId:string;readonly followStrength?:number}
 |{readonly kind:'handle';readonly endpoint:Endpoint}
 |{readonly kind:'curves';readonly curveIds:readonly string[];readonly preserveRelations?:boolean}
 |{readonly kind:'domain';readonly layerIds:readonly string[];readonly curveIds?:readonly string[]};
export interface DrawingControlEditPlan {
 readonly before:DrawingDocument;readonly intent:DrawingControlEditIntent;readonly controls:readonly DrawingScalarControl[];
 readonly curveIds:readonly string[];readonly nodeIds:readonly string[];readonly structureUnchanged:true;
 /** Complex material/domain producers retain the canonical complete operation. */
 readonly fallbackReason?:string;
}
interface InternalPlan {index:DrawingControlDependencyIndex;scope:DrawingDocument;nodeIds:ReadonlySet<string>;handleKeys:ReadonlySet<string>;curveIds:ReadonlySet<string>}
const planCache=new WeakMap<DrawingDocument,Map<string,DrawingControlEditPlan>>();
const plans=new WeakMap<DrawingControlEditPlan,InternalPlan>(),proofs=new WeakMap<DrawingDocument,DrawingControlEditPlan>();
/** Selection is a seed, never a dirty set. Nodes close over links and mirror
 * followers; adjacent relative handles then close over SMOOTH and mirrors. */
export function prepareDrawingControlEditPlan(before:DrawingDocument,intent:DrawingControlEditIntent):DrawingControlEditPlan {
 let cache=planCache.get(before);if(!cache){cache=new Map();planCache.set(before,cache);}const cacheKey=JSON.stringify(intent),known=cache.get(cacheKey);if(known)return known;
 const index=drawingControlDependencyIndex(before),nodeIds=new Set<string>(),handles=new Map<string,Endpoint>(),directIds=intent.kind==='curves'?intent.curveIds:intent.kind==='domain'?intent.curveIds??before.layers.filter(l=>intent.layerIds.includes(l.id)).flatMap(l=>l.items).filter(id=>index.curves.has(id)):[];
 const addHandle=(endpoint:Endpoint)=>{if(!index.curves.has(endpoint.curveId))throw Error('The selected curve no longer exists.');handles.set(endKey(endpoint),endpoint);};
 if(intent.kind==='node')nodeIds.add(intent.nodeId);else if(intent.kind==='handle')addHandle(intent.endpoint);else for(const id of directIds){const curve=index.curves.get(id);if(!curve)throw Error('The selected curve no longer exists.');for(const end of [0,1] as const){nodeIds.add(curve.nodes[end]);addHandle({curveId:id,end});}}
 const queue=[...nodeIds];for(const id of queue){if(!index.nodes.has(id))throw Error('The selected node no longer exists.');for(const other of index.nodeFollowers.get(id)??[])if(!nodeIds.has(other)){nodeIds.add(other);queue.push(other);}for(const endpoint of index.nodeIncidence.get(id)??[])addHandle(endpoint);}
 const handleQueue=[...handles.values()];for(const endpoint of handleQueue)for(const other of index.handleFollowers.get(endKey(endpoint))??[])if(!handles.has(endKey(other))){addHandle(other);handleQueue.push(other);}
 const curveIds=new Set([...handles.values()].map(e=>e.curveId)),readNodes=new Set([...curveIds].flatMap(id=>index.curves.get(id)!.nodes)),hasCurves=(r:{a:Endpoint;b:Endpoint})=>curveIds.has(r.a.curveId)&&curveIds.has(r.b.curveId);
 const curveList=[...curveIds].sort((a,b)=>index.curvePositions.get(a)!-index.curvePositions.get(b)!),nodeList=[...nodeIds].sort((a,b)=>index.nodePositions.get(a)!-index.nodePositions.get(b)!);
 const mirror=before.mirrorEditing,scope:DrawingDocument={...before,curves:curveList.map(id=>index.curves.get(id)!),nodes:[...readNodes].sort((a,b)=>index.nodePositions.get(a)!-index.nodePositions.get(b)!).map(id=>index.nodes.get(id)!),joins:before.joins.filter(hasCurves),endpointLinks:before.endpointLinks?.filter(hasCurves),fills:[],offsets:[],displayIntervals:[],mirrorEditing:mirror?{...mirror,curvePairs:mirror.curvePairs.filter(pair=>curveIds.has(pair.a)&&curveIds.has(pair.b)),axisNodeIds:mirror.axisNodeIds?.filter(id=>readNodes.has(id))}:undefined};
 const fallbackReason=intent.kind==='domain'?'live-domain-scope':scope.curves.some(c=>!c.visible)?'hidden-container-members':undefined;
 const controls:DrawingScalarControl[]=[...nodeList.map(nodeId=>Object.freeze({kind:'node' as const,nodeId})),...handleQueue.map(e=>Object.freeze({kind:'handle' as const,curveId:e.curveId,end:e.end}))];
 const plan:DrawingControlEditPlan=Object.freeze({before,intent:structuredClone(intent),controls:Object.freeze(controls),curveIds:Object.freeze(curveList),nodeIds:Object.freeze(nodeList),structureUnchanged:true,...fallbackReason?{fallbackReason}:{}});plans.set(plan,{index,scope,nodeIds,handleKeys:new Set(handles.keys()),curveIds});work.plans++;cache.set(cacheKey,plan);return plan;
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
  // Domain/material edits use their canonical dynamic membership path. A later
  // membership or parameter change cannot be represented by stale point hints.
  next=applyLayerDomainIntent(before,value.intent).document;

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
 const internal=plans.get(plan);if(!internal)throw Error('Unknown Drawing control edit plan.');const before=plan.before,nodes=before.nodes.slice(),curves=before.curves.slice(),changedCurves=new Map<string,DrawingCurve>();
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
