import type {DrawingDocument} from '../drawing/model';
import {retainSnapshotAffines} from './elementPlacement';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';
import {dominantSnapshotBasis,snapshotSupportWeights} from './simplexSupport';
import type {Angle,SnapshotAngleGraph,SnapshotDeformationState} from './model';
import {locateSnapshotSimplex,type SnapshotSimplexLocation,type SnapshotTriangulation} from './triangulation';

/** Only source addresses and original angle supports are persisted. Visibility
 * values always come from live real views; no boolean or drawing is captured. */
export interface SnapshotVisibilitySupport {vertexIds:string[];angles:Angle[];snapshotIds:string[]}
export interface SnapshotVisibilityRecipe {
 version:1;
 source:SnapshotVisibilitySupport;
 /** Each insertion adds one local edit selector on its then-current child.
  * Later subdivisions retain those selectors unchanged. */
 edits:{support:SnapshotVisibilitySupport;snapshotId:string}[];
}
export type SnapshotVisibilityRecipeRegistry=Record<string,SnapshotVisibilityRecipe>;
export interface SnapshotVisibilityBasis {snapshotId:string;drawing:DrawingDocument;state:SnapshotDeformationState}
const fail=(message:string):never=>{throw Error(`Exact visibility restriction: ${message}`);};
const object=(value:unknown,allowed?:readonly string[])=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail('expected a plain data object.');
 if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||allowed&&!allowed.includes(key)||!('value' in Object.getOwnPropertyDescriptor(value,key)!)))fail('unknown or accessor recipe field.');
 return value as Record<string,unknown>;
};
const list=(value:unknown,max:number):unknown[]=>{if(!Array.isArray(value)||value.length>max||Array.from({length:value.length},(_,i)=>i).some(i=>!Object.hasOwn(value,i)))return fail('bounded dense array required.');return value;};
const id=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>16384)fail('invalid identifier.');};
function validateSupport(value:unknown):asserts value is SnapshotVisibilitySupport {
 const support=object(value,['vertexIds','angles','snapshotIds']),vertices=list(support.vertexIds,3),snapshots=list(support.snapshotIds,3),angles=list(support.angles,3);
 if(vertices.length<2||new Set(vertices).size!==vertices.length||snapshots.length!==vertices.length||new Set(snapshots).size!==snapshots.length||angles.length!==vertices.length)fail('two or three distinct live support vertices required.');
 vertices.forEach(id);snapshots.forEach(id);for(const raw of angles){const a=object(raw,['x','y']);if(![a.x,a.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=90))fail('invalid angle support.');}
 snapshotSupportWeights(value as SnapshotVisibilitySupport,angles[0] as Angle,fail);
}
export function validateSnapshotVisibilityRecipe(value:unknown):asserts value is SnapshotVisibilityRecipe {
 const recipe=object(value,['version','source','edits']);if(recipe.version!==1)fail('unsupported recipe version.');validateSupport(recipe.source);
 for(const raw of list(recipe.edits,256)){const edit=object(raw,['support','snapshotId']);validateSupport(edit.support);id(edit.snapshotId);if(!edit.support.snapshotIds.includes(edit.snapshotId as string))fail('edit owner is outside its support.');}
}
export function snapshotVisibilityRecipeDependencies(recipe:SnapshotVisibilityRecipe):string[]{return [...new Set([...recipe.source.snapshotIds,...recipe.edits.map(edit=>edit.snapshotId)])];}
export function validateSnapshotVisibilityRecipes(value:unknown,mesh:SnapshotTriangulation,basis=false):asserts value is SnapshotVisibilityRecipeRegistry {
 const registry=object(value),snapshots=new Set(mesh.vertices.map(v=>v.snapshotId)),simplexes=new Set([...mesh.edges,...mesh.triangles].map(s=>s.id));if(Object.keys(registry).length>(basis?10000:50000))fail('registry limit exceeded.');
 for(const [key,recipe] of Object.entries(registry)){
  id(key);if(!(basis?snapshots:simplexes).has(key))fail('recipe references a removed view or simplex.');validateSnapshotVisibilityRecipe(recipe);
  if(snapshotVisibilityRecipeDependencies(recipe).some(id=>!snapshots.has(id)))fail('a live visibility source was removed.');
  for(const edit of recipe.edits)if(edit.support.snapshotIds.some(id=>!snapshots.has(id)))fail('an edit selector references a removed view.');
 }
 if(!basis)return;
 const done=new Set<string>(),visiting=new Set<string>();
 const visit=(id:string)=>{if(visiting.has(id))fail('cyclic visibility dependency.');if(done.has(id))return;visiting.add(id);if(visiting.size>64)fail('visibility dependency depth exceeds its bounded limit.');for(const source of Object.hasOwn(registry,id)?snapshotVisibilityRecipeDependencies(registry[id] as SnapshotVisibilityRecipe):[])visit(source);visiting.delete(id);done.add(id);};
 Object.keys(registry).forEach(visit);
}
function captureSupport(mesh:SnapshotTriangulation,vertexIds:readonly string[]):SnapshotVisibilitySupport {
 const vertices=vertexIds.map(id=>mesh.vertices.find(v=>v.id===id)!);return {vertexIds:[...vertexIds],angles:vertices.map(v=>({...v.angle})),snapshotIds:vertices.map(v=>v.snapshotId)};
}
export function captureSnapshotVisibilityRecipe(graph:SnapshotAngleGraph,location:SnapshotSimplexLocation):SnapshotVisibilityRecipe {
 if(location.kind==='vertex')return fail('a visibility capture needs an interior support.');
 const inherited=graph.visibilityRecipes?.[location.simplexId];return inherited?structuredClone(inherited):{version:1,source:captureSupport(graph.mesh,location.vertexIds),edits:[]};
}
export function restrictSnapshotVisibilityRecipes(graph:SnapshotAngleGraph,mesh:SnapshotTriangulation,snapshotId:string):SnapshotVisibilityRecipeRegistry {
 return Object.fromEntries([...mesh.edges,...mesh.triangles].map(simplex=>{
  const support=captureSupport(mesh,simplex.vertexIds),at={x:support.angles.reduce((sum,a)=>sum+a.x,0)/support.angles.length,y:support.angles.reduce((sum,a)=>sum+a.y,0)/support.angles.length},old=locateSnapshotSimplex(graph.mesh,at);
  if(!old||old.kind==='vertex')return fail('a child simplex has no original visibility support.');
  const recipe=captureSnapshotVisibilityRecipe(graph,old);if(support.snapshotIds.includes(snapshotId))recipe.edits.push({support,snapshotId});validateSnapshotVisibilityRecipe(recipe);return [simplex.id,recipe];
 }));
}
const selected=(support:SnapshotVisibilitySupport,at:Angle)=>support.snapshotIds[dominantSnapshotBasis(support.snapshotIds.map((snapshotId,index)=>({snapshotId,angle:support.angles[index]})),snapshotSupportWeights(support,at,fail))];
function copyVisibility(drawing:DrawingDocument,value:(id:string,visible:boolean)=>boolean):DrawingDocument {
 const next={...drawing,curves:drawing.curves.map(item=>({...item,visible:value(item.id,item.visible)})),fills:drawing.fills.map(item=>({...item,visible:value(item.id,item.visible)})),offsets:drawing.offsets.map(item=>({...item,visible:value(item.id,item.visible)}))};
 retainSnapshotAffines(next,[drawing]);return retainSnapshotRouteMaterialInput(next,drawing);
}
/** Existing membership and all geometry/material remain authoritative. A layer
 * false gates members; true/null cannot revive a source-hidden member. */
export function applySnapshotVisibilityState(drawing:DrawingDocument,state:SnapshotDeformationState):DrawingDocument {
 const owner=new Map(drawing.layers.flatMap(layer=>layer.items.map(id=>[id,layer.id] as const)));
 return copyVisibility(drawing,(id,visible)=>{const layerId=owner.get(id),flags=layerId===undefined?undefined:state.layers[layerId]?.visibility;return flags?.[layerId!]!==false&&(flags?.[id]??visible);});
}
export function evaluateSnapshotVisibilityRecipe(recipe:SnapshotVisibilityRecipe,bases:readonly SnapshotVisibilityBasis[],drawing:DrawingDocument,at:Angle):DrawingDocument {
 const byId=new Map(bases.map(base=>[base.snapshotId,base])),source=byId.get(selected(recipe.source,at));if(!source)return fail('missing live visibility basis.');
 const flags=new Map([...source.drawing.curves,...source.drawing.fills,...source.drawing.offsets].map(item=>[item.id,item.visible]));
 let result=copyVisibility(drawing,(id,visible)=>flags.get(id)??visible);
 for(const edit of recipe.edits)if(selected(edit.support,at)===edit.snapshotId){const basis=byId.get(edit.snapshotId);if(!basis)return fail('missing local visibility edit basis.');result=applySnapshotVisibilityState(result,basis.state);}
 return result;
}
/** Retired selectors carry no element IDs. Source object deletion therefore
 * needs no shadow-data cleanup and can never recreate a removed member. */
export function pruneSnapshotVisibilityRecipes(graph:SnapshotAngleGraph,mesh:SnapshotTriangulation):Pick<SnapshotAngleGraph,'visibilityRecipes'|'visibilityBasisRecipes'> {
 const snapshots=new Set(mesh.vertices.map(v=>v.snapshotId)),simplexes=new Set([...mesh.edges,...mesh.triangles].map(s=>s.id));
 const active=(recipe:SnapshotVisibilityRecipe)=>snapshotVisibilityRecipeDependencies(recipe).every(id=>snapshots.has(id))&&recipe.edits.every(edit=>edit.support.snapshotIds.every(id=>snapshots.has(id)));
 return {...graph.visibilityRecipes?{visibilityRecipes:Object.fromEntries(Object.entries(graph.visibilityRecipes).filter(([id,recipe])=>simplexes.has(id)&&active(recipe)))}:{},...graph.visibilityBasisRecipes?{visibilityBasisRecipes:Object.fromEntries(Object.entries(graph.visibilityBasisRecipes).filter(([id,recipe])=>snapshots.has(id)&&active(recipe)))}:{}};
}
