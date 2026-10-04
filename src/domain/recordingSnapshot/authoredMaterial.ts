import {validateIntervalOverrides} from '../vectorRecording/intervals';
import type {DrawingDocument,StrokeDisplayIntervals} from '../drawing/model';
import type {CurveSplitIntent} from '../drawing/layerEditIntent';
import {displayPath} from '../drawing/displayIntervals';
import type {SceneIntervalValue,SnapshotDeformationState,SnapshotAngleGraph} from './model';
import {validateSnapshotMaterialPartitions,snapshotMaterialMeasurementRuns,remapSnapshotMaterialPartitions,transferSnapshotAuthoredPartition,transportSnapshotAuthoredPartitionSource,type SnapshotMaterialPartition} from './materialSplit';
import {validateSnapshotMaterialPathLineages,remapSnapshotMaterialPathLineages} from './materialPathLineages';
import {createSnapshotPathMaterialFrame,snapshotPathUsesDeclaredMaterialGrid,type SnapshotMaterialPathLineage} from './pathMaterialFrame';
import {retainSnapshotAffines} from './elementPlacement';

/** A local raw appearance and live topology addresses. No controls, fitted
 * parameters, endpoint positions, or sampled geometry are retained. */
export interface SnapshotAuthoredMaterial {
 version:1;
 appearance:StrokeDisplayIntervals;
 partition?:SnapshotMaterialPartition;
 path?:SnapshotMaterialPathLineage;
}

export function validateSnapshotAuthoredMaterial(value:unknown):asserts value is SnapshotAuthoredMaterial {
 const fail=():never=>{throw Error('Invalid authored material frame.');};
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
 if(Reflect.ownKeys(value as object).some(key=>typeof key!=='string'||!['version','appearance','partition','path'].includes(key)||!('value' in Object.getOwnPropertyDescriptor(value,key)!)))fail();
 const material=value as SnapshotAuthoredMaterial;if(material.version!==1||!!material.partition===!!material.path)fail();validateIntervalOverrides([material.appearance]);
 if(material.partition){validateSnapshotMaterialPartitions([material.partition]);if(material.appearance.scope!=='CURVE'||material.appearance.displayRoute||material.partition.sourceTrackId!==material.appearance.id||material.partition.reverse!==material.appearance.anchor.reverse||material.partition.parts.some(part=>part.ranges.length!==material.appearance.ranges.length||part.ranges.some(range=>!material.appearance.ranges.some(value=>value.id===range.rangeId))))fail();}
 if(material.path){validateSnapshotMaterialPathLineages([material.path]);if(material.path.sourceTrackId!==material.appearance.id||material.appearance.scope==='CURVE'&&!material.appearance.displayRoute)fail();}
}

export function remapSnapshotAuthoredMaterial(value:SceneIntervalValue,basis:DrawingDocument,intent:CurveSplitIntent):SnapshotAuthoredMaterial|undefined {
 if(!value.appearance)return undefined;
 const old=value.authoredMaterial,appearance=old?.appearance??value.appearance;
 if(!old&&(appearance.scope==='CURVE'&&!appearance.displayRoute?appearance.anchor.id!==intent.curveId:!displayPath(basis,appearance.anchor.id).segments.some(use=>use.id===intent.curveId)))return undefined;
 const drawing={...basis,displayIntervals:[value.appearance]},partition=remapSnapshotMaterialPartitions(old?.partition?[old.partition]:undefined,intent,[value.appearance])[0],path=remapSnapshotMaterialPathLineages(old?.path?[old.path]:undefined,intent,[drawing])[0];
 return {version:1,appearance:structuredClone(appearance),...(partition?{partition}:{}),...(path?{path}:{})};
}

/** Replay local authored material after the inserted view's current fitted
 * ranges are available, before its inherited baseline is combined with edits. */
export function applySnapshotAuthoredMaterial(state:SnapshotDeformationState,source:DrawingDocument,drawing:DrawingDocument):DrawingDocument {
 const entries=new Map(Object.values(state.layers).flatMap(layer=>Object.entries(layer.intervals??{}))),intervals=drawing.displayIntervals?.map(track=>{
  const value=entries.get(track.id),material=value?.authoredMaterial;if(!material)return track;
  const {partition,path}=material,required=partition?.parts.map(part=>part.curveId)??path?.curves.flatMap(curve=>curve.parts.map(part=>part.curveId))??[];
  // The owning recipe suspends an incomplete material relationship. Let its
  // normal membership check run without evaluating a missing authored frame.
  if(required.some(id=>!source.curves.some(curve=>curve.id===id)||!drawing.curves.some(curve=>curve.id===id)))return track;
  if(partition){const part=partition.parts.find(part=>part.sourceTrackId===track.id);if(!part)return track;
   return {...track,ranges:track.ranges.map(range=>{const id=part.ranges.find(value=>value.sourceRangeId===range.id)?.rangeId,raw=material.appearance.ranges.find(range=>range.id===id);if(!raw)return range;
    const endpoint=(end:'start'|'end')=>transferSnapshotAuthoredPartition(partition,source,drawing,{kind:'interval-endpoint',layerId:'authored',sourceTrackId:track.id,rangeId:range.id,end},raw[end]);
    return {...range,start:endpoint('start'),end:endpoint('end')};
   })};
  }
  if(path){const input=source.displayIntervals?.find(value=>value.id===track.id);if(!input)return track;const logicalSource=createSnapshotPathMaterialFrame(source,input,path,true),logicalTarget=createSnapshotPathMaterialFrame(drawing,track,path,true),actual=createSnapshotPathMaterialFrame(drawing,track);
   return {...track,ranges:track.ranges.map(range=>{const raw=material.appearance.ranges.find(value=>value.id===range.id);if(!raw)return range;const endpoint=(end:'start'|'end')=>actual.positionOf(logicalTarget.materialAt(logicalTarget.positionOf(logicalSource.materialAt(raw[end]),source)));return {...range,start:endpoint('start'),end:endpoint('end')};})};
  }
  return track;
 });
 return intervals?retainSnapshotAffines({...drawing,displayIntervals:intervals},[drawing]):drawing;
}

/** Source edits retain the same native material support as ordinary authored
 * channels; only its live-frame percentage changes, never its ownership. */
export function transportSnapshotAuthoredMaterialSource(material:SnapshotAuthoredMaterial,before:DrawingDocument,after:DrawingDocument):SnapshotAuthoredMaterial {
 const {partition,path}=material;
 let endpoint:(value:number)=>number;
 if(partition)endpoint=value=>transportSnapshotAuthoredPartitionSource(partition,before,after,value);
 else if(path){const a=before.displayIntervals?.find(track=>track.id===path.sourceTrackId),b=after.displayIntervals?.find(track=>track.id===path.sourceTrackId);if(!a||!b)throw Error('Authored path material lost its live source.');const from=createSnapshotPathMaterialFrame(before,a,path,true),to=createSnapshotPathMaterialFrame(after,b,path,true);endpoint=value=>to.positionOf(from.materialAt(value),before);}
 else return material;
 return {...material,appearance:{...material.appearance,ranges:material.appearance.ranges.map(range=>({...range,start:endpoint(range.start),end:endpoint(range.end)}))}};
}

/** Until ARC and compound-route grids have the same exact restriction law,
 * keep those authored channels behind the existing atomic split boundary. */
export function assertSnapshotAuthoredMaterialSplitSupported(snapshotId:string,state:SnapshotDeformationState,basis:DrawingDocument,graph:SnapshotAngleGraph,intent:CurveSplitIntent):void {
 for(const layer of Object.values(state.layers))for(const [id,value] of Object.entries(layer.intervals??{})){
  if(!value.appearance)continue;
  const track=basis.displayIntervals?.find(track=>track.id===id);if(!track)continue;
  const path=displayPath(basis,track.anchor.id),partition=graph.materialPartitions?.find(partition=>partition.parts.some(part=>part.sourceTrackId===id)),ids=new Set(track.scope==='CURVE'&&!track.displayRoute?partition?.parts.map(part=>part.curveId)??[track.anchor.id]:path.segments.map(use=>use.id));
  if(!ids.has(intent.curveId))continue;
  const arc=basis.joins.some(join=>join.mode==='ARC'&&(ids.has(join.a.curveId)||ids.has(join.b.curveId)))||(basis.endpointLinks??[]).some(link=>link.joinBrush?.kind==='ARC'&&(ids.has(link.a.curveId)||ids.has(link.b.curveId)));
  const lineage=graph.materialPathLineages?.find(lineage=>lineage.sourceTrackId===id),simplePath=lineage?snapshotPathUsesDeclaredMaterialGrid(basis,track,lineage):!track.displayRoute&&!path.closed&&path.segments.length===1&&!(basis.endpointLinks??[]).some(link=>ids.has(link.a.curveId)||ids.has(link.b.curveId));
  if(arc||track.scope!=='CURVE'&&!simplePath||track.displayRoute)throw Error(`Cannot split ${intent.curveId} in snapshot ${snapshotId}: authored interval ${id} needs an exact retained material grid for its ARC or compound path; no state was changed.`);
 }
}

/** The final scalar transfer can restore a different fitted correspondence from
 * the temporary topology frame. Preserve the actual arc-table decomposition,
 * not just endpoint geometry, before publishing an authored material split. */
export function assertSnapshotAuthoredMaterialSplit(
 snapshotId:string,before:{drawing:DrawingDocument;state:SnapshotDeformationState},after:DrawingDocument,
 prior:SnapshotAngleGraph,next:SnapshotAngleGraph,intent:CurveSplitIntent,
):void {
 const owned=new Set(Object.values(before.state.layers).flatMap(layer=>Object.entries(layer.intervals??{}).filter(([,value])=>value.appearance).map(([id])=>id)));
 if(!owned.size)return;
 type Part={curveId:string;parameterRange:readonly [number,number]};
 const original:Part[]=[{curveId:intent.curveId,parameterRange:[0,1]}];
 const check=(trackId:string,old:readonly Part[],current:readonly Part[],useDeclared=true)=>{
  if(old.some(part=>!before.drawing.curves.some(curve=>curve.id===part.curveId))||current.some(part=>!after.curves.some(curve=>curve.id===part.curveId)))return;
  const a=snapshotMaterialMeasurementRuns(old,before.drawing,useDeclared),b=snapshotMaterialMeasurementRuns(current,after,useDeclared);
  if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`Cannot split ${intent.curveId} in snapshot ${snapshotId}: authored interval ${trackId} changes its exact fitted material measurement partition. The current live fitted correspondence cannot preserve this material field; no state was changed.`);
 };
 for(const partition of next.materialPartitions??[]){
  if(!partition.parts.some(part=>intent.childCurveIds.includes(part.curveId)))continue;
  const old=prior.materialPartitions?.find(value=>value.sourceTrackId===partition.sourceTrackId);
  if((old?.parts.map(part=>part.sourceTrackId)??[partition.sourceTrackId]).some(id=>owned.has(id)))check(partition.sourceTrackId,old?.parts??original,partition.parts);
 }
 for(const lineage of next.materialPathLineages??[]){
  if(!owned.has(lineage.sourceTrackId))continue;
  const old=prior.materialPathLineages?.find(value=>value.sourceTrackId===lineage.sourceTrackId);
  const track=after.displayIntervals?.find(value=>value.id===lineage.sourceTrackId),useDeclared=!!track&&snapshotPathUsesDeclaredMaterialGrid(after,track,lineage);
  for(const root of lineage.curves)if(root.parts.some(part=>intent.childCurveIds.includes(part.curveId)))check(lineage.sourceTrackId,old?.curves.find(value=>value.sourceCurveId===root.sourceCurveId)?.parts??original,root.parts,useDeclared);
 }
}
