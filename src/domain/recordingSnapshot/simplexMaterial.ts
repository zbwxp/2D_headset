import type {SnapshotMaterialPathLineage} from './materialPathLineages';
import {createSnapshotMaterialPartitionBasis,snapshotMaterialPartitionInkEnds,type SnapshotMaterialPartition} from './materialSplit';
import {blendSnapshotPropertyValues} from './propertyResponses';
import type {DrawingDocument,StrokeDisplayIntervals} from '../drawing/model';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {replaceEndpointPairMaterial,transportEndpointPairMaterial} from './endpointPairMaterial';
import type {SnapshotSimplexBasis} from './simplexGeometry';
import type {SnapshotScalarPropertyTarget} from './model';

/** Runtime-only inputs supplied by the complete native material dependency plan. */
export interface SnapshotSimplexMaterialReuse {
 readonly intervals:StrokeDisplayIntervals[];
 readonly dirtyTrackIndices:readonly number[];
 readonly trackDiagnostics:readonly string[][];
 readonly basisTrackIndices:readonly ReadonlyMap<string,number>[];
 readonly layerIds:ReadonlyMap<string,string>;
}
export interface SnapshotSimplexMaterialResult {drawing:DrawingDocument;diagnostics:string[];trackDiagnostics?:string[][]}
const materialStats={transportedTracks:0,transportedBasisTracks:0,reusedTracks:0,dependencyPlans:0,revisionSamples:0};
/** Kernel work counters, independent of display-field cache hits or timing. */
export const getSnapshotSimplexMaterialStats=()=>({...materialStats});
export const resetSnapshotSimplexMaterialStats=()=>{for(const key of Object.keys(materialStats) as (keyof typeof materialStats)[])materialStats[key]=0;};
export function countSnapshotSimplexMaterialWork(kind:'dependencyPlans'|'revisionSamples'):void {materialStats[kind]++;}
export interface SnapshotSimplexMaterialOptions {
 /** Only a native prepared plan with complete control/source proof may reuse. */
 reuse?:SnapshotSimplexMaterialReuse;
 partitions?:readonly SnapshotMaterialPartition[];
 pathLineages?:readonly SnapshotMaterialPathLineage[];
 response?:(target:SnapshotScalarPropertyTarget,values:readonly number[],weights:readonly number[])=>number;
 inherited?:(target:SnapshotScalarPropertyTarget)=>number|undefined;
 pinch?:(trackId:string,rangeId:string)=>number|undefined;
}

/** Shared material-coordinate preparation for sampling and inverse property edits. */
export function snapshotSimplexIntervalBasisValues(bases:readonly SnapshotSimplexBasis[],drawing:DrawingDocument,sourceTrackId:string,rangeId:string,partitions?:readonly SnapshotMaterialPartition[],pathLineages?:readonly SnapshotMaterialPathLineage[]):{start:number[];end:number[];diagnostics:string[]} {
 const diagnostics:string[]=[];
 const layerId=drawing.layers.find(layer=>layer.items.includes(drawing.displayIntervals?.find(track=>track.id===sourceTrackId)?.anchor.id??''))?.id;
 if((partitions?.length||pathLineages?.length)&&layerId){const basis=createSnapshotMaterialPartitionBasis(partitions,bases,drawing,diagnostics,pathLineages),target={kind:'interval-endpoint' as const,layerId,sourceTrackId,rangeId};return {start:basis({...target,end:'start'}).values,end:basis({...target,end:'end'}).values,diagnostics};}
 const ranges=bases.map(basis=>{
  const source=basis.drawing.displayIntervals?.find(track=>track.id===sourceTrackId);
  if(!source)throw Error('The interval is absent from an active real snapshot.');
  const range=transportEndpointPairMaterial(basis.drawing,source,drawing,diagnostics).ranges.find(range=>range.id===rangeId);
  if(!range)throw Error('The interval range is absent from an active real snapshot.');
  return range;
 });
 return {start:ranges.map(range=>range.start),end:ranges.map(range=>range.end),diagnostics};
}

/** Main-render appearance stage only. Full-curve onion sampling never calls
 * this function. Material coordinates are transported from each active basis
 * into the same final geometry before ordinary geometric-weight mixing. */
export function transportSnapshotSimplexMaterial(bases:readonly SnapshotSimplexBasis[],drawing:DrawingDocument,weights:readonly number[],options:SnapshotSimplexMaterialOptions={}):SnapshotSimplexMaterialResult {
 if(bases.length<2||!drawing.displayIntervals?.length)return {drawing,diagnostics:[]};
 const diagnostics:string[]=[],blend=(values:number[])=>blendSnapshotPropertyValues(values,weights);
 const partitionBasis=options.partitions?.length||options.pathLineages?.length?createSnapshotMaterialPartitionBasis(options.partitions,bases,drawing,diagnostics,options.pathLineages):undefined;
 const reuse=options.reuse,trackDiagnostics=reuse?[...reuse.trackDiagnostics]:drawing.displayIntervals.map(()=>[] as string[]);
 const transport=(selected:StrokeDisplayIntervals,index:number)=>{
  materialStats.transportedTracks++;const diagnosticStart=diagnostics.length;
  try{
   const transported=bases.map((basis,basisIndex)=>{const source=reuse?basis.drawing.displayIntervals?.[reuse.basisTrackIndices[basisIndex].get(selected.id)!]:basis.drawing.displayIntervals?.find(track=>track.id===selected.id);if(!source||source.id!==selected.id)throw Error('The material relationship is absent from an active basis.');materialStats.transportedBasisTracks++;return transportEndpointPairMaterial(basis.drawing,source,drawing,diagnostics);});
   return {...selected,ranges:selected.ranges.map(range=>{
    const values=transported.map(track=>track.ranges.find(value=>value.id===range.id));if(values.some(value=>!value))throw Error(`Material range ${range.id} has incompatible identity.`);
    const layerId=reuse?reuse.layerIds.get(selected.id):drawing.layers.find(layer=>layer.items.includes(selected.anchor.id))?.id;
    const logicalValues={start:range.start,end:range.end};let closedPath=false;
    const coordinate=(end:'start'|'end')=>{
     const addressed=layerId?{kind:'interval-endpoint' as const,layerId,sourceTrackId:selected.id,rangeId:range.id,end}:undefined,mapped=addressed&&partitionBasis?.(addressed),target=mapped?.target??addressed,coordinates=mapped?.values??values.map(value=>value![end]),project=mapped?.project??((value:number)=>value),ordinary=target?options.inherited?.(target)??blend(coordinates):blend(coordinates);
     closedPath=!!mapped?.closed;
     if(!target||!options.response){logicalValues[end]=ordinary;return project(ordinary);}
     const sampled=options.response(target,coordinates,weights);
     if(!Number.isFinite(sampled)||sampled<0||sampled>1){diagnostics.push(`Material ${selected.id} range ${range.id} ${end}: the response exceeds its valid 0…1 material range; ordinary interpolation is retained.`);logicalValues[end]=ordinary;return project(ordinary);}
     logicalValues[end]=sampled;return project(sampled);
    };
    let start=coordinate('start'),end=coordinate('end');if(closedPath&&Math.abs(logicalValues.end-logicalValues.start)>=1-1e-10){start=logicalValues.start;end=logicalValues.end;}const inkEnds=snapshotMaterialPartitionInkEnds(options.partitions,drawing,selected.id,range.id,logicalValues);
    return withIntervalPinch({...range,start,end,...inkEnds?{inkEnds}:{}},options.pinch?.(selected.id,range.id)??blend(values.map(value=>intervalPinch(value!))));
   })};
  }catch(error){diagnostics.push(`Material ${selected.id}: ${error instanceof Error?error.message:String(error)} The saved discrete material is retained for review.`);return selected;}finally{trackDiagnostics[index]=diagnostics.slice(diagnosticStart);}
 };
 const intervals=reuse?(reuse.dirtyTrackIndices.length?[...reuse.intervals]:reuse.intervals):drawing.displayIntervals.map(transport);
 if(reuse){materialStats.reusedTracks+=intervals.length-reuse.dirtyTrackIndices.length;for(const index of reuse.dirtyTrackIndices)intervals[index]=transport(drawing.displayIntervals[index],index);}
 return {drawing:replaceEndpointPairMaterial(drawing,intervals),diagnostics:[...new Set(reuse?trackDiagnostics.flat():diagnostics)],trackDiagnostics};
}
