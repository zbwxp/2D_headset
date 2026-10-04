import {splitSnapshotMirrorMetadata} from './mirrorMetadata';
import {resolveSnapshotFitParameter} from './splitParameterField';
import {recordingForSnapshot} from './tracks';
import {splitSnapshotObjectLocks} from './objectLocks';
import {splitCageLineages,splitCageShapeLineages} from './cageSplitLineage';
import {evaluatedControlParameter,evaluatedMaterialSource,hasEvaluatedDeformationFor} from '../drawing/evaluatedDeformation';
import {markSnapshotRouteMaterialInput,snapshotRouteMaterialSource} from './routeMaterialSource';
import {remapSnapshotMaterialPathLineages} from './materialPathLineages';
import {remapSnapshotMaterialPartitions} from './materialSplit';
import {applyCurveSplitIntent,mapLayerEditIntent,type LayerEditIntent,type CurveSplitIntent} from '../drawing/layerEditIntent';
import {shapeOf,sub,layerFor,type DrawingDocument,type Point2,type Endpoint,type StrokeDisplayIntervals} from '../drawing/model';
import {resolveSnapshot,type SnapshotEvaluation} from './evaluation';
import {displayPath} from '../drawing/displayIntervals';
import {splitSnapshotCurveAppearance} from './curveAppearance';
import {splitSnapshotNodeForks} from './nodeForks';
import type {MirrorCurvePair} from '../drawing/mirrorEditing';
import {canonicalElementId,drawingSourceOwns,drawingIdentityIds} from './sources';
import {emptySnapshotDeformationState,type RecordingSnapshotWorkspace,type RecordingSnapshot,type SnapshotDeformationState,type SnapshotRelationOverrides,type SceneIntervalValue} from './model';

export interface SnapshotTopologyDiagnostic {code:'LOCAL_SPLIT_CORRESPONDENCE';snapshotId:string;curveId:string;message:string}
interface FrozenPose {evaluation:SnapshotEvaluation;split:DrawingDocument;finalSplit:DrawingDocument;material:DrawingDocument}
interface FrozenSnapshot {snapshotId:string;saved:FrozenPose;draft?:FrozenPose;inherited?:FrozenPose}
/** Ephemeral preflight evidence. Geometry is used only to derive local residuals;
 * no frozen drawing is stored in a project or response expression. */
export interface SnapshotCurveSplitPlan {
 readonly before:RecordingSnapshotWorkspace;
 readonly sourceSnapshotId:string;
 readonly intent:CurveSplitIntent;
 readonly frozen:readonly FrozenSnapshot[];
}
const clone=<T,>(value:T):T=>structuredClone(value);
// Source intent is checked against the canonical library at transaction entry.
// Referenced frames may expose a local shared-node authority for an outer end;
// split that exact current topology with the same curve/seam/material IDs.
const splitParameter=(drawing:DrawingDocument,intent:CurveSplitIntent)=>resolveSnapshotFitParameter(drawing,[{curveId:intent.curveId,parameterRange:[0,1]}],intent.t)??evaluatedControlParameter(drawing,intent.curveId,intent.t);
const split=(drawing:DrawingDocument,intent:CurveSplitIntent)=>{
 const current={...intent,sourceNodeIds:drawing.curves.find(curve=>curve.id===intent.curveId)?.nodes??intent.sourceNodeIds},q=splitParameter(drawing,intent),materialSource=(drawing:DrawingDocument,track:StrokeDisplayIntervals)=>snapshotRouteMaterialSource(markSnapshotRouteMaterialInput(drawing),track);
 if(!hasEvaluatedDeformationFor(drawing,intent.curveId)&&q===intent.t)return applyCurveSplitIntent(drawing,current,{propagate:true,materialSource}).document;
 const controls=applyCurveSplitIntent({...drawing,displayIntervals:undefined},{...current,t:q},{propagate:true}).document,source=evaluatedMaterialSource(drawing),material=applyCurveSplitIntent(source,{...current,t:source===drawing?q:intent.t,sourceNodeIds:source.curves.find(curve=>curve.id===intent.curveId)?.nodes??current.sourceNodeIds},{propagate:true,materialSource}).document;
 return {...controls,displayIntervals:material.displayIntervals};
};
const replaceId=(ids:readonly string[],intent:CurveSplitIntent)=>[...new Set(ids.flatMap(id=>id===intent.curveId?[...intent.childCurveIds]:[id]))];
const endpoint=(value:Endpoint,intent:CurveSplitIntent):Endpoint=>value.curveId===intent.curveId?{...value,curveId:intent.childCurveIds[value.end]}:value;
const hasCurve=(drawing:DrawingDocument,id:string)=>drawing.curves.some(curve=>curve.id===id);
const fail=(snapshotId:string,target:string,reason:string):never=>{throw Error(`Cannot split ${target} in snapshot ${snapshotId}: ${reason}`);};

/** Matches the Drawing adapter's persisted namespace, including promoted working
 * sources. Only known old IDs and explicit newly allocated intent IDs are mapped. */
export function canonicalSnapshotLayerEditIntent(source:RecordingSnapshot,intent:LayerEditIntent,workspace?:RecordingSnapshotWorkspace):LayerEditIntent {
 if(!source.source)throw Error('A source split requires a Drawing source adapter.');
 const existing=new Map(Object.entries(source.source.originIds).map(([canonical,raw])=>[raw,canonical]));
 const known=new Set(workspace?workspace.snapshots.flatMap(snapshot=>{const evaluated=resolveSnapshot(workspace,snapshot.id,{useDraft:false,diagnostics:'preview'});return [...drawingIdentityIds(evaluated.source),...drawingIdentityIds(evaluated.drawing),...(snapshot.draft?drawingIdentityIds(resolveSnapshot(workspace,snapshot.id,{useDraft:true,angle:snapshot.draft.angle,diagnostics:'preview'}).drawing):[])];}):Object.keys(source.source.originIds));
 let scope=source.source.artworkId;
 if(source.id.startsWith('source:'))try{const parts=JSON.parse(source.id.slice(7));if(Array.isArray(parts)&&parts.length===1&&typeof parts[0]==='string')scope=parts[0];}catch{/* Explicit custom source keeps its artwork namespace. */}
 return mapLayerEditIntent(intent,id=>existing.get(id)??(known.has(id)?id:canonicalElementId(scope,id)));
}
export function canonicalSnapshotSplitIntent(source:RecordingSnapshot,intent:CurveSplitIntent):CurveSplitIntent{return canonicalSnapshotLayerEditIntent(source,intent) as CurveSplitIntent;}
function frozenPose(workspace:RecordingSnapshotWorkspace,snapshot:RecordingSnapshot,intent:CurveSplitIntent,mode:'saved'|'draft'|'inherited'):FrozenPose {
 const local=mode==='inherited'?{...snapshot,deformation:emptySnapshotDeformationState(),draft:undefined}:snapshot;
 const input=local===snapshot?workspace:{...workspace,snapshots:workspace.snapshots.map(value=>value.id===snapshot.id?local:value)};
 const evaluation=resolveSnapshot(input,snapshot.id,{useDraft:mode==='draft',angle:mode==='draft'?snapshot.draft!.angle:snapshot.angle,diagnostics:'preview'});
 return {evaluation,split:split(evaluation.preElementPlacementDrawing,intent),finalSplit:split(evaluation.drawing,intent),material:split(evaluation.source,intent)};
}
function preflightTracks(workspace:RecordingSnapshotWorkspace,frozen:readonly FrozenSnapshot[],intent:CurveSplitIntent,localOnly=false):void {
 for(const recording of workspace.recordings){
  const affected=frozen.filter(value=>recording.snapshotIds.includes(value.snapshotId));if(!affected.length)continue;
  const interpolates=recording.mode==='endpoint-pair'&&recording.snapshotIds.length>1;
  if(!localOnly&&interpolates){const vertexIds=new Set(recording.mode==='triangulated'?recording.angleGraph!.mesh.vertices.map(vertex=>vertex.snapshotId):recording.snapshotIds);for(const frame of affected)if(vertexIds.has(frame.snapshotId))for(const [kind,pose] of [['saved',frame.saved],['draft',frame.draft]] as const){if(!pose)continue;const q=evaluatedControlParameter(pose.evaluation.drawing,intent.curveId,intent.t);if(q!==intent.t)fail(frame.snapshotId,intent.curveId,`Recording ${recording.id} ${kind} basis uses fitted cut ${q} for native t ${intent.t}. Its intermediate scalar field needs a live fitted-parameter restriction before this source split can preserve it; no state was changed.`);}}
  if(recording.legacy)fail(affected[0].snapshotId,intent.curveId,`legacy scene Recording ${recording.id} requires an explicit topology migration (${recording.legacy.reason}).`);
  if(localOnly&&recording.mode==='endpoint-pair')fail(affected[0].snapshotId,intent.curveId,`endpoint-pair Recording ${recording.id} cannot evaluate mismatched local topology; create a triangulated copy before this local split.`);
  if(recording.mode==='endpoint-pair')for(const responses of [recording.endpointPair?.responses,recording.endpointPair?.draft?.responses])if(responses){
   const target=[...Object.keys(responses.nodes),...Object.keys(responses.handles)].find(id=>id===intent.curveId||intent.sourceNodeIds.includes(id));
   if(target)fail(affected[0].snapshotId,intent.curveId,`endpoint-pair Recording ${recording.id}, response target ${target} requires exact response-expression conversion before source splitting.`);
  }
  if(recording.mode==='triangulated'){
   if(localOnly)continue;
   // An explicitly edited inserted interval still uses the authored inversion
   // path. Until that path can retain a changing fitted parameter exactly, fail
   // before replacing source IDs instead of committing material endpoint drift.
   for(const frame of affected){
    if(!recording.angleGraph?.materialBasisRecipes?.[frame.snapshotId])continue;
    const snapshot=workspace.snapshots.find(value=>value.id===frame.snapshotId)!;
    for(const mode of ['inherited','saved','draft'] as const){
     const pose=frame[mode],state=mode==='inherited'?snapshot.inheritedState:mode==='draft'?snapshot.draft?.deformation:snapshot.deformation;
     if(!pose||!state||Math.abs(splitParameter(pose.evaluation.drawing,intent)-intent.t)<=1e-10)continue;
     for(const layer of Object.values(state.layers))for(const [id,value] of Object.entries(layer.intervals??{})){
      const track=value.appearance&&pose.evaluation.drawing.displayIntervals?.find(track=>track.id===id);if(!track)continue;
      const affected=track.scope==='CURVE'?track.anchor.id===intent.curveId:displayPath(pose.evaluation.drawing,track.anchor.id).segments.some(use=>use.id===intent.curveId);
      if(affected)fail(frame.snapshotId,intent.curveId,`authored interval ${id} on an inherited fitted material field needs exact authored-parameter rebasing before source splitting; no state was changed.`);
     }
    }
   }
   remapSnapshotMaterialPartitions(recording.angleGraph?.materialPartitions,intent,affected.flatMap(value=>value.saved.evaluation.source.displayIntervals??[]));
   remapSnapshotMaterialPathLineages(recording.angleGraph?.materialPathLineages,intent,affected.map(value=>value.saved.evaluation.source));
   continue; // Old tracks in graph copies are recovery evidence only.
  }
  const layers=new Set(affected.flatMap(value=>[value.saved.evaluation,...(value.draft?[value.draft.evaluation]:[])].map(value=>layerFor(value.drawing,intent.curveId)?.id).filter((id):id is string=>!!id)));
  const warps=new Set(affected.flatMap(value=>value.saved.evaluation.state.bindings.filter(binding=>layers.has(binding.layerId)).map(binding=>binding.warpId)));
  for(const track of recording.tracks){
   if(!track.keys.length&&!track.draft)continue;
   const depends=track.channel==='warp'?warps.has(track.targetId):layers.has(track.targetId)&&(track.channel==='shape'||track.channel==='interval'||track.elementId===intent.curveId);
   if(depends)fail(affected[0].snapshotId,intent.curveId,`${recording.mode??'tracks'} Recording ${recording.id}, ${track.channel} track ${track.id}, target ${track.targetId}${track.elementId?`/${track.elementId}`:''} has a live trajectory that cannot yet be transferred exactly; its keys and archive were not changed.`);
  }
 }
}
/** Freeze every real source/reference pose before changing canonical topology.
 * Excluded members are not frozen, but their tombstones are remapped on commit. */
export function prepareSnapshotCurveSplit(workspace:RecordingSnapshotWorkspace,sourceSnapshotId:string,intent:CurveSplitIntent,mirrorPairs:readonly SnapshotSplitMirrorReplacement[]=[]):SnapshotCurveSplitPlan {
 const owner=workspace.snapshots.find(snapshot=>snapshot.id===sourceSnapshotId);
 if(!owner||!drawingSourceOwns(owner,intent.curveId))throw Error('The split source does not own this canonical curve.');
 const original=workspace.library.curves[intent.curveId];if(!original||original.nodes.some((id,end)=>id!==intent.sourceNodeIds[end]))throw Error('The split intent no longer matches the canonical source curve topology.');
 const fresh=[...intent.childCurveIds,intent.seamNodeId,intent.seamJoinId,...intent.intervals.flatMap(track=>[track.rightTrackId,...track.ranges.map(range=>range.rightRangeId)])];
 const occupied=new Set([...Object.values(workspace.library).flatMap(map=>Object.keys(map)),...workspace.snapshots.flatMap(snapshot=>[...snapshot.layers.map(layer=>layer.id),...Object.values(snapshot.relations).flatMap(patch=>[...(patch.add??[]).map((value:{id:string})=>value.id),...(patch.update??[]).map((value:{id:string})=>value.id)])])]);
 if(fresh.some(id=>occupied.has(id)))throw Error('A split identity already exists in the Snapshot workspace.');
 const frozen:FrozenSnapshot[]=[];
 for(const snapshot of workspace.snapshots){
  const evaluated=resolveSnapshot(workspace,snapshot.id,{useDraft:false,diagnostics:'preview'});if(!hasCurve(evaluated.drawing,intent.curveId))continue;
  const mirrorPair=snapshot.inputMirror?.curvePairs.find(pair=>pair.a===intent.curveId||pair.b===intent.curveId);
  if(mirrorPair&&!mirrorPairs.some(value=>value.oldPairId===mirrorPair.id)&&owner.source?.mirrorEditing?.enabled!==false&&!(mirrorPair.a===mirrorPair.b&&mirrorPair.reverse&&intent.correspondenceNotice))fail(snapshot.id,intent.curveId,`mirror pair ${mirrorPair.id} requires a paired split identity plan${mirrorPair.reverse?' with complementary 1-t direction':''}.`);
  const saved=frozenPose(workspace,snapshot,intent,'saved');
  frozen.push({snapshotId:snapshot.id,saved,...(snapshot.draft?{draft:frozenPose(workspace,snapshot,intent,'draft')}:{}),...(snapshot.inheritedState?{inherited:frozenPose(workspace,snapshot,intent,'inherited')}:{})});
 }
 preflightTracks(workspace,frozen,intent);
 return {before:workspace,sourceSnapshotId,intent:clone(intent),frozen};
}
function remapIntervals(values:Record<string,SceneIntervalValue>|undefined,basis:DrawingDocument,intent:CurveSplitIntent):Record<string,SceneIntervalValue>|undefined {
 if(!values)return values;const result:Record<string,SceneIntervalValue>={};
 for(const [id,value] of Object.entries(values)){
  const plan=intent.intervals.find(track=>track.trackId===id);
  if(!value.appearance&&!plan){result[id]=clone(value);continue;}
  const appearance=value.appearance??basis.displayIntervals?.find(track=>track.id===id);
  if(!appearance){result[id]=clone(value);continue;}
  const mapped=split({...basis,displayIntervals:[appearance]},intent).displayIntervals??[];
  for(const track of mapped){const right=track.id===plan?.rightTrackId,enabled=Object.fromEntries(Object.entries(value.enabled).map(([rangeId,on])=>[right?plan?.ranges.find(range=>range.rangeId===rangeId)?.rightRangeId??rangeId:rangeId,on]));result[track.id]={...clone(value),appearance:value.appearance?track:null,enabled};}
 }
 return result;
}
function remapState(state:SnapshotDeformationState,basis:DrawingDocument,intent:CurveSplitIntent):SnapshotDeformationState {
 const result=clone(state);
 for(const domain of result.layerDomains??[])if(domain.layerIds.includes(layerFor(basis,intent.curveId)?.id??'')){if(domain.kind==='h-coons')domain.fitLineages=splitCageLineages(domain.fitLineages,intent);const shaped=splitCageShapeLineages(domain.shapeLineages,domain.postShape,{...intent,sourceNodeIds:basis.curves.find(curve=>curve.id===intent.curveId)?.nodes??intent.sourceNodeIds});if(shaped.lineages.length)domain.shapeLineages=shaped.lineages;if(shaped.value)domain.postShape=shaped.value;}
 for(const value of Object.values(result.layers)){
  for(const category of ['elementPlacements','visibility'] as const){const map=value[category];if(map&&Object.hasOwn(map,intent.curveId)){const prior=map[intent.curveId];delete map[intent.curveId];for(const id of intent.childCurveIds)Object.defineProperty(map,id,{value:clone(prior),enumerable:true,writable:true,configurable:true});}}
  if(value.curveAppearance)value.curveAppearance=splitSnapshotCurveAppearance(value.curveAppearance,intent);
  if(value.shape)delete value.shape.handles[intent.curveId];
  if(value.intervals)value.intervals=remapIntervals(value.intervals,basis,intent);
 }
 return result;
}
function remapRelations(relations:SnapshotRelationOverrides,basis:DrawingDocument,intent:CurveSplitIntent,source?:RecordingSnapshot):SnapshotRelationOverrides {
 const result=clone(relations);
 if(result.mirrorEditing)result.mirrorEditing=splitSnapshotMirrorMetadata(result.mirrorEditing,intent);
 for(const category of ['joins','endpointLinks'] as const){const patch=result[category];for(const values of [patch?.add,patch?.update])for(const value of values??[]){value.a=endpoint(value.a,intent);value.b=endpoint(value.b,intent);}}
 for(const values of [result.groups?.add,result.groups?.update])for(const value of values??[])value.curveIds=replaceId(value.curveIds,intent);
 const patch=result.displayIntervals;
 if(patch)for(const op of ['add','update'] as const)if(patch[op])patch[op]=patch[op]!.flatMap(value=>{
  if(source&&op==='add'&&drawingSourceOwns(source,value.id))return [value];
  return split({...basis,displayIntervals:[value]},intent).displayIntervals??[];
 });
 return result;
}
/** Fit only residual shape channels against the new post-Warp baseline. Layer
 * placement, element placement, Warp hierarchy and source addresses stay live. */
function rebasePose(workspace:RecordingSnapshotWorkspace,snapshot:RecordingSnapshot,frozen:FrozenPose,intent:CurveSplitIntent,mode:'saved'|'draft'|'inherited',extraCurveIds:readonly string[]=[]):RecordingSnapshot {
 const local=mode==='inherited'?{...snapshot,deformation:emptySnapshotDeformationState(),draft:undefined}:snapshot;
 const current=resolveSnapshot({...workspace,snapshots:workspace.snapshots.map(value=>value.id===snapshot.id?local:value)},snapshot.id,{useDraft:mode==='draft',angle:mode==='draft'?snapshot.draft!.angle:snapshot.angle,diagnostics:'preview'});
 const target=frozen.split,layerId=layerFor(current.preShapeDrawing,intent.childCurveIds[0])?.id;
 if(!layerId)return fail(snapshot.id,intent.curveId,'the split children lost their layer membership.');
 const state=clone(mode==='inherited'?snapshot.inheritedState!:mode==='draft'?snapshot.draft!.deformation:snapshot.deformation),value=state.layers[layerId]??(state.layers[layerId]={});
 const shape=clone(current.state.layers[layerId]?.shape??{nodes:{},handles:{}});delete shape.handles[intent.curveId];
 const affectedNodes=new Set(intent.childCurveIds.flatMap(id=>current.preShapeDrawing.curves.find(curve=>curve.id===id)!.nodes));
 for(const id of affectedNodes){const wanted=target.nodes.find(node=>node.id===id),base=current.preShapeDrawing.nodes.find(node=>node.id===id);if(!wanted||!base)return fail(snapshot.id,id,'a split control is missing.');shape.nodes[id]=sub(wanted.position,base.position);}
 for(const id of intent.childCurveIds){const wanted=shapeOf(target,id),base=shapeOf(current.preShapeDrawing,id);shape.handles[id]=[sub(sub(wanted[1],wanted[0]),sub(base[1],base[0])),sub(sub(wanted[2],wanted[3]),sub(base[2],base[3]))];}
 value.shape=shape;
 for(const id of extraCurveIds){
  if(!hasCurve(target,id)||!hasCurve(current.preShapeDrawing,id))continue;
  const owner=layerFor(current.preShapeDrawing,id)!.id,other=state.layers[owner]??(state.layers[owner]={}),otherShape=clone(other.shape??current.state.layers[owner]?.shape??{nodes:{},handles:{}}),curve=current.preShapeDrawing.curves.find(curve=>curve.id===id)!;
  for(const nodeId of curve.nodes){const wanted=target.nodes.find(node=>node.id===nodeId)!,base=current.preShapeDrawing.nodes.find(node=>node.id===nodeId)!;otherShape.nodes[nodeId]=sub(wanted.position,base.position);}
  const wanted=shapeOf(target,id),base=shapeOf(current.preShapeDrawing,id);otherShape.handles[id]=[sub(sub(wanted[1],wanted[0]),sub(base[1],base[0])),sub(sub(wanted[2],wanted[3]),sub(base[2],base[3]))];other.shape=otherShape;
 }
 const rebuilt=()=>mode==='inherited'?{...snapshot,inheritedState:state}:mode==='draft'?{...snapshot,draft:{...snapshot.draft!,deformation:state}}:{...snapshot,deformation:state};
 const evaluate=()=>{const rebuiltSnapshot=rebuilt(),view=mode==='inherited'?{...rebuiltSnapshot,deformation:emptySnapshotDeformationState(),draft:undefined}:rebuiltSnapshot;return resolveSnapshot({...workspace,snapshots:workspace.snapshots.map(item=>item.id===snapshot.id?view:item)},snapshot.id,{useDraft:mode==='draft',angle:mode==='draft'?snapshot.draft!.angle:snapshot.angle,diagnostics:'preview'});};
 // Material is authored in the input domain. Invert the existing evaluated
 // material pipeline, including Warp correspondence and nonuniform placement,
 // instead of copying final-space arc fractions into that input domain.
 const inheritedMaterial=recordingForSnapshot(workspace,snapshot.id)?.angleGraph?.materialBasisRecipes?.[snapshot.id];
 let evaluated=evaluate();
 for(const wanted of frozen.finalSplit.displayIntervals??[]){
  if(!displayPath(frozen.finalSplit,wanted.anchor.id).segments.some(use=>intent.childCurveIds.includes(use.id)||extraCurveIds.includes(use.id)))continue;
  const materialLayer=layerFor(evaluated.source,wanted.anchor.id)?.id??layerId;
  // A retained recipe is restored after the temporary topology rebase. Do not
  // turn its interim value into an authored override that suppresses the live
  // recipe; only appearances already owned by this raw state may be inverted.
  if(inheritedMaterial&&!state.layers[materialLayer]?.intervals?.[wanted.id]?.appearance)continue;
  const actual=evaluated.drawing.displayIntervals?.find(track=>track.id===wanted.id),input=evaluated.source.displayIntervals?.find(track=>track.id===wanted.id);if(!actual||!input)fail(snapshot.id,wanted.id,'split material lost its source track.');
  for(const range of wanted.ranges)for(const side of ['start','end'] as const){
   const observed=evaluated.drawing.displayIntervals?.find(track=>track.id===wanted.id)?.ranges.find(value=>value.id===range.id)?.[side];if(observed!==undefined&&Math.abs(observed-range[side])<=1e-9)continue;
   const materialState=state.layers[materialLayer]??(state.layers[materialLayer]={}),intervals=materialState.intervals??(materialState.intervals={}),entry=intervals[wanted.id]??(intervals[wanted.id]={appearance:clone(input!),enabled:{}});if(!entry.appearance)entry.appearance=clone(input!);
   const authored=entry.appearance.ranges.find(value=>value.id===range.id);if(!authored)fail(snapshot.id,range.id,'split material range is missing.');
   let lo=0,hi=1;const collapsed=range.start===range.end;
   for(let iteration=0;iteration<42;iteration++){const mid=(lo+hi)/2;authored![side]=mid;if(collapsed)authored!.start=authored!.end=mid;evaluated=evaluate();const result=evaluated.drawing.displayIntervals?.find(track=>track.id===wanted.id)?.ranges.find(value=>value.id===range.id)?.[side];if(result===undefined||!Number.isFinite(result))fail(snapshot.id,range.id,'material response cannot be inverted.');if(Math.abs(result!-range[side])<=1e-10)break;if(result!<range[side])lo=mid;else hi=mid;}
   const result=evaluated.drawing.displayIntervals?.find(track=>track.id===wanted.id)?.ranges.find(value=>value.id===range.id)?.[side];if(result===undefined||Math.abs(result-range[side])>1e-7)fail(snapshot.id,range.id,'the current material mapping cannot preserve this split interval exactly.');
  }
 }
 return rebuilt();
}
function orderedFrozen(plan:SnapshotCurveSplitPlan):FrozenSnapshot[]{
 const byId=new Map(plan.frozen.map(value=>[value.snapshotId,value])),result:FrozenSnapshot[]=[],done=new Set<string>();
 const visit=(id:string)=>{if(done.has(id))return;done.add(id);const snapshot=plan.before.snapshots.find(value=>value.id===id);for(const layer of snapshot?.layers??[])if(layer.kind==='reference')visit(layer.baseSnapshotId);const frozen=byId.get(id);if(frozen)result.push(frozen);};
 for(const value of plan.frozen)visit(value.snapshotId);return result;
}
export interface SnapshotSplitMirrorReplacement {oldPairId:string;left:MirrorCurvePair;right:MirrorCurvePair}
export interface SnapshotCurveSplitBatchPlan {before:RecordingSnapshotWorkspace;sourceSnapshotId:string;plans:readonly SnapshotCurveSplitPlan[];mirrorPairs:readonly SnapshotSplitMirrorReplacement[]}
/** All curves are frozen against the same original workspace, before any source
 * update. Mirror companions use their own explicit native t and allocated IDs. */
export function prepareSnapshotCurveSplits(workspace:RecordingSnapshotWorkspace,sourceSnapshotId:string,intents:readonly CurveSplitIntent[],mirrorPairs:readonly SnapshotSplitMirrorReplacement[]=[]):SnapshotCurveSplitBatchPlan {
 if(!intents.length||new Set(intents.map(value=>value.curveId)).size!==intents.length)throw Error('A split batch requires distinct source curves.');
 const plans=intents.map(intent=>prepareSnapshotCurveSplit(workspace,sourceSnapshotId,intent,mirrorPairs));
 const splitAll=(drawing:DrawingDocument)=>{
  if(!intents.some(intent=>hasEvaluatedDeformationFor(drawing,intent.curveId)||splitParameter(drawing,intent)!==intent.t))return intents.reduce((document,intent)=>hasCurve(document,intent.curveId)?split(document,intent):document,drawing);
  const materialSource=evaluatedMaterialSource(drawing),material=intents.reduce((document,intent)=>hasCurve(document,intent.curveId)?split(document,materialSource===drawing?{...intent,t:splitParameter(drawing,intent)}:intent):document,materialSource);
  const controls=intents.reduce<DrawingDocument>((document,intent)=>hasCurve(document,intent.curveId)?applyCurveSplitIntent(document,{...intent,t:splitParameter(drawing,intent),sourceNodeIds:document.curves.find(curve=>curve.id===intent.curveId)!.nodes},{propagate:true}).document:document,{...drawing,displayIntervals:undefined});return {...controls,displayIntervals:material.displayIntervals};
 };
 const frozenPlans=plans.map(plan=>({...plan,frozen:plan.frozen.map(frozen=>{
  const pose=(value:FrozenPose):FrozenPose=>({...value,split:splitAll(value.evaluation.preElementPlacementDrawing),finalSplit:splitAll(value.evaluation.drawing),material:splitAll(value.evaluation.source)});
  return {...frozen,saved:pose(frozen.saved),...(frozen.inherited?{inherited:pose(frozen.inherited)}:{}),...(frozen.draft?{draft:pose(frozen.draft)}:{})};})}));
 return {before:workspace,sourceSnapshotId,plans:frozenPlans,mirrorPairs:clone(mirrorPairs)};
}
/** Apply only after every canonical source split was refreshed together. */
export function finishSnapshotCurveSplits(batch:SnapshotCurveSplitBatchPlan,candidate:RecordingSnapshotWorkspace):RecordingSnapshotWorkspace {
 const {plans}=batch;let workspace={...candidate,library:{...candidate.library,curves:{...candidate.library.curves}},snapshots:candidate.snapshots.map(initial=>{
  let snapshot=initial;
  if(snapshot.relations.mirrorEditing)for(const plan of plans)snapshot={...snapshot,relations:{...snapshot.relations,mirrorEditing:splitSnapshotMirrorMetadata(snapshot.relations.mirrorEditing!,plan.intent,batch.mirrorPairs)}};
  let basis=plans.flatMap(plan=>plan.frozen).find(value=>value.snapshotId===snapshot.id)?.saved.evaluation.source;
  if(snapshot.inputMirror){const mirror=snapshot.inputMirror;const curvePairs=mirror.curvePairs.flatMap(pair=>{const replacement=batch.mirrorPairs.find(value=>value.oldPairId===pair.id);return replacement?[replacement.left,replacement.right]:plans.some(plan=>pair.a===plan.intent.curveId||pair.b===plan.intent.curveId)?[]:[pair];});snapshot={...snapshot,inputMirror:{...mirror,curvePairs}};}
  for(const plan of plans){const {intent}=plan;
   const layers=snapshot.layers.map(layer=>layer.kind==='reference'&&layer.membership?{...layer,membership:{...(layer.membership.orderOverride?{orderOverride:replaceId(layer.membership.orderOverride,intent)}:{}),...(layer.membership.addElementIds?{addElementIds:replaceId(layer.membership.addElementIds,intent)}:{}),...(layer.membership.excludeElementIds?{excludeElementIds:replaceId(layer.membership.excludeElementIds,intent)}:{})}}:layer);
   const memberSources=snapshot.memberSources&&Object.hasOwn(snapshot.memberSources,intent.curveId)?Object.fromEntries(Object.entries(snapshot.memberSources).flatMap(([id,source])=>id===intent.curveId?intent.childCurveIds.map(id=>[id,source]):[[id,source]])):snapshot.memberSources;
   snapshot={...snapshot,layers,...(memberSources?{memberSources}:{})};if(!basis||!hasCurve(basis,intent.curveId))continue;
   snapshot={...snapshot,...(snapshot.objectLocks?{objectLocks:splitSnapshotObjectLocks(snapshot.objectLocks,intent)}:{}),...(snapshot.nodeForks?{nodeForks:splitSnapshotNodeForks(snapshot.nodeForks,intent)}:{}),relations:remapRelations(snapshot.relations,basis,intent,snapshot.id===batch.sourceSnapshotId?snapshot:undefined),deformation:remapState(snapshot.deformation,basis,intent),...(snapshot.inheritedState?{inheritedState:remapState(snapshot.inheritedState,basis,intent)}:{}),...(snapshot.draft?{draft:{...snapshot.draft,deformation:remapState(snapshot.draft.deformation,basis,intent)}}:{})};
   basis=split(basis,intent);
  }
  return snapshot;
 })};
 // Recorder material fields keep their logical targets. Each new piece is a
 // render restriction using the same live material frame and stable split IDs.
 workspace={...workspace,recordings:workspace.recordings.map(recording=>{if(recording.mode!=='triangulated'||!recording.angleGraph)return recording;let partitions=recording.angleGraph.materialPartitions,lineages=recording.angleGraph.materialPathLineages;for(const plan of plans){const affected=plan.frozen.filter(value=>recording.snapshotIds.includes(value.snapshotId));if(affected.length){partitions=remapSnapshotMaterialPartitions(partitions,plan.intent,affected.flatMap(value=>value.saved.evaluation.source.displayIntervals??[]));lineages=remapSnapshotMaterialPathLineages(lineages,plan.intent,affected.map(value=>value.saved.evaluation.source));}}return partitions?.length||lineages?.length?{...recording,angleGraph:{...recording.angleGraph,...partitions?.length?{materialPartitions:partitions}:{},...lineages?.length?{materialPathLineages:lineages}:{}}}:recording;})};
 const combined:SnapshotCurveSplitPlan={...plans[0],frozen:[...new Map(plans.flatMap(plan=>plan.frozen).map(value=>[value.snapshotId,value])).values()]};
 for(const ordered of orderedFrozen(combined)){
  let snapshot=workspace.snapshots.find(value=>value.id===ordered.snapshotId)!;
  const replace=(next:RecordingSnapshot)=>{snapshot=next;workspace={...workspace,snapshots:workspace.snapshots.map(value=>value.id===next.id?next:value)};};
  const original=batch.before.snapshots.find(value=>value.id===snapshot.id),retired=new Set(plans.map(plan=>plan.intent.curveId));
  const extras=(plan:SnapshotCurveSplitPlan)=>[...new Set((original?.inputMirror?.curvePairs??[]).filter(pair=>(pair.a===plan.intent.curveId||pair.b===plan.intent.curveId)&&!batch.mirrorPairs.some(value=>value.oldPairId===pair.id)).flatMap(pair=>[pair.a,pair.b]).filter(id=>!retired.has(id)))];
  for(const mode of ['inherited','saved','draft'] as const)for(const plan of plans){const frozen=plan.frozen.find(value=>value.snapshotId===snapshot.id),pose=frozen?.[mode];if(pose)replace(rebasePose(workspace,snapshot,pose,plan.intent,mode,extras(plan)));}
  for(const mode of ['saved','draft'] as const)for(const plan of plans){const frozen=plan.frozen.find(value=>value.snapshotId===snapshot.id),pose=frozen?.[mode];if(!pose)continue;const actual=resolveSnapshot(workspace,snapshot.id,{useDraft:mode==='draft',angle:mode==='draft'?snapshot.draft!.angle:snapshot.angle,diagnostics:'preview'}).preElementPlacementDrawing;
   for(const id of [...plan.intent.childCurveIds,...extras(plan)]){const expected=shapeOf(pose.split,id),got=shapeOf(actual,id);if(expected.some((point,index)=>point.some((value,axis)=>Math.abs(value-got[index][axis])>1e-8)))fail(snapshot.id,id,'the current constraints cannot preserve the already-deformed split controls exactly.');}
   const final=resolveSnapshot(workspace,snapshot.id,{useDraft:mode==='draft',angle:mode==='draft'?snapshot.draft!.angle:snapshot.angle,diagnostics:'preview'});for(const id of plan.intent.childCurveIds){const expected=shapeOf(pose.finalSplit,id),got=shapeOf(final.drawing,id);if(expected.some((point,index)=>point.some((value,axis)=>Math.abs(value-got[index][axis])>1e-8)))fail(snapshot.id,id,final.diagnostics.find(issue=>issue.code==='LAYER_DOMAIN')?.message??'the retained output program cannot preserve its exact fitted restriction.');}
  }
 }
 for(const {intent} of plans)delete workspace.library.curves[intent.curveId];return workspace;
}
export function finishSnapshotCurveSplit(plan:SnapshotCurveSplitPlan,candidate:RecordingSnapshotWorkspace):RecordingSnapshotWorkspace {
 return finishSnapshotCurveSplits({before:plan.before,sourceSnapshotId:plan.sourceSnapshotId,plans:[plan],mirrorPairs:[]},candidate);
}

/** Child-only topology owns two new local members and an old-ID tombstone.
 * Existing parent/other basis states and recorder response maps are untouched. */
export function splitSnapshotLocalCurve(before:RecordingSnapshotWorkspace,snapshotId:string,intent:CurveSplitIntent):{workspace:RecordingSnapshotWorkspace;diagnostics:SnapshotTopologyDiagnostic[]} {
 const snapshot=before.snapshots.find(value=>value.id===snapshotId);if(!snapshot)throw Error('Local split snapshot is missing.');
 for(const id of [...intent.childCurveIds,intent.seamNodeId])if(Object.values(before.library).some(map=>Object.hasOwn(map,id)))throw Error('A local split identity already exists in the canonical library.');
 const saved=frozenPose(before,snapshot,intent,'saved'),layerId=layerFor(saved.evaluation.source,intent.curveId)?.id,layer=snapshot.layers.find(value=>value.id===layerId);
 if(!layer||layer.kind!=='reference')throw Error('A local split requires a referenced layer.');
 const dependentPaint=[...saved.evaluation.source.fills.filter(value=>value.boundary.some(use=>use.id===intent.curveId)),...saved.evaluation.source.offsets.filter(value=>value.source.some(use=>use.id===intent.curveId))];
 if(dependentPaint.length)fail(snapshotId,intent.curveId,`local paint dependencies need explicit new identities: ${dependentPaint.map(value=>value.id).join(', ')}.`);
 const frozen:FrozenSnapshot={snapshotId,saved,...(snapshot.draft?{draft:frozenPose(before,snapshot,intent,'draft')}:{}),...(snapshot.inheritedState?{inherited:frozenPose(before,snapshot,intent,'inherited')}:{})};preflightTracks(before,[frozen],intent,true);
 const material=saved.material;let workspace=clone(before),local=workspace.snapshots.find(value=>value.id===snapshotId)!;
 for(const id of intent.childCurveIds)workspace.library.curves[id]=clone(material.curves.find(curve=>curve.id===id)!);
 workspace.library.nodes[intent.seamNodeId]=clone(material.nodes.find(node=>node.id===intent.seamNodeId)!);
 const slot=local.layers.find(value=>value.id===layer.id)!;if(slot.kind!=='reference')throw Error('Local split layer changed.');
 slot.membership={...(slot.membership?.orderOverride?{orderOverride:replaceId(slot.membership.orderOverride,intent)}:{}),addElementIds:[...(slot.membership?.addElementIds??[]).filter(id=>id!==intent.curveId),...intent.childCurveIds],excludeElementIds:[...new Set([...(slot.membership?.excludeElementIds??[]),intent.curveId])]};
 if(local.objectLocks)local.objectLocks=splitSnapshotObjectLocks(local.objectLocks,intent);
 if(local.nodeForks)local.nodeForks=splitSnapshotNodeForks(local.nodeForks,intent,true);
 local.relations=remapRelations(local.relations,saved.evaluation.source,intent);
 const inheritedRelations={joins:material.joins,endpointLinks:material.endpointLinks??[],groups:material.groups??[],displayIntervals:material.displayIntervals??[]};
 // Relations formerly inherited solely through the excluded curve must become
 // explicit local relations, preserving the exact split material/connection.
 for(const category of ['joins','endpointLinks','groups','displayIntervals'] as const){const values=inheritedRelations[category].filter(value=>category==='joins'||category==='endpointLinks'?intent.childCurveIds.includes((value as {a:Endpoint;b:Endpoint}).a.curveId)||intent.childCurveIds.includes((value as {a:Endpoint;b:Endpoint}).b.curveId):category==='groups'?(value as {curveIds:string[]}).curveIds.some(id=>intent.childCurveIds.includes(id)):(value as StrokeDisplayIntervals).anchor.id===intent.childCurveIds[0]||(value as StrokeDisplayIntervals).anchor.id===intent.childCurveIds[1]);
  const patch=local.relations[category]??{},known=new Set([...(patch.add??[]),...(patch.update??[])].map(value=>value.id)),fresh=values.filter(value=>!known.has(value.id));
  const survives=(item:typeof fresh[number])=>category==='groups'&&(item as {curveIds:string[]}).curveIds.some(id=>!intent.childCurveIds.includes(id));
  (local.relations as Record<string,unknown>)[category]={...patch,add:[...(patch.add??[]),...fresh.filter(item=>!survives(item))],...(fresh.some(survives)?{update:[...(patch.update??[]),...fresh.filter(survives)]}:{})};
 }
 local.deformation=remapState(local.deformation,saved.evaluation.source,intent);if(local.inheritedState)local.inheritedState=remapState(local.inheritedState,saved.evaluation.source,intent);if(local.draft)local.draft={...local.draft,deformation:remapState(local.draft.deformation,saved.evaluation.source,intent)};
 for(const mode of ['inherited','saved','draft'] as const){const pose=frozen[mode];if(pose){local=rebasePose(workspace,local,pose,intent,mode);workspace={...workspace,snapshots:workspace.snapshots.map(value=>value.id===snapshotId?local:value)};}}
 return {workspace,diagnostics:[{code:'LOCAL_SPLIT_CORRESPONDENCE',snapshotId,curveId:intent.curveId,message:'This local split creates new curve IDs only in this snapshot and breaks correspondence with the parent curve.'}]};
}
