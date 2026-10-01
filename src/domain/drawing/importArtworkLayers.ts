import {parseDrawing,uid,type DrawingDocument,type CurveUse,type Endpoint} from './model';

export interface ArtworkLayerDependency {
 kind:'endpointLink'|'fill'|'offset'|'join';
 objectId:string;
 fromLayerId:string;
 requiredLayerId:string;
}
export interface ArtworkLayerImportPlan {
 /** All lists follow source layer order, independent of selection click order. */
 requestedLayerIds:string[];
 layerIds:string[];
 additionalLayerIds:string[];
 dependencies:ArtworkLayerDependency[];
}
export class ArtworkLayerImportError extends Error {
 constructor(readonly code:'INVALID_SOURCE'|'INVALID_TARGET'|'UNKNOWN_LAYER'|'MISSING_DEPENDENCY'|'INVALID_OPTIONS'|'ID_GENERATION_FAILED',message:string){super(message);}
}
export class ArtworkLayerDependencyError extends Error {
 readonly code='LAYER_DEPENDENCIES';
 constructor(readonly plan:ArtworkLayerImportPlan,source:DrawingDocument){
  super(`所选图层还依赖：${plan.additionalLayerIds.map(id=>source.layers.find(l=>l.id===id)!.name).join('、')}。请同时选择这些图层，或明确允许一并导入。`);
 }
}
export interface ImportArtworkLayersOptions {
 /** Opt in to the complete dependency closure. Default rejects extra layers. */
 includeDependencies?:boolean;
 /** Top-first insertion position in target.layers. Default is 0. */
 insertAt?:number;
 /** Tests/integrations may inject a generator; collisions are checked and never reused. */
 idFactory?:()=>string;
}
export interface ImportedArtworkLayers {
 document:DrawingDocument;
 sourceLayerIds:string[];
 additionalLayerIds:string[];
 importedLayerIds:string[];
 importedCurveIds:string[];
 /** Every imported entity, including interval ranges, has a fresh ID. */
 idMap:Record<string,string>;
}
const validDocument=(value:DrawingDocument,kind:'SOURCE'|'TARGET')=>{
 try{return parseDrawing(value);}catch(error){throw new ArtworkLayerImportError(`INVALID_${kind}`,`${kind==='SOURCE'?'来源':'当前'}画稿无效：${(error as Error).message}`);}
};
function plan(source:DrawingDocument,layerIds:readonly string[]):ArtworkLayerImportPlan{
 if(!Array.isArray(layerIds)||layerIds.some(id=>typeof id!=='string'||!id))throw new ArtworkLayerImportError('INVALID_OPTIONS','请选择有效的来源图层 ID。');
 const selected=new Set(layerIds),requested=new Set(layerIds),owners=new Map(source.layers.flatMap(l=>l.items.map(id=>[id,l.id] as const))),curves=new Set(source.curves.map(c=>c.id));
 for(const id of requested)if(!source.layers.some(l=>l.id===id))throw new ArtworkLayerImportError('UNKNOWN_LAYER',`来源图层不存在：${id}`);
 const dependencies:ArtworkLayerDependency[]=[],seen=new Set<string>();
 const requireCurve=(curveId:string,kind:ArtworkLayerDependency['kind'],objectId:string,fromLayerId:string)=>{
  const owner=owners.get(curveId);
  if(!curves.has(curveId)||!owner)throw new ArtworkLayerImportError('MISSING_DEPENDENCY',`来源对象 ${objectId} 引用了不存在的曲线 ${curveId}，请先修复来源画稿。`);
  if(owner!==fromLayerId){
   const key=JSON.stringify([kind,objectId,fromLayerId,owner]);
   if(!seen.has(key)){seen.add(key);dependencies.push({kind,objectId,fromLayerId,requiredLayerId:owner});}
  }
  selected.add(owner);
 };
 for(let size=-1;size!==selected.size;){
  size=selected.size;
  for(const f of source.fills){const owner=owners.get(f.id)!;if(selected.has(owner))for(const use of f.boundary)requireCurve(use.id,'fill',f.id,owner);}
  for(const o of source.offsets){const owner=owners.get(o.id)!;if(selected.has(owner))for(const use of o.source)requireCurve(use.id,'offset',o.id,owner);}
  // Position links cross artwork layers without merging their stroke topology.
  // A partial import must not silently drop that authored coupling.
  for(const link of source.endpointLinks??[]){
   const a=owners.get(link.a.curveId)!,b=owners.get(link.b.curveId)!;
   if(selected.has(a))requireCurve(link.b.curveId,'endpointLink',link.id,a);
   if(selected.has(b))requireCurve(link.a.curveId,'endpointLink',link.id,b);
  }
  for(const join of source.joins){
   const a=owners.get(join.a.curveId)!,b=owners.get(join.b.curveId)!;
   if(selected.has(a))requireCurve(join.b.curveId,'join',join.id,a);
   if(selected.has(b))requireCurve(join.a.curveId,'join',join.id,b);
  }
 }
 const ordered=(set:Set<string>)=>source.layers.filter(l=>set.has(l.id)).map(l=>l.id);
 return {requestedLayerIds:ordered(requested),layerIds:ordered(selected),additionalLayerIds:source.layers.filter(l=>selected.has(l.id)&&!requested.has(l.id)).map(l=>l.id),dependencies};
}
/** Read-only plan for an import confirmation dialog; performs no ID allocation. */
export function planArtworkLayerImport(source:DrawingDocument,layerIds:readonly string[]):ArtworkLayerImportPlan {
 return plan(validDocument(source,'SOURCE'),layerIds);
}
function allIds(d:DrawingDocument):string[]{
 return [...d.layers,...d.curves,...d.nodes,...d.fills,...d.offsets,...d.joins,...(d.groups??[]),...(d.endpointLinks??[]),...(d.displayIntervals??[]),...(d.displayIntervals??[]).flatMap(t=>t.ranges)].map(x=>x.id);
}
/** Pure copy between artworks. The caller owns Drawing-mode gating and the one undo transaction.
 * Source coordinates/names/order/flags are retained; target reference and mirror guide are retained.
 * No source or target object is mutated, and no imported reference resolves to old target geometry.
 */
export function importArtworkLayers(target:DrawingDocument,source:DrawingDocument,layerIds:readonly string[],options:ImportArtworkLayersOptions={}):ImportedArtworkLayers {
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['includeDependencies','insertAt','idFactory'].includes(k))||options.includeDependencies!==undefined&&typeof options.includeDependencies!=='boolean'||options.idFactory!==undefined&&typeof options.idFactory!=='function')throw new ArtworkLayerImportError('INVALID_OPTIONS','图层导入选项无效。');
 const current=validDocument(target,'TARGET'),saved=validDocument(source,'SOURCE'),p=plan(saved,layerIds),insertAt=options.insertAt??0;
 if(!Number.isInteger(insertAt)||insertAt<0||insertAt>current.layers.length)throw new ArtworkLayerImportError('INVALID_OPTIONS','插入位置必须位于当前图层列表中。');
 if(p.additionalLayerIds.length&&!options.includeDependencies)throw new ArtworkLayerDependencyError(p,saved);
 if(!p.layerIds.length)return {document:target,sourceLayerIds:[],additionalLayerIds:[],importedLayerIds:[],importedCurveIds:[],idMap:{}};
 const layers=new Set(p.layerIds),items=new Set(saved.layers.filter(l=>layers.has(l.id)).flatMap(l=>l.items)),curves=saved.curves.filter(c=>items.has(c.id)),curveIds=new Set(curves.map(c=>c.id)),nodes=new Set(curves.flatMap(c=>c.nodes));
 const incoming={
  layers:saved.layers.filter(l=>layers.has(l.id)),curves,nodes:saved.nodes.filter(n=>nodes.has(n.id)),
  fills:saved.fills.filter(f=>items.has(f.id)),offsets:saved.offsets.filter(o=>items.has(o.id)),
  joins:saved.joins.filter(j=>curveIds.has(j.a.curveId)||curveIds.has(j.b.curveId)),
  endpointLinks:(saved.endpointLinks??[]).filter(l=>curveIds.has(l.a.curveId)||curveIds.has(l.b.curveId)),
  groups:(saved.groups??[]).filter(g=>g.curveIds.some(id=>curveIds.has(id))),
  displayIntervals:(saved.displayIntervals??[]).filter(t=>curveIds.has(t.anchor.id)),
 };
 const taken=new Set([...allIds(current),...allIds(saved)]),map=new Map<string,string>(),fresh=options.idFactory??uid;
 for(const entity of [...incoming.layers,...incoming.curves,...incoming.nodes,...incoming.fills,...incoming.offsets,...incoming.joins,...incoming.endpointLinks,...incoming.groups,...incoming.displayIntervals,...incoming.displayIntervals.flatMap(t=>t.ranges)]){
  let id:string|undefined;
  for(let attempt=0;attempt<100;attempt++){
   const candidate=fresh();
   if(typeof candidate!=='string'||!candidate.trim())throw new ArtworkLayerImportError('ID_GENERATION_FAILED','无法生成有效的新对象 ID；没有导入任何内容。');
   if(!taken.has(candidate)){id=candidate;break;}
  }
  if(!id)throw new ArtworkLayerImportError('ID_GENERATION_FAILED','无法生成不冲突的新对象 ID；没有导入任何内容。');
  map.set(entity.id,id);taken.add(id);
 }
 // Stroke traversal uses lexicographic endpoint IDs. Preserve that order when
 // assigning fresh IDs so a copied asymmetric profile keeps its direction.
 const generated=[...map.values()].sort((a,b)=>a.localeCompare(b));
 [...map.keys()].sort((a,b)=>a.localeCompare(b)).forEach((old,index)=>map.set(old,generated[index]));
 const remap=(id:string)=>{const result=map.get(id);if(!result)throw new ArtworkLayerImportError('MISSING_DEPENDENCY',`导入关系缺少对象 ${id}；没有导入任何内容。`);return result;};
 const use=(u:CurveUse):CurveUse=>({...u,id:remap(u.id)}),endpoint=(e:Endpoint):Endpoint=>({...e,curveId:remap(e.curveId)});
 const importedLayers=incoming.layers.map(l=>({...l,id:remap(l.id),items:l.items.map(remap)}));
 const result:DrawingDocument={
  ...current,
  layers:[...current.layers.slice(0,insertAt),...importedLayers,...current.layers.slice(insertAt)],
  nodes:[...current.nodes,...incoming.nodes.map(n=>({...n,id:remap(n.id)}))],
  curves:[...current.curves,...incoming.curves.map(c=>({...c,id:remap(c.id),nodes:c.nodes.map(remap) as [string,string]}))],
  fills:[...current.fills,...incoming.fills.map(f=>({...f,id:remap(f.id),boundary:f.boundary.map(use)}))],
  offsets:[...current.offsets,...incoming.offsets.map(o=>({...o,id:remap(o.id),source:o.source.map(use)}))],
  joins:[...current.joins,...incoming.joins.map(j=>({...j,id:remap(j.id),a:endpoint(j.a),b:endpoint(j.b)}))],
  ...(incoming.endpointLinks.length?{endpointLinks:[...(current.endpointLinks??[]),...incoming.endpointLinks.map(l=>({...l,id:remap(l.id),a:endpoint(l.a),b:endpoint(l.b)}))]}:{}),
  ...(incoming.groups.length?{groups:[...(current.groups??[]),...incoming.groups.map(g=>({...g,id:remap(g.id),curveIds:g.curveIds.map(remap)}))]}:{}),
  ...(incoming.displayIntervals.length?{displayIntervals:[...(current.displayIntervals??[]),...incoming.displayIntervals.map(t=>({...t,id:remap(t.id),anchor:use(t.anchor),ranges:t.ranges.map(r=>({...r,id:remap(r.id)}))}))]}:{}),
 };
 // Includes cross-layer link coincidence, smooth-tangent consistency, ownership,
 // duplicate IDs and every existing DrawingDocument structural invariant.
 const document=parseDrawing(result);
 return {document,sourceLayerIds:p.layerIds,additionalLayerIds:p.additionalLayerIds,importedLayerIds:importedLayers.map(l=>l.id),importedCurveIds:curves.map(c=>remap(c.id)),idMap:Object.fromEntries(map)};
}
