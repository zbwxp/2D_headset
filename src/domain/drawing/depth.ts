import {resolveDisplayRoute} from './displayRoutes';
import {InputCache} from '../geometry/cache';
import {curveById,layerFor,groupFor,objectById,type DrawingDocument as Doc} from './model';
import {strokeFor,strokeIds,strokeObjectIds,strokeName,paintItems,layerTree,type PaintItem} from './strokes';
import {groupTree,groupObjectIds} from './groups';
import {strokeInk,strokeEnds,extendedInk,type InkRun,type InkSampling} from './appearance';
import type {InkEnds} from './model';
import {partitionedUses} from './roundedJoin';
import type {Stroke} from './strokes';
export type DepthScope='PARENT'|'LAYER';
interface Container {id:string;name:string;ids:string[]}
const layerContainer=(d:Doc,id:string):Container=>{const l=d.layers.find(l=>l.id===id)!;return {id:l.id,name:l.name,ids:l.items};};
/** Reference only structural siblings: hidden/folded objects still occupy slots.
 * Never follow another curve's offset, so crossing overrides cannot form cycles. */
export function depthContext(d:Doc,id:string,scope:DepthScope=curveById(d,id)?.depthScope??'PARENT'){
 const layer=layerFor(d,id)!,stroke=strokeFor(d,id),group=groupFor(d,id);
 let siblings:Container[],parent:string;
 const asItem=(item:ReturnType<typeof layerTree>[number]):Container=>({id:item.id,name:item.stroke?strokeName(d,item.stroke):objectById(d,item.id)!.name,ids:item.stroke?strokeObjectIds(d,item.stroke):[item.id]});
 if(scope==='LAYER'){siblings=d.layers.map(l=>layerContainer(d,l.id));parent=layer.id;}
 else if(stroke.segments.length>1||curveById(d,id).strokeName||layerTree(d,layer.id).find(x=>x.id===stroke.id)?.fills.length){
  siblings=group?layerTree(d,layer.id).filter(x=>groupFor(d,x.id)?.id===group.id).map(asItem):groupTree(d,layer.id).map(e=>e.group?{id:e.id,name:e.group.name,ids:groupObjectIds(d,e.group)}:asItem(e.item!));parent=stroke.id;
 }else if(group){siblings=groupTree(d,layer.id).map(e=>e.group?{id:e.id,name:e.group.name,ids:groupObjectIds(d,e.group)}:asItem(e.item!));parent=group.id;}
 else{siblings=d.layers.map(l=>layerContainer(d,l.id));parent=layer.id;}
 const index=siblings.findIndex(s=>s.id===parent),value=curveById(d,id).depthOffset??0,targetIndex=Math.max(0,Math.min(siblings.length-1,index-value));
 return {scope,siblings,parent:siblings[index],index,target:siblings[targetIndex],effective:index-targetIndex,min:index-(siblings.length-1),max:index};
}
export function setDepthOffset(d:Doc,id:string,value:number,scope:DepthScope=curveById(d,id)?.depthScope??'PARENT'):Doc{
 const c=curveById(d,id);if(!c)return d;if(c.locked)throw Error('对象已锁定。');
 if(!Number.isSafeInteger(value)||Math.abs(value)>10000||!['PARENT','LAYER'].includes(scope))throw Error('深度偏移须为整数。');
 if((c.depthOffset??0)===value&&(c.depthScope??'PARENT')===scope)return d;
 return {...d,curves:d.curves.map(x=>x===c?{...c,depthOffset:value,depthScope:scope}:x)};
}
/** Dragging within a stroke changes list/ink order, never traversal or ownership. */
export function reorderCurveMember(d:Doc,id:string,target:string,after=false):Doc{
 const a=curveById(d,id),b=curveById(d,target);if(!a||!b||id===target||strokeFor(d,id)!==strokeFor(d,target))return d;
 if(a.locked)throw Error('对象已锁定。');const l=layerFor(d,id)!,items=l.items.filter(x=>x!==id),index=items.indexOf(target);items.splice(index+(after?1:0),0,id);
 if(items.every((x,i)=>x===l.items[i]))return d;
 const members=new Set(strokeIds(strokeFor(d,id)));
 return {...d,curves:d.curves.map(c=>members.has(c.id)?{...c,localPaintOrder:true}:c),layers:d.layers.map(x=>x===l?{...l,items}:x)};
}
export interface PaintBatch {layerId:string;item:PaintItem;owner?:string;position:number}
/** Position is a derived number, never a stored layer index. Top first. */
const paintPlans=new InputCache<PaintBatch[]>(64);
export function depthPaintBatches(d:Doc):PaintBatch[]{
 // IDs/order/connectivity only: a new interpolated frame reuses this plan.
 // Value keys also catch in-place command drafts; no document/history retained.
 const routed=new Set((d.displayIntervals??[]).flatMap(t=>t.displayRoute?resolveDisplayRoute(d,t.displayRoute).path.segments.map(u=>u.id):[]));
 const key=JSON.stringify([[...routed],d.layers.map(l=>[l.id,l.items]),d.curves.map(c=>[c.id,c.nodes,!!c.strokeName,c.depthOffset??0,c.depthScope??'PARENT',!!c.localPaintOrder]),d.joins.map(j=>[j.a,j.b]),d.fills.map(f=>[f.id,f.boundary]),d.offsets.map(o=>o.id),d.groups?.map(g=>[g.id,g.curveIds])]);
 const cached=paintPlans.get(key);if(cached)return cached;
 let cursor=0;const base:PaintBatch[]=[],positions=new Map<string,number>(),layerSlots=new Map<string,number>();
 for(const layer of d.layers){layerSlots.set(layer.id,cursor);for(const item of paintItems(d,layer.id)){
  if(item.stroke){const ids=new Set(strokeIds(item.stroke));for(const id of layer.items.filter(id=>ids.has(id))){positions.set(id,cursor);base.push({layerId:layer.id,item,owner:id,position:cursor++});}}
  else{positions.set(item.id,cursor);base.push({layerId:layer.id,item,position:cursor++});}
 }cursor++;}
 const affected=new Set(d.curves.filter(c=>c.depthOffset||c.localPaintOrder||routed.has(c.id)).map(c=>strokeFor(d,c.id).id)),out:PaintBatch[]=[],seen=new Set<string>();
 for(const b of base){
  if(!b.owner){out.push(b);continue;}
  if(!affected.has(b.item.id)){if(!seen.has(b.item.id)){out.push({...b,owner:undefined});seen.add(b.item.id);}continue;}
  const context=depthContext(d,b.owner),offset=curveById(d,b.owner).depthOffset??0;
  if(!offset||!context.effective){out.push(b);continue;}
  const target=context.target.ids.map(id=>positions.get(id)).filter((x):x is number=>x!==undefined);
  out.push({...b,position:!target.length?(layerSlots.get(context.target.id)??b.position):offset>0?Math.min(...target)-.5:Math.max(...target)+.5});
 }
 return paintPlans.set(key,out.sort((a,b)=>a.position-b.position||(positions.get(a.owner??a.item.id)!-positions.get(b.owner??b.item.id)!)));
}

/** Measure/taper the entire path first, then assign its ink to source members.
 * A sharp join is painted once with the foreground side; an ARC is split at its
 * arc midpoint. Neither operation changes the source geometry or fill boundary. */
export function memberInk(d:Doc,s:Stroke,positions:ReadonlyMap<string,number>,sampling?:InkSampling):Map<string,InkRun[]>{
 const pieces=partitionedUses(d,s.segments,s.closed).pieces,result=new Map<string,InkRun[]>();
 const owner=(index:number)=>pieces[index].inkOwner!;
 for(const run of strokeInk(d,s,undefined,true,sampling)){
  const extensions=run.extensions??[];
  for(const f of run.fragments??[]){
   const a=owner(f.pieceIndex),b=f.jointWith===undefined?a:owner(f.jointWith),id=(positions.get(a)??0)<=(positions.get(b)??0)?a:b;
   const list=result.get(id)??[];
   list.push({shapes:f.shapes,outline:f.outline,tips:f.tips,uniform:run.uniform&&f.jointWith===undefined,closed:false,clipped:run.clipped});result.set(id,list);
  }
  for(const e of extensions){const list=result.get(owner(e.pieceIndex));if(list?.length)(list[0].extensions??=[]).push(e);}
 }
 if(!s.closed){const ends=strokeEnds(d,s),extensions=extendedInk(pieces.map(p=>p.shape),ends.map(e=>e.style) as InkEnds).extensions;
  for(const e of extensions){const list=result.get(ends[e.end].endpoint.curveId);if(list?.length)(list[0].extensions??=[]).push({shape:e.shape,pieceIndex:e.end?pieces.length-1:0});}
 }
 return result;
}
