import {curveById,objectById,layerFor,parseDrawing,type DrawingDocument} from './model';
import {importArtworkLayers} from './importArtworkLayers';

export interface ObjectDuplicatePlan {sourceLayerId:string;requestedObjectIds:string[];objectIds:string[];additionalObjectIds:string[]}
export class ObjectDuplicateError extends Error {constructor(readonly code:'INVALID_SELECTION'|'CROSS_LAYER_DEPENDENCY'|'OBJECT_DEPENDENCIES',message:string,readonly plan?:ObjectDuplicatePlan){super(message);}}

/** Copy one organizational unit without severing a shared node, relation or fill boundary. */
export function planObjectDuplication(d:DrawingDocument,objectIds:readonly string[]):ObjectDuplicatePlan{
 if(!objectIds.length||new Set(objectIds).size!==objectIds.length||objectIds.some(id=>!objectById(d,id)))throw new ObjectDuplicateError('INVALID_SELECTION','请选择存在且不重复的曲线、填充或偏移对象。');
 const owner=layerFor(d,objectIds[0])!;
 if(objectIds.some(id=>layerFor(d,id)?.id!==owner.id))throw new ObjectDuplicateError('CROSS_LAYER_DEPENDENCY','对象复制须来自同一图层；跨层内容请使用保留依赖关系的图层导入。');
 const selected=new Set(objectIds);
 const include=(id:string)=>{if(layerFor(d,id)?.id!==owner.id)throw new ObjectDuplicateError('CROSS_LAYER_DEPENDENCY',`对象依赖另一图层的 ${id}；请使用保留依赖关系的图层导入。`);selected.add(id);};
 for(;;){
  const previous=selected.size;
  for(const fill of d.fills)if(selected.has(fill.id))fill.boundary.forEach(u=>include(u.id));
  for(const offset of d.offsets)if(selected.has(offset.id))offset.source.forEach(u=>include(u.id));
  const nodes=new Set(d.curves.filter(c=>selected.has(c.id)).flatMap(c=>c.nodes));
  for(const c of d.curves)if(c.nodes.some(id=>nodes.has(id)))include(c.id);
  for(const link of [...d.joins,...(d.endpointLinks??[])])if(selected.has(link.a.curveId)||selected.has(link.b.curveId)){include(link.a.curveId);include(link.b.curveId);}
  for(const group of d.groups??[])if(group.curveIds.some(id=>selected.has(id)))group.curveIds.forEach(include);
  // Complete dependent paint accompanies its copied boundary; unrelated consumers do not.
  for(const fill of d.fills)if(layerFor(d,fill.id)?.id===owner.id&&fill.boundary.every(u=>selected.has(u.id)))include(fill.id);
  for(const offset of d.offsets)if(layerFor(d,offset.id)?.id===owner.id&&offset.source.every(u=>selected.has(u.id)))include(offset.id);
  if(selected.size===previous)break;
 }
 const ordered=owner.items.filter(id=>selected.has(id));
 return {sourceLayerId:owner.id,requestedObjectIds:owner.items.filter(id=>objectIds.includes(id)),objectIds:ordered,additionalObjectIds:ordered.filter(id=>!objectIds.includes(id))};
}

export function duplicateArtworkObjects(d:DrawingDocument,objectIds:readonly string[],options:{targetLayerId?:string;includeDependencies?:boolean}={}){
 const plan=planObjectDuplication(d,objectIds),target=options.targetLayerId??plan.sourceLayerId;
 if(!d.layers.some(l=>l.id===target))throw new ObjectDuplicateError('INVALID_SELECTION','目标图层不存在。');
 if(plan.additionalObjectIds.length&&!options.includeDependencies)throw new ObjectDuplicateError('OBJECT_DEPENDENCIES',`复制还需要关联对象：${plan.additionalObjectIds.join(', ')}。请明确允许 includeDependencies。`,plan);
 const chosen=new Set(plan.objectIds),curves=d.curves.filter(c=>chosen.has(c.id)),nodes=new Set(curves.flatMap(c=>c.nodes)),sourceLayer=d.layers.find(l=>l.id===plan.sourceLayerId)!;
 const fragment:DrawingDocument={version:3,layers:[{...sourceLayer,items:plan.objectIds}],curves,nodes:d.nodes.filter(n=>nodes.has(n.id)),fills:d.fills.filter(f=>chosen.has(f.id)),offsets:d.offsets.filter(o=>chosen.has(o.id)),joins:d.joins.filter(j=>chosen.has(j.a.curveId)&&chosen.has(j.b.curveId)),endpointLinks:(d.endpointLinks??[]).filter(j=>chosen.has(j.a.curveId)&&chosen.has(j.b.curveId)),groups:(d.groups??[]).filter(g=>g.curveIds.every(id=>chosen.has(id))),displayIntervals:(d.displayIntervals??[]).filter(t=>chosen.has(t.anchor.id))};
 const imported=importArtworkLayers(d,fragment,[sourceLayer.id]),temporaryLayerId=imported.importedLayerIds[0],newItems=imported.document.layers.find(l=>l.id===temporaryLayerId)!.items;
 const document=parseDrawing({...imported.document,layers:imported.document.layers.filter(l=>l.id!==temporaryLayerId).map(l=>l.id===target?{...l,items:[...newItems,...l.items]}:l)});
 return {document,plan,objectIds:newItems,curveIds:newItems.filter(id=>!!curveById(document,id)),idMap:{...imported.idMap,[sourceLayer.id]:target}};
}
