import {add,sub,length,type DrawingDocument,type Endpoint,type Point2} from '../drawing/model';

const key=(endpoint:Endpoint)=>JSON.stringify([endpoint.curveId,endpoint.end]);
const tolerance=(...points:Point2[])=>64*Number.EPSILON*Math.max(1,...points.flat().map(Math.abs));
/** Resolve each explicit SMOOTH component once. Affine targets keep their exact
 * controls; only boundary followers inherit direction and retain their length.
 * The driver is deterministic and independent of the selected-curve order. */
export function projectSnapshotTransformTargets(before:DrawingDocument,target:DrawingDocument):DrawingDocument {
 const relations=[...target.joins.filter(join=>join.mode==='SMOOTH'),...(target.endpointLinks??[]).filter(link=>link.joinBrush?.kind==='SMOOTH')].sort((a,b)=>a.id.localeCompare(b.id));
 if(!relations.length)return target;
 const nodes=new Map(target.nodes.map(node=>[node.id,node.position])),priorNodes=new Map(before.nodes.map(node=>[node.id,node.position])),priorCurves=new Map(before.curves.map(curve=>[curve.id,curve])),curves=new Map(target.curves.map(curve=>[curve.id,curve]));
 const vector=(endpoint:Endpoint)=>{const curve=curves.get(endpoint.curveId)!;return sub(curve.handles[endpoint.end],nodes.get(curve.nodes[endpoint.end])!);};
 const changed=(endpoint:Endpoint)=>{const curve=priorCurves.get(endpoint.curveId)!,prior=sub(curve.handles[endpoint.end],priorNodes.get(curve.nodes[endpoint.end])!),next=vector(endpoint);return length(sub(prior,next))>tolerance(prior,next);};
 const graph=new Map<string,Endpoint[]>(),done=new Set<string>(),replacements=new Map<string,[Point2,Point2]>();
 for(const relation of relations)for(const [a,b] of [[relation.a,relation.b],[relation.b,relation.a]])graph.set(key(a),[...(graph.get(key(a))??[]),b]);
 for(const relation of relations){
  if(done.has(key(relation.a)))continue;
  const queue=[{endpoint:relation.a,sign:1}],members=new Map([[key(relation.a),queue[0]]]);let conflict=false;
  for(const member of queue){done.add(key(member.endpoint));for(const other of graph.get(key(member.endpoint))??[]){const known=members.get(key(other));if(known){if(known.sign!==-member.sign)conflict=true;}else{const next={endpoint:other,sign:-member.sign};members.set(key(other),next);queue.push(next);}}}
  const explicit=queue.filter(member=>changed(member.endpoint)).sort((a,b)=>key(a.endpoint).localeCompare(key(b.endpoint)));if(!explicit.length)continue;
  if(conflict)throw Error(`SMOOTH ${relation.id} requests conflicting handle directions.`);
  const driver=explicit.find(member=>key(member.endpoint)===key(relation.a))??explicit[0],direction=vector(driver.endpoint),size=length(direction);
  // Match Drawing transform/A authoring's existing minimum handle length.
  if(size<1e-7)throw Error(`SMOOTH ${relation.id} driver is below the existing authoring minimum handle length.`);
  const explicitKeys=new Set(explicit.map(member=>key(member.endpoint)));
  for(const {endpoint,sign} of queue){
   const curve=curves.get(endpoint.curveId)!,node=nodes.get(curve.nodes[endpoint.end])!,old=curve.handles[endpoint.end],extent=length(sub(old,node));
   if(extent<1e-7)throw Error(`SMOOTH ${relation.id} handle ${endpoint.curveId} end ${endpoint.end} is below the existing authoring minimum handle length.`);
   const projected=add(node,[direction[0]*extent/size*sign/driver.sign,direction[1]*extent/size*sign/driver.sign]);
   if(explicitKeys.has(key(endpoint))){if(length(sub(projected,old))>1e-7)throw Error(`SMOOTH ${relation.id} has incompatible transformed handle targets.`);continue;}
   if(length(sub(projected,old))<=tolerance(projected,old))continue;
   if(curve.locked)throw Error('关联对象已锁定，无法修改。');
   let handles=replacements.get(curve.id);if(!handles){handles=curve.handles.map(point=>[...point]) as [Point2,Point2];replacements.set(curve.id,handles);}handles[endpoint.end]=projected;
  }
 }
 return replacements.size?{...target,curves:target.curves.map(curve=>replacements.has(curve.id)?{...curve,handles:replacements.get(curve.id)!}:curve)}:target;
}
