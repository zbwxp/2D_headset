import {validateSnapshotViewMirrorRelation} from './viewMirrorRelation';
import {validateSnapshotVisibilityRecipes,pruneSnapshotVisibilityRecipes} from './visibilityRestriction';
import {validateSnapshotMaterialPathLineages} from './materialPathLineages';
import {validateSnapshotMaterialPartitions} from './materialSplit';
import {validateSnapshotMaterialRecipeRegistry,validateSnapshotMaterialBasisRecipes,validateSnapshotMaterialEditLeaves} from './materialRestriction';
import {validateSnapshotResponseExpressionRegistry,snapshotResponseExpressionRegistryValidForMesh} from './responseExpressionRegistry';
import type {Angle,RecordingSnapshot,RecordingSnapshotWorkspace,SnapshotAngleGraph,SnapshotControlResponse,SnapshotCorrectionFrame,SnapshotEndpointPair,SnapshotEndpointResponses,SnapshotOrphanedResponses} from './model';
import {createSnapshotTriangulation,validateSnapshotTriangulation,locateSnapshotSimplex,type SnapshotTriangulation} from './triangulation';
import {validateInteriorResponseSamples,type InteriorResponseSample} from './triangularResponses';
import {endpointPairCompatibility,validateSnapshotEndpointPair,validateSnapshotEndpointResponses} from './endpointPair';
import {resolveEndpointPairBasis,resolveSnapshot} from './evaluation';
import {validateRecordingSnapshots} from './validation';
import {validateSnapshotPropertyResponses} from './propertyResponses';
export type {SnapshotAngleGraph,SnapshotTriangleControlResponse,SnapshotTriangleResponses,SnapshotCorrectionFrame,SnapshotOrphanedResponses} from './model';

export type SnapshotAngleGraphDiagnosticCode='INVALID_GRAPH'|'MISSING_RECORDING'|'ID_COLLISION'|'UNSUPPORTED_LEGACY_INTERPOLATION'|'INCOMPATIBLE_ENDPOINT_BASIS'|'PAIR_EDGE_UNREPRESENTABLE'|'ORPHANED_RESPONSE'|'UNHANDLED_REBIND';
export interface SnapshotAngleGraphDiagnostic {code:SnapshotAngleGraphDiagnosticCode;message:string;edgeId?:string;triangleId?:string;frameId?:string}
const error=(value:unknown)=>value instanceof Error?value.message:String(value);
const fail=(message:string):never=>{throw Error(`Invalid snapshot angle graph: ${message}`);};
const own=<T>(map:Record<string,T>,key:string):T|undefined=>Object.hasOwn(map,key)?map[key]:undefined;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const id=(value:unknown)=>{if(typeof value!=='string'||!value.length||value.length>16384)fail('identifier');};
const object=(value:unknown,allowed?:readonly string[]):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('expected object');
 const data=value as Record<string,unknown>,keys=Object.keys(data);
 if(keys.length>65536)fail('map limit');
 if(allowed&&keys.some(key=>!allowed.includes(key)))fail('unknown field');
 return data;
};
const list=(value:unknown,max=16384):unknown[]=>{if(!Array.isArray(value)||value.length>max)return fail('array limit');return value;};
const angle=(value:unknown)=>{const data=object(value,['x','y']);if(![data.x,data.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=-90&&n<=90))fail('angle');};
const tuple=(value:unknown,size:number)=>{const result=list(value,size);if(result.length!==size)fail('tuple length');return result;};
function meshShape(value:unknown):SnapshotTriangulation {
 const mesh=object(value,['version','coverage','vertices','edges','triangles']);
 for(const raw of list(mesh.vertices,10000)){const vertex=object(raw,['id','snapshotId','angle']);id(vertex.id);id(vertex.snapshotId);angle(vertex.angle);}
 for(const raw of list(mesh.edges,30000)){const edge=object(raw,['id','vertexIds']);id(edge.id);tuple(edge.vertexIds,2).forEach(id);}
 for(const raw of list(mesh.triangles,20000)){const triangle=object(raw,['id','vertexIds','edgeIds']);id(triangle.id);tuple(triangle.vertexIds,3).forEach(id);tuple(triangle.edgeIds,3).forEach(id);}
 validateSnapshotTriangulation(value as SnapshotTriangulation);return value as SnapshotTriangulation;
}
function endpointResponses(value:unknown):void {
 const data=object(value,['nodes','handles']);
 const control=(value:unknown)=>{const response=object(value,['x','y']);for(const axis of ['x','y'])if(response[axis]!==undefined)list(response[axis],256).forEach(knot=>tuple(knot,2));};
 for(const [key,value] of Object.entries(object(data.nodes))){id(key);control(value);}
 for(const [key,value] of Object.entries(object(data.handles))){id(key);tuple(value,2).forEach(control);}
 validateSnapshotEndpointResponses(value as SnapshotEndpointResponses);
}
function triangleResponses(value:unknown):void {
 const data=object(value,['nodes','handles']);
 const control=(value:unknown)=>{
  const response=object(value,['x','y']);
  for(const axis of ['x','y'])if(response[axis]!==undefined){
   const samples=list(response[axis],4096);
   for(const raw of samples){const sample=object(raw,['id','at','weights']);id(sample.id);tuple(sample.at,3);tuple(sample.weights,3);}
   validateInteriorResponseSamples(samples as InteriorResponseSample[]);
  }
 };
 for(const [key,value] of Object.entries(object(data.nodes))){id(key);control(value);}
 for(const [key,value] of Object.entries(object(data.handles))){id(key);tuple(value,2).forEach(control);}
}
function responseMaps(data:Record<string,unknown>,mesh:SnapshotTriangulation,optional=false):void {
 const check=(key:'edgeResponses'|'triangleResponses',ids:Set<string>,validate:(value:unknown)=>void)=>{
  if(optional&&data[key]===undefined)return;
  for(const [simplexId,value] of Object.entries(object(data[key]))){id(simplexId);if(!ids.has(simplexId))fail(`${key} references a missing simplex; retain it in orphanedResponses`);validate(value);}
 };
 check('edgeResponses',new Set(mesh.edges.map(edge=>edge.id)),endpointResponses);
 check('triangleResponses',new Set(mesh.triangles.map(triangle=>triangle.id)),triangleResponses);
}
function frames(value:unknown,mesh:SnapshotTriangulation):void {
 const ids=new Set<string>();
 for(const raw of list(value,10000)){
  const frame=object(raw,['id','angle','status','edgeResponses','triangleResponses','propertyResponses','responseExpressions','basisAdjustment']);id(frame.id);angle(frame.angle);
  if(ids.has(frame.id as string))fail('duplicate correction frame');ids.add(frame.id as string);
  if(frame.status!=='saved'&&frame.status!=='draft')fail('correction frame status');
  if(frame.basisAdjustment!==undefined){
   if(frame.status!=='draft')fail('basis adjustment must belong to a correction draft');
   const adjustment=object(frame.basisAdjustment,['snapshotIds','layerIds','trustRegionLimited']);
   if(adjustment.trustRegionLimited!==undefined&&typeof adjustment.trustRegionLimited!=='boolean')fail('basis adjustment trust-region diagnostic');
   for(const key of ['snapshotIds','layerIds']){const values=list(adjustment[key],16384);if(!values.length||new Set(values).size!==values.length)fail('basis adjustment requires unique nonempty dependencies');values.forEach(id);}
   for(const snapshotId of adjustment.snapshotIds as string[]){const vertex=mesh.vertices.find(vertex=>vertex.snapshotId===snapshotId);if(!vertex||!((Math.abs(vertex.angle.x)===90&&vertex.angle.y===0)||(Math.abs(vertex.angle.y)===90&&vertex.angle.x===0)))fail('basis adjustment must reference a cardinal extreme snapshot');}
  }
  responseMaps(frame,mesh,true);if(frame.responseExpressions!==undefined)validateSnapshotResponseExpressionRegistry(frame.responseExpressions,mesh);if(frame.propertyResponses!==undefined)validateSnapshotPropertyResponses(frame.propertyResponses,mesh);
 }
}

/** Strict persisted schema and values. Run at load/edit boundaries, never per
 * sample. Defaults remain absent in old recordings; opt-in graphs are explicit. */
export function validateSnapshotAngleGraph(graph:SnapshotAngleGraph):void {
 const data=object(graph,['viewMirror','version','mesh','edgeResponses','triangleResponses','correctionFrames','orphanedResponses','migration','propertyResponses','responseExpressions','materialRecipes','materialBasisRecipes','visibilityRecipes','visibilityBasisRecipes','materialPartitions','materialPathLineages']);
 if(data.version!==1)fail('version');const mesh=meshShape(data.mesh);if(data.viewMirror!==undefined)validateSnapshotViewMirrorRelation(data.viewMirror,{angleGraph:graph});if(data.visibilityRecipes!==undefined)validateSnapshotVisibilityRecipes(data.visibilityRecipes,mesh);if(data.visibilityBasisRecipes!==undefined)validateSnapshotVisibilityRecipes(data.visibilityBasisRecipes,mesh,true);if(data.materialRecipes!==undefined)validateSnapshotMaterialRecipeRegistry(data.materialRecipes,mesh);if(data.materialBasisRecipes!==undefined)validateSnapshotMaterialBasisRecipes(data.materialBasisRecipes,mesh,graph);validateSnapshotMaterialEditLeaves(graph);if(data.materialPartitions!==undefined)validateSnapshotMaterialPartitions(data.materialPartitions);if(data.materialPathLineages!==undefined)validateSnapshotMaterialPathLineages(data.materialPathLineages);responseMaps(data,mesh);if(data.responseExpressions!==undefined)validateSnapshotResponseExpressionRegistry(data.responseExpressions,mesh);if(data.propertyResponses!==undefined)validateSnapshotPropertyResponses(data.propertyResponses,mesh);
 if(data.correctionFrames!==undefined)frames(data.correctionFrames,mesh);
 if(data.orphanedResponses!==undefined){
  const ids=new Set<string>();
  for(const raw of list(data.orphanedResponses,10000)){
   const archive=object(raw,['id','reason','message','mesh','edgeResponses','triangleResponses','correctionFrames','propertyResponses','responseExpressions','materialPartitions','materialRecipes','materialBasisRecipes','visibilityRecipes','visibilityBasisRecipes','materialPathLineages']);id(archive.id);
   if(ids.has(archive.id as string))fail('duplicate response archive');ids.add(archive.id as string);
   if(!['deleted-view','mesh-change','unhandled-rebind'].includes(String(archive.reason))||typeof archive.message!=='string'||!archive.message||archive.message.length>4096)fail('response archive reason');
   const oldMesh=meshShape(archive.mesh);if(archive.visibilityRecipes!==undefined)validateSnapshotVisibilityRecipes(archive.visibilityRecipes,oldMesh);if(archive.visibilityBasisRecipes!==undefined)validateSnapshotVisibilityRecipes(archive.visibilityBasisRecipes,oldMesh,true);if(archive.materialPathLineages!==undefined)validateSnapshotMaterialPathLineages(archive.materialPathLineages);if(archive.materialPartitions!==undefined)validateSnapshotMaterialPartitions(archive.materialPartitions);if(archive.materialRecipes!==undefined)validateSnapshotMaterialRecipeRegistry(archive.materialRecipes,oldMesh);if(archive.materialBasisRecipes!==undefined)validateSnapshotMaterialBasisRecipes(archive.materialBasisRecipes,oldMesh);responseMaps(archive,oldMesh);if(archive.responseExpressions!==undefined)validateSnapshotResponseExpressionRegistry(archive.responseExpressions,oldMesh);if(archive.propertyResponses!==undefined)validateSnapshotPropertyResponses(archive.propertyResponses,oldMesh);if(archive.correctionFrames!==undefined)frames(archive.correctionFrames,oldMesh);
  }
 }
 if(data.migration!==undefined){
  const migration=object(data.migration,['sourceRecordingId','sourceMode','sourceRecordingJSON','sourceSnapshotsJSON']);id(migration.sourceRecordingId);
  if(migration.sourceMode!=='endpoint-pair')fail('migration source mode');
  for(const key of ['sourceRecordingJSON','sourceSnapshotsJSON'])if(typeof migration[key]!=='string'||(migration[key] as string).length>32*1024*1024)fail('migration recovery JSON');
  try{
   const source=JSON.parse(migration.sourceRecordingJSON as string),snapshots=JSON.parse(migration.sourceSnapshotsJSON as string);
   if(!source||Array.isArray(source)||source.id!==migration.sourceRecordingId||source.mode!==migration.sourceMode||!Array.isArray(snapshots))fail('migration recovery payload');
  }catch{fail('migration recovery JSON');}
 }
}

/** Creates only the supplied genuine views; it never adds extreme points. */
export function createSnapshotAngleGraph(inputs:readonly {snapshotId:string;angle:Angle}[]):SnapshotAngleGraph {
 inputs.forEach(input=>angle(input.angle));
 return {version:1,mesh:createSnapshotTriangulation(inputs),edgeResponses:{},triangleResponses:{}};
}

/** Reversing both progress and response preserves signed/nonmonotone curves. */
export function reverseSnapshotEndpointResponses(responses:SnapshotEndpointResponses):SnapshotEndpointResponses {
 validateSnapshotEndpointResponses(responses);
 const control=(response:SnapshotControlResponse):SnapshotControlResponse=>{const next:SnapshotControlResponse={};for(const axis of ['x','y'] as const)if(response[axis]!==undefined)next[axis]=response[axis]!.map<[number,number]>(([t,w])=>[1-t,1-w]).reverse();return next;};
 const result:SnapshotEndpointResponses={nodes:Object.fromEntries(Object.entries(responses.nodes).map(([key,value])=>[key,control(value)])),
  handles:Object.fromEntries(Object.entries(responses.handles).map(([key,pair])=>[key,[control(pair[0]),control(pair[1])]]))};
 // IEEE subtraction can collapse a very small progress to 1. Refuse this case
 // instead of dropping or moving a saved knot to make the conversion validate.
 validateSnapshotEndpointResponses(result);return result;
}

export type SnapshotPairEdgeMigration=
 |{ok:true;edgeId:string;responses?:SnapshotEndpointResponses;draft?:SnapshotCorrectionFrame;diagnostics:SnapshotAngleGraphDiagnostic[]}
 |{ok:false;diagnostics:SnapshotAngleGraphDiagnostic[]};
/** Map only an intact edge. Splitting/restriction needs its own proven response
 * transform; selecting a nearby edge would silently change the old motion. */
export function mapEndpointPairToAngleGraph(mesh:SnapshotTriangulation,pair:SnapshotEndpointPair,frameId='endpoint-pair-draft'):SnapshotPairEdgeMigration {
 try{
  validateSnapshotTriangulation(mesh);validateSnapshotEndpointPair(pair);
  const start=mesh.vertices.find(vertex=>vertex.snapshotId===pair.startSnapshotId),end=mesh.vertices.find(vertex=>vertex.snapshotId===pair.endSnapshotId);
  const edge=start&&end&&mesh.edges.find(edge=>edge.vertexIds.includes(start.id)&&edge.vertexIds.includes(end.id));
  if(!edge||!start||!end)return {ok:false,diagnostics:[{code:'PAIR_EDGE_UNREPRESENTABLE',message:'The original endpoint pair is not one intact mesh edge. Splitting or restricting its nonlinear responses requires an explicit faithful transform.'}]};
  if(start.angle.y!==end.angle.y||start.angle.x===end.angle.x)return {ok:false,diagnostics:[{code:'PAIR_EDGE_UNREPRESENTABLE',edgeId:edge.id,message:'The original yaw endpoint pair must retain its one-axis angle binding during copy migration. Rebinding its correction field requires an explicit policy.'}]};
  const reverse=edge.vertexIds[0]!==start.id,convert=(responses:SnapshotEndpointResponses)=>reverse?reverseSnapshotEndpointResponses(responses):structuredClone(responses);
  return {ok:true,edgeId:edge.id,...(pair.responses?{responses:convert(pair.responses)}:{}),
   ...(pair.draft?{draft:{id:frameId,angle:{...pair.draft.angle},status:'draft',edgeResponses:{[edge.id]:convert(pair.draft.responses)}}}:{}),diagnostics:[]};
 }catch(cause){return {ok:false,diagnostics:[{code:'PAIR_EDGE_UNREPRESENTABLE',message:error(cause)}]};}
}

export interface SnapshotRecordingCopyOptions {id:string;name?:string;snapshotIdMap?:Record<string,string>}
export type SnapshotRecordingCopyResult=
 |{ok:true;workspace:RecordingSnapshotWorkspace;recordingId:string;snapshotIdMap:Record<string,string>;diagnostics:SnapshotAngleGraphDiagnostic[]}
 |{ok:false;diagnostics:SnapshotAngleGraphDiagnostic[]};

function cloneSnapshot(snapshot:RecordingSnapshot,ids:Record<string,string>):RecordingSnapshot {
 const next=structuredClone(snapshot),mapped=(id:string)=>own(ids,id)??id;
 next.id=mapped(snapshot.id);if(next.parentSnapshotId)next.parentSnapshotId=mapped(next.parentSnapshotId);if(next.memberSources)next.memberSources=Object.fromEntries(Object.entries(next.memberSources).map(([id,source])=>[id,mapped(source)]));
 for(const layer of next.layers)if(layer.kind==='reference')layer.baseSnapshotId=mapped(layer.baseSnapshotId);
 for(const state of [next.deformation,next.inheritedState,next.draft?.deformation])if(state?.intervalMaterialIssues)for(const issue of Object.values(state.intervalMaterialIssues))issue.sourceSnapshotId=mapped(issue.sourceSnapshotId);
 return next;
}

/** Explicit, atomic, lossless working-copy migration. Legacy keyed interpolation
 * has no general equivalence to final-control barycentrics, so it is refused.
 * No source recording, source snapshot, key, draft or canonical ID is rewritten. */
export function createTriangulatedRecordingCopy(workspace:RecordingSnapshotWorkspace,recordingId:string,options:SnapshotRecordingCopyOptions):SnapshotRecordingCopyResult {
 const source=workspace.recordings.find(recording=>recording.id===recordingId);
 if(!source)return {ok:false,diagnostics:[{code:'MISSING_RECORDING',message:`Recording ${recordingId} does not exist.`}]};
 if(source.mode!=='endpoint-pair'||!source.endpointPair)return {ok:false,diagnostics:[{code:'UNSUPPORTED_LEGACY_INTERPOLATION',message:'Only an explicit endpoint-pair recording has a proven final-control response mapping. Legacy keyed or nonlinear interpolation is retained unchanged; conversion needs a faithful adapter.'}]};
 try{
  id(options.id);if(options.name!==undefined&&(typeof options.name!=='string'||!options.name.trim()||options.name.length>256))fail('copy name');
  if(workspace.recordings.some(recording=>recording.id===options.id))return {ok:false,diagnostics:[{code:'ID_COLLISION',message:`Recording ${options.id} already exists.`}]};
  const snapshots=source.snapshotIds.map(id=>workspace.snapshots.find(snapshot=>snapshot.id===id));
  if(snapshots.some(snapshot=>!snapshot))fail('missing source snapshot');
  const sourceSnapshots=snapshots as RecordingSnapshot[],snapshotIdMap:Record<string,string>=Object.fromEntries(sourceSnapshots.map(snapshot=>[snapshot.id,own(options.snapshotIdMap??{},snapshot.id)??`angle-copy:${JSON.stringify([options.id,snapshot.id])}`]));
  if(options.snapshotIdMap&&Object.keys(options.snapshotIdMap).some(id=>!source.snapshotIds.includes(id)))fail('snapshot ID map contains an unrelated snapshot');
  const cloneIds=Object.values(snapshotIdMap);cloneIds.forEach(id);
  if(new Set(cloneIds).size!==cloneIds.length||cloneIds.some(id=>workspace.snapshots.some(snapshot=>snapshot.id===id)))return {ok:false,diagnostics:[{code:'ID_COLLISION',message:'Working-copy snapshot IDs must be new and distinct.'}]};
  const copiedSnapshots=sourceSnapshots.map(snapshot=>cloneSnapshot(snapshot,snapshotIdMap)),copied=structuredClone(source);
  // Snapshot-local saved residuals own graph bases. Retained legacy tracks are
  // recovery evidence, so materialize their exact saved channel values once at
  // the original compatibility angle, never at a future Recorder binding.
  copiedSnapshots.forEach((copy,index)=>{
   const original=sourceSnapshots[index],saved=resolveSnapshot(workspace,original.id,{angle:original.angle,useDraft:false,diagnostics:'preview'});
   copy.deformation=structuredClone(saved.state);delete copy.inheritedState;
   const hasDraft=original.draft&&original.draft.angle.x===original.angle.x&&original.draft.angle.y===original.angle.y||source.tracks.some(track=>track.draft&&track.draft.angle.x===original.angle.x&&track.draft.angle.y===original.angle.y);
   if(hasDraft)copy.draft={angle:{...original.angle},deformation:structuredClone(resolveSnapshot(workspace,original.id,{angle:original.angle,useDraft:true,diagnostics:'preview'}).state),channels:structuredClone(original.draft?.channels??[])};
   for(const state of [copy.deformation,copy.draft?.deformation])if(state?.intervalMaterialIssues)for(const issue of Object.values(state.intervalMaterialIssues))issue.sourceSnapshotId=own(snapshotIdMap,issue.sourceSnapshotId)??issue.sourceSnapshotId;
  });
  copied.id=options.id;copied.name=options.name??`${source.name.slice(0,241)} (working copy)`;copied.snapshotIds=source.snapshotIds.map(id=>snapshotIdMap[id]);
  if(source.activeSnapshotId)copied.activeSnapshotId=snapshotIdMap[source.activeSnapshotId];
  for(const track of copied.tracks)if(track.channel==='interval'&&track.materialIssue)track.materialIssue.sourceSnapshotId=own(snapshotIdMap,track.materialIssue.sourceSnapshotId)??track.materialIssue.sourceSnapshotId;
  const graph=createSnapshotAngleGraph(copiedSnapshots.map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle}))),pair={...source.endpointPair,startSnapshotId:snapshotIdMap[source.endpointPair.startSnapshotId],endSnapshotId:snapshotIdMap[source.endpointPair.endSnapshotId]};
  const mapped=mapEndpointPairToAngleGraph(graph.mesh,pair,`angle-copy-draft:${options.id}`);if(!mapped.ok)return mapped;
  if(mapped.responses)graph.edgeResponses[mapped.edgeId]=mapped.responses;
  if(mapped.draft)graph.correctionFrames=[mapped.draft];
  graph.migration={sourceRecordingId:source.id,sourceMode:'endpoint-pair',sourceRecordingJSON:JSON.stringify(source),sourceSnapshotsJSON:JSON.stringify(sourceSnapshots)};
  copied.mode='triangulated';copied.angleGraph=graph;delete copied.endpointPair;
  const next:RecordingSnapshotWorkspace={...workspace,snapshots:[...workspace.snapshots,...copiedSnapshots],recordings:[...workspace.recordings,copied],activeRecordingId:copied.id};
  // One complete workspace validation for this transaction includes both the
  // unmodified legacy source and the newly constructed working copy.
  validateRecordingSnapshots(next);
  // The new surface supports partial membership, but that must never reinterpret
  // an old pair which previously refused incompatible endpoint topology. Check
  // both saved geometry and the current endpoint draft when one is active.
  const current=sourceSnapshots.find(snapshot=>snapshot.angle.x===source.angle.x&&snapshot.angle.y===source.angle.y);
  const hasCurrentDraft=!!current&&(!!current.draft||source.tracks.some(track=>track.draft?.angle.x===source.angle.x&&track.draft?.angle.y===source.angle.y));
  for(const useDraft of hasCurrentDraft?[false,true]:[false]){
   const basis=resolveEndpointPairBasis(workspace,recordingId,{useDraft}),issues=endpointPairCompatibility(basis.start.drawing,basis.end.drawing);
   if(issues.length)return {ok:false,diagnostics:[{code:'INCOMPATIBLE_ENDPOINT_BASIS',message:`The ${useDraft?'current draft':'saved'} endpoint basis is incompatible: ${issues.join(' ')} Repair the original endpoint topology before creating its triangulated working copy. The original recording is unchanged.`}]};
  }
  return {ok:true,workspace:next,recordingId:copied.id,snapshotIdMap,diagnostics:[]};
 }catch(cause){return {ok:false,diagnostics:[{code:'INVALID_GRAPH',message:error(cause)}]};}
}

export type SnapshotAngleGraphMeshResult={ok:true;graph:SnapshotAngleGraph;diagnostics:SnapshotAngleGraphDiagnostic[]}|{ok:false;diagnostics:SnapshotAngleGraphDiagnostic[]};
/** Safe topology wrapper: retiring a simplex archives its constraints and old
 * coordinate frame. Rebinding occupied coordinates has no implicit follow-mesh
 * or absolute-angle policy and is explicitly refused pending that decision. */
export function reconcileSnapshotAngleGraphMesh(graph:SnapshotAngleGraph,mesh:SnapshotTriangulation,archive:{id:string;reason:SnapshotOrphanedResponses['reason'];message:string}):SnapshotAngleGraphMeshResult {
 try{
  validateSnapshotAngleGraph(graph);meshShape(mesh);
  const oldVertices=new Map(graph.mesh.vertices.map(vertex=>[vertex.id,vertex]));
  const rebound=mesh.vertices.some(vertex=>{const old=oldVertices.get(vertex.id);return old&&(!same(old.angle,vertex.angle)||old.snapshotId!==vertex.snapshotId);});
  const constrained=!!graph.viewMirror||Object.keys(graph.visibilityRecipes??{}).length||Object.keys(graph.visibilityBasisRecipes??{}).length||Object.keys(graph.materialRecipes??{}).length||Object.keys(graph.materialBasisRecipes??{}).length||Object.keys(graph.responseExpressions??{}).length||Object.keys(graph.edgeResponses).length||Object.keys(graph.triangleResponses).length||graph.correctionFrames?.length||Object.keys(graph.propertyResponses?.edges??{}).length||Object.keys(graph.propertyResponses?.triangles??{}).length;
  if(rebound&&constrained)return {ok:false,diagnostics:[{code:'UNHANDLED_REBIND',message:'This angle rebind affects recorder-owned constraints. Choose and implement an explicit absolute-angle or follow-mesh rebind policy before changing it.'}]};
  const edges=new Map(mesh.edges.map(edge=>[edge.id,edge])),triangles=new Map(mesh.triangles.map(triangle=>[triangle.id,triangle]));
  for(const edge of graph.mesh.edges)if(edges.has(edge.id)&&!same(edge.vertexIds,edges.get(edge.id)!.vertexIds))fail('existing edge orientation cannot change under the same ID');
  for(const triangle of graph.mesh.triangles)if(triangles.has(triangle.id)&&(!same(triangle.vertexIds,triangles.get(triangle.id)!.vertexIds)||!same(triangle.edgeIds,triangles.get(triangle.id)!.edgeIds)))fail('existing triangle coordinates cannot change under the same ID');
  const keepExpression=(id:string,responses:NonNullable<SnapshotAngleGraph['responseExpressions']>[string])=>(edges.has(id)||triangles.has(id))&&snapshotResponseExpressionRegistryValidForMesh(responses,mesh);
  const retiredExpressions=Object.fromEntries(Object.entries(graph.responseExpressions??{}).filter(([id,responses])=>!keepExpression(id,responses)));
  const retiredEdges=Object.fromEntries(Object.entries(graph.edgeResponses).filter(([id])=>!edges.has(id))),retiredTriangles=Object.fromEntries(Object.entries(graph.triangleResponses).filter(([id])=>!triangles.has(id)));
  const retiredProperties={edges:Object.fromEntries(Object.entries(graph.propertyResponses?.edges??{}).filter(([id])=>!edges.has(id))),triangles:Object.fromEntries(Object.entries(graph.propertyResponses?.triangles??{}).filter(([id])=>!triangles.has(id)))};
  const retiredFrames=(graph.correctionFrames??[]).filter(frame=>{const location=locateSnapshotSimplex(graph.mesh,frame.angle);return Object.entries(frame.responseExpressions??{}).some(([id,responses])=>!keepExpression(id,responses))||Object.keys(frame.propertyResponses?.edges??{}).some(id=>!edges.has(id))||Object.keys(frame.propertyResponses?.triangles??{}).some(id=>!triangles.has(id))||Object.keys(frame.edgeResponses??{}).some(id=>!edges.has(id))||Object.keys(frame.triangleResponses??{}).some(id=>!triangles.has(id))||location?.kind==='edge'&&!edges.has(location.simplexId)||location?.kind==='triangle'&&!triangles.has(location.simplexId);});
  const retiredIds=new Set(retiredFrames.map(frame=>frame.id)),diagnostics:SnapshotAngleGraphDiagnostic[]=[...Object.keys(retiredExpressions).map(simplexId=>({code:'ORPHANED_RESPONSE' as const,message:`Expression responses for ${simplexId} were archived because their simplex or live basis dependency was removed.`})),...Object.keys(retiredProperties.edges).map(edgeId=>({code:'ORPHANED_RESPONSE' as const,edgeId,message:`Edge ${edgeId} property responses were archived with their original coordinate frame.`})),...Object.keys(retiredProperties.triangles).map(triangleId=>({code:'ORPHANED_RESPONSE' as const,triangleId,message:`Triangle ${triangleId} property responses were archived with their original coordinate frame.`})),...Object.keys(retiredEdges).map(edgeId=>({code:'ORPHANED_RESPONSE' as const,edgeId,message:`Edge ${edgeId} responses were archived with their original coordinate frame.`})),...Object.keys(retiredTriangles).map(triangleId=>({code:'ORPHANED_RESPONSE' as const,triangleId,message:`Triangle ${triangleId} responses were archived with their original coordinate frame.`})),...retiredFrames.map(frame=>({code:'ORPHANED_RESPONSE' as const,frameId:frame.id,message:`Correction frame ${frame.id} was archived because its simplex was removed.`}))];
  const next:SnapshotAngleGraph={...graph,mesh:structuredClone(mesh),...pruneSnapshotVisibilityRecipes(graph,mesh),...(graph.materialRecipes?{materialRecipes:Object.fromEntries(Object.entries(graph.materialRecipes).filter(([id])=>edges.has(id)||triangles.has(id)))}:{}),...(graph.responseExpressions?{responseExpressions:Object.fromEntries(Object.entries(graph.responseExpressions).filter(([id,responses])=>keepExpression(id,responses)))}:{}),edgeResponses:Object.fromEntries(Object.entries(graph.edgeResponses).filter(([id])=>edges.has(id))),triangleResponses:Object.fromEntries(Object.entries(graph.triangleResponses).filter(([id])=>triangles.has(id))),
   ...(graph.propertyResponses?{propertyResponses:{edges:Object.fromEntries(Object.entries(graph.propertyResponses.edges).filter(([id])=>edges.has(id))),triangles:Object.fromEntries(Object.entries(graph.propertyResponses.triangles).filter(([id])=>triangles.has(id)))}}:{}),
   ...(graph.correctionFrames?{correctionFrames:graph.correctionFrames.filter(frame=>!retiredIds.has(frame.id))}:{})};
  if(diagnostics.length)next.orphanedResponses=[...(graph.orphanedResponses??[]),{...archive,mesh:structuredClone(graph.mesh),...(Object.keys(retiredExpressions).length?{responseExpressions:structuredClone(retiredExpressions)}:{}),edgeResponses:structuredClone(retiredEdges),triangleResponses:structuredClone(retiredTriangles),...(Object.keys(retiredProperties.edges).length||Object.keys(retiredProperties.triangles).length?{propertyResponses:structuredClone(retiredProperties)}:{}),...(retiredFrames.length?{correctionFrames:structuredClone(retiredFrames)}:{})}];
  validateSnapshotAngleGraph(next);return {ok:true,graph:next,diagnostics};
 }catch(cause){return {ok:false,diagnostics:[{code:'INVALID_GRAPH',message:error(cause)}]};}
}
