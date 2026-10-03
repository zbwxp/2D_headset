import {hasEvaluatedDeformation,hasEvaluatedDeformationFor,retainEvaluatedDeformations} from '../drawing/evaluatedDeformation';
import {add,sub,type DrawingDocument,type DrawingCurve,type Point2} from '../drawing/model';
import {cleanEndpointLinks} from '../drawing/endpointLinks';
import {evaluatedAffine,evaluatedAffineSource,registerEvaluatedAffine} from '../drawing/evaluatedAffine';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';
import type {SnapshotDiagnostic} from './model';

/** Local shared-node topology. Keys remain live source node identities; values
 * name their sole retained authority in this Snapshot. No geometry is stored. */
export type SnapshotNodeAliases=Record<string,string>;
export class SnapshotNodeAliasError extends Error {constructor(readonly code:string,message:string){super(message);this.name='SnapshotNodeAliasError';}}
const fail=(code:string,message:string):never=>{throw new SnapshotNodeAliasError(code,message);};
const validId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=16384;
export function normalizeSnapshotNodeAliases(value:SnapshotNodeAliases):SnapshotNodeAliases {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>65536)return fail('INVALID_NODE_ALIAS','Snapshot node aliases must be a bounded node-ID map.');
 const result:SnapshotNodeAliases=Object.create(null);
 for(const start of Object.keys(value)){
  if(Object.hasOwn(result,start))continue;const path:string[]=[],visiting=new Set<string>();let id=start;
  while(Object.hasOwn(value,id)&&!Object.hasOwn(result,id)){
   const next=value[id];if(!validId(id)||!validId(next)||next===id||visiting.has(id))return fail('INVALID_NODE_ALIAS','Snapshot node aliases must have valid, distinct IDs and no authority cycle.');
   path.push(id);visiting.add(id);id=next;
  }
  const authority=Object.hasOwn(result,id)?result[id]:id;for(const node of path)result[node]=authority;
 }
 return {...result};
}
export const snapshotNodeAuthority=(aliases:SnapshotNodeAliases|undefined,id:string):string=>aliases&&Object.hasOwn(aliases,id)?aliases[id]:id;
export function mergeSnapshotNodeAliases(before:SnapshotNodeAliases|undefined,added:SnapshotNodeAliases):SnapshotNodeAliases|undefined {
 const result=normalizeSnapshotNodeAliases({...before,...added});return Object.keys(result).length?result:undefined;
}
export function pruneSnapshotNodeAliases(aliases:SnapshotNodeAliases|undefined,removed:ReadonlySet<string>):SnapshotNodeAliases|undefined {
 if(!aliases)return aliases;const result=Object.fromEntries(Object.entries(normalizeSnapshotNodeAliases(aliases)).filter(([id,authority])=>!removed.has(id)&&!removed.has(authority)));return Object.keys(result).length?result:undefined;
}
function aliasDrawing(drawing:DrawingDocument,aliases:SnapshotNodeAliases):DrawingDocument {
 const nodes=new Map(drawing.nodes.map(node=>[node.id,node])),authority=(id:string)=>snapshotNodeAuthority(aliases,id);
 return {...drawing,nodes:drawing.nodes.filter(node=>authority(node.id)===node.id),curves:drawing.curves.map(curve=>{
  if(curve.nodes.every(id=>authority(id)===id))return curve;
  return {...curve,nodes:curve.nodes.map(authority) as [string,string],handles:curve.handles.map((point,end)=>add(point,sub(nodes.get(authority(curve.nodes[end]))!.position,nodes.get(curve.nodes[end])!.position))) as [Point2,Point2]};
 })};
}
/** Evaluate the same relative-handle translation as Drawing's true node merge.
 * Unavailable membership leaves an explicit alias inactive; permanent source
 * deletion retires it through the normal source-dependency transaction. */
export function applySnapshotNodeAliases(drawing:DrawingDocument,value:SnapshotNodeAliases|undefined,diagnostics:SnapshotDiagnostic[],snapshotId:string):DrawingDocument {
 if(!value||!Object.keys(value).length)return drawing;
 const normalized=normalizeSnapshotNodeAliases(value),nodes=new Set(drawing.nodes.map(node=>node.id)),aliases:SnapshotNodeAliases={};
 for(const [id,authority] of Object.entries(normalized)){
  if(nodes.has(id)&&nodes.has(authority))Object.defineProperty(aliases,id,{value:authority,enumerable:true});
  else diagnostics.push({code:'MISSING_ELEMENT',snapshotId,elementId:id,message:`Shared-node alias ${id} → ${authority} is inactive because one source node is outside this Snapshot's membership.`});
 }
 if(!Object.keys(aliases).length)return drawing;
 if(hasEvaluatedDeformation(drawing)&&Object.entries(aliases).some(([id,authority])=>hasEvaluatedDeformationFor(drawing,id)||hasEvaluatedDeformationFor(drawing,authority)))return fail('NODE_ALIAS_MATERIAL_CONFLICT','Binding controls inside a retained cage needs a post-domain topology target. Disable or reset the affected cage first; no source or Snapshot was changed.');
 const result=cleanEndpointLinks(aliasDrawing(drawing,aliases)),material=evaluatedAffineSource(drawing);
 retainEvaluatedDeformations(result,[drawing]);
 if(material){
  const mapped=cleanEndpointLinks(aliasDrawing(material,aliases)),mappedNodes=new Map(mapped.nodes.map(node=>[node.id,node])),mappedCurves=new Map(mapped.curves.map(curve=>[curve.id,curve]));
  const close=(a:Point2,b:Point2)=>a.every((v,i)=>Math.abs(v-b[i])<=1e-9*Math.max(1,Math.abs(v),Math.abs(b[i])));
  for(const curve of result.curves){const affine=evaluatedAffine(drawing,curve.id);if(!affine)continue;const base=mappedCurves.get(curve.id)!;
   for(const end of [0,1] as const){const expectedNode=result.nodes.find(node=>node.id===curve.nodes[end])!;if(!close(affine.point(mappedNodes.get(base.nodes[end])!.position),expectedNode.position)||!close(affine.point(base.handles[end]),curve.handles[end]))return fail('NODE_ALIAS_MATERIAL_CONFLICT',`Curve ${curve.id} cannot share this node across its inherited material placement. Use a common layer domain before binding; no topology was changed.`);}
  }
  registerEvaluatedAffine(result,mapped,id=>evaluatedAffine(drawing,id));
 }
 return retainSnapshotRouteMaterialInput(result,drawing);
}

/** Adapt Drawing's already chosen shared-node groups to canonical inherited
 * authorities. A locally created node may yield to an inherited ID. Merging
 * two inherited IDs records an alias; splitting an inherited node still needs
 * an explicit topology operation and cannot masquerade as an identity swap. */
export function prepareSnapshotNodeMerge(before:DrawingDocument,target:DrawingDocument,owned:ReadonlySet<string>,prior:SnapshotNodeAliases|undefined,forkNodeIds:ReadonlySet<string>=new Set()):{drawing:DrawingDocument;aliases:SnapshotNodeAliases|undefined} {
 const candidates=new Map<string,Set<string>>(),destinations=new Map<string,Set<string>>(),known=new Set(before.nodes.map(node=>node.id));
 for(const curve of before.curves){if(owned.has(curve.id))continue;const next=target.curves.find(value=>value.id===curve.id);if(!next)continue;
  for(const end of [0,1] as const){const wanted=next.nodes[end],old=curve.nodes[end];const sources=candidates.get(wanted)??new Set<string>();sources.add(old);candidates.set(wanted,sources);const uses=destinations.get(old)??new Set<string>();if(!forkNodeIds.has(wanted))uses.add(wanted);destinations.set(old,uses);}
 }
 for(const [id,uses] of destinations)if(uses.size>1)return fail('INHERITED_NODE_SPLIT_REQUIRED',`Inherited node ${id} would split into separate local nodes. Use an explicit local split/unbind topology operation; no source or Snapshot was changed.`);
 const identities=new Map<string,string>(),added:SnapshotNodeAliases={};
 for(const [wanted,sources] of candidates){
  if(forkNodeIds.has(wanted)){identities.set(wanted,wanted);continue;}
  if(!known.has(wanted)&&!target.curves.some(curve=>!before.curves.some(value=>value.id===curve.id)&&curve.nodes.includes(wanted)))return fail('INHERITED_NODE_REPLACEMENT_REQUIRED',`Inherited node identity cannot be replaced by ${wanted} without an explicit local topology operation.`);
  const authority=sources.has(wanted)?wanted:[...sources][0];identities.set(wanted,authority);for(const id of sources)if(id!==authority)Object.defineProperty(added,id,{value:authority,enumerable:true});
 }
 const map=(id:string)=>identities.get(id)??id,nodes=new Map<string,DrawingDocument['nodes'][number]>();
 for(const node of target.nodes){const id=map(node.id),old=nodes.get(id);if(old&&old.position.some((v,i)=>Math.abs(v-node.position[i])>1e-8))return fail('INHERITED_TOPOLOGY_CONFLICT','The requested shared node has conflicting endpoint positions.');nodes.set(id,{...node,id});}
 return {drawing:{...target,nodes:[...nodes.values()],curves:target.curves.map(curve=>({...curve,nodes:curve.nodes.map(map) as DrawingCurve['nodes']}))},aliases:mergeSnapshotNodeAliases(prior,added)};
}
