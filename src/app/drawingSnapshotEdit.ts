import {trySnapshotControlInverse} from '../domain/recordingSnapshot/controlSpace';
import {prepareSnapshotEdit,snapshotEditContext,type SnapshotEditPlan} from './snapshotEditTransaction';
import type {LandmarkProject} from '../domain/landmarks/model';
import {add,sub,nodeAt,parseDrawing,type DrawingDocument as Doc,type Point2} from '../domain/drawing/model';
import {identityScenePlacement,identitySceneShape} from '../domain/recordingScene/model';
import {applyScenePlacementMatrix,composePlacementSimilarity} from '../domain/recordingScene/tracks';
import {drawingSnapshotForArtwork,remapDrawingIdentities} from '../domain/recordingSnapshot/sources';
import {applySnapshotMembershipEdit} from '../domain/recordingSnapshot/localMembership';
import {linkedNodeIds} from '../domain/drawing/endpointLinks';
import {drawingSnapshotPresentation,type DrawingSnapshotPresentation} from './drawingSnapshotPresentation';
import {applyLayerEditIntent,createLayerCurveSplitIntent,createCurveSplitIntent,type LayerEditIntent} from '../domain/drawing/layerEditIntent';
import {resolveSnapshot} from '../domain/recordingSnapshot/evaluation';
import {applyLayerDomainIntent,assertLayerDomainIntent,layerDomainMatrix,type LayerDomainIntent} from '../domain/drawing/layerDomainIntent';
import {markFinalizedGeometry} from '../domain/drawing/geometryEdit';
import {applyAffine2D,isIdentityAffine2D} from '../domain/geometry/affine2d';

const same=(a:unknown,b:unknown)=>a===b||JSON.stringify(a)===JSON.stringify(b);
const close=(a:Point2,b:Point2)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8;
export const DRAWING_REFERENCE_EDIT_CAPABILITY='Referenced layers support node, handle and geometry transforms, visibility, names and local removal here. Additions, splitting, material, connections and locks require the original source.';
export class DrawingSnapshotEditCapabilityError extends Error {
 constructor(message=DRAWING_REFERENCE_EDIT_CAPABILITY){super(message);this.name='DrawingSnapshotEditCapabilityError';}
}
function changedKeys(before:object,after:object){return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!same((before as any)[key],(after as any)[key]));}
function mergeChanged<T extends {id:string}>(source:T,before:T|undefined,after:T):T {
 if(!before)return after;const result={...source};for(const key of changedKeys(before,after)){if(Object.hasOwn(after,key))(result as any)[key]=(after as any)[key];else delete (result as any)[key];}return result;
}
function preserveSourceOrder<T extends {id:string}>(source:T[],values:T[]):T[]{const byId=new Map(values.map(value=>[value.id,value])),known=new Set(source.map(value=>value.id));return [...source.flatMap(value=>byId.has(value.id)?[byId.get(value.id)!]:[]),...values.filter(value=>!known.has(value.id))];}
const relationCurves=(value:any,key:string):string[]=>key==='groups'?value.curveIds:key==='displayIntervals'?[value.anchor.id]:[value.a.curveId,value.b.curveId];

export interface DrawingSnapshotEditPlan extends SnapshotEditPlan {
 /** Original-only legacy document; never contains referenced geometry. */
 sourceDrawing?:Doc;
 /** Snapshot state after the optional original transaction has synchronized. */
 localWorkspace?:NonNullable<LandmarkProject['recordingSnapshots']>;
}

/** A whole-layer domain retains authored parameters. Original owners still
 * edit their source through the common Drawing command; references persist a
 * local placement and consume the existing Warp/shape/placement evaluator.
 * Resolving this plan also supplies the preview, including deferred ARC ink. */
export function prepareDrawingLayerDomainEdit(project:LandmarkProject,intent:LayerDomainIntent,options:{canEditOriginals?:boolean;allowRelated?:boolean}={}):DrawingSnapshotEditPlan&{drawing:Doc} {
 assertLayerDomainIntent(intent);
 const artworkId=project.drawingSnapshots?.activeId??'$working',workspace=project.recordingSnapshots,view=workspace&&drawingSnapshotPresentation(workspace,artworkId),before=view?.drawing??project.drawing;
 if(!before)throw new DrawingSnapshotEditCapabilityError('The original Drawing document is unavailable.');
 const targets=new Set(intent.scope.layerIds);
 for(const id of targets){const layer=before.layers.find(layer=>layer.id===id);if(!layer)throw new DrawingSnapshotEditCapabilityError('A layer domain target no longer exists.');if(layer.locked||before.curves.some(curve=>layer.items.includes(curve.id)&&curve.locked))throw new DrawingSnapshotEditCapabilityError('Unlock the selected layer and its curves before transforming the whole layer.');}
 const matrix=layerDomainMatrix(intent);
 if(!intent.replace&&isIdentityAffine2D(matrix))return {before:project,project,changed:false,drawing:markFinalizedGeometry(before)};
 if(!view){if(intent.replace||intent.domain.kind==='affine'&&intent.domain.enabled===false)throw new DrawingSnapshotEditCapabilityError('Only a saved referenced layer domain can be replaced or disabled.');if(options.canEditOriginals===false)throw new DrawingSnapshotEditCapabilityError('Recording cannot edit Drawing-owned original layers.');const drawing=applyLayerDomainIntent(before,intent,options).document,plan=prepareDrawingSnapshotEdit(project,drawing);return {...plan,drawing:markFinalizedGeometry(drawing)};}
 const localIds=[...targets].filter(id=>view.layerOwners.get(id)?.kind==='snapshot-local'),originalIds=[...targets].filter(id=>!localIds.includes(id)),local=new Set(localIds);
 if(originalIds.length&&(intent.replace||intent.domain.kind==='affine'&&intent.domain.enabled===false))throw new DrawingSnapshotEditCapabilityError('Source-owned transforms edit original geometry; only referenced layer domains can be replaced or disabled.');
 if(originalIds.length&&options.canEditOriginals===false)throw new DrawingSnapshotEditCapabilityError('Recording cannot edit Drawing-owned original layers.');
 // A shared endpoint cannot acquire a second position authority. Coherent
 // referenced layers may transform together; mixed source/reference links
 // need a common domain owner rather than baking the relation into offsets.
 const owner=(curveId:string)=>before.layers.find(layer=>layer.items.includes(curveId))?.id;
 const checkRelation=(ids:(string|undefined)[])=>{if(!ids.some(id=>id&&local.has(id)))return;if(ids.some(id=>!id||!local.has(id)))throw new DrawingSnapshotEditCapabilityError('Select every linked referenced layer for this layer transform. A link to an original source needs a common snapshot domain.');};
 for(const link of before.endpointLinks??[])checkRelation([owner(link.a.curveId),owner(link.b.curveId)]);
 for(const node of before.nodes)checkRelation(before.curves.filter(curve=>curve.nodes.includes(node.id)).map(curve=>owner(curve.id)));
 let plan:DrawingSnapshotEditPlan=originalIds.length?prepareDrawingSnapshotEdit(project,applyLayerDomainIntent(before,{...intent,scope:{kind:'layers',layerIds:originalIds}},options).document):{before:project,project,changed:false};
 if(localIds.length){
  const nextWorkspace=plan.project.recordingSnapshots!,snapshot=drawingSnapshotForArtwork(nextWorkspace,artworkId)!,layers={...snapshot.deformation.layers};
  const canonicalIds=localIds.map(view.canonicalId),domains=view.evaluation.state.layerDomains??[],useDomain=intent.domain.kind==='affine'||domains.some(domain=>domain.layerIds.some(id=>canonicalIds.includes(id)));
  let layerDomains=snapshot.deformation.layerDomains;
  if(useDomain){
   const prior=domains.find(domain=>domain.id===intent.operationId);
   if(intent.replace){if(!prior||prior.layerIds.length!==canonicalIds.length||prior.layerIds.some(id=>!canonicalIds.includes(id)))throw new DrawingSnapshotEditCapabilityError('The saved layer domain or its exact layer scope no longer exists.');}
   else if(prior)throw new DrawingSnapshotEditCapabilityError('The layer domain operation ID is already in use.');
   const operation={id:intent.operationId,layerIds:canonicalIds,matrix,...(intent.domain.kind==='affine'&&intent.domain.enabled!==undefined?{enabled:intent.domain.enabled}:{})};
   layerDomains=layerDomains?.some(domain=>domain.id===operation.id)?layerDomains.map(domain=>domain.id===operation.id?operation:domain):[...layerDomains??[],operation];
  }else if(intent.domain.kind==='placement-similarity')for(const id of canonicalIds){const placement=composePlacementSimilarity(view.evaluation.placements[id]??identityScenePlacement(),intent.domain.value);layers[id]={...layers[id],placement};}
  const next={...nextWorkspace,snapshots:nextWorkspace.snapshots.map(value=>value===snapshot?{...snapshot,deformation:{...snapshot.deformation,layers,...(layerDomains?{layerDomains}:{})}}:value)};
  const domainPlan=prepareSnapshotEdit(snapshotEditContext(plan.project,true),{kind:'snapshot-state',workspace:next});
  plan={...plan,before:project,project:domainPlan.project,changed:plan.changed||domainPlan.changed,localWorkspace:domainPlan.project.recordingSnapshots};
 }
 const result=drawingSnapshotPresentation(plan.project.recordingSnapshots!,artworkId)!;
 const priorConflicts=new Set(view.evaluation.diagnostics.filter(issue=>issue.code==='RELATION_CONFLICT').map(issue=>JSON.stringify(issue)));
 if(result.evaluation.diagnostics.some(issue=>issue.code==='RELATION_CONFLICT'&&!priorConflicts.has(JSON.stringify(issue))))throw new DrawingSnapshotEditCapabilityError('This layer domain would separate linked endpoint authorities. Transform their layers coherently.');
 if(!intent.replace&&!(intent.domain.kind==='affine'&&intent.domain.enabled===false))for(const id of localIds)for(const curve of before.curves.filter(curve=>before.layers.find(layer=>layer.id===id)!.items.includes(curve.id))){
  const after=result.drawing.curves.find(value=>value.id===curve.id);
  if(!after||curve.handles.some((point,end)=>!close(after.handles[end],applyAffine2D(matrix,point)))||curve.nodes.some(nodeId=>!close(result.drawing.nodes.find(node=>node.id===nodeId)!.position,applyAffine2D(matrix,before.nodes.find(node=>node.id===nodeId)!.position))))throw new DrawingSnapshotEditCapabilityError('This layer placement is controlled by a recording channel. Edit its owning snapshot before changing it here.');
 }
 return {...plan,drawing:markFinalizedGeometry(result.drawing)};
}

/** Adapt the result of the existing Drawing commands, not their gesture logic.
 * Only changed source fields are transported back; untouched evaluated state
 * is never ingested into the original. References retain sparse local offsets.
 * All capability checks and both common transactions run before opening Undo. */
export function prepareDrawingSnapshotEdit(project:LandmarkProject,next:Doc):DrawingSnapshotEditPlan {
 const workspace=project.recordingSnapshots,artworkId=project.drawingSnapshots?.activeId??'$working';
 const view=workspace&&drawingSnapshotPresentation(workspace,artworkId);
 if(!view||!project.drawing){const plan=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:next});return {...plan,sourceDrawing:next};}
 const before=view.drawing;if(next===before||same(next,before))return {before:project,project,changed:false};
 const source=project.drawing,localLayers=new Set([...view.layerOwners].filter(([,owner])=>owner.kind==='snapshot-local').map(([id])=>id));
 const localItems=new Set(before.layers.filter(layer=>localLayers.has(layer.id)).flatMap(layer=>layer.items));
 const localCurves=new Set(before.curves.filter(curve=>localItems.has(curve.id)).map(curve=>curve.id));
 const localNodes=new Set(before.curves.filter(curve=>localCurves.has(curve.id)).flatMap(curve=>curve.nodes));
 const canonicalNext=remapDrawingIdentities(next,view.canonicalId),evaluation=view.evaluation;
 const changedLocalLayers=new Set<string>(),visibility=new Map<string,Record<string,boolean|null>>(),renames=new Map<string,string>(),removedLayers=new Set<string>(),exclusions=new Map<string,string[]>();
 const removedItems=new Set([...localItems].filter(id=>!next.layers.some(layer=>layer.items.includes(id)))),removedCurves=new Set([...localCurves].filter(id=>removedItems.has(id)));
 const geometryChanged=before.nodes.some(node=>!same(node.position,next.nodes.find(value=>value.id===node.id)?.position))||before.curves.some(curve=>!same(curve.handles,next.curves.find(value=>value.id===curve.id)?.handles));
 const inverse=(layerId:string,curveId:string,p:Point2):Point2=>{
  const matrix=trySnapshotControlInverse(evaluation,layerId,curveId);
  if(!matrix)throw new DrawingSnapshotEditCapabilityError('Restore or disable the affected layer domain or zero placement axis before editing its controls.');
  return applyScenePlacementMatrix(matrix,p);
 };
 const localVisibility=(layerId:string,id:string,visible:boolean)=>{visibility.set(layerId,{...visibility.get(layerId),[id]:visible});changedLocalLayers.add(layerId);};
 for(const layer of before.layers.filter(layer=>localLayers.has(layer.id))){
  const after=next.layers.find(value=>value.id===layer.id),owner=view.layerOwners.get(layer.id)!;if(!after){removedLayers.add(owner.layerId);continue;}
  if(changedKeys(layer,after).some(key=>!['name','visible','items'].includes(key))||after.items.some(id=>!layer.items.includes(id))||!same(after.items,layer.items.filter(id=>after.items.includes(id))))throw new DrawingSnapshotEditCapabilityError();
  const removed=layer.items.filter(id=>!after.items.includes(id));if(removed.length)exclusions.set(owner.layerId,removed.map(view.canonicalId));
  if(layer.name!==after.name)renames.set(owner.layerId,after.name);if(layer.visible!==after.visible)localVisibility(owner.layerId,owner.layerId,after.visible);
 }
 for(const key of ['curves','fills','offsets'] as const)for(const item of before[key].filter(value=>localItems.has(value.id))){
  const after=next[key].find(value=>value.id===item.id);if(!after&&removedItems.has(item.id))continue;if(!after||changedKeys(item,after).some(field=>field!=='visible'&&!(key==='curves'&&field==='handles')))throw new DrawingSnapshotEditCapabilityError();
  const layerId=view.canonicalId(before.layers.find(layer=>layer.items.includes(item.id))!.id);
  if(item.visible!==after.visible)localVisibility(layerId,view.canonicalId(item.id),after.visible);
  if(key==='curves'&&!same((item as Doc['curves'][number]).handles,(after as Doc['curves'][number]).handles))changedLocalLayers.add(layerId);
 }
 for(const id of localNodes){const node=before.nodes.find(value=>value.id===id)!,after=next.nodes.find(value=>value.id===id);if(!after&&before.curves.filter(curve=>curve.nodes.includes(id)).every(curve=>removedCurves.has(curve.id)))continue;if(!after||changedKeys(node,after).some(key=>key!=='position'))throw new DrawingSnapshotEditCapabilityError();if(!same(node.position,after.position))for(const layer of before.layers)if(before.curves.some(curve=>layer.items.includes(curve.id)&&curve.nodes.includes(id)))changedLocalLayers.add(view.canonicalId(layer.id));}

 // Rebuild only the adapter-owned subset. New geometry is permitted only in
 // original layers. Existing reference IDs may never become source originals.
 const sourceLayers=next.layers.filter(layer=>!localLayers.has(layer.id)),sourceItems=new Set(sourceLayers.flatMap(layer=>layer.items));
 if([...sourceItems].some(id=>localItems.has(id)))throw new DrawingSnapshotEditCapabilityError();
 const sourceCurves=next.curves.filter(curve=>sourceItems.has(curve.id)),sourceNodes=new Set(sourceCurves.flatMap(curve=>curve.nodes));
 if([...sourceNodes].some(id=>localNodes.has(id)))throw new DrawingSnapshotEditCapabilityError();
 for(const curve of sourceCurves){const oldOwner=before.layers.find(layer=>layer.items.includes(curve.id)),newOwner=sourceLayers.find(layer=>layer.items.includes(curve.id));if(!oldOwner||!newOwner||oldOwner.id===newOwner.id)continue;
  const ids=[oldOwner.id,newOwner.id].map(view.canonicalId);if(ids.some(id=>evaluation.state.bindings.some(binding=>binding.layerId===id)||!same(evaluation.placements[id]??identityScenePlacement(),identityScenePlacement())))throw new DrawingSnapshotEditCapabilityError('Move this original between layers in its unplaced source view. The destination uses a different local transform.');
 }
 let original:Doc={...source};
 const lists={layers:sourceLayers,curves:sourceCurves,nodes:next.nodes.filter(node=>sourceNodes.has(node.id)),fills:next.fills.filter(fill=>sourceItems.has(fill.id)),offsets:next.offsets.filter(offset=>sourceItems.has(offset.id))};
 for(const key of ['layers','curves','nodes','fills','offsets'] as const){
  (original as any)[key]=[...lists[key].map((after:any)=>{const raw=(source[key] as {id:string}[]).find(value=>value.id===after.id),prior=(before[key] as {id:string}[]).find(value=>value.id===after.id);return raw?mergeChanged(raw,prior,after):after;}),...source[key].filter(value=>!before[key].some(prior=>prior.id===value.id)&&!lists[key].some(after=>after.id===value.id))];
  if(key!=='layers')(original as any)[key]=preserveSourceOrder(source[key] as {id:string}[],original[key]);
 }
 for(const key of ['joins','endpointLinks','groups','displayIntervals'] as const){
  const sourceIds=new Set((source[key]??[]).map(value=>value.id));
  const local=(value:any)=>relationCurves(value,key).some(id=>localCurves.has(id))||!sourceIds.has(value.id)&&(before[key]??[]).some(prior=>prior.id===value.id);
  const priorLocal=(before[key]??[]).filter(local),nextLocal=(next[key]??[]).filter(local);
  const survivingLocal=priorLocal.flatMap((value:any)=>key==='groups'?(()=>{const curveIds=value.curveIds.filter((id:string)=>!removedCurves.has(id));return curveIds.length?[{...value,curveIds}]:[];})():relationCurves(value,key).some(id=>removedCurves.has(id))?[]:[value]);
  if(!same(survivingLocal,nextLocal)){
   // The common geometry finalizer transports material fractions. Evaluation
   // performs that transport on the local shape itself; don't store it twice.
   const withoutFractions=(values:typeof priorLocal)=>values.map((value:any)=>key==='displayIntervals'?{...value,ranges:value.ranges.map(({start,end,...range}:any)=>range)}:value);
   if(key!=='displayIntervals'||!geometryChanged||!same(withoutFractions(survivingLocal),withoutFractions(nextLocal)))throw new DrawingSnapshotEditCapabilityError();
  }
  const values=(next[key]??[]).filter(value=>!local(value));
  if(values.some(value=>relationCurves(value,key).some(id=>!sourceCurves.some(curve=>curve.id===id))))throw new DrawingSnapshotEditCapabilityError();
  if(source[key]!==undefined||values.length)(original as any)[key]=[...values.map((after:any)=>{const raw=(source[key]??[]).find(value=>value.id===after.id),prior=(before[key]??[]).find(value=>value.id===after.id);return raw?mergeChanged(raw,prior,after):after;}),...(source[key]??[]).filter(value=>!(before[key]??[]).some(prior=>prior.id===value.id)&&!values.some(after=>after.id===value.id))];
  if(original[key])(original as any)[key]=preserveSourceOrder((source[key]??[]) as {id:string}[],original[key]!);
 }
 for(const key of ['reference','mirrorAxisX','mirrorEditing'] as const)if(!same(before[key],next[key])){if(next[key]===undefined)delete original[key];else Object.assign(original,{[key]:next[key]});}
 // A locally disabled relation is absent from the presentation, but still
 // belongs to the source. Preserve it until one of its actual members is
 // deleted, then apply the same dependency cleanup as native source deletion.
 const survivingCurves=new Set(original.curves.map(curve=>curve.id));
 original.joins=original.joins.filter(join=>survivingCurves.has(join.a.curveId)&&survivingCurves.has(join.b.curveId));
 if(original.endpointLinks)original.endpointLinks=original.endpointLinks.filter(link=>survivingCurves.has(link.a.curveId)&&survivingCurves.has(link.b.curveId));
 if(original.groups)original.groups=original.groups.map(group=>({...group,curveIds:group.curveIds.filter(id=>survivingCurves.has(id))})).filter(group=>group.curveIds.length);
 if(original.displayIntervals)original.displayIntervals=original.displayIntervals.filter(track=>survivingCurves.has(track.anchor.id));
 // Original coordinates can be edited through placement and shape residuals.
 // A nonlinear source Warp has no general inverse; never guess or bake it.
 const sourcePoint=(curveRawId:string,position:Point2,priorPosition:Point2,originalPosition:Point2):Point2=>{
  if(close(position,priorPosition))return originalPosition;const curveId=view.canonicalId(curveRawId),layerId=view.canonicalId(before.layers.find(layer=>layer.items.includes(curveRawId))!.id);
  if(evaluation.state.bindings.some(binding=>binding.layerId===layerId))throw new DrawingSnapshotEditCapabilityError('This original layer has a local Warp. Edit its unwarped original source before changing source controls.');
  return add(originalPosition,sub(inverse(layerId,curveId,position),inverse(layerId,curveId,priorPosition)));
 };
 const newPoint=(curveId:string,point:Point2)=>{const owner=sourceLayers.find(layer=>layer.items.includes(curveId));if(!owner)return point;const layerId=view.canonicalId(owner.id);if(evaluation.state.bindings.some(binding=>binding.layerId===layerId))throw new DrawingSnapshotEditCapabilityError('This original layer has a local Warp. Add geometry to its unwarped original source.');return inverse(layerId,view.canonicalId(curveId),point);};
 original={...original,nodes:original.nodes.map(node=>{const prior=before.nodes.find(value=>value.id===node.id),raw=source.nodes.find(value=>value.id===node.id),curve=before.curves.find(curve=>curve.nodes.includes(node.id)),wanted=next.nodes.find(value=>value.id===node.id)!;return prior&&raw&&curve?{...node,position:sourcePoint(curve.id,wanted.position,prior.position,raw.position)}:!raw?{...node,position:newPoint(sourceCurves.find(curve=>curve.nodes.includes(node.id))!.id,node.position)}:node;}),curves:original.curves.map(curve=>{const prior=before.curves.find(value=>value.id===curve.id),raw=source.curves.find(value=>value.id===curve.id),wanted=next.curves.find(value=>value.id===curve.id)!;if(prior&&raw)return {...curve,handles:wanted.handles.map((point,end)=>sourcePoint(curve.id,point,prior.handles[end],raw.handles[end])) as [Point2,Point2]};if(raw)return curve;return {...curve,handles:curve.handles.map((point,end)=>{const node=source.nodes.find(node=>node.id===curve.nodes[end]),displayed=before.nodes.find(node=>node.id===curve.nodes[end]);return sub(newPoint(curve.id,point),node&&displayed?sub(newPoint(curve.id,displayed.position),node.position):[0,0]);}) as [Point2,Point2]};})};
 const sourceChanged=!same(original,source);if(sourceChanged)parseDrawing(original);
 const sourcePlan=sourceChanged?prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:original}):{before:project,project,changed:false};
 let result=sourcePlan.project,localWorkspace:LandmarkProject['recordingSnapshots'];
 const layerOrderChanged=!same(before.layers.map(layer=>layer.id),next.layers.map(layer=>layer.id));
 if(changedLocalLayers.size||renames.size||removedLayers.size||exclusions.size||layerOrderChanged){
  const updated=result.recordingSnapshots!,snapshot=drawingSnapshotForArtwork(updated,artworkId)!,deformation={...snapshot.deformation,layers:{...snapshot.deformation.layers},relationPositions:{...snapshot.deformation.relationPositions}};
  const relationNodes=new Set<string>();
  for(const node of canonicalNext.nodes){
   const was=evaluation.drawing.nodes.find(value=>value.id===node.id);if(!was||close(node.position,was.position))continue;
   const component=linkedNodeIds(evaluation.drawing,node.id),links=(evaluation.drawing.endpointLinks??[]).filter(link=>component.has(nodeAt(evaluation.drawing,link.a).id)&&component.has(nodeAt(evaluation.drawing,link.b).id));
   const targets=Object.entries(evaluation.state.relationPositions).filter(([,value])=>value.sourceLinkIds.some(id=>links.some(link=>link.id===id)));if(!targets.length)continue;
   const curve=evaluation.drawing.curves.find(curve=>curve.nodes.includes(node.id))!,layerId=evaluation.drawing.layers.find(layer=>layer.items.includes(curve.id))!.id,basis=evaluation.preShapeDrawing.nodes.find(value=>value.id===node.id)!;
   const offset=sub(inverse(layerId,curve.id,node.position),basis.position);
   for(const id of component){const target=canonicalNext.nodes.find(value=>value.id===id),base=evaluation.preShapeDrawing.nodes.find(value=>value.id===id),owner=evaluation.drawing.curves.find(curve=>curve.nodes.includes(id)),layer=owner&&evaluation.drawing.layers.find(layer=>layer.items.includes(owner.id));if(target&&base&&owner&&layer&&!close(sub(inverse(layer.id,owner.id,target.position),base.position),offset))throw new DrawingSnapshotEditCapabilityError('Linked layers need compatible placements before editing their shared position.');relationNodes.add(id);}
   for(const [id,value] of targets)deformation.relationPositions[id]={...value,sourceLinkIds:[...value.sourceLinkIds],offset};
  }
  for(const layerId of changedLocalLayers){
   const layer=evaluation.drawing.layers.find(layer=>layer.id===layerId)!;
   if(!layer||view.layerOwners.get(view.presentationId(layerId))?.kind!=='snapshot-local')throw new DrawingSnapshotEditCapabilityError('The edit couples original and referenced layer controls. Edit each source independently.');
   const shape=structuredClone(evaluation.state.layers[layerId]?.shape??identitySceneShape());
   for(const curve of evaluation.preElementPlacementDrawing.curves.filter(curve=>layer.items.includes(curve.id)&&!removedCurves.has(view.presentationId(curve.id)))){
    const world=evaluation.drawing.curves.find(value=>value.id===curve.id)!,wanted=canonicalNext.curves.find(value=>value.id===curve.id)!,base=evaluation.preShapeDrawing.curves.find(value=>value.id===curve.id)!;
    if(same(world.handles,wanted.handles)&&curve.nodes.every(id=>same(canonicalNext.nodes.find(node=>node.id===id)?.position,evaluation.drawing.nodes.find(node=>node.id===id)?.position)))continue;
    for(const end of [0,1] as const){
     const node=nodeAt(canonicalNext,{curveId:curve.id,end}),was=nodeAt(evaluation.drawing,{curveId:curve.id,end}),basis=nodeAt(evaluation.preShapeDrawing,{curveId:curve.id,end}),position=inverse(layerId,curve.id,node.position);
     if(!relationNodes.has(node.id)&&!close(node.position,was.position))shape.nodes[node.id]=sub(position,basis.position);
     const vector=sub(inverse(layerId,curve.id,wanted.handles[end]),position),oldVector=sub(inverse(layerId,curve.id,world.handles[end]),inverse(layerId,curve.id,was.position));
     if(!close(vector,oldVector)){const offsets=shape.handles[curve.id]??[[0,0],[0,0]];offsets[end]=sub(vector,sub(base.handles[end],basis.position));shape.handles[curve.id]=offsets;}
    }
   }
   const own=deformation.layers[layerId];deformation.layers[layerId]={...own,shape,...(visibility.has(layerId)?{visibility:{...own?.visibility,...visibility.get(layerId)}}:{})};
  }
  const refreshed=drawingSnapshotPresentation(updated,artworkId)!,order=next.layers.map(layer=>refreshed.canonicalId(layer.id)),edited={...snapshot,deformation,layers:snapshot.layers.filter(layer=>!removedLayers.has(layer.id)).map(layer=>({...layer,...(renames.has(layer.id)?{name:renames.get(layer.id)!}:{})})).sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id))};
  localWorkspace={...updated,snapshots:updated.snapshots.map(value=>value===snapshot?edited:value)};
  for(const [layerId,elementIds] of exclusions)applySnapshotMembershipEdit(localWorkspace,snapshot.id,{op:'excludeElements',layerId,elementIds},()=>{throw Error('Removing a reference must never allocate IDs.');});
  result=prepareSnapshotEdit(snapshotEditContext(result,true),{kind:'snapshot-state',workspace:localWorkspace}).project;localWorkspace=result.recordingSnapshots;
  const replay=drawingSnapshotPresentation(localWorkspace!,artworkId)!;assertLocalGeometry(view,canonicalNext,replay,localCurves,localNodes);
  for(const [layerId,values] of visibility)for(const [id,wanted] of Object.entries(values)){const item=id===layerId?replay.evaluation.drawing.layers.find(layer=>layer.id===id):[...replay.evaluation.drawing.curves,...replay.evaluation.drawing.fills,...replay.evaluation.drawing.offsets].find(item=>item.id===id);if(item&&item.visible!==wanted)throw new DrawingSnapshotEditCapabilityError('This visibility is controlled by a recording channel. Edit its owning snapshot before changing it here.');}
 }
 return {before:project,project:result,changed:result!==project,...(sourceChanged?{sourceDrawing:original}:{}),...(localWorkspace?{localWorkspace}:{})};
}

/** Store actions already share prepareSnapshotEdit. Preflight both writes, then
 * apply them inside the same native Drawing Undo transaction. */
type DrawingSnapshotEditor={project:LandmarkProject;beginEdit:()=>void;endEdit:()=>void;setDrawing:(drawing:Doc,intent?:LayerEditIntent)=>void;setRecordingSnapshots:(workspace:NonNullable<LandmarkProject['recordingSnapshots']>)=>void;commitPreparedSnapshotEdit?:(plan:SnapshotEditPlan)=>void};
export function commitDrawingSnapshotEdit(editor:DrawingSnapshotEditor,next:Doc,intent?:LayerDomainIntent):DrawingSnapshotEditPlan {
 const plan=intent?prepareSnapshotEdit(snapshotEditContext(editor.project,true),{kind:'layer-domain',intent}) as DrawingSnapshotEditPlan&{drawing:Doc}:prepareDrawingSnapshotEdit(editor.project,next);
 if(intent&&!same(next,(plan as DrawingSnapshotEditPlan&{drawing:Doc}).drawing))throw new DrawingSnapshotEditCapabilityError('The layer domain intent and its preview no longer agree.');
 if(!plan.changed)return plan;
 if(editor.commitPreparedSnapshotEdit){editor.commitPreparedSnapshotEdit(plan);return plan;}
 editor.beginEdit();try{if(plan.sourceDrawing)editor.setDrawing(plan.sourceDrawing);if(plan.localWorkspace)editor.setRecordingSnapshots(plan.localWorkspace);}finally{editor.endEdit();}return plan;
}

/** The split identity plan travels through the same Snapshot transaction as the
 * document. Never infer lineage from a delete/add diff or mint IDs per child. */
export function prepareDrawingCurveSplit(project:LandmarkProject,curveId:string,t:number):DrawingSnapshotEditPlan&{intent:LayerEditIntent;ids:string[]} {
 const workspace=project.recordingSnapshots,artworkId=project.drawingSnapshots?.activeId??'$working',view=workspace&&drawingSnapshotPresentation(workspace,artworkId),source=workspace&&drawingSnapshotForArtwork(workspace,artworkId);
 if(view&&source){
  const curve=view.drawing.curves.find(value=>value.id===curveId),layer=curve&&view.drawing.layers.find(value=>value.items.includes(curve.id));
  if(!curve||!layer)throw Error('The selected curve no longer exists.');
  const owner=view.layerOwners.get(layer.id)!;
  if(owner.kind==='snapshot-local'){
   const intent=createCurveSplitIntent(view.evaluation.drawing,view.canonicalId(curveId),t),plan=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'local-curve-split',snapshotId:view.snapshotId,intent});
   return {...plan,intent,ids:[...intent.childCurveIds],localWorkspace:plan.project.recordingSnapshots};
  }
 }
 if(!project.drawing)throw Error('The original Drawing document is unavailable.');
 const pair=project.drawing.mirrorEditing?.enabled?project.drawing.mirrorEditing.curvePairs.find(value=>value.a===curveId||value.b===curveId):undefined;
 const relatedCurveIds=new Set([curveId,...(pair?[pair.a,pair.b]:[])].map(id=>view?.canonicalId(id)??id));
 const relatedDrawings=workspace&&source?workspace.snapshots.flatMap(snapshot=>[false,...(snapshot.draft?[true]:[])].flatMap(useDraft=>{
  const evaluated=resolveSnapshot(workspace,snapshot.id,{useDraft,...(useDraft?{angle:snapshot.draft!.angle}:{}),diagnostics:'preview'}).drawing;
  return evaluated.curves.some(value=>relatedCurveIds.has(value.id))?[remapDrawingIdentities(evaluated,id=>source.source!.originIds[id]??id)]:[];
 })):[];
 const intent=createLayerCurveSplitIntent(project.drawing,curveId,t,{relatedDrawings}),applied=applyLayerEditIntent(project.drawing,intent),drawing=applied.document;
 const plan=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing,intent});
 return {...plan,intent,ids:applied.ids,sourceDrawing:drawing};
}
export function commitDrawingCurveSplit(editor:DrawingSnapshotEditor,curveId:string,t:number){
 const plan=prepareDrawingCurveSplit(editor.project,curveId,t);if(!plan.changed)return plan;
 if(editor.commitPreparedSnapshotEdit){editor.commitPreparedSnapshotEdit(plan);return plan;}
 editor.beginEdit();try{if(plan.sourceDrawing)editor.setDrawing(plan.sourceDrawing,plan.intent);else if(plan.localWorkspace)editor.setRecordingSnapshots(plan.localWorkspace);}finally{editor.endEdit();}return plan;
}

function assertLocalGeometry(before:DrawingSnapshotPresentation,wanted:Doc,after:DrawingSnapshotPresentation,curves:Set<string>,nodes:Set<string>){
 const actual=after.evaluation.drawing;
 for(const rawId of nodes){const id=before.canonicalId(rawId),target=wanted.nodes.find(node=>node.id===id),result=actual.nodes.find(node=>node.id===id);if(target&&(!result||!close(target.position,result.position)))throw new DrawingSnapshotEditCapabilityError('This referenced control is constrained by local recording state. Edit its owning snapshot before changing it here.');}
 for(const rawId of curves){const id=before.canonicalId(rawId),target=wanted.curves.find(curve=>curve.id===id),result=actual.curves.find(curve=>curve.id===id);if(target&&(!result||target.handles.some((point,end)=>!close(point,result.handles[end]))))throw new DrawingSnapshotEditCapabilityError('This referenced handle is constrained by local recording state. Edit its owning snapshot before changing it here.');}
}
