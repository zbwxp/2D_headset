import type {DrawingDocument} from '../drawing/model';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {replaceEndpointPairMaterial,transportEndpointPairMaterial} from './endpointPairMaterial';
import type {SnapshotSimplexBasis} from './simplexGeometry';

/** Main-render appearance stage only. Full-curve onion sampling never calls
 * this function. Material coordinates are transported from each active basis
 * into the same final geometry before ordinary geometric-weight mixing. */
export function transportSnapshotSimplexMaterial(bases:readonly SnapshotSimplexBasis[],drawing:DrawingDocument,weights:readonly number[]):{drawing:DrawingDocument;diagnostics:string[]} {
 if(bases.length<2||!drawing.displayIntervals?.length)return {drawing,diagnostics:[]};
 const diagnostics:string[]=[],blend=(values:number[])=>values.reduce((sum,value,index)=>sum+value*weights[index],0);
 const intervals=drawing.displayIntervals.map(selected=>{
  try{
   const transported=bases.map(basis=>{const source=basis.drawing.displayIntervals?.find(track=>track.id===selected.id);if(!source)throw Error('The material relationship is absent from an active basis.');return transportEndpointPairMaterial(basis.drawing,source,drawing,diagnostics);});
   return {...selected,ranges:selected.ranges.map(range=>{
    const values=transported.map(track=>track.ranges.find(value=>value.id===range.id));if(values.some(value=>!value))throw Error(`Material range ${range.id} has incompatible identity.`);
    return withIntervalPinch({...range,start:blend(values.map(value=>value!.start)),end:blend(values.map(value=>value!.end))},blend(values.map(value=>intervalPinch(value!))));
   })};
  }catch(error){diagnostics.push(`Material ${selected.id}: ${error instanceof Error?error.message:String(error)} The saved discrete material is retained for review.`);return selected;}
 });
 return {drawing:replaceEndpointPairMaterial(drawing,intervals),diagnostics:[...new Set(diagnostics)]};
}
