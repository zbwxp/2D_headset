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
import type {Angle,RecordingSnapshot,RecordingSnapshotWorkspace,SnapshotDiagnostic,SnapshotRelationPatch,SnapshotDeformationState} from './model';

/** Drawing already authored the geometry, connections and identities. This is
 * an ownership/coordinate adapter, never another pen or topology kernel. */
export interface SnapshotDrawingTopologyEdit {
 recordingId:string;snapshotId:string;angle:Angle;
 beforeDrawing:DrawingDocument;drawing:DrawingDocument;
}
/** Snapshot-local authorship has no dependency on a Recorder or its cursor.
 * The host chooses the visible saved/draft state before entering this adapter. */
export interface SnapshotLocalDrawingEdit {
 snapshotId:string;state:'saved'|'active-draft';
 beforeDrawing:DrawingDocument;drawing:DrawingDocument;
}
export class SnapshotDrawingTopologyError extends Error {constructor(readonly code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new SnapshotDrawingTopologyError(code,message);};
const clone=<T,>(value:T):T=>structuredClone(value);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const close=(a:Point2,b:Point2)=>length(sub(a,b))<=1e-8*Math.max(1,length(a),length(b));
const curveStyle=({handles:_,nodes:__,...curve}:DrawingCurve)=>curve;
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
function unplace(evaluation:SnapshotEvaluation,layerId:string,curveId:string,point:Point2):Point2 {
 const inverse=trySnapshotControlInverse(evaluation,layerId,curveId);
 if(!inverse)return fail('SINGULAR_TOPOLOGY_INVERSE',`Layer ${layerId} or curve ${curveId} has a collapsed placement axis or layer domain. Restore or disable that operation before authoring its controls.`);
 return applyScenePlacementMatrix(inverse,point);
}
/** Keep existing canonical endpoint authorities when Drawing merged a new pen
 * node into one of them. Two inherited nodes cannot be silently identified. */
function preserveInheritedNodes(before:DrawingDocument,target:DrawingDocument,owned:Set<string>):DrawingDocument {
 const authority=new Map<string,string>();
 for(const curve of before.curves){if(owned.has(curve.id))continue;const wanted=target.curves.find(value=>value.id===curve.id);if(!wanted)continue;
  for(const end of [0,1] as const){const prior=authority.get(wanted.nodes[end]);if(prior&&prior!==curve.nodes[end])return fail('INHERITED_TOPOLOGY_CONFLICT','This connection would merge two distinct inherited nodes. Their source topology must be edited in Drawing.');authority.set(wanted.nodes[end],curve.nodes[end]);}
 }
 if([...authority].every(([id,value])=>id===value))return target;
 const map=(id:string)=>authority.get(id)??id;
 const nodes=new Map<string,DrawingDocument['nodes'][number]>();for(const node of target.nodes){const id=map(node.id),prior=nodes.get(id);if(prior&&!close(prior.position,node.position))return fail('INHERITED_TOPOLOGY_CONFLICT','Inherited node identity has conflicting requested positions.');nodes.set(id,{...node,id});}
 return {...target,nodes:[...nodes.values()],curves:target.curves.map(curve=>({...curve,nodes:curve.nodes.map(map) as [string,string]}))};
}

export function prepareSnapshotDrawingTopologyEdit(before:RecordingSnapshotWorkspace,edit:SnapshotDrawingTopologyEdit):{workspace:RecordingSnapshotWorkspace;diagnostics:SnapshotDiagnostic[]} {
 assertSnapshotTopologyVertex(before,edit.recordingId,edit.snapshotId,edit.angle);
 return prepareSnapshotLocalDrawingEdit(before,{snapshotId:edit.snapshotId,state:'active-draft',beforeDrawing:edit.beforeDrawing,drawing:edit.drawing});
}
export function prepareSnapshotLocalDrawingEdit(before:RecordingSnapshotWorkspace,edit:SnapshotLocalDrawingEdit):{workspace:RecordingSnapshotWorkspace;diagnostics:SnapshotDiagnostic[]} {
 const snapshot=before.snapshots.find(value=>value.id===edit.snapshotId)??fail('MISSING_SNAPSHOT','The local Drawing target Snapshot no longer exists.'),useDraft=edit.state==='active-draft';
 const evaluate=(workspace:RecordingSnapshotWorkspace)=>resolveSnapshot(workspace,snapshot.id,{useDraft,angle:snapshot.angle,diagnostics:'preview'});
 const evaluation=evaluate(before),current=evaluation.drawing;
 const patchRelations=<T extends {id:string}>(patch:SnapshotRelationPatch<T>|undefined,prior:readonly T[],next:readonly T[])=>patchSnapshotRelations(patch,prior,next,id=>drawingSourceOwns(snapshot,id));
 // Metadata such as the artwork reference does not participate in geometry.
 const content=(drawing:DrawingDocument)=>[drawing.nodes,drawing.curves,drawing.layers,drawing.fills,drawing.offsets,drawing.joins,drawing.endpointLinks??[],drawing.groups??[],drawing.displayIntervals??[]];
 if(!same(content(current),content(edit.beforeDrawing)))return fail('STALE_TOPOLOGY_TARGET','The snapshot changed during this Drawing gesture. Start the gesture again on its current frame.');
 const owned=new Set(current.curves.filter(curve=>evaluation.provenance[curve.id]?.sourceSnapshotId===snapshot.id&&!drawingSourceOwns(snapshot,curve.id)).map(curve=>curve.id));
 const target=preserveInheritedNodes(current,parseDrawing(edit.drawing),owned);
 if(same(content(current),content(target)))return {workspace:before,diagnostics:[]};
 const membershipBefore=captureSnapshotResponseMembership(before);
 const originalIds=new Set(drawingIdentityIds(current)),occupied=new Set([...Object.values(before.library).flatMap(map=>Object.keys(map)),...before.snapshots.flatMap(value=>[value.id,...value.layers.map(layer=>layer.id),...Object.keys(value.source?.originIds??{}),...[...value.relations.displayIntervals?.add??[],...value.relations.displayIntervals?.update??[]].flatMap(track=>track.ranges.map(range=>range.id)),...names.flatMap(name=>[...value.relations[name]?.add??[],...value.relations[name]?.update??[]].map(relation=>relation.id))])]);
 for(const id of drawingIdentityIds(target))if(!originalIds.has(id)&&occupied.has(id))return fail('TOPOLOGY_ID_COLLISION',`New Drawing identity ${id} already belongs to another canonical element or layer.`);
 for(const curve of target.curves){const prior=current.curves.find(value=>value.id===curve.id);if(!prior)continue;
  if(layerFor(current,curve.id)?.id!==layerFor(target,curve.id)?.id)return fail('TOPOLOGY_MEMBERSHIP_CONFLICT','Moving existing elements between layers requires an explicit membership move.');
  if(!owned.has(curve.id)&&!same(curve.nodes,prior.nodes))return fail('INHERITED_TOPOLOGY_CONFLICT','Inherited curve endpoint identities cannot be replaced locally.');
  if(!same(curveStyle(prior),curveStyle(curve)))return fail('TOPOLOGY_STYLE_CONFLICT','This topology edit also changes existing curve appearance. Keep inherited stroke appearance when joining new pen segments.');
 }
 for(const kind of ['fills','offsets'] as const)for(const value of target[kind]){const prior=current[kind].find(item=>item.id===value.id);if(prior&&!same(value,prior))return fail('TOPOLOGY_PAINT_CONFLICT','Existing paint properties must be edited through their own channels.');}
 let workspace=clone(before),local=workspace.snapshots.find(value=>value.id===snapshot.id)!;
 const wantedIds=new Set([...target.curves,...target.fills,...target.offsets].map(value=>value.id)),removed=current.layers.flatMap(layer=>layer.items).filter(id=>!wantedIds.has(id));
 const localOwned=new Set(removed.filter(id=>evaluation.provenance[id]?.sourceSnapshotId===snapshot.id&&!drawingSourceOwns(snapshot,id)));
 if(removed.some(id=>drawingSourceOwns(snapshot,id)))return fail('DRAWING_SOURCE_OWNERSHIP','Drawing-owned originals must be deleted through their original-source adapter.');
 for(const layer of local.layers)if(!target.layers.some(value=>value.id===layer.id)&&drawingSourceOwns(snapshot,layer.id))return fail('DRAWING_SOURCE_OWNERSHIP','Drawing-owned layers must be deleted through their original-source adapter.');
 const newIds=new Set(target.curves.filter(curve=>!current.curves.some(prior=>prior.id===curve.id)).map(curve=>curve.id));
 local.layers=target.layers.map(layer=>{
  const prior=local.layers.find(value=>value.id===layer.id);
  if(!prior)return {...clone(layer),kind:'original' as const};
  if(prior.kind==='original'){if(drawingSourceOwns(snapshot,layer.id)&&(!same(prior.items,layer.items)||prior.name!==layer.name))return fail('DRAWING_SOURCE_OWNERSHIP','Drawing-owned layer membership must be changed through its original-source adapter.');return {...prior,name:layer.name,items:[...layer.items]};}
  const membership=excludeSnapshotLocalMembers(prior.membership??{},removed.filter(id=>current.layers.find(value=>value.id===layer.id)?.items.includes(id)));
  const added=layer.items.filter(id=>!current.layers.find(value=>value.id===layer.id)?.items.includes(id));
  const addElementIds=[...new Set([...(membership.addElementIds??[]),...added])],excludeElementIds=(membership.excludeElementIds??[]).filter(id=>!addElementIds.includes(id));
  return {...prior,name:layer.name,...(addElementIds.length||excludeElementIds.length?{membership:{...(addElementIds.length?{addElementIds}:{}),...(excludeElementIds.length?{excludeElementIds}:{})}}:{membership:undefined})};
 });
 // New material starts in this snapshot's input domain. Whole-layer Warp and
 // placement remain live; new IDs receive no private inverse correction keys.
 const inverseByLayer=new Map<string,(point:Point2)=>Point2>(),nodes=new Map(target.nodes.map(node=>[node.id,node]));
 const inverse=(layerId:string)=>{let value=inverseByLayer.get(layerId);if(!value){value=layerWarpInverse(evaluation,layerId);inverseByLayer.set(layerId,value);}return value;};
 for(const curve of target.curves){if(!newIds.has(curve.id)){if(owned.has(curve.id)&&!same(curve.nodes,workspace.library.curves[curve.id].nodes))workspace.library.curves[curve.id].nodes=[...curve.nodes];continue;}
  const layerId=layerFor(target,curve.id)!.id,map=inverse(layerId);
  const handles=curve.handles.map((point,end)=>{
   const nodeId=curve.nodes[end],post=evaluation.preElementPlacementDrawing.nodes.find(node=>node.id===nodeId),base=evaluation.preShapeDrawing.nodes.find(node=>node.id===nodeId),delta=post&&base?sub(post.position,base.position):[0,0] as Point2;
   return map(sub(unplace(evaluation,layerId,curve.id,point),delta));
  }) as [Point2,Point2];
  workspace.library.curves[curve.id]={...clone(curve),handles};
  for(const nodeId of curve.nodes)if(!Object.hasOwn(workspace.library.nodes,nodeId))workspace.library.nodes[nodeId]={id:nodeId,position:map(unplace(evaluation,layerId,curve.id,nodes.get(nodeId)!.position))};
 }
 for(const kind of ['fills','offsets'] as const)for(const value of target[kind])if(!current[kind].some(prior=>prior.id===value.id))Object.defineProperty(workspace.library[kind],value.id,{value:clone(value),enumerable:true,writable:true,configurable:true});
 const localLinks=(drawing:DrawingDocument)=>(drawing.endpointLinks??[]).map(link=>{if(link.joinBrush?.kind!=='ARC')return link;const scale=snapshotControlBrushScale(evaluation,layerFor(current,link.a.curveId)?.id??'',link.a.curveId);return scale===1?link:{...link,joinBrush:{...link.joinBrush,trimDistance:link.joinBrush.trimDistance/scale}};});
 for(const name of names){const patch=patchRelations(local.relations[name] as SnapshotRelationPatch<{id:string}>|undefined,name==='endpointLinks'?localLinks(current):current[name]??[],name==='endpointLinks'?localLinks(target):target[name]??[]);if(patch)(local.relations as Record<string,unknown>)[name]=patch;else delete local.relations[name];}
 // Relation topology changes immediately, including when a shape draft exists.
 // Retire disabled link references in all local states, not just today's draft.
 const authorityStates=[local.deformation,...local.inheritedState?[local.inheritedState]:[],...local.draft?[local.draft.deformation]:[]],liveLinks=new Set((target.endpointLinks??[]).map(link=>link.id));
 for(const state of authorityStates)for(const [id,value] of Object.entries(state.relationPositions)){const sourceLinkIds=value.sourceLinkIds.filter(linkId=>liveLinks.has(linkId));if(!sourceLinkIds.length)delete state.relationPositions[id];else if(sourceLinkIds.length!==value.sourceLinkIds.length)state.relationPositions[id]={...value,sourceLinkIds};}
 // Existing controls are residuals over today's live post-Warp material. Only
 // changed IDs are authored; saved state and an unrelated draft remain intact.
 const intermediate=evaluate(workspace);
 const state:SnapshotDeformationState=useDraft&&local.draft?local.draft.deformation:local.deformation,shapes=new Map<string,NonNullable<SnapshotDeformationState['layers'][string]['shape']>>();
 const relationNodes=reconcileSnapshotEndpointRelationEdit(current,target,intermediate,state,(layerId,curveId,point)=>unplace(intermediate,layerId,curveId,point),authorityStates);
 const shapeFor=(layerId:string)=>{let value=shapes.get(layerId);if(!value){value=clone(state.layers[layerId]?.shape??intermediate.state.layers[layerId]?.shape??{nodes:{},handles:{}});shapes.set(layerId,value);}return value;};
 for(const curve of target.curves){if(newIds.has(curve.id))continue;const prior=current.curves.find(value=>value.id===curve.id)!,layerId=layerFor(target,curve.id)!.id;
  for(const end of [0,1] as const){const wantedNode=nodes.get(curve.nodes[end])!,priorNode=current.nodes.find(node=>node.id===prior.nodes[end])!,baseNode=intermediate.preShapeDrawing.nodes.find(node=>node.id===curve.nodes[end]);if(!baseNode)return fail('MISSING_TOPOLOGY_CONTROL','A shared Drawing node has no canonical input.');
   if(!relationNodes.has(wantedNode.id)&&!close(wantedNode.position,priorNode.position))shapeFor(layerId).nodes[wantedNode.id]=sub(unplace(intermediate,layerId,curve.id,wantedNode.position),baseNode.position);
   if(!close(sub(curve.handles[end],wantedNode.position),sub(prior.handles[end],priorNode.position))){const baseCurve=intermediate.preShapeDrawing.curves.find(value=>value.id===curve.id)!;const shape=shapeFor(layerId),deltas=shape.handles[curve.id]??[[0,0],[0,0]];shape.handles[curve.id]=deltas;deltas[end]=sub(sub(unplace(intermediate,layerId,curve.id,curve.handles[end]),unplace(intermediate,layerId,curve.id,wantedNode.position)),sub(baseCurve.handles[end],baseNode.position));}
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
 for(const link of target.endpointLinks??[]){const brush=link.joinBrush,got=actual.drawing.endpointLinks?.find(value=>value.id===link.id)?.joinBrush;if(brush?.kind==='ARC'&&(got?.kind!=='ARC'||!close([brush.trimDistance,0],[got.trimDistance,0])))return fail('TOPOLOGY_BRUSH_UNREPRESENTABLE','The requested ARC trim cannot be represented under the current layer or stroke placement. No relation was changed.');}
 for(const curve of target.curves){const got=actual.drawing.curves.find(value=>value.id===curve.id);if(!got||!same(got.nodes,curve.nodes))return fail('TOPOLOGY_TARGET_UNREPRESENTABLE',`Curve ${curve.id} could not retain its requested shared-node topology.`);for(const end of [0,1] as const){const wanted=nodes.get(curve.nodes[end])!.position,gotNode=actual.drawing.nodes.find(node=>node.id===got.nodes[end])?.position;if(!gotNode||!close(gotNode,wanted)||!close(got.handles[end],curve.handles[end]))return fail('TOPOLOGY_TARGET_UNREPRESENTABLE',`Curve ${curve.id} cannot reproduce the requested controls under its live layer domains and SMOOTH constraints. No geometry was changed.`);}}
 if(actual.drawing.curves.some(curve=>!wantedIds.has(curve.id)))return fail('TOPOLOGY_TARGET_UNREPRESENTABLE','The local membership edit could not remove every requested curve.');
 const reconciled=reconcileSnapshotMembershipResponses(workspace,membershipBefore);
 return {workspace:parseRecordingSnapshots(reconciled.workspace),diagnostics:[...actual.diagnostics.filter(issue=>issue.code==='LOCAL_ORIGINAL'||issue.code==='MISSING_SNAPSHOT'||issue.code==='MISSING_LAYER'),...reconciled.diagnostics.map(({message})=>({code:'POSE' as const,message}))]};
}
