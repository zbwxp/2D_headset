import {createSnapshotResponseFieldWeightMapper} from './responseExpressionRegistry';
import {add,type DrawingDocument,type Endpoint,type Point2} from '../drawing/model';
import {applyEndpointPairSmoothConstraints,endpointPairNodeAuthorities} from './endpointPair';
import type {SnapshotExpressionControlResponse,SnapshotExpressionResponses} from './model';
import type {SnapshotScalarTarget} from './simplexGeometry';
import type {SnapshotSimplexLocation,SnapshotTriangulation} from './triangulation';
import type {SmoothComponent} from './smoothComponent';
import {smoothEndpointKey,projectSmoothComponentCorrection,projectSmoothComponent,smoothNumericTolerance} from './smoothComponent';
import {combineSnapshotResponseExpressions,createSnapshotSmoothProjectionExpression,rebaseSnapshotResponseExpression,type SnapshotResponseExpression,type SnapshotResponseExpressionField,type SnapshotSmoothProjectionContract} from './responseExpressions';

export interface SnapshotProjectionComponent {component:SmoothComponent;nodeIds:readonly string[]}
/** Build the original whole component before taking any split combination.
 * Geometric and corrected values are live expressions; no intermediate pose is
 * retained. The original H=P+V arithmetic and thresholds stay in the projector. */
export function captureSnapshotProjectedResponses(mesh:SnapshotTriangulation,location:SnapshotSimplexLocation,components:readonly SnapshotProjectionComponent[],capture:(location:SnapshotSimplexLocation,target:SnapshotScalarTarget,axis:0|1)=>SnapshotResponseExpression,scope:string,inherited?:(target:SnapshotScalarTarget,axis:0|1)=>SnapshotResponseExpression):Map<string,{endpoint:Endpoint;response:SnapshotExpressionControlResponse}> {
 const snapshotByVertex=new Map(mesh.vertices.map(vertex=>[vertex.id,vertex.snapshotId]));
 const field:SnapshotResponseExpressionField={id:JSON.stringify(['projection-baseline',scope,location.simplexId]),vertexIds:[...location.vertexIds],edges:[],samples:[]};
 const baseline=(target:SnapshotScalarTarget,axis:0|1):SnapshotResponseExpression=>({version:1,fields:[field],terms:field.vertexIds.map((vertexId,coordinate)=>({fieldId:field.id,coordinate:coordinate as 0|1|2,weight:'geometric',basis:[{coefficient:1,basis:{snapshotId:snapshotByVertex.get(vertexId)!,target:{...target},axis}}]}))});
 const full=(target:SnapshotScalarTarget,axis:0|1)=>combineSnapshotResponseExpressions([{coefficient:1,expression:baseline(target,axis)},{coefficient:1,expression:capture(location,target,axis)}]);
 const result=new Map<string,{endpoint:Endpoint;response:SnapshotExpressionControlResponse}>(),mapper=createSnapshotResponseFieldWeightMapper(mesh,location);
 for(const {component,nodeIds} of components){
  const existing=component.members.flatMap(({endpoint})=>capture(location,{kind:'handle',...endpoint},0).smoothContracts??[]).find(contract=>contract.targets.length===component.members.length&&contract.targets.every(({endpoint})=>component.members.some(member=>smoothEndpointKey(member.endpoint)===smoothEndpointKey(endpoint))));
  const contract:SnapshotSmoothProjectionContract=existing??{id:JSON.stringify(['smooth-contract',scope,location.simplexId,component.relationId]),component,targets:component.members.map(({endpoint})=>({endpoint:{...endpoint},scale:1}))};
  const ordered=contract.targets.map(({endpoint})=>({endpoint,nodeId:nodeIds[component.members.findIndex(member=>smoothEndpointKey(member.endpoint)===smoothEndpointKey(endpoint))]}));
  const inputs=ordered.map(({endpoint,nodeId})=>({node:([0,1] as const).map(axis=>full({kind:'node',nodeId},axis)) as [SnapshotResponseExpression,SnapshotResponseExpression],vector:([0,1] as const).map(axis=>full({kind:'handle',...endpoint},axis)) as [SnapshotResponseExpression,SnapshotResponseExpression]}));
  const baselineFull=(target:SnapshotScalarTarget,axis:0|1)=>{const expression=inherited?.(target,axis)??capture(location,target,axis),geometric=expression.sourceBaseline?{version:1 as const,fields:expression.fields,terms:expression.sourceBaseline}:baseline(target,axis);return combineSnapshotResponseExpressions([{coefficient:1,expression:geometric},{coefficient:1,expression}]);};
  const baselineInputs=existing?ordered.map(({endpoint,nodeId})=>({node:([0,1] as const).map(axis=>baselineFull({kind:'node',nodeId},axis)) as [SnapshotResponseExpression,SnapshotResponseExpression],vector:([0,1] as const).map(axis=>baselineFull({kind:'handle',...endpoint},axis)) as [SnapshotResponseExpression,SnapshotResponseExpression]})):undefined;
  for(const [{endpoint},member] of ordered.map((value,index)=>[value,index] as const)){
   const target:SnapshotScalarTarget={kind:'handle',...endpoint},response:SnapshotExpressionControlResponse={};
   for(const axis of [0,1] as const){
    const expression=rebaseSnapshotResponseExpression(createSnapshotSmoothProjectionExpression(contract.component,inputs,member,axis,baselineInputs?{baselineInputs,scales:contract.targets.map(target=>target.scale)}:undefined),field,(source,index)=>mapper(source,location.vertexIds.map((_,coordinate)=>coordinate===index?1:0)));
    response[axis===0?'x':'y']={...expression,smoothContracts:[contract]};
   }
   result.set(smoothEndpointKey(endpoint),{endpoint,response});
  }
 }

 return result;
}

/** Retarget only live child endpoints; original component IDs are diagnostic
 * labels, never lookup keys for removed geometry. */
export function remapSnapshotSmoothContracts(expression:SnapshotResponseExpression,split:{curveId:string;childCurveIds:readonly [string,string];t:number}):SnapshotResponseExpression {
 return expression.smoothContracts?{...expression,smoothContracts:expression.smoothContracts.map(contract=>({...contract,targets:contract.targets.map(target=>target.endpoint.curveId===split.curveId?{endpoint:{curveId:split.childCurveIds[target.endpoint.end],end:target.endpoint.end},scale:target.scale*(target.endpoint.end===0?split.t:1-split.t)}:target)}))}:expression;
}
export const snapshotProjectionScalarKey=(target:SnapshotScalarTarget,axis:0|1)=>JSON.stringify([target.kind,target.kind==='node'?target.nodeId:target.curveId,target.kind==='handle'?target.end:null,axis]);
export interface SnapshotProjectionScalarSample {baseline:number;corrected:number;baselineCorners:readonly number[];correctedCorners:readonly number[];weights:readonly number[]}
/** Native corrections remain in the exact same original component frame.
 * Applying a correction of zero returns the projected baseline untouched. */
export function projectSnapshotResponseCorrections(drawing:DrawingDocument,responses:SnapshotExpressionResponses|undefined,samples:ReadonlyMap<string,SnapshotProjectionScalarSample>):{drawing:DrawingDocument;diagnostics:string[]} {
 const contracts=new Map<string,SnapshotSmoothProjectionContract>();
 for(const pair of Object.values(responses?.handles??{}))for(const response of pair)for(const expression of Object.values(response))for(const contract of expression.smoothContracts??[])contracts.set(contract.id,contract);
 if(!contracts.size)return applyEndpointPairSmoothConstraints(drawing);
 const curves=new Map(drawing.curves.map(curve=>[curve.id,curve])),nodes=new Map(drawing.nodes.map(node=>[node.id,node.position])),authorities=endpointPairNodeAuthorities(drawing),owned=new Set<string>(),diagnostics:string[]=[];
 const scalar=(target:SnapshotScalarTarget,axis:0|1,kind:'baseline'|'corrected',fallback:number)=>samples.get(snapshotProjectionScalarKey(target,axis))?.[kind]??fallback;
 for(const contract of contracts.values()){
  if(!contract.targets.every(({endpoint})=>curves.has(endpoint.curveId)))continue;
  const input=(kind:'baseline'|'corrected',corner?:number)=>contract.targets.map(({endpoint})=>{const curve=curves.get(endpoint.curveId)!,nodeId=curve.nodes[endpoint.end],authority=authorities.get(nodeId)??nodeId,node=nodes.get(nodeId)!,handle=curve.handles[endpoint.end];const value=(target:SnapshotScalarTarget,axis:0|1,fallback:number)=>corner===undefined?scalar(target,axis,kind,fallback):samples.get(snapshotProjectionScalarKey(target,axis))?.[kind==='baseline'?'baselineCorners':'correctedCorners'][corner]??fallback;return {node:([0,1] as const).map(axis=>value({kind:'node',nodeId:authority},axis,node[axis])) as Point2,vector:([0,1] as const).map(axis=>value({kind:'handle',...endpoint},axis,handle[axis]-node[axis])) as Point2};});
  const baseline=input('baseline'),corrected=input('corrected'),unchanged=baseline.every((value,index)=>value.node.every((coordinate,axis)=>coordinate===corrected[index].node[axis])&&value.vector.every((coordinate,axis)=>coordinate===corrected[index].vector[axis]));
  contract.targets.forEach(({endpoint})=>owned.add(smoothEndpointKey(endpoint)));
  const cornerChanged=contract.targets.some(({endpoint})=>{const curve=curves.get(endpoint.curveId)!,nodeId=authorities.get(curve.nodes[endpoint.end])??curve.nodes[endpoint.end];return [{kind:'node' as const,nodeId},{kind:'handle' as const,...endpoint}].some(target=>([0,1] as const).some(axis=>{const sample=samples.get(snapshotProjectionScalarKey(target,axis));return sample?.baselineCorners.some((value,index)=>value!==sample.correctedCorners[index]);}));});
  if(unchanged&&!cornerChanged)continue;
  const scales=contract.targets.map(target=>target.scale),projected=projectSmoothComponentCorrection(contract.component,baseline,corrected,scales);diagnostics.push(...projected.diagnostics);
  const weights=samples.get(snapshotProjectionScalarKey({kind:'handle',...contract.targets[0].endpoint},0))?.weights??[];
  const anchorCorrections=weights.map((_,index)=>{const actual=input('corrected',index),projection=projectSmoothComponentCorrection(contract.component,input('baseline',index),actual,scales);return projection.controls.map((control,member)=>control.vector.map((value,axis)=>value-actual[member].vector[axis]) as Point2);});
  contract.targets.forEach(({endpoint},index)=>{const curve=curves.get(endpoint.curveId)!,handles=[...curve.handles] as [Point2,Point2];const vector=projected.controls[index].vector.map((value,axis)=>value-weights.reduce((sum,weight,corner)=>sum+weight*anchorCorrections[corner][index][axis],0)) as Point2;handles[endpoint.end]=add(nodes.get(curve.nodes[endpoint.end])!,vector);curves.set(curve.id,{...curve,handles});});
 }
 const next=applyEndpointPairSmoothConstraints({...drawing,curves:drawing.curves.map(curve=>curves.get(curve.id)!)},owned);
 return {drawing:next.drawing,diagnostics:[...new Set([...diagnostics,...next.diagnostics])]};
}

/** Invert the retained component's length/direction law before solving scalar
 * response weights. Final projected axes are coupled: an unchanged final axis
 * can still require a different raw coordinate when the other axis changes. */
export function unprojectSnapshotResponseTarget(wanted:DrawingDocument,responses:SnapshotExpressionResponses|undefined,samples:ReadonlyMap<string,SnapshotProjectionScalarSample>,available:(target:SnapshotScalarTarget,axis:0|1)=>boolean):DrawingDocument {
 const contracts=new Map<string,SnapshotSmoothProjectionContract>();
 for(const pair of Object.values(responses?.handles??{}))for(const response of pair)for(const expression of Object.values(response))for(const contract of expression.smoothContracts??[])contracts.set(contract.id,contract);
 if(!contracts.size)return wanted;
 const curves=new Map(wanted.curves.map(curve=>[curve.id,curve])),nodes=new Map(wanted.nodes.map(node=>[node.id,node.position])),authorities=endpointPairNodeAuthorities(wanted);
 for(const contract of contracts.values()){
  if(!contract.targets.every(({endpoint})=>curves.has(endpoint.curveId)))continue;
  const input=(kind:'baseline'|'corrected',corner?:number)=>contract.targets.map(({endpoint})=>{
   const curve=curves.get(endpoint.curveId)!,nodeId=curve.nodes[endpoint.end],authority=authorities.get(nodeId)??nodeId,node=nodes.get(nodeId)!,handle=curve.handles[endpoint.end];
   const value=(target:SnapshotScalarTarget,axis:0|1,fallback:number)=>{const sample=samples.get(snapshotProjectionScalarKey(target,axis));return corner===undefined?sample?.[kind]??fallback:sample?.[kind==='baseline'?'baselineCorners':'correctedCorners'][corner]??fallback;};
   return {node:([0,1] as const).map(axis=>value({kind:'node',nodeId:authority},axis,node[axis])) as Point2,vector:([0,1] as const).map(axis=>value({kind:'handle',...endpoint},axis,handle[axis]-node[axis])) as Point2};
  });
  const baseline=input('baseline'),current=input('corrected'),scales=contract.targets.map(target=>target.scale),weights=samples.get(snapshotProjectionScalarKey({kind:'handle',...contract.targets[0].endpoint},0))?.weights??[];
  const projectedBaseline=projectSmoothComponent(contract.component,baseline.map((value,index)=>({node:value.node,vector:value.vector.map(value=>value/scales[index]) as Point2})));
  const anchors=weights.map((_,index)=>{const actual=input('corrected',index),projected=projectSmoothComponentCorrection(contract.component,input('baseline',index),actual,scales);return projected.controls.map((value,member)=>value.vector.map((value,axis)=>value-actual[member].vector[axis]) as Point2);});
  const targets=contract.targets.map(({endpoint},member)=>{const curve=curves.get(endpoint.curveId)!,node=nodes.get(curve.nodes[endpoint.end])!,vector=curve.handles[endpoint.end].map((value,axis)=>value-node[axis]) as Point2;return vector.map((value,axis)=>(value-baseline[member].vector[axis]+weights.reduce((sum,weight,corner)=>sum+weight*anchors[corner][member][axis],0))/scales[member]+projectedBaseline.controls[member].vector[axis]) as Point2;});
  const driver=targets[0],driverLength=Math.hypot(...driver),inactive=contract.component.conflict||driverLength<=smoothNumericTolerance(...driver);
  contract.targets.forEach(({endpoint},member)=>{
   const curve=curves.get(endpoint.curveId)!,node=nodes.get(curve.nodes[endpoint.end])!,target:SnapshotScalarTarget={kind:'handle',...endpoint},scale=scales[member],raw=current[member].vector.map(value=>value/scale) as Point2,wantedVector=targets[member],extent=Math.hypot(...wantedVector),free=([0,1] as const).filter(axis=>available(target,axis));let vector:Point2;
   const unconstrained=member===0||inactive||extent<=smoothNumericTolerance(...node,...add(node,wantedVector));
   if(!unconstrained){const sign=contract.component.members[member].sign,aligned=driver.map(value=>value*extent/driverLength*sign);if(wantedVector.some((value,axis)=>Math.abs(value-aligned[axis])>Math.max(1e-10,8*smoothNumericTolerance(value,aligned[axis]))))throw Error(`SMOOTH ${contract.component.relationId}: the target does not follow its original stable driver.`);}
   if(unconstrained)vector=wantedVector;
   else if(free.length===2){const size=Math.hypot(...raw);vector=size?raw.map(value=>value*extent/size) as Point2:wantedVector;}
   else if(free.length===1){const axis=free[0],fixed=axis===0?1:0,magnitude=Math.abs(raw[fixed]);if(extent+smoothNumericTolerance(extent,magnitude)<magnitude)throw Error(`SMOOTH ${contract.component.relationId}: the requested length cannot preserve its unavailable raw ${fixed===0?'X':'Y'} axis.`);vector=[...raw];const amount=extent===0?0:extent*Math.sqrt(Math.max(0,1-(magnitude/extent)**2));vector[axis]=(raw[axis]<0?-1:raw[axis]>0?1:wantedVector[axis]<0?-1:1)*amount;}
   else {if(Math.abs(Math.hypot(...raw)-extent)>8*smoothNumericTolerance(...raw,extent))throw Error(`SMOOTH ${contract.component.relationId}: the requested length needs an available raw response axis.`);vector=raw;}
   const handles=[...curve.handles] as [Point2,Point2];handles[endpoint.end]=add(node,vector.map(value=>value*scale) as Point2);curves.set(curve.id,{...curve,handles});
  });
 }
 return {...wanted,curves:wanted.curves.map(curve=>curves.get(curve.id)!)};
}
