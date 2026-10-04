import type {DrawingDocument} from '../drawing/model';
import type {Angle,SnapshotAngleGraph} from './model';
import type {SnapshotSimplexBasis} from './simplexGeometry';
import {snapshotSupportWeights} from './simplexSupport';
import {createSnapshotResponseBasisResolver} from './responseExpressionRegistry';
import {createSnapshotFitParameterCollector} from './responseFitParameterRanges';
import {recordSnapshotSplitParameterResolvers,type SnapshotSplitParameterResolver} from './splitParameterField';
import {extractSnapshotResponseOperation,prepareSnapshotResponseExpression,snapshotResponseExpressionBasisReferences,snapshotResponseExpressionFitParameters,type SnapshotResponseExpression,type SnapshotResponseExpressionField,type SnapshotResponseOperation} from './responseExpressions';

const fail=(message:string):never=>{throw Error(`Inherited fitted material: ${message}`);};
/** A new real view owns ordinary controls but still evaluates its inherited
 * material field. Recover the same q programs from the retained scalar DAG,
 * using only already resolved source bases. No old geometry or q is persisted. */
export function applySnapshotInheritedFitParameters(graph:SnapshotAngleGraph,snapshotId:string,at:Angle,bases:readonly SnapshotSimplexBasis[],drawing:DrawingDocument):DrawingDocument {
 const available=new Set(bases.map(basis=>basis.snapshotId)),vertices=new Map(graph.mesh.vertices.map(vertex=>[vertex.id,vertex.angle])),basisScalar=createSnapshotResponseBasisResolver(bases),collector=createSnapshotFitParameterCollector(),seen=new Set<string>(),inherited:SnapshotSplitParameterResolver[]=[];
 const geometricWeights=(field:SnapshotResponseExpressionField)=>snapshotSupportWeights({angles:field.vertexIds.map(id=>vertices.get(id)??fail(`missing support vertex ${id}.`))},at,fail);
 const expressions=Object.values(graph.responseExpressions??{}).flatMap(responses=>[...Object.values(responses.nodes),...Object.values(responses.handles).flat()].flatMap(control=>Object.values(control) as SnapshotResponseExpression[]));
 for(const expression of expressions)for(const program of [expression.operations,expression.sourceBaselineOperations])for(const [index,operation] of (program??[]).entries()){
  if(operation.kind!=='curve-material-parameter'||!operation.domain)continue;
  const field=expression.fields.find(field=>field.id===operation.fieldId)!;
  try{geometricWeights(field);}catch{continue;}
  const candidate=extractSnapshotResponseOperation({version:1,fields:expression.fields,terms:[],operations:program},index),controls=snapshotResponseExpressionBasisReferences(candidate),parameters=snapshotResponseExpressionFitParameters(candidate),references=[...controls,...parameters];
  if(references.some(reference=>reference.snapshotId===snapshotId||!available.has(reference.snapshotId)))continue;
  // The frozen-source topology transaction rebases real poses before its last
  // step transfers scalar leaves to the new IDs. Such retired dependencies
  // cannot supply a current inherited frame during that unpublished stage.
  if(controls.some(reference=>basisScalar(reference)===undefined)||parameters.some(reference=>basisScalar.fitParameter?.(reference)===undefined))continue;
  const key=JSON.stringify([operation.domain,operation.fieldId,candidate.operations]);if(seen.has(key))continue;seen.add(key);
  const sample=prepareSnapshotResponseExpression(candidate),q=sample({basisScalar,geometricWeights,recordFitParameter:collector.record});collector.record(operation.domain,q);
  const root=candidate.operations!.at(-1)!;if(root.kind!=='curve-material-parameter')return fail('the extracted scalar root is not a material parameter.');
  const parameterLeaves=root.parameters.map(index=>candidate.operations![index]);if(parameterLeaves.some(leaf=>leaf.kind!=='fit-parameter'))return fail('a retained parameter root has no direct live basis cuts.');
  const values=new Map<number,number>([[0,0],[1,1],[operation.domain.t,q]]);
  const resolver:SnapshotSplitParameterResolver={parts:operation.domain.parts,parameterAt(t){
   const known=values.get(t);if(known!==undefined)return known;
   // Append new parameter leaves. The original leaves used by the parent
   // reconstruction keep their original split t and shared ownership.
   const operations:SnapshotResponseOperation[]=[...candidate.operations!.slice(0,-1)],parameters=parameterLeaves.map(leaf=>{if(leaf.kind!=='fit-parameter')return fail('missing parameter leaf.');const index=operations.length;operations.push({...leaf,reference:{...leaf.reference,t}});return index;});
   operations.push({...root,parameters,domain:{...operation.domain!,t}});
   const value=prepareSnapshotResponseExpression({version:1,fields:candidate.fields,terms:[],operations})({basisScalar,geometricWeights});values.set(t,value);return value;
  }};inherited.push(resolver);
  // A subsequent source split adds native boundaries to this same original
  // field. Evaluate them from its callable recipe rather than depending on a
  // newer split program that may legitimately reference this real view.
  for(const part of operation.domain.parts.slice(0,-1))collector.record({parts:operation.domain.parts,t:part.parameterRange[1]},resolver.parameterAt(part.parameterRange[1]));
 }
 if(!inherited.length)return drawing;
 collector.apply(drawing);recordSnapshotSplitParameterResolvers(drawing,inherited);return drawing;
}
