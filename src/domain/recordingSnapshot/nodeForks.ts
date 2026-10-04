import {replaySnapshotTopologyMaterial} from './inheritedTopologyMaterial';
import {cageEvaluationDependencyContext,retainCageEvaluationDependencyContext} from './cageEvaluationDependencies';
import type {EvaluatedMaterialStep} from '../drawing/materialProgram';
import {hasEvaluatedDeformation,hasEvaluatedDeformationFor,retainEvaluatedDeformations,evaluatedMaterialSource,evaluatedMaterialProgram} from '../drawing/evaluatedDeformation';
import {nodeAt,members,type DrawingDocument,type Endpoint} from '../drawing/model';
import {evaluatedAffine,evaluatedAffineSource,registerEvaluatedAffine} from '../drawing/evaluatedAffine';
import {retainSnapshotAffines} from './elementPlacement';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';
import {normalizeSnapshotNodeAliases,SnapshotNodeAliasError,type SnapshotNodeAliases} from './nodeAliases';
import type {SnapshotDiagnostic} from './model';
import type {CurveSplitIntent} from '../drawing/layerEditIntent';

/** A local node identity with a live source-endpoint origin. bind:false retains
 * an origin used by another branch after its initiating endpoint detaches again. */
export interface SnapshotNodeFork extends Endpoint {bind?:false;/** Local curve splitting changes the bound child, not this live origin. */source?:Endpoint}
export type SnapshotNodeForks=Record<string,SnapshotNodeFork>;
/** The command cause is explicit; arbitrary node-ID replacement is not unbind. */
export interface SnapshotNodeUnbindIntent {kind:'snapshot-node-unbind';snapshotId:string;endpoint:Endpoint;beforeNodeId:string;nodeId:string}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const validId=(id:unknown):id is string=>typeof id==='string'&&!!id&&id.length<=16384;
const fail=(message:string):never=>{throw Error(`Invalid Snapshot node unbind: ${message}`);};
export function validateSnapshotNodeForks(forks:unknown):asserts forks is SnapshotNodeForks {
 if(!forks||typeof forks!=='object'||Array.isArray(forks)||Object.keys(forks).length>65536)fail('expected a bounded node-origin map.');
 const ends=new Set<string>();for(const [id,raw] of Object.entries(forks as Record<string,unknown>)){
  if(!validId(id)||!raw||typeof raw!=='object'||Array.isArray(raw))fail('invalid local node identity.');const value=raw as SnapshotNodeFork;
  if(Object.keys(value).some(key=>!['curveId','end','bind','source'].includes(key))||!validId(value.curveId)||value.end!==0&&value.end!==1||value.bind!==undefined&&value.bind!==false)fail('invalid source endpoint.');
  if(value.source!==undefined&&(!value.source||typeof value.source!=='object'||Array.isArray(value.source)||!validId(value.source.curveId)||value.source.end!==0&&value.source.end!==1||Object.keys(value.source).some(key=>key!=='curveId'&&key!=='end')))fail('invalid retained source endpoint.');
  const key=JSON.stringify([value.curveId,value.end]);if(value.bind!==false){if(ends.has(key))fail('one endpoint has multiple local node authorities.');ends.add(key);}
 }
}
export function createSnapshotNodeUnbindIntent(snapshotId:string,before:DrawingDocument,after:DrawingDocument,endpoint:Endpoint):SnapshotNodeUnbindIntent|undefined {
 const beforeNodeId=nodeAt(before,endpoint)?.id,nodeId=nodeAt(after,endpoint)?.id;if(beforeNodeId===nodeId)return undefined;
 if(!validId(snapshotId)||!beforeNodeId||!nodeId||members(before,beforeNodeId).length<2||before.nodes.some(node=>node.id===nodeId))fail('the unbind command requires a shared endpoint and a fresh Drawing node ID.');
 return {kind:'snapshot-node-unbind',snapshotId,endpoint:{...endpoint},beforeNodeId,nodeId};
}
export function mapSnapshotNodeUnbindIntent(intent:SnapshotNodeUnbindIntent,map:(id:string)=>string):SnapshotNodeUnbindIntent {return {...intent,endpoint:{...intent.endpoint,curveId:map(intent.endpoint.curveId)},beforeNodeId:map(intent.beforeNodeId),nodeId:map(intent.nodeId)};}
export const snapshotForkForEndpoint=(forks:SnapshotNodeForks|undefined,endpoint:Endpoint)=>Object.entries(forks??{}).find(([,fork])=>fork.bind!==false&&fork.curveId===endpoint.curveId&&fork.end===endpoint.end)?.[0];
function forkDrawing(drawing:DrawingDocument,forks:SnapshotNodeForks,origins:readonly DrawingDocument[]=[]):DrawingDocument {
 const curves=new Map(drawing.curves.map(curve=>[curve.id,curve])),nodes=new Map(drawing.nodes.map(node=>[node.id,node])),ends=new Map<string,string>();
 for(const [id,fork] of Object.entries(forks)){const origin=fork.source??fork,source=[drawing,...origins].find(value=>value.curves.some(curve=>curve.id===origin.curveId)),curve=source?.curves.find(curve=>curve.id===origin.curveId);if(!curve||!source)continue;const node=source.nodes.find(node=>node.id===curve.nodes[origin.end]);if(!node)fail(`source endpoint ${origin.curveId}:${origin.end} has no current node.`);nodes.set(id,{id,position:[...node!.position]});if(fork.bind!==false&&curves.has(fork.curveId))ends.set(JSON.stringify([fork.curveId,fork.end]),id);}
 return {...drawing,nodes:[...nodes.values()],curves:drawing.curves.map(curve=>({...curve,nodes:curve.nodes.map((id,end)=>ends.get(JSON.stringify([curve.id,end]))??id) as [string,string]}))};
}
/** Child-owned curves may already share a runtime fork before inherited fields
 * are replayed. Materialize only their missing canonical input nodes; the full
 * endpoint identity adaptation still runs once at the normal topology stage. */
export function materializeSnapshotForkInputs(drawing:DrawingDocument,forks:SnapshotNodeForks|undefined,origins:readonly DrawingDocument[]):DrawingDocument {
 if(!forks)return drawing;const present=new Set(drawing.nodes.map(node=>node.id)),needed=new Set(drawing.curves.flatMap(curve=>curve.nodes).filter(id=>Object.hasOwn(forks,id)&&!present.has(id)));if(!needed.size)return drawing;
 const material=evaluatedMaterialSource(drawing),resolved=forkDrawing(material,forks,origins.map(evaluatedMaterialSource)),nodes=resolved.nodes.filter(node=>needed.has(node.id));
 if(nodes.length!==needed.size)throw new SnapshotNodeAliasError('NODE_FORK_MATERIAL_CONFLICT','A local curve references a fork whose live canonical endpoint is unavailable. No source or Snapshot was changed.');
 return retainCageEvaluationDependencyContext(retainSnapshotAffines({...drawing,nodes:[...drawing.nodes,...nodes]},[drawing]),[drawing]);
}
export function applySnapshotNodeForks(drawing:DrawingDocument,forks:SnapshotNodeForks|undefined,diagnostics:SnapshotDiagnostic[],snapshotId:string,origins:readonly DrawingDocument[]=[],sourceForLayer?:(layerId:string,representativeCurveId:string)=>DrawingDocument|undefined):DrawingDocument {
 if(!forks||!Object.keys(forks).length)return drawing;validateSnapshotNodeForks(forks);
 const active:SnapshotNodeForks={};for(const [id,fork] of Object.entries(forks))if([drawing,...origins].some(value=>value.curves.some(curve=>curve.id===(fork.source??fork).curveId)))active[id]=fork;else diagnostics.push({code:'MISSING_ELEMENT',snapshotId,elementId:id,message:`Local node ${id} is inactive because source curve ${fork.curveId} is outside this Snapshot's membership.`});
 if(!Object.keys(active).length)return drawing;
 if([drawing,...origins].some(input=>hasEvaluatedDeformation(input)&&Object.values(active).some(fork=>hasEvaluatedDeformationFor(input,fork.curveId)||hasEvaluatedDeformationFor(input,(fork.source??fork).curveId)))){
  const inputs=[drawing,...origins].map(input=>evaluatedMaterialSource(cageEvaluationDependencyContext(input))),target=retainSnapshotAffines(forkDrawing(drawing,active,origins),[drawing]),material=forkDrawing(evaluatedMaterialSource(drawing),active,inputs.slice(1)),programs=new Map<string,EvaluatedMaterialStep[]>();
  // A fork duplicates a live node's identity at each retained correction stage.
  // Relative handles and the existing field descriptors remain unchanged.
  const nodeOrigins=new Map(Object.entries(active).flatMap(([id,fork])=>{const origin=fork.source??fork,curve=inputs.map(input=>input.curves.find(curve=>curve.id===origin.curveId)).find(Boolean);return curve?[[id,curve.nodes[origin.end]] as const]:[];}));
  const adapt=(steps:readonly EvaluatedMaterialStep[]):EvaluatedMaterialStep[]=>steps.map(step=>{if(step.kind==='reflected')return {...step,steps:adapt(step.steps)};if(step.kind!=='post-shape')return step;const nodes={...step.value.nodes};for(const [id,origin] of nodeOrigins)if(Object.hasOwn(nodes,origin))nodes[id]=[...nodes[origin]];return {...step,value:{...step.value,nodes}};});
  for(const curve of drawing.curves){const steps=evaluatedMaterialProgram(drawing,curve.id);if(!steps)throw new SnapshotNodeAliasError('NODE_FORK_MATERIAL_CONFLICT',`Curve ${curve.id} has no replayable material lineage for the requested endpoint fork.`);if(steps.length)programs.set(curve.id,adapt(steps));}
  return retainSnapshotRouteMaterialInput(replaySnapshotTopologyMaterial(target,material,programs,(layerId,curveId)=>{const parent=sourceForLayer?.(layerId,curveId);return parent?forkDrawing(evaluatedMaterialSource(cageEvaluationDependencyContext(parent)),active,inputs):undefined;}),drawing);
 }
 const result=forkDrawing(drawing,active,origins),material=evaluatedAffineSource(drawing);
 retainEvaluatedDeformations(result,[drawing]);
 if(material)registerEvaluatedAffine(result,forkDrawing(material,active,origins.map(value=>evaluatedAffineSource(value)??value)),id=>evaluatedAffine(drawing,id)??(active[id]?evaluatedAffine(drawing,active[id].curveId):undefined));
 return retainSnapshotRouteMaterialInput(result,drawing);
}
/** Old source identities remain available until aliases have consumed them.
 * Then only actual curve-owned nodes enter downstream picking and rendering. */
export function pruneSnapshotTopologyNodes(drawing:DrawingDocument):DrawingDocument {
 const used=new Set(drawing.curves.flatMap(curve=>curve.nodes));if(drawing.nodes.every(node=>used.has(node.id)))return drawing;
 return retainSnapshotRouteMaterialInput(retainCageEvaluationDependencyContext(retainSnapshotAffines({...drawing,nodes:drawing.nodes.filter(node=>used.has(node.id))},[drawing]),[drawing]),drawing);
}
export function prepareSnapshotNodeUnbind(snapshotId:string,input:DrawingDocument,before:DrawingDocument,target:DrawingDocument,priorForks:SnapshotNodeForks|undefined,priorAliases:SnapshotNodeAliases|undefined,intent:SnapshotNodeUnbindIntent|undefined):{forks:SnapshotNodeForks|undefined;aliases:SnapshotNodeAliases|undefined;freshNodeIds:Set<string>} {
 if(!intent)return {forks:priorForks,aliases:priorAliases,freshNodeIds:new Set()};
 const expected=createSnapshotNodeUnbindIntent(snapshotId,before,target,intent.endpoint);if(!expected||!same(expected,intent))fail('the explicit command intent no longer matches this Snapshot and its Drawing result.');
 const oldCurve=before.curves.find(curve=>curve.id===intent.endpoint.curveId)!,nextCurve=target.curves.find(curve=>curve.id===intent.endpoint.curveId)!,sourceCurve=input.curves.find(curve=>curve.id===intent.endpoint.curveId);if(!sourceCurve)fail('the detached endpoint has no live input curve.');
 if(!same(nodeAt(before,intent.endpoint).position,nodeAt(target,intent.endpoint).position)||!same(oldCurve.handles,nextCurve.handles))fail('unbind must preserve the current endpoint and both handles.');
 for(const curve of before.curves){const after=target.curves.find(value=>value.id===curve.id);if(!after||curve.nodes.some((id,end)=>!(curve.id===intent.endpoint.curveId&&end===intent.endpoint.end)&&after.nodes[end]!==id))fail('unbind may only split its explicitly selected endpoint.');}
 const forks=structuredClone(priorForks??{}),previous=snapshotForkForEndpoint(forks,intent.endpoint);
 if(previous)forks[previous]={...forks[previous],bind:false};forks[intent.nodeId]={...intent.endpoint,...(previous&&forks[previous].source?{source:forks[previous].source}:{})};
 const used=new Set(input.curves.flatMap(curve=>curve.nodes.map((id,end)=>snapshotForkForEndpoint(forks,{curveId:curve.id,end:end as 0|1})??id))),aliases=Object.fromEntries(Object.entries(normalizeSnapshotNodeAliases(priorAliases??{})).filter(([id])=>used.has(id)));
 const retained=new Set([...target.curves.flatMap(curve=>curve.nodes),...Object.values(aliases),...used]);
 for(const [id,fork] of Object.entries(forks))if(fork.bind===false&&!retained.has(id))delete forks[id];
 return {forks,aliases:Object.keys(aliases).length?aliases:undefined,freshNodeIds:new Set([intent.nodeId])};
}
export function splitSnapshotNodeForks(forks:SnapshotNodeForks|undefined,intent:CurveSplitIntent,localOnly=false):SnapshotNodeForks|undefined {
 if(!forks)return forks;const map=(end:Endpoint):Endpoint=>end.curveId===intent.curveId?{...end,curveId:intent.childCurveIds[end.end]}:end;return Object.fromEntries(Object.entries(forks).map(([id,fork])=>{const origin=fork.source??{curveId:fork.curveId,end:fork.end},target=map(fork),source=localOnly?origin:map(origin);return [id,{...target,...(!same({curveId:target.curveId,end:target.end},source)?{source}:{source:undefined})}];}));
}
export function pruneSnapshotNodeForks(forks:SnapshotNodeForks|undefined,removed:ReadonlySet<string>):SnapshotNodeForks|undefined {
 if(!forks)return forks;const result=Object.fromEntries(Object.entries(forks).filter(([id,fork])=>!removed.has(id)&&!removed.has(fork.curveId)&&!removed.has((fork.source??fork).curveId)));return Object.keys(result).length?result:undefined;
}
