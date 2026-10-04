import {inheritedTopologyLayerProgram} from './inheritedTopologyMaterial';
import {snapshotPaintAppearanceDifference,mergeSnapshotPaintAppearance,type SnapshotPaintAppearanceMap} from './paintAppearance';
import {inverseAffine2D,applyAffine2DVector} from '../geometry/affine2d';
import {snapshotControlMatrix} from './controlSpace';
import {tryPrepareSnapshotLayerMemberEdit} from './layerMemberEdit';
import {snapshotWithMirrorMetadata} from './mirrorMetadata';
import {hasNonlinearDeformationFor} from '../drawing/evaluatedDeformation';
import {captureLayerDomainControls,layerUsesCage} from './layerDomainControlEdit';
import {layerCageCurveIds,reconcileLayerCageStrokeScope} from './layerCageScope';
import {createNonlinearTopologyInput,nonlinearTopologyTargetLayers,nonlinearTopologyControlBase,retainOtherTopologyControls} from './nonlinearTopologyTargets';
import {snapshotCurveAppearanceDifference,unsupportedSnapshotCurveAppearanceFields,mergeSnapshotCurveAppearance,type SnapshotCurveAppearanceMap} from './curveAppearance';
import {trySnapshotControlInverse,snapshotControlBrushScale} from './controlSpace';
import {parseDrawing,layerFor,sub,length,type DrawingDocument,type DrawingCurve,type Point2} from '../drawing/model';
import {applyScenePlacementMatrix} from '../recordingScene/tracks';
import {identityScenePlacement} from '../recordingScene/model';
import {type WarpGrid} from '../vectorWarp/model';
import {resolveSnapshot,type SnapshotEvaluation} from './evaluation';
import {excludeSnapshotLocalMembers} from './localMembership';
import {drawingSourceOwns,drawingIdentityIds} from './sources';
import {removeDeletedSourceReferences} from './sourceDeletion';
import {captureSnapshotResponseMembership,reconcileSnapshotMembershipResponses} from './membershipResponses';
import {propagateAutomaticSnapshotLayers} from './automaticSnapshotEdits';
import {reconcileSnapshotEndpointRelationEdit} from './endpointRelationEdits';
import {snapshotIntervalMaterialSource} from './routeMaterialSource';
import {transportEndpointPairMaterial} from './endpointPairMaterial';
import {parseRecordingSnapshots} from './persistence';
import {patchSnapshotRelations} from './relationAuthoringIntent';
import {prepareSnapshotNodeMerge,snapshotNodeAuthority} from './nodeAliases';
import {prepareSnapshotNodeUnbind,snapshotForkForEndpoint,type SnapshotNodeUnbindIntent} from './nodeForks';
import type {Angle,RecordingSnapshot,RecordingSnapshotWorkspace,SnapshotDiagnostic,SnapshotRelationPatch,SnapshotDeformationState} from './model';

/** Drawing already authored the geometry, connections and identities. This is
 * an ownership/coordinate adapter, never another pen or topology kernel. */
export interface SnapshotDrawingTopologyEdit {
 recordingId:string;snapshotId:string;angle:Angle;nodeUnbind?:SnapshotNodeUnbindIntent;
 beforeDrawing:DrawingDocument;drawing:DrawingDocument;
}
/** Snapshot-local authorship has no dependency on a Recorder or its cursor.
 * The host chooses the visible saved/draft state before entering this adapter. */
export interface SnapshotLocalDrawingEdit {
 snapshotId:string;state:'saved'|'active-draft';nodeUnbind?:SnapshotNodeUnbindIntent;
 beforeDrawing:DrawingDocument;drawing:DrawingDocument;
}
export class SnapshotDrawingTopologyError extends Error {constructor(readonly code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new SnapshotDrawingTopologyError(code,message);};
const clone=<T,>(value:T):T=>structuredClone(value);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const close=(a:Point2,b:Point2)=>length(sub(a,b))<=1e-8*Math.max(1,length(a),length(b));
const names=['joins','endpointLinks','groups','displayIntervals'] as const;

/** No epsilon, nearest selected snapshot, or correction-frame status can turn
 * a recorder cursor into a real topology authoring vertex. */
export function assertSnapshotTopologyVertex(workspace:RecordingSnapshotWorkspace,recordingId:string,snapshotId:string,angle:Angle):RecordingSnapshot {
 const recording=workspace.recordings.find(value=>value.id===recordingId),snapshot=workspace.snapshots.find(value=>value.id===snapshotId);
 if(!recording||!snapshot||!recording.snapshotIds.includes(snapshotId))return fail('REAL_SNAPSHOT_REQUIRED','Select a real snapshot belonging to this Recording before changing topology.');
 if(recording.legacy)return fail('LEGACY_READ_ONLY',recording.legacy.reason);
 const bound=recording.mode==='triangulated'?recording.angleGraph?.mesh.vertices.find(vertex=>vertex.snapshotId===snapshotId)?.angle:snapshot.angle;
 if(!bound||bound.x!==angle.x||bound.y!==angle.y||recording.angle.x!==angle.x||recording.angle.y!==angle.y)return fail('REAL_SNAPSHOT_REQUIRED','Topology requires a real snapshot with an actual recorder vertex at the exact requested angle. Correction frames cannot create or delete layers or curves.');
 if(recording.mode==='endpoint-pair')return fail('ENDPOINT_TOPOLOGY_REQUIRED','Create a triangulated Recording copy before changing one endpoint’s topology. Endpoint-pair interpolation requires matching topology.');
 return snapshot;
}

/** Hermite jets prove a grid is one affine map, including its extrapolated
 * boundary patches. Sampling a few points cannot establish this property. */
function affineWarpInverse(grid:WarpGrid,layerId:string):(point:Point2)=>Point2 {
 const dx=(grid.bounds.max[0]-grid.bounds.min[0])/grid.columns,dy=(grid.bounds.max[1]-grid.bounds.min[1])/grid.rows,first=grid.nodes[0];
 const u=sub(first.handleU,first.position).map(value=>value*3/dx) as Point2,v=sub(first.handleV,first.position).map(value=>value*3/dy) as Point2;
 const map=(point:Point2):Point2=>[first.position[0]+u[0]*(point[0]-grid.bounds.min[0])+v[0]*(point[1]-grid.bounds.min[1]),first.position[1]+u[1]*(point[0]-grid.bounds.min[0])+v[1]*(point[1]-grid.bounds.min[1])];
 const equal=(a:Point2,b:Point2)=>a.every((value,axis)=>Math.abs(value-b[axis])<=128*Number.EPSILON*Math.max(1,Math.abs(value),Math.abs(b[axis])));
 for(const [index,node] of grid.nodes.entries()){
  const x=grid.bounds.min[0]+index%(grid.columns+1)*dx,y=grid.bounds.min[1]+Math.floor(index/(grid.columns+1))*dy;
  if(!equal(node.position,map([x,y]))||!equal(node.handleU,map([x+dx/3,y]))||!equal(node.handleV,map([x,y+dy/3]))||!equal(node.twist,[0,0]))return fail('NONLINEAR_TOPOLOGY_INVERSE',`Layer ${layerId} has a nonlinear local Warp. The requested final-space curve has no exact affine source mapping; no geometry was created.`);
 }
 const determinant=u[0]*v[1]-u[1]*v[0];
 if(!Number.isFinite(determinant)||determinant===0)return fail('SINGULAR_TOPOLOGY_INVERSE',`Layer ${layerId} has a singular local Warp. Restore its collapsed axis before creating geometry.`);
 return point=>{const p=sub(point,first.position);return [grid.bounds.min[0]+(v[1]*p[0]-v[0]*p[1])/determinant,grid.bounds.min[1]+(-u[1]*p[0]+u[0]*p[1])/determinant];};
}
function layerWarpInverse(evaluation:SnapshotEvaluation,layerId:string):(point:Point2)=>Point2 {
 const inverses:Array<(point:Point2)=>Point2>=[],seen=new Set<string>();let id=evaluation.state.bindings.find(binding=>binding.layerId===layerId)?.warpId;
 while(id){if(seen.has(id))return fail('INVALID_WARP','Local Warp hierarchy contains a cycle.');seen.add(id);const warp=evaluation.state.warps.find(value=>value.id===id);if(!warp)return fail('INVALID_WARP','Local Warp hierarchy is missing a parent.');inverses.push(affineWarpInverse(warp.grid,layerId));id=warp.parentId;}
 return point=>inverses.reduceRight((value,inverse)=>inverse(value),point);
}
function unplace(evaluation:SnapshotEvaluation,layerId:string,curveId:string,point:Point2,topology:DrawingDocument=evaluation.drawing):Point2 {
 evaluation={...evaluation,state:{...evaluation.state,layerDomains:evaluation.state.layerDomains?.filter(domain=>domain.kind!=='h-coons'||layerCageCurveIds(topology,domain).has(curveId))}};
 if(layerUsesCage(evaluation.state.layerDomains,layerId)||hasNonlinearDeformationFor(evaluation.source,curveId))return fail('MISSING_TOPOLOGY_CONTROL_LINEAGE',`Control ${curveId} in layer ${layerId} has no resolved canonical input/output topology target. No geometry was changed.`);
 const inverse=trySnapshotControlInverse(evaluation,layerId,curveId);
 if(!inverse)return fail('SINGULAR_TOPOLOGY_INVERSE',`Layer ${layerId} or curve ${curveId} has a collapsed placement axis or layer domain. Restore or disable that operation before authoring its controls.`);
 return applyScenePlacementMatrix(inverse,point);
}

export function prepareSnapshotDrawingTopologyEdit(before:RecordingSnapshotWorkspace,edit:SnapshotDrawingTopologyEdit):{workspace:RecordingSnapshotWorkspace;diagnostics:SnapshotDiagnostic[]} {
 assertSnapshotTopologyVertex(before,edit.recordingId,edit.snapshotId,edit.angle);
 return prepareSnapshotLocalDrawingEdit(before,{snapshotId:edit.snapshotId,state:'active-draft',beforeDrawing:edit.beforeDrawing,drawing:edit.drawing,...(edit.nodeUnbind?{nodeUnbind:edit.nodeUnbind}:{})});
}
export function prepareSnapshotLocalDrawingEdit(before:RecordingSnapshotWorkspace,edit:SnapshotLocalDrawingEdit):{workspace:RecordingSnapshotWorkspace;diagnostics:SnapshotDiagnostic[]} {
 const snapshot=before.snapshots.find(value=>value.id===edit.snapshotId)??fail('MISSING_SNAPSHOT','The local Drawing target Snapshot no longer exists.'),useDraft=edit.state==='active-draft';
 const evaluate=(workspace:RecordingSnapshotWorkspace)=>resolveSnapshot(workspace,snapshot.id,{useDraft,angle:snapshot.angle,diagnostics:'preview'});
 const evaluation=evaluate(before),current=evaluation.drawing;
 const patchRelations=<T extends {id:string}>(patch:SnapshotRelationPatch<T>|undefined,prior:readonly T[],next:readonly T[])=>patchSnapshotRelations(patch,prior,next,id=>drawingSourceOwns(snapshot,id));
 // Metadata such as the artwork reference does not participate in geometry.
 const content=(drawing:DrawingDocument)=>[drawing.nodes,drawing.curves,drawing.layers,drawing.fills,drawing.offsets,drawing.joins,drawing.endpointLinks??[],drawing.groups??[],drawing.displayIntervals??[]];
 if(!same(content(current),content(edit.beforeDrawing)))return fail('STALE_TOPOLOGY_TARGET','The snapshot changed during this Drawing gesture. Start the gesture again on its current frame.');
 const members=tryPrepareSnapshotLayerMemberEdit(before,snapshot,edit,evaluation);if(members)return members;
 const owned=new Set(current.curves.filter(curve=>evaluation.provenance[curve.id]?.sourceSnapshotId===snapshot.id&&!drawingSourceOwns(snapshot,curve.id)).map(curve=>curve.id));
 const parsed=parseDrawing(edit.drawing),fork=prepareSnapshotNodeUnbind(snapshot.id,evaluation.topologyInputDrawing,current,parsed,snapshot.nodeForks,snapshot.nodeAliases,edit.nodeUnbind),forkCurves=new Set(Object.values(fork.forks??{}).filter(value=>value.bind!==false).map(value=>value.curveId));
 const merged=prepareSnapshotNodeMerge(current,parsed,new Set([...owned].filter(id=>!forkCurves.has(id))),fork.aliases,fork.freshNodeIds),target=merged.drawing;
 if(same(content(current),content(target)))return {workspace:before,diagnostics:[]};
 const membershipBefore=captureSnapshotResponseMembership(before);
 const originalIds=new Set(drawingIdentityIds(current)),occupied=new Set([...Object.values(before.library).flatMap(map=>Object.keys(map)),...before.snapshots.flatMap(value=>[value.id,...value.layers.map(layer=>layer.id),...Object.keys(value.source?.originIds??{}),...Object.keys(value.nodeForks??{}),...[...value.relations.displayIntervals?.add??[],...value.relations.displayIntervals?.update??[]].flatMap(track=>track.ranges.map(range=>range.id)),...names.flatMap(name=>[...value.relations[name]?.add??[],...value.relations[name]?.update??[]].map(relation=>relation.id))])]);
 for(const id of drawingIdentityIds(target))if(!originalIds.has(id)&&occupied.has(id))return fail('TOPOLOGY_ID_COLLISION',`New Drawing identity ${id} already belongs to another canonical element or layer.`);
 const appearances=new Map<string,SnapshotCurveAppearanceMap>(),paintAppearances=new Map<string,SnapshotPaintAppearanceMap>();
 for(const curve of target.curves){const prior=current.curves.find(value=>value.id===curve.id);if(!prior)continue;
  if(layerFor(current,curve.id)?.id!==layerFor(target,curve.id)?.id)return fail('TOPOLOGY_MEMBERSHIP_CONFLICT','Moving existing elements between layers requires an explicit membership move.');
  if(!owned.has(curve.id)&&!same(curve.nodes,prior.nodes.map((id,end)=>snapshotNodeAuthority(merged.aliases,snapshotForkForEndpoint(fork.forks,{curveId:curve.id,end:end as 0|1})??id))))return fail('INHERITED_TOPOLOGY_CONFLICT','Inherited curve endpoint identities require an explicit Snapshot node authority.');
  const unsupported=unsupportedSnapshotCurveAppearanceFields(prior,curve);if(unsupported.length)return fail('TOPOLOGY_STYLE_CONFLICT',`Curve ${curve.id} changes unsupported local fields: ${unsupported.join(', ')}. No geometry or appearance was changed.`);
  const appearance=snapshotCurveAppearanceDifference(prior,curve);if(appearance){if(prior.locked)return fail('LOCKED_PROPERTY_TARGET','Unlock the curve before editing its properties.');const layerId=layerFor(target,curve.id)!.id;appearances.set(layerId,{...appearances.get(layerId),[curve.id]:appearance});}
 }
 for(const kind of ['fills','offsets'] as const)for(const value of target[kind]){const prior=current[kind].find(item=>item.id===value.id);if(!prior)continue;
  if(layerFor(current,value.id)?.id!==layerFor(target,value.id)?.id)return fail('TOPOLOGY_MEMBERSHIP_CONFLICT','Moving existing paint between layers requires an explicit membership move.');
  const patch=snapshotPaintAppearanceDifference(prior,value);if(!patch)continue;
  if(prior.locked)return fail('LOCKED_PROPERTY_TARGET','Unlock the paint object before editing its properties.');
  const layerId=layerFor(target,value.id)!.id;
  if(patch.kind==='offset'&&patch.translation){const sourceCurve='source' in value?value.source[0]?.id:undefined,inverse=inverseAffine2D(snapshotControlMatrix(evaluation,layerId,sourceCurve??''));
   if(!inverse)return fail('SINGULAR_PAINT_PLACEMENT','Restore the collapsed layer or stroke axis before changing the offset translation. Other appearance properties remain editable.');
   patch.translation=applyAffine2DVector(inverse,patch.translation);
  }
  paintAppearances.set(layerId,{...paintAppearances.get(layerId),[value.id]:patch});
 }
 let workspace=clone(before),local=workspace.snapshots.find(value=>value.id===snapshot.id)!;
 if(merged.aliases)local.nodeAliases=merged.aliases;else delete local.nodeAliases;
 if(fork.forks)local.nodeForks=fork.forks;else delete local.nodeForks;
 const wantedIds=new Set([...target.curves,...target.fills,...target.offsets].map(value=>value.id)),removed=current.layers.flatMap(layer=>layer.items).filter(id=>!wantedIds.has(id));
 const localOwned=new Set(removed.filter(id=>evaluation.provenance[id]?.sourceSnapshotId===snapshot.id&&!drawingSourceOwns(snapshot,id)));
 if(removed.some(id=>drawingSourceOwns(snapshot,id)))return fail('DRAWING_SOURCE_OWNERSHIP','Drawing-owned originals must be deleted through their original-source adapter.');
 for(const layer of local.layers)if(!target.layers.some(value=>value.id===layer.id)&&drawingSourceOwns(snapshot,layer.id))return fail('DRAWING_SOURCE_OWNERSHIP','Drawing-owned layers must be deleted through their original-source adapter.');
 const newIds=new Set(target.curves.filter(curve=>!current.curves.some(prior=>prior.id===curve.id)).map(curve=>curve.id));
 local.layers=target.layers.map(layer=>{
  const prior=local.layers.find(value=>value.id===layer.id);
  if(!prior)return {...clone(layer),kind:'original' as const};
  if(prior.kind==='original'){if(drawingSourceOwns(snapshot,layer.id)){if(prior.name!==layer.name)return fail('DRAWING_SOURCE_OWNERSHIP','Drawing-owned layer names must be changed through their original-source adapter.');const added=layer.items.filter(id=>!prior.items.includes(id)),excluded=prior.items.filter(id=>!layer.items.includes(id)),ordered=prior.membership?.orderOverride||!same(current.layers.find(value=>value.id===layer.id)?.items,layer.items);return {...prior,...(added.length||excluded.length||ordered?{membership:{...(added.length?{addElementIds:added}:{}),...(excluded.length?{excludeElementIds:excluded}:{}),...(ordered?{orderOverride:[...layer.items]}:{})}}:{membership:undefined})};}return {...prior,name:layer.name,items:[...layer.items]};}
  const membership=excludeSnapshotLocalMembers(prior.membership??{},removed.filter(id=>current.layers.find(value=>value.id===layer.id)?.items.includes(id)));
  const added=layer.items.filter(id=>!current.layers.find(value=>value.id===layer.id)?.items.includes(id));
  const addElementIds=[...new Set([...(membership.addElementIds??[]),...added])],excludeElementIds=(membership.excludeElementIds??[]).filter(id=>!addElementIds.includes(id));
  return {...prior,name:layer.name,...(addElementIds.length||excludeElementIds.length||membership.orderOverride?.length?{membership:{...(membership.orderOverride?{orderOverride:[...layer.items]}:{}),...(addElementIds.length?{addElementIds}:{}),...(excludeElementIds.length?{excludeElementIds}:{})}}:{membership:undefined})};
 });
 // New material starts in this snapshot's input domain. Explicit child P in a
 // nonlinear layer uses a fixed input draft plus an authored output target.
 // New parent/source members still have no private child correction entries.
 const inheritedPrograms=new Map<string,import('../drawing/materialProgram').EvaluatedMaterialStep[]>();
 for(const layer of snapshot.layers)if(layer.kind==='reference'&&before.snapshots.some(value=>value.id===layer.baseSnapshotId)&&target.layers.find(value=>value.id===layer.id)?.items.some(id=>newIds.has(id))){const parent=resolveSnapshot(before,layer.baseSnapshotId,{useDraft:false,diagnostics:'preview'}).drawing;for(const curveId of target.layers.find(value=>value.id===layer.id)!.items.filter(id=>newIds.has(id)))inheritedPrograms.set(curveId,inheritedTopologyLayerProgram(parent,layer.baseLayerId,{drawing:target,layerId:layer.id,curveId})??[]);}
 const nonlinearLayers=nonlinearTopologyTargetLayers(evaluation,target,inheritedPrograms),nonlinearInputs=createNonlinearTopologyInput(evaluation,target,newIds,nonlinearLayers,inheritedPrograms);
 const inverseByLayer=new Map<string,(point:Point2)=>Point2>(),nodes=new Map(target.nodes.map(node=>[node.id,node]));
 const inverse=(layerId:string)=>{let value=inverseByLayer.get(layerId);if(!value){value=layerWarpInverse(evaluation,layerId);inverseByLayer.set(layerId,value);}return value;};
 for(const curve of target.curves){if(!newIds.has(curve.id)){if(owned.has(curve.id)&&!forkCurves.has(curve.id)&&!same(curve.nodes,workspace.library.curves[curve.id].nodes))workspace.library.curves[curve.id].nodes=[...curve.nodes];continue;}
  const input=nonlinearInputs.get(curve.id);if(input){workspace.library.curves[curve.id]=input.curve;for(const [id,position] of input.nodes)if(!Object.hasOwn(workspace.library.nodes,id)&&!Object.hasOwn(fork.forks??{},id))workspace.library.nodes[id]={id,position:[...position]};continue;}
  const layerId=layerFor(target,curve.id)!.id,map=inverse(layerId);
  const handles=curve.handles.map((point,end)=>{
   const nodeId=curve.nodes[end],post=evaluation.preElementPlacementDrawing.nodes.find(node=>node.id===nodeId),base=evaluation.preShapeDrawing.nodes.find(node=>node.id===nodeId),delta=post&&base?sub(post.position,base.position):[0,0] as Point2;
   return map(sub(unplace(evaluation,layerId,curve.id,point,target),delta));
  }) as [Point2,Point2];
  workspace.library.curves[curve.id]={...clone(curve),handles};
  for(const nodeId of curve.nodes)if(!Object.hasOwn(workspace.library.nodes,nodeId)&&!Object.hasOwn(fork.forks??{},nodeId))workspace.library.nodes[nodeId]={id:nodeId,position:map(unplace(evaluation,layerId,curve.id,nodes.get(nodeId)!.position,target))};
 }
 for(const kind of ['fills','offsets'] as const)for(const value of target[kind])if(!current[kind].some(prior=>prior.id===value.id))Object.defineProperty(workspace.library[kind],value.id,{value:clone(value),enumerable:true,writable:true,configurable:true});
 const localJoins=(drawing:DrawingDocument)=>drawing.joins.map(join=>{if(join.mode!=='ARC'||join.radius===undefined)return join;const scale=snapshotControlBrushScale(evaluation,layerFor(target,join.a.curveId)?.id??'',join.a.curveId);return scale===1?join:{...join,radius:join.radius/scale};});
 const localLinks=(drawing:DrawingDocument)=>(drawing.endpointLinks??[]).map(link=>{if(link.joinBrush?.kind!=='ARC')return link;const scale=snapshotControlBrushScale(evaluation,layerFor(current,link.a.curveId)?.id??'',link.a.curveId);return scale===1?link:{...link,joinBrush:{...link.joinBrush,trimDistance:link.joinBrush.trimDistance/scale}};});
 for(const name of names){const patch=patchRelations(local.relations[name] as SnapshotRelationPatch<{id:string}>|undefined,name==='endpointLinks'?localLinks(current):name==='joins'?localJoins(current):current[name]??[],name==='endpointLinks'?localLinks(target):name==='joins'?localJoins(target):target[name]??[]);if(patch)(local.relations as Record<string,unknown>)[name]=patch;else delete local.relations[name];}
 local.relations=snapshotWithMirrorMetadata(local,current,target).relations;
 // Relation topology changes immediately, including when a shape draft exists.
 // Retire disabled link references in all local states, not just today's draft.
 const authorityStates=[local.deformation,...local.inheritedState?[local.inheritedState]:[],...local.draft?[local.draft.deformation]:[]],liveLinks=new Set((target.endpointLinks??[]).map(link=>link.id));
 for(const state of authorityStates)for(const domain of state.layerDomains??[])if(domain.kind==='h-coons'&&domain.strokeScope)domain.strokeScope=reconcileLayerCageStrokeScope(domain,current,target);
 const liveNodes=new Set(target.curves.flatMap(curve=>curve.nodes)),retiredControlNodes=new Set(current.curves.filter(curve=>target.curves.some(value=>value.id===curve.id)).flatMap(curve=>curve.nodes.filter(id=>!liveNodes.has(id))));
 for(const state of authorityStates)for(const layer of Object.values(state.layers))if(layer.shape)for(const id of Object.keys(layer.shape.nodes))if(snapshotNodeAuthority(merged.aliases,id)!==id)delete layer.shape.nodes[id];
 for(const state of authorityStates)for(const domain of state.layerDomains??[])if(domain.postShape)for(const id of Object.keys(domain.postShape.nodes))if(snapshotNodeAuthority(merged.aliases,id)!==id||retiredControlNodes.has(id))delete domain.postShape.nodes[id];
 for(const state of authorityStates)for(const [id,value] of Object.entries(state.relationPositions)){const sourceLinkIds=value.sourceLinkIds.filter(linkId=>liveLinks.has(linkId));if(!sourceLinkIds.length)delete state.relationPositions[id];else if(sourceLinkIds.length!==value.sourceLinkIds.length)state.relationPositions[id]={...value,sourceLinkIds};}
 // Appearance belongs to the same saved/draft state as the command's controls.
 const appearanceState=useDraft&&local.draft?local.draft.deformation:local.deformation;
 for(const [layerId,patch] of appearances){const layer=appearanceState.layers[layerId]??={};layer.curveAppearance=mergeSnapshotCurveAppearance(layer.curveAppearance,patch);}
 for(const [layerId,patch] of paintAppearances){const layer=appearanceState.layers[layerId]??={};layer.paintAppearance=mergeSnapshotPaintAppearance(layer.paintAppearance,patch);}
 // Existing controls are residuals over today's live post-Warp material. Only
 // changed IDs are authored; saved state and an unrelated draft remain intact.
 const state:SnapshotDeformationState=useDraft&&local.draft?local.draft.deformation:local.deformation,shapes=new Map<string,NonNullable<SnapshotDeformationState['layers'][string]['shape']>>();
 const priorDomains=state.layerDomains;
 if(nonlinearLayers.size)state.layerDomains=nonlinearTopologyControlBase(evaluation.state.layerDomains??[],state.layerDomains,nonlinearLayers,()=>{let serial=1,id=`${snapshot.id}:topology-controls:${serial}`;while(occupied.has(id)||workspace.snapshots.some(value=>[...value.deformation.layerDomains??[],...value.inheritedState?.layerDomains??[],...value.draft?.deformation.layerDomains??[]].some(domain=>domain.id===id)))id=`${snapshot.id}:topology-controls:${++serial}`;occupied.add(id);return id;});
 const intermediate=evaluate(workspace);
 const nonlinearCurves=new Set(target.curves.filter(curve=>nonlinearLayers.has(layerFor(target,curve.id)!.id)).map(curve=>curve.id));
 const linearRelations=(drawing:DrawingDocument):DrawingDocument=>({...drawing,endpointLinks:drawing.endpointLinks?.filter(link=>!nonlinearCurves.has(link.a.curveId)&&!nonlinearCurves.has(link.b.curveId))});
 const failedDomain=intermediate.diagnostics.find(issue=>issue.code==='LAYER_DOMAIN'&&intermediate.state.layerDomains?.some(domain=>domain.id===issue.channelId&&domain.layerIds.some(id=>nonlinearLayers.has(id))));
 if(failedDomain)return fail('NONLINEAR_TOPOLOGY_INPUT',`The topology input cannot be evaluated by its retained domain: ${failedDomain.message} No geometry was changed.`);
 const relationNodes=reconcileSnapshotEndpointRelationEdit(linearRelations(current),linearRelations(target),intermediate,state,(layerId,curveId,point)=>unplace(intermediate,layerId,curveId,point),authorityStates);
 const post=captureLayerDomainControls(intermediate.drawing,target,intermediate.state.layerDomains??[],state.layerDomains,nonlinearLayers);if(post.handledLayers.size)state.layerDomains=retainOtherTopologyControls(post.domains,evaluation.state.layerDomains??[],priorDomains,target,nonlinearLayers,retiredControlNodes);
 const shapeFor=(layerId:string)=>{let value=shapes.get(layerId);if(!value){value=clone(state.layers[layerId]?.shape??intermediate.state.layers[layerId]?.shape??{nodes:{},handles:{}});shapes.set(layerId,value);}return value;};
 for(const curve of target.curves){if(newIds.has(curve.id))continue;const prior=current.curves.find(value=>value.id===curve.id)!,layerId=layerFor(target,curve.id)!.id;if(nonlinearLayers.has(layerId))continue;
  for(const end of [0,1] as const){const wantedNode=nodes.get(curve.nodes[end])!,priorNode=current.nodes.find(node=>node.id===prior.nodes[end])!,baseNode=intermediate.preShapeDrawing.nodes.find(node=>node.id===curve.nodes[end]);if(!baseNode)return fail('MISSING_TOPOLOGY_CONTROL','A shared Drawing node has no canonical input.');
   if(!relationNodes.has(wantedNode.id)&&(curve.nodes[end]!==prior.nodes[end]||!close(wantedNode.position,priorNode.position)))shapeFor(layerId).nodes[wantedNode.id]=sub(unplace(intermediate,layerId,curve.id,wantedNode.position),baseNode.position);
   if(curve.nodes[end]!==prior.nodes[end]||!close(sub(curve.handles[end],wantedNode.position),sub(prior.handles[end],priorNode.position))){const baseCurve=intermediate.preShapeDrawing.curves.find(value=>value.id===curve.id)!;const shape=shapeFor(layerId),deltas=shape.handles[curve.id]??[[0,0],[0,0]];shape.handles[curve.id]=deltas;deltas[end]=sub(sub(unplace(intermediate,layerId,curve.id,curve.handles[end]),unplace(intermediate,layerId,curve.id,wantedNode.position)),sub(baseCurve.handles[end],baseNode.position));}
  }
 }
 for(const [layerId,shape] of shapes)state.layers[layerId]={...state.layers[layerId],shape};
 // A locally owned original deletion has source semantics for its descendants;
 // inherited deletion is only the membership tombstone above.
 for(const layer of snapshot.layers)if(layer.kind==='original'&&!target.layers.some(value=>value.id===layer.id))localOwned.add(layer.id);
 if(localOwned.size){const remainingCurves=Object.values(workspace.library.curves).filter(curve=>!localOwned.has(curve.id)),usedNodes=new Set(remainingCurves.flatMap(curve=>curve.nodes));for(const curveId of [...localOwned])for(const nodeId of before.library.curves[curveId]?.nodes??[])if(!usedNodes.has(nodeId))localOwned.add(nodeId);workspace=removeDeletedSourceReferences(before,workspace,snapshot.id,localOwned);}
 workspace=propagateAutomaticSnapshotLayers(before,workspace).workspace;
 let actual=evaluate(workspace);
 // The editor's ranges describe the visible frame. A newly resolved local
 // route stores them in its live relationship material frame, using exactly
 // the same source-t/ARC-fraction transport as interpolation and numeric edits.
 const resolvedMaterials=new Set<string>(),materialTracks=(target.displayIntervals??[]).map(track=>{const material=snapshotIntervalMaterialSource(actual,track.id);if(material===actual.source)return track;resolvedMaterials.add(track.id);return transportEndpointPairMaterial(target,track,material,[]);});
 if(resolvedMaterials.size){const patch=patchRelations(local.relations.displayIntervals,current.displayIntervals??[],materialTracks);if(patch)local.relations.displayIntervals=patch;else delete local.relations.displayIntervals;
  for(const track of materialTracks)if(resolvedMaterials.has(track.id)){const layerId=layerFor(target,track.anchor.id)!.id,value=actual.state.layers[layerId]?.intervals?.[track.id];if(value?.appearance){const layer=state.layers[layerId]??={};layer.intervals={...layer.intervals,[track.id]:{...clone(value),appearance:clone(track)}};}}
  actual=evaluate(workspace);
 }
 for(const track of target.displayIntervals??[])if(track.displayRoute&&!actual.drawing.displayIntervals?.some(value=>value.id===track.id&&same(value.displayRoute,track.displayRoute)))return fail('TOPOLOGY_ROUTE_UNREPRESENTABLE','This local endpoint link cannot yet retain a through-display route over its source controls. No relation was changed.');
 for(const track of target.displayIntervals??[])if(resolvedMaterials.has(track.id)){const got=actual.drawing.displayIntervals!.find(value=>value.id===track.id)!;for(const range of track.ranges){const value=got.ranges.find(item=>item.id===range.id);if(!value||!close([range.start,range.end],[value.start,value.end]))return fail('TOPOLOGY_MATERIAL_UNREPRESENTABLE','The route edit cannot retain its requested material addresses. No relation was changed.');}}
 for(const join of target.joins)if(join.mode==='ARC'){const got=actual.drawing.joins.find(value=>value.id===join.id);if(got?.mode!=='ARC'||!close([got.radius??0,0],[join.radius??0,0]))return fail('TOPOLOGY_BRUSH_UNREPRESENTABLE','The requested ARC radius cannot be represented under the current layer or stroke placement. No relation was changed.');}
 for(const link of target.endpointLinks??[]){const brush=link.joinBrush,got=actual.drawing.endpointLinks?.find(value=>value.id===link.id)?.joinBrush;if(brush?.kind==='ARC'&&(got?.kind!=='ARC'||!close([brush.trimDistance,0],[got.trimDistance,0])))return fail('TOPOLOGY_BRUSH_UNREPRESENTABLE','The requested ARC trim cannot be represented under the current layer or stroke placement. No relation was changed.');}
 for(const kind of ['fills','offsets'] as const)for(const value of target[kind]){const got=actual.drawing[kind].find(item=>item.id===value.id);if(!got)return fail('TOPOLOGY_APPEARANCE_UNREPRESENTABLE',`Paint ${value.id} could not retain its requested local appearance. No geometry or appearance was changed.`);
  const difference=snapshotPaintAppearanceDifference(got,value);if(difference?.kind==='offset'&&difference.translation&&'translation' in got&&got.translation&&close(got.translation,difference.translation))delete difference.translation;
  if(difference&&Object.keys(difference).length>1)return fail('TOPOLOGY_APPEARANCE_UNREPRESENTABLE',`Paint ${value.id} could not retain its requested local appearance. No geometry or appearance was changed.`);
 }
 for(const curve of target.curves){const got=actual.drawing.curves.find(value=>value.id===curve.id);if(got&&snapshotCurveAppearanceDifference(got,curve))return fail('TOPOLOGY_APPEARANCE_UNREPRESENTABLE',`Curve ${curve.id} could not retain its requested local appearance. No geometry or appearance was changed.`);if(!got||!same(got.nodes,curve.nodes))return fail('TOPOLOGY_TARGET_UNREPRESENTABLE',`Curve ${curve.id} could not retain its requested shared-node topology.`);for(const end of [0,1] as const){const wanted=nodes.get(curve.nodes[end])!.position,gotNode=actual.drawing.nodes.find(node=>node.id===got.nodes[end])?.position;if(!gotNode||!close(gotNode,wanted)||!close(got.handles[end],curve.handles[end]))return fail('TOPOLOGY_TARGET_UNREPRESENTABLE',`Curve ${curve.id} cannot reproduce the requested controls under its live layer domains and SMOOTH constraints. No geometry was changed.`);}}
 if(actual.drawing.curves.some(curve=>!wantedIds.has(curve.id)))return fail('TOPOLOGY_TARGET_UNREPRESENTABLE','The local membership edit could not remove every requested curve.');
 const reconciled=reconcileSnapshotMembershipResponses(workspace,membershipBefore);
 return {workspace:parseRecordingSnapshots(reconciled.workspace),diagnostics:[...actual.diagnostics.filter(issue=>issue.code==='LOCAL_ORIGINAL'||issue.code==='MISSING_SNAPSHOT'||issue.code==='MISSING_LAYER'),...reconciled.diagnostics.map(({message})=>({code:'POSE' as const,message}))]};
}
