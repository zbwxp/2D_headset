import {snapshotSupportWeights} from './simplexSupport';
import type {SnapshotMaterialPathLineage} from './materialPathLineages';
import {resolveDisplayRoute} from '../drawing/displayRoutes';
import {createSnapshotMaterialPartitionBasis,snapshotMaterialPartitionAddress,snapshotMaterialPartitionInkEnds,type SnapshotMaterialPartition} from './materialSplit';
import type {DrawingDocument,StrokeDisplayIntervals} from '../drawing/model';
import {intervalPinch,withIntervalPinch} from '../drawing/intervalPinch';
import {retainSnapshotAffines} from './elementPlacement';
import {transportEndpointPairMaterial} from './endpointPairMaterial';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';
import {captureSnapshotResponseField,validateSnapshotResponseExpression} from './responseExpressions';
import {blendSnapshotPropertyValues,effectiveSnapshotPropertyResponses,snapshotScalarPropertyTargetKey,validateSnapshotScalarPropertyTarget} from './propertyResponses';
import {prepareTriangularResponse,type BarycentricWeights,type InteriorResponseSample,type OrientedEdgeResponse} from './triangularResponses';
import type {Angle,SnapshotAngleGraph,SnapshotScalarPropertyTarget} from './model';
import type {SnapshotSimplexBasis} from './simplexGeometry';
import {locateSnapshotSimplex,type SnapshotSimplexLocation,type SnapshotTriangulation} from './triangulation';

/** Retained material supports contain angle coordinates and dimensionless scalar
 * constraints only. A leaf always reads a live real snapshot. An edit leaf is
 * that snapshot's explicitly authored material minus its live inherited recipe,
 * both transported from the SAME real geometry into the current final drawing.
 * There are no saved drawings, material coordinates or sampled trajectories. */
export interface SnapshotMaterialField {
 vertexIds:string[];angles:Angle[];
 properties:{target:SnapshotScalarPropertyTarget;edges:OrientedEdgeResponse[];samples:InteriorResponseSample[]}[];
}
export interface SnapshotMaterialTerm {
 field:SnapshotMaterialField;weight:'response'|'residual'|'geometric';
 bases:{snapshotId:string;kind:'value'|'edit';coefficient:number}[];
}
export interface SnapshotMaterialRecipe {version:1;terms:SnapshotMaterialTerm[]}
export type SnapshotMaterialRecipeRegistry=Record<string,SnapshotMaterialRecipe>;
const fail=(message:string):never=>{throw Error(`Exact material restriction: ${message}`);};
const object=(value:unknown,keys:readonly string[])=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail('expected a plain data object.');
 if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||!keys.includes(key)||!('value' in Object.getOwnPropertyDescriptor(value,key)!)))fail('unknown or accessor recipe field.');
 return value as Record<string,unknown>;
};
const list=(value:unknown,max:number):unknown[]=>{if(!Array.isArray(value)||value.length>max||Array.from({length:value.length},(_,i)=>i).some(i=>!Object.hasOwn(value,i)))return fail('bounded dense array required.');return value;};
const id=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>16384)fail('invalid identifier.');};
export function validateSnapshotMaterialRecipe(value:unknown):asserts value is SnapshotMaterialRecipe {
 const recipe=object(value,['version','terms']);if(recipe.version!==1)fail('unsupported recipe version.');
 let constraints=0;
 for(const raw of list(recipe.terms,256)){
  const term=object(raw,['field','weight','bases']),field=object(term.field,['vertexIds','angles','properties']);
  if(!['response','residual','geometric'].includes(String(term.weight)))fail('invalid weight operation.');
  const vertices=list(field.vertexIds,3);if(vertices.length<2||new Set(vertices).size!==vertices.length)fail('two or three distinct support vertices required.');vertices.forEach(id);
  const angles=list(field.angles,3);if(angles.length!==vertices.length)fail('missing support coordinates.');for(const raw of angles){const a=object(raw,['x','y']);if(![a.x,a.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=90))fail('invalid angle support.');}
  const bases=list(term.bases,3);if(bases.length!==vertices.length)fail('missing live basis.');for(const raw of bases){const basis=object(raw,['snapshotId','kind','coefficient']);id(basis.snapshotId);if(!['value','edit'].includes(String(basis.kind))||typeof basis.coefficient!=='number'||!Number.isFinite(basis.coefficient))fail('invalid live basis leaf.');}
  const targets=new Set<string>();
  for(const raw of list(field.properties,16384)){
   const property=object(raw,['target','edges','samples']);validateSnapshotScalarPropertyTarget(property.target);const key=snapshotScalarPropertyTargetKey(property.target);if(targets.has(key))fail('duplicate property field.');targets.add(key);
   constraints+=list(property.edges,3).reduce<number>((sum,raw)=>sum+list(object(raw,['from','to','knots']).knots??[],256).length,0)+list(property.samples,4096).length;if(constraints>65536)fail('material support limit exceeded.');
   validateSnapshotResponseExpression({version:1,fields:[{id:'material-validation',vertexIds:vertices,edges:property.edges,samples:property.samples}],terms:[]});
  }
  geometricWeights(field as unknown as SnapshotMaterialField,(angles[0] as Angle));
 }
}
export function snapshotMaterialRecipeDependencies(recipe:SnapshotMaterialRecipe):string[]{return [...new Set(recipe.terms.flatMap(term=>term.bases.filter(b=>b.coefficient!==0).map(b=>b.snapshotId)))];}
export function validateSnapshotMaterialRecipeRegistry(value:unknown,mesh:SnapshotTriangulation):asserts value is SnapshotMaterialRecipeRegistry {
 const simplexes=new Set([...mesh.edges,...mesh.triangles].map(s=>s.id)),snapshots=new Set(mesh.vertices.map(v=>v.snapshotId));
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>50000)fail('invalid material registry.');
 for(const [simplex,recipe] of Object.entries(value as Record<string,unknown>)){if(!simplexes.has(simplex))fail('material recipe references a retired simplex.');validateSnapshotMaterialRecipe(recipe);if(snapshotMaterialRecipeDependencies(recipe).some(id=>!snapshots.has(id)))fail('a live material basis was removed; retain or explicitly transfer it before deleting its view.');}
}
export function validateSnapshotMaterialBasisRecipes(value:unknown,mesh:SnapshotTriangulation):asserts value is SnapshotMaterialRecipeRegistry {
 const snapshots=new Set(mesh.vertices.map(v=>v.snapshotId));
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>10000)fail('invalid material basis registry.');
 const registry=value as SnapshotMaterialRecipeRegistry;
 for(const [snapshot,recipe] of Object.entries(registry)){if(!snapshots.has(snapshot))fail('material basis recipe references a removed view.');validateSnapshotMaterialRecipe(recipe);if(snapshotMaterialRecipeDependencies(recipe).some(id=>!snapshots.has(id)))fail('a live material source was removed.');}
 const done=new Set<string>(),visiting=new Set<string>();
 const visit=(id:string)=>{if(visiting.has(id))fail('cyclic material expression dependency.');if(done.has(id))return;visiting.add(id);if(visiting.size>64)fail('material dependency depth exceeds its bounded limit.');for(const source of registry[id]?snapshotMaterialRecipeDependencies(registry[id]):[])visit(source);visiting.delete(id);done.add(id);};
 Object.keys(registry).forEach(visit);
}
export function validateSnapshotMaterialEditLeaves(graph:SnapshotAngleGraph):void {
 for(const recipe of [...Object.values(graph.materialRecipes??{}),...Object.values(graph.materialBasisRecipes??{})])for(const term of recipe.terms)for(const basis of term.bases)if(basis.coefficient!==0&&basis.kind==='edit'&&!Object.hasOwn(graph.materialBasisRecipes??{},basis.snapshotId))fail('an edit leaf needs its Recorder-owned inherited material basis recipe.');
}
function geometricWeights(field:SnapshotMaterialField,at:Angle):number[]{return snapshotSupportWeights(field,at,fail);}
function captureField(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation):SnapshotMaterialField {
 const effective=effectiveSnapshotPropertyResponses(graph,{useDraft:false}),targets=new Map([...Object.values(effective.edges),...Object.values(effective.triangles)].flat().map(value=>[snapshotScalarPropertyTargetKey(value.target),value.target]));
 const properties=[...targets.values()].flatMap(target=>{
  const key=snapshotScalarPropertyTargetKey(target),field=captureSnapshotResponseField('material-field',graph.mesh,location,{edgeKnots:id=>effective.edges[id]?.find(value=>snapshotScalarPropertyTargetKey(value.target)===key)?.knots,triangleSamples:id=>effective.triangles[id]?.find(value=>snapshotScalarPropertyTargetKey(value.target)===key)?.samples});
  return field.edges.length||field.samples.length?[{target:{...target},edges:structuredClone(field.edges) as OrientedEdgeResponse[],samples:structuredClone(field.samples) as InteriorResponseSample[]}]:[];
 });
 const simplex=location.kind==='edge'?graph.mesh.edges.find(s=>s.id===location.simplexId)!:graph.mesh.triangles.find(s=>s.id===location.simplexId)!;
 return {vertexIds:[...simplex.vertexIds],angles:simplex.vertexIds.map(id=>({...graph.mesh.vertices.find(v=>v.id===id)!.angle})),properties};
}
export function captureSnapshotMaterialRecipe(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation):SnapshotMaterialRecipe {
 if(location.kind==='vertex')return fail('a material capture needs an interior support.');
 const inherited=graph.materialRecipes?.[location.simplexId],field=captureField(graph,location),bases=field.vertexIds.map(id=>({snapshotId:graph.mesh.vertices.find(v=>v.id===id)!.snapshotId,kind:'value' as const,coefficient:1}));
 const recipe:SnapshotMaterialRecipe={version:1,terms:[...structuredClone(inherited?.terms??[]),...!inherited||field.properties.length?[{field,weight:inherited?'residual' as const:'response' as const,bases}]:[]]};validateSnapshotMaterialRecipe(recipe);return recipe;
}
export function restrictSnapshotMaterialRecipes(graph:SnapshotAngleGraph,mesh:SnapshotTriangulation,snapshotId:string):SnapshotMaterialRecipeRegistry {
 const registry:SnapshotMaterialRecipeRegistry={};
 for(const simplex of [...mesh.edges,...mesh.triangles]){
  const angles=simplex.vertexIds.map(id=>mesh.vertices.find(v=>v.id===id)!.angle),at={x:angles.reduce((sum,a)=>sum+a.x,0)/angles.length,y:angles.reduce((sum,a)=>sum+a.y,0)/angles.length},old=locateSnapshotSimplex(graph.mesh,at);
  if(!old||old.kind==='vertex')fail('a child simplex has no original material support.');
  const recipe=captureSnapshotMaterialRecipe(graph,old!),newIndex=simplex.vertexIds.findIndex(id=>mesh.vertices.find(v=>v.id===id)!.snapshotId===snapshotId);
  if(newIndex>=0)recipe.terms.push({field:{vertexIds:[...simplex.vertexIds],angles:angles.map(a=>({...a})),properties:[]},weight:'geometric',bases:simplex.vertexIds.map((id,index)=>({snapshotId:mesh.vertices.find(v=>v.id===id)!.snapshotId,kind:'edit',coefficient:index===newIndex?1:0}))});
  validateSnapshotMaterialRecipe(recipe);Object.defineProperty(registry,simplex.id,{value:recipe,enumerable:true});
 }
 return registry;
}
const baselines=new WeakMap<DrawingDocument,DrawingDocument>();
const copyMaterial=(drawing:DrawingDocument,displayIntervals:StrokeDisplayIntervals[])=>{const next={...drawing,displayIntervals};retainSnapshotAffines(next,[drawing]);return retainSnapshotRouteMaterialInput(next,drawing);};
/** Pure material evaluation. Every basis is already resolved; this never runs
 * an angle's geometry, Warp, SMOOTH, coverage, or onion pipeline. */
export function evaluateSnapshotMaterialRecipe(recipe:SnapshotMaterialRecipe,bases:readonly SnapshotSimplexBasis[],drawing:DrawingDocument,at:Angle,partitions?:readonly SnapshotMaterialPartition[],lineages?:readonly SnapshotMaterialPathLineage[]):{drawing:DrawingDocument;diagnostics:string[]} {
 const byId=new Map(bases.map(b=>[b.snapshotId,b.drawing])),diagnostics:string[]=[],transports=new Map<string,StrokeDisplayIntervals>();
 const transported=(snapshotId:string,trackId:string,baseline=false)=>{const key=JSON.stringify([snapshotId,trackId,baseline]);let result=transports.get(key);if(result)return result;const actual=byId.get(snapshotId);if(!actual)fail(`missing live material basis ${snapshotId}.`);const source=baseline?baselines.get(actual!):actual;if(!source)fail(`missing inherited material baseline ${snapshotId}.`);const track=source!.displayIntervals?.find(t=>t.id===trackId);if(!track)fail(`material ${trackId} is absent from live basis ${snapshotId}.`);result=transportEndpointPairMaterial(source!,track!,drawing,diagnostics);transports.set(key,result);return result;};
 const partitionReaders=new Map<string,ReturnType<typeof createSnapshotMaterialPartitionBasis>>();
 const partitionValue=(snapshotId:string,target:SnapshotScalarPropertyTarget,baseline=false)=>{const key=JSON.stringify([snapshotId,baseline]);let read=partitionReaders.get(key);if(!read){const actual=byId.get(snapshotId),source=baseline&&actual?baselines.get(actual):actual;if(!source)fail(`missing live material partition basis ${snapshotId}.`);read=createSnapshotMaterialPartitionBasis(partitions,[{snapshotId,drawing:source!}],drawing,diagnostics,lineages);partitionReaders.set(key,read);}return read(target).values[0];};
 // Local membership loss suspends only the affected display relationship.
 // Its Recorder field remains intact for restoration; never recreate a missing
 // basis track or let another local path stand in for its explicit route.
 const inactive=new Set<string>();
 for(const track of drawing.displayIntervals??[]){
  const partition=partitions?.find(partition=>partition.parts.some(part=>part.sourceTrackId===track.id)),required=partition?partition.parts.map(part=>({id:part.sourceTrackId,ranges:part.ranges.map(range=>range.sourceRangeId)})):[{id:track.id,ranges:track.ranges.map(range=>range.id)}];
  const pathLineage=lineages?.find(lineage=>lineage.sourceTrackId===track.id),pathPieces=pathLineage?.curves.flatMap(curve=>curve.parts.map(part=>part.curveId))??[];
  let reason:string|undefined;
  for(const term of recipe.terms)for(const basis of term.bases){if(!basis.coefficient||reason)continue;const actual=byId.get(basis.snapshotId),sources=basis.kind==='edit'?[actual,actual&&baselines.get(actual)]:[actual];for(const source of sources){if(!source){reason=`live basis ${basis.snapshotId} is unavailable`;break;}if(pathPieces.some(id=>!source.curves.some(curve=>curve.id===id))){reason=`live basis ${basis.snapshotId} no longer supplies the complete path measurement`;break;}for(const item of required){const material=source.displayIntervals?.find(track=>track.id===item.id);if(!material||item.ranges.some(id=>!material.ranges.some(range=>range.id===id))){reason=`live basis ${basis.snapshotId} no longer supplies material ${item.id}`;break;}if(material.displayRoute&&resolveDisplayRoute(source,material.displayRoute,{deferEndpointPositions:true}).diagnostics.length){reason=`live basis ${basis.snapshotId} no longer supplies the complete route ${item.id}`;break;}}if(reason)break;}}
  if(!reason&&pathPieces.some(id=>!drawing.curves.some(curve=>curve.id===id)))reason='a path measurement piece is outside the current membership';
  if(!reason&&track.displayRoute&&resolveDisplayRoute(drawing,track.displayRoute,{deferEndpointPositions:true}).diagnostics.length)reason='its explicit route is outside the current membership';
  if(reason){for(const item of required)inactive.add(item.id);diagnostics.push(`Material ${track.id} is inactive because ${reason}. Its retained field can resume when membership is restored.`);}
 }
 const projectMaterial=createSnapshotMaterialPartitionBasis(partitions,[],drawing,diagnostics,lineages);
 const compiled=recipe.terms.map(term=>({term,geometric:geometricWeights(term.field,at),properties:new Map(term.field.properties.map(property=>[snapshotScalarPropertyTargetKey(property.target),prepareTriangularResponse(property.edges,property.samples)]))}));
 const intervals=(drawing.displayIntervals??[]).filter(track=>!inactive.has(track.id)).map(track=>({...track,ranges:track.ranges.map(range=>{
  const layerId=drawing.layers.find(layer=>layer.items.includes(track.anchor.id))?.id;
  const logicalValues={start:range.start,end:range.end};let closedPath=false;
  const scalar=(end:'start'|'end'|'pinch')=>{
   const target=layerId&&end!=='pinch'?{kind:'interval-endpoint' as const,layerId,sourceTrackId:track.id,rangeId:range.id,end}:undefined,address=target?snapshotMaterialPartitionAddress(partitions,target):undefined,path=lineages?.find(lineage=>lineage.sourceTrackId===track.id),projection=target&&(address||path)?projectMaterial(target):undefined,logical=projection?.target??target;closedPath=!!projection?.closed;
   const result=compiled.reduce((total,{term,geometric,properties})=>{
   const values=term.bases.map(basis=>{if(!basis.coefficient)return 0;if((address||path)&&target){const value=partitionValue(basis.snapshotId,target),baseline=basis.kind==='edit'?partitionValue(basis.snapshotId,target,true):0;return (value-baseline)*basis.coefficient;}const value=transported(basis.snapshotId,track.id).ranges.find(r=>r.id===range.id);if(!value)fail(`material range ${range.id} is absent from ${basis.snapshotId}.`);const read=(r:typeof value)=>end==='pinch'?intervalPinch(r!):r![end];let scalar=read(value);if(basis.kind==='edit'){const baseline=transported(basis.snapshotId,track.id,true).ranges.find(r=>r.id===range.id);if(!baseline)fail('edited material range has no inherited baseline.');scalar-=read(baseline);}return scalar*basis.coefficient;});
   const blend=(weights:readonly number[])=>blendSnapshotPropertyValues(values,weights);
   const ordinary=blend(geometric);if(term.weight==='geometric'||end==='pinch')return total+(term.weight==='residual'?0:ordinary);
   const field=logical&&properties.get(snapshotScalarPropertyTargetKey(logical)),weights=field?field([geometric[0],geometric[1],geometric[2]??0] as BarycentricWeights):geometric;
   let value=blend(weights);if(!Number.isFinite(value)||term.weight==='response'&&(value<0||value>1)){diagnostics.push(`Material ${track.id} range ${range.id} ${end}: the response exceeds its valid 0…1 material range; ordinary interpolation is retained.`);value=ordinary;}
   const next=total+(term.weight==='residual'?value-ordinary:value);
   if(term.weight==='residual'&&(next<0||next>1)){diagnostics.push(`Material ${track.id} range ${range.id} ${end}: the response exceeds its valid 0…1 material range; inherited interpolation is retained.`);return total;}return next;
  },0);if(end!=='pinch')logicalValues[end]=result;return projection?projection.project(result):result;
  };
  let start=scalar('start'),end=scalar('end');if(closedPath&&Math.abs(logicalValues.end-logicalValues.start)>=1-1e-10){start=logicalValues.start;end=logicalValues.end;}const inkEnds=snapshotMaterialPartitionInkEnds(partitions,drawing,track.id,range.id,logicalValues);
  return withIntervalPinch({...range,start,end,...inkEnds?{inkEnds}:{}},scalar('pinch'));
 })}));
 return {drawing:copyMaterial(drawing,intervals),diagnostics:[...new Set(diagnostics)]};
}
/** Apply the live inherited recipe first. Explicit local interval channels stay
 * authoritative. The inherited baseline is runtime-only and invalidates with
 * the already-resolved source basis identities. */
export function applySnapshotMaterialRecipe(recipe:SnapshotMaterialRecipe,at:Angle,bases:readonly SnapshotSimplexBasis[],drawing:DrawingDocument,editedTrackIds:ReadonlySet<string>=new Set(),partitions?:readonly SnapshotMaterialPartition[],lineages?:readonly SnapshotMaterialPathLineage[]):{drawing:DrawingDocument;diagnostics:string[]} {
 const sampled=evaluateSnapshotMaterialRecipe(recipe,bases,drawing,at,partitions,lineages),baseline=sampled.drawing;
 const intervals=baseline.displayIntervals!.map(track=>editedTrackIds.has(track.id)?drawing.displayIntervals!.find(t=>t.id===track.id)??track:track),result=copyMaterial(drawing,intervals);baselines.set(result,baseline);return {...sampled,drawing:result};
}
