import {add,sub,length,type Endpoint,type Point2} from '../drawing/model';
import type {SmoothComponent} from '../endpointRelations/smoothComponent';
export {deriveSmoothComponents,smoothEndpointKey,type SmoothRelation,type SmoothMember,type SmoothComponent} from '../endpointRelations/smoothComponent';

export type SmoothComponentInput={node:Point2;handle:Point2;vector?:never}|{node:Point2;vector:Point2;handle?:never};
export interface SmoothComponentControl {endpoint:Endpoint;handle:Point2;vector:Point2}

export const smoothNumericTolerance=(...values:number[]):number=>64*Number.EPSILON*Math.max(1,...values.map(Math.abs));

/** Runtime policy: the stable first member drives, locks do not suppress an
 * authored pose, and degenerate controls report diagnostics. Project ordered
 * component controls with the exact endpoint-pair arithmetic.
 * Vector inputs first reconstruct H=P+vector, then recover H-P. This preserves
 * the rounding and zero-length decisions of scalar-interpolated controls. */
export function projectSmoothComponent(component:SmoothComponent,inputs:readonly SmoothComponentInput[]):{controls:SmoothComponentControl[];diagnostics:string[]} {
 if(inputs.length!==component.members.length||!inputs.length)throw Error('SMOOTH component needs one input for each ordered member.');
 const controls=component.members.map(({endpoint},index)=>{const input=inputs[index],handle=input.handle??add(input.node,input.vector!);return {endpoint,handle,vector:sub(handle,input.node)};}),diagnostics:string[]=[],vector=controls[0].vector,size=length(vector);
 if(component.conflict||size<=smoothNumericTolerance(...vector)){diagnostics.push(`SMOOTH ${component.relationId} has ${component.conflict?'conflicting tangent directions':'a zero-length driver'}; its constraint cannot be resolved.`);return {controls,diagnostics};}
 let projected=false;
 for(let index=0;index<component.members.length;index++){
  const {endpoint,sign}=component.members[index],node=inputs[index].node,old=controls[index].handle,extent=length(sub(old,node));
  if(extent<=smoothNumericTolerance(...old,...node)){diagnostics.push(`SMOOTH ${component.relationId} handle ${endpoint.curveId}/${endpoint.end} has zero length.`);continue;}
  const next=add(node,[vector[0]*extent/size*sign,vector[1]*extent/size*sign]);if(length(sub(next,old))>smoothNumericTolerance(...next,...old))projected=true;
  controls[index]={endpoint,handle:next,vector:sub(next,node)};
 }
 if(projected)diagnostics.push(`SMOOTH ${component.relationId}: dependent handles follow the stable driver direction and their interpolated lengths.`);
 return {controls,diagnostics};
}

/** Apply a correction through the same original-scale component law on both
 * sides: B+s*(P(C/s)-P(B/s)). Node changes remain translations of the result.
 * In exact arithmetic an already-projected baseline B=s*P(B/s) makes this
 * s*P(C/s); retaining B also preserves its existing floating-point residual.
 * This cannot recover original vectors already lost when a short child handle
 * was rounded against a large node. Callers must preserve those source values.
 */
export function projectSmoothComponentCorrection(component:SmoothComponent,baselineInputs:readonly SmoothComponentInput[],correctedInputs:readonly SmoothComponentInput[],scales:readonly number[]):{controls:SmoothComponentControl[];diagnostics:string[]} {
 const count=component.members.length;
 if(!count||baselineInputs.length!==count||correctedInputs.length!==count||scales.length!==count)throw Error('SMOOTH correction needs one baseline, correction, and scale for each ordered member.');
 if(scales.some(scale=>!Number.isFinite(scale)||scale<=0))throw Error('SMOOTH correction scales must be finite and positive.');
 const inputControl=(input:SmoothComponentInput)=>({node:input.node,handle:input.handle??add(input.node,input.vector!),vector:input.vector??sub(input.handle!,input.node)}),baseline=baselineInputs.map(inputControl),corrected=correctedInputs.map(inputControl);
 const originalInputs=(inputs:typeof baseline):SmoothComponentInput[]=>inputs.map((input,index)=>{
  const vector:Point2=[input.vector[0]/scales[index],input.vector[1]/scales[index]];
  if(!vector.every(Number.isFinite))throw Error('SMOOTH correction scale produces a non-finite original vector.');
  return {node:input.node,vector};
 });
 const sameInputs=baseline.every((input,index)=>input.node.every((value,axis)=>value===corrected[index].node[axis])&&input.vector.every((value,axis)=>value===corrected[index].vector[axis]));
 // A zero correction never reprojects or rescales the stored current handles.
 if(sameInputs)return {controls:corrected.map((input,index)=>({endpoint:component.members[index].endpoint,handle:input.handle,vector:sub(input.handle,input.node)})),diagnostics:[]};
 const projectedBaseline=projectSmoothComponent(component,originalInputs(baseline));
 const projectedCorrection=projectSmoothComponent(component,originalInputs(corrected));
 const controls=component.members.map(({endpoint},index)=>{
  const before=projectedBaseline.controls[index].vector,after=projectedCorrection.controls[index].vector,base=baseline[index].vector,scale=scales[index],node=corrected[index].node;
  const handle=add(node,[base[0]+scale*(after[0]-before[0]),base[1]+scale*(after[1]-before[1])]);
  return {endpoint,handle,vector:sub(handle,node)};
 });
 return {controls,diagnostics:projectedCorrection.diagnostics};
}
