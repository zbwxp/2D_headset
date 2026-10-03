import {transform} from '../../domain/drawing/commands';
import {applyMirrorEditing} from '../../domain/drawing/mirrorEditing';
import {applyScenePlacement} from '../../domain/recordingScene/tracks';
import type {ScenePlacementValue} from '../../domain/recordingScene/model';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {snapshotIntervalMaterialSource} from '../../domain/recordingSnapshot/routeMaterialSource';
import {transportEndpointPairMaterial} from '../../domain/recordingSnapshot/endpointPairMaterial';
import {snapshotMaterialPartitionAddress} from '../../domain/recordingSnapshot/materialSplit';
import {createSnapshotNodeUnbindIntent} from '../../domain/recordingSnapshot/nodeForks';
import type {LandmarkProject} from '../../domain/landmarks/model';
import {layerFor,type DrawingDocument,type DisplayInterval,type StrokeDisplayIntervals} from '../../domain/drawing/model';
import type {DrawingCommandIntent} from '../drawing/endpointInteraction';
import type {SnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {prepareSnapshotEdit,snapshotEditContext,type SnapshotEditPlan} from '../../app/snapshotEditTransaction';
import {prepareSnapshotBatch,prepareSnapshotPreview} from '../../app/recordingSnapshotApi';
import type {Angle} from '../../domain/recordingSnapshot/model';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const contents=(d:DrawingDocument)=>[d.nodes,d.curves,d.layers,d.fills,d.offsets,d.joins,d.endpointLinks??[],d.groups??[]];
const structure=(d:DrawingDocument)=>[d.nodes,d.curves.map(({id,nodes,handles})=>({id,nodes,handles})),d.layers.map(({name,...layer})=>layer),d.fills.map(({id,boundary})=>({id,boundary})),d.offsets.map(({id,source})=>({id,source})),d.joins.map(({radius,...join})=>join),d.endpointLinks??[],d.groups?.map(({name,...group})=>group)??[],d.displayIntervals??[]];
const trackStructure=({ranges,...track}:StrokeDisplayIntervals)=>[track,ranges.map(range=>range.id)];
const rangeStructure=({start,end,mode,enabled,fullLoop,inkEnds,...range}:DisplayInterval)=>range;
/** Existing interval parameters already have typed Recorder ownership. Keep
 * their commands, including intermediate-angle response edits, authoritative. */
export function snapshotDrawingIntervalCommands(before:DrawingDocument,after:DrawingDocument):SnapshotCommand[]|undefined{
 if(!same(contents(before),contents(after)))return undefined;
 const prior=before.displayIntervals??[],next=after.displayIntervals??[];
 if(!same(prior.map(trackStructure),next.map(trackStructure)))return undefined;
 const commands:SnapshotCommand[]=[];
 for(const [index,track] of next.entries()){
  const layerId=layerFor(before,track.anchor.id)?.id;if(!layerId)throw Error('The interval no longer belongs to a current Snapshot layer.');
  for(const [rangeIndex,range] of track.ranges.entries()){
   const previous=prior[index].ranges[rangeIndex];if(!same(rangeStructure(previous),rangeStructure(range)))return undefined;
   const target={layerId,sourceTrackId:track.id,rangeId:range.id};
   const patch=Object.fromEntries((['start','end','mode','fullLoop'] as const).filter(key=>!same(previous[key],range[key])).map(key=>[key,range[key]??(key==='mode'?'SHOW':false)]));
   if(Object.keys(patch).length)commands.push({op:'changeInterval',...target,...patch});
   if((previous.enabled!==false)!==(range.enabled!==false))commands.push({op:'setIntervalEnabled',...target,enabled:range.enabled!==false});
   for(const end of [0,1] as const)if(!same(previous.inkEnds?.[end],range.inkEnds?.[end])){
    const style=range.inkEnds?.[end];if(!style)return undefined;
    commands.push({op:'setIntervalEnd',...target,end,style});
   }
  }
 }
 return commands;
}
export interface SnapshotDrawingPropertyEdit {recordingId:string;snapshotId:string;angle:Angle;beforeDrawing:DrawingDocument;drawing:DrawingDocument;intent?:DrawingCommandIntent;validation?:'preview'|'full'}
/** Property widgets emit real Drawing commands; this is only the ownership
 * boundary. Never replace the source Drawing or serialize evaluated geometry. */
export function prepareSnapshotDrawingPropertyEdit(project:LandmarkProject,edit:SnapshotDrawingPropertyEdit):SnapshotEditPlan{
 const commands=snapshotDrawingIntervalCommands(edit.beforeDrawing,edit.drawing);
 if(commands){if(!commands.length)return {before:project,project,changed:false};
  const workspace=project.recordingSnapshots! ,recording=workspace.recordings.find(value=>value.id===edit.recordingId)!,evaluation=evaluateRecordingSnapshot(workspace,edit.recordingId,{useDraft:true,diagnostics:'preview'});
  if(!same(contents(evaluation.drawing),contents(edit.beforeDrawing))||!same(evaluation.drawing.displayIntervals,edit.beforeDrawing.displayIntervals))throw Error('The Snapshot changed during this property edit. Start the edit again.');
  const correction=evaluation.angleSurface?.role==='correction'||evaluation.endpointPair?.role==='correction';
  const mapped=commands.map(command=>{
   if(correction||command.op!=='changeInterval'||command.start===undefined&&command.end===undefined)return command;
   const graph=recording.angleGraph,target={kind:'interval-endpoint' as const,layerId:command.layerId,sourceTrackId:command.sourceTrackId,rangeId:command.rangeId,end:'start' as const};
   // Partition/path commands already resolve a final-frame address themselves.
   if(graph&&(snapshotMaterialPartitionAddress(graph.materialPartitions,target)||graph.materialPathLineages?.some(lineage=>lineage.sourceTrackId===command.sourceTrackId)))return command;
   const track=edit.drawing.displayIntervals!.find(track=>track.id===command.sourceTrackId)!,material=snapshotIntervalMaterialSource(evaluation,track.id),range=transportEndpointPairMaterial(edit.beforeDrawing,track,material,[]).ranges.find(range=>range.id===command.rangeId)!;
   return {...command,...(command.start!==undefined?{start:range.start}:{}),...(command.end!==undefined?{end:range.end}:{})};
  });
  const result=(edit.validation==='preview'?prepareSnapshotPreview:prepareSnapshotBatch)(project,{recordingId:edit.recordingId,commands:mapped});return {before:project,project:result.changed?{...project,recordingSnapshots:result.recordingSnapshots}:project,changed:result.changed,diagnostics:result.diagnostics};
 }
 const workspace=project.recordingSnapshots,recording=workspace?.recordings.find(value=>value.id===edit.recordingId),snapshot=workspace?.snapshots.find(value=>value.id===edit.snapshotId),angle=recording?.mode==='triangulated'?recording.angleGraph?.mesh.vertices.find(vertex=>vertex.snapshotId===edit.snapshotId)?.angle:snapshot?.angle;
 if(!recording||!snapshot||!recording.snapshotIds.includes(snapshot.id)||!angle||angle.x!==edit.angle.x||angle.y!==edit.angle.y||recording.angle.x!==angle.x||recording.angle.y!==angle.y)throw Error('Edit these properties in a real Snapshot. Intermediate angles currently support geometry and interval endpoint responses.');
 if(same(structure(edit.beforeDrawing),structure(edit.drawing)))return prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-local-drawing',snapshotId:snapshot.id,state:'active-draft',beforeDrawing:edit.beforeDrawing,drawing:edit.drawing});
 return prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'local-drawing-topology',recordingId:recording.id,snapshotId:snapshot.id,angle:edit.angle,beforeDrawing:edit.beforeDrawing,drawing:edit.drawing,...(edit.intent?.kind==='node-unbind'?{nodeUnbind:createSnapshotNodeUnbindIntent(snapshot.id,edit.beforeDrawing,edit.drawing,edit.intent.endpoint)}:{})});
}

/** A response frame authors final controls only. Its real bases keep ownership
 * of ARC trim and paint parameters; neither these nor material ranges become
 * accidental response fields when Drawing's transform command moves controls. */
export function snapshotDrawingTransformTarget(before:DrawingDocument,ids:string[],value:ScenePlacementValue):DrawingDocument {
 const next=transform(before,ids,point=>applyScenePlacement(value,point));
 return applyMirrorEditing(before,{...next,joins:before.joins});
}
