import {blendSnapshotPropertyValues} from './propertyResponses';
import type {DrawingDocument} from '../drawing/model';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {replaceEndpointPairMaterial,transportEndpointPairMaterial} from './endpointPairMaterial';
import type {SnapshotSimplexBasis} from './simplexGeometry';
import type {SnapshotScalarPropertyTarget} from './model';

export interface SnapshotSimplexMaterialOptions {
 response?:(target:SnapshotScalarPropertyTarget,values:readonly number[],weights:readonly number[])=>number;
 inherited?:(target:SnapshotScalarPropertyTarget)=>number|undefined;
 pinch?:(trackId:string,rangeId:string)=>number|undefined;
}

/** Shared material-coordinate preparation for sampling and inverse property edits. */
export function snapshotSimplexIntervalBasisValues(bases:readonly SnapshotSimplexBasis[],drawing:DrawingDocument,sourceTrackId:string,rangeId:string):{start:number[];end:number[];diagnostics:string[]} {
 const diagnostics:string[]=[],ranges=bases.map(basis=>{
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
export function transportSnapshotSimplexMaterial(bases:readonly SnapshotSimplexBasis[],drawing:DrawingDocument,weights:readonly number[],options:SnapshotSimplexMaterialOptions={}):{drawing:DrawingDocument;diagnostics:string[]} {
 if(bases.length<2||!drawing.displayIntervals?.length)return {drawing,diagnostics:[]};
 const diagnostics:string[]=[],blend=(values:number[])=>blendSnapshotPropertyValues(values,weights);
 const intervals=drawing.displayIntervals.map(selected=>{
  try{
   const transported=bases.map(basis=>{const source=basis.drawing.displayIntervals?.find(track=>track.id===selected.id);if(!source)throw Error('The material relationship is absent from an active basis.');return transportEndpointPairMaterial(basis.drawing,source,drawing,diagnostics);});
   return {...selected,ranges:selected.ranges.map(range=>{
    const values=transported.map(track=>track.ranges.find(value=>value.id===range.id));if(values.some(value=>!value))throw Error(`Material range ${range.id} has incompatible identity.`);
    const layerId=drawing.layers.find(layer=>layer.items.includes(selected.anchor.id))?.id;
    const coordinate=(end:'start'|'end')=>{
     const coordinates=values.map(value=>value![end]),target=layerId?{kind:'interval-endpoint' as const,layerId,sourceTrackId:selected.id,rangeId:range.id,end}:undefined,ordinary=target?options.inherited?.(target)??blend(coordinates):blend(coordinates);
     if(!target||!options.response)return ordinary;
     const sampled=options.response(target,coordinates,weights);
     if(!Number.isFinite(sampled)||sampled<0||sampled>1){diagnostics.push(`Material ${selected.id} range ${range.id} ${end}: the response exceeds its valid 0…1 material range; ordinary interpolation is retained.`);return ordinary;}
     return sampled;
    };
    return withIntervalPinch({...range,start:coordinate('start'),end:coordinate('end')},options.pinch?.(selected.id,range.id)??blend(values.map(value=>intervalPinch(value!))));
   })};
  }catch(error){diagnostics.push(`Material ${selected.id}: ${error instanceof Error?error.message:String(error)} The saved discrete material is retained for review.`);return selected;}
 });
 return {drawing:replaceEndpointPairMaterial(drawing,intervals),diagnostics:[...new Set(diagnostics)]};
}
