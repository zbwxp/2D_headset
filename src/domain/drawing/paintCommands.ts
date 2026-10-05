import {DEFAULT_FILL_MIST,validFillMist,validDepthAppearance} from './model';
import {groupFor,uid,curveById,shapeOf,layerFor,objectById,editable,length,sub,finitePoint,validInkEnds,validContourMist,DEFAULT_PEN_TAPER_SCALE,type CurveUse,type DrawingDocument as Doc,type InkStyle,type InkEndStyle,type InkEnds,type FillRegion,type OffsetRelation} from './model';
import {groupObjectIds,selectionUnit,orderGroups} from './groups';
import {normalizeOrder,strokeFor,strokeIds,strokeObjectIds,paintItems,strokePaths,layerTree} from './strokes';
import {resolveUses,offsetGeometry} from './appearance';
import {createCurve,connect,moveToLayer} from './commands';
const requireObject=(d:Doc,id:string)=>{const o=objectById(d,id),l=layerFor(d,id);if(!o||!l||o.locked)throw Error('关联对象已隐藏或锁定，无法修改。');return o;};
const usesFor=(d:Doc,id:string)=>strokePaths(strokeFor(d,id)).find(p=>p.segments.some(x=>x.id===id))!.segments.map(x=>({...x}));
export function setInk(d:Doc,ids:string[],change:InkStyle&{inkVisible?:boolean}):Doc{
 const all=change.inkVisible!==undefined?ids:[...new Set(ids.flatMap(id=>strokeIds(strokeFor(d,id))))];all.forEach(id=>{if(!editable(d,id))throw Error('关联对象已隐藏或锁定，无法修改。');});
 return {...d,curves:d.curves.map(c=>all.includes(c.id)?{...c,...change}:c)};
}
export function setInkEnd(d:Doc,id:string,end:0|1,change:InkEndStyle):Doc{
 const object=curveById(d,id)??d.offsets.find(o=>o.id===id);if(!object)return d;requireObject(d,id);if(!object.visible)throw Error('关联对象已隐藏或锁定，无法修改。');
 const ends=object.inkEnds??[{},{}],inkEnds:InkEnds=[{...ends[0]},{...ends[1]}];inkEnds[end]={...inkEnds[end],...change};
 if(Object.hasOwn(change,'taper'))delete inkEnds[end].taperWidthScale;
 if(!validInkEnds(inkEnds))throw Error('收尖距离须为 0–5000 px，延伸距离须为 0–500 px。');
 if(JSON.stringify(inkEnds)===JSON.stringify(ends))return d;
 return {...d,curves:d.curves.map(c=>c.id===id?{...c,inkEnds}:c),offsets:d.offsets.map(o=>o.id===id?{...o,inkEnds}:o)};
}
/** First opt-in starts uniform, ignoring dormant Pen defaults saved at old joins. */
export function enableInteriorInkEnd(d:Doc,id:string,end:0|1,enabled:boolean):Doc{
 const c=curveById(d,id);if(!c)return d;const previous=c.inkEnds?.[end];
 return setInkEnd(d,id,end,enabled&&previous?.interior===undefined?{interior:true,taper:0,extension:0}:{interior:enabled});
}
/** Orders exactly one closed boundary. Multiple loops/ambiguous branches are refused. */
export function closedBoundary(d:Doc,ids:string[]):CurveUse[]{
 if(!ids.length)throw Error('请选择形成闭环的边界曲线。');
 const rest=[...new Set(ids)];if(rest.some(id=>!curveById(d,id)))throw Error('请选择形成闭环的边界曲线。');
 const uses:CurveUse[]=[{id:rest.shift()!,reverse:false}],first=shapeOf(d,uses[0].id)[0];let end=shapeOf(d,uses[0].id)[3];
 while(rest.length){const candidates=rest.flatMap(id=>[0,1].filter(e=>length(sub(shapeOf(d,id)[e?3:0],end))<1e-7).map(e=>({id,reverse:!!e})));
  if(candidates.length!==1)throw Error('边界未闭合，或存在分支。请只选择一个闭环。');const next=candidates[0];uses.push(next);rest.splice(rest.indexOf(next.id),1);end=shapeOf(d,next.id)[next.reverse?0:3];
 }
 if(length(sub(end,first))>1e-7)throw Error('边界未闭合或已断开。');return uses;
}
export function createFill(d:Doc,ids:string[],color:FillRegion['color'],kind:'SOLID'|'MIST'='SOLID'):Doc{
 if(kind==='MIST'&&color==='transparent')throw Error('透明挖空不能同时使用雾化填充。');
 const boundary=closedBoundary(d,ids),layer=layerFor(d,ids[0])!;
 if(ids.some(id=>layerFor(d,id)?.id!==layer.id))throw Error('连接仅支持同一图层。');ids.forEach(id=>requireObject(d,id));
 const id=uid(),fill:FillRegion={id,name:`${color==='white'?'白色':color==='black'?'黑色':'透明'}填充 ${d.fills.length+1}`,color,boundary,visible:true,locked:false,...(kind==='MIST'?{mist:{...DEFAULT_FILL_MIST}}:{})};
 if(kind==='MIST')fill.name=`雾化填充 ${d.fills.length+1}`;
 // A new fill starts immediately behind all of its boundary strokes.
 const at=Math.max(...ids.flatMap(id=>strokeIds(strokeFor(d,id))).map(id=>layer.items.indexOf(id)))+1,items=[...layer.items];items.splice(at,0,id);
 return orderGroups({...d,fills:[...d.fills,fill],layers:d.layers.map(l=>l.id===layer.id?{...l,items}:l)});
}
export function createOffset(d:Doc,id:string):Doc{
 requireObject(d,id);const source=usesFor(d,id),resolved=resolveUses(d,source);if(resolved.error)throw Error(resolved.error);
 const layer=layerFor(d,id)!,newId=uid(),o:OffsetRelation={id:newId,name:`偏移线 ${d.offsets.length+1}`,visible:true,locked:false,source,distance:.012,start:.2,end:.85,taper:.18,width:curveById(d,id).width*.65,inkEnds:[{taperWidthScale:DEFAULT_PEN_TAPER_SCALE},{taperWidthScale:DEFAULT_PEN_TAPER_SCALE}]};
 return {...d,offsets:[...d.offsets,o],layers:d.layers.map(l=>l===layer?{...l,items:[newId,...l.items]}:l)};
}
export function changePaint(d:Doc,id:string,change:Partial<FillRegion&OffsetRelation>):Doc{
 const o=objectById(d,id),l=layerFor(d,id);if(!o||!l)return d;if(o.locked&&Object.keys(change).some(k=>k!=='visible'&&k!=='locked'))throw Error('对象已锁定。');
 if(change.name!==undefined&&!change.name.trim())return d;
 if(d.fills.some(f=>f.id===id)){
  if(change.color!==undefined&&!['white','black','transparent'].includes(change.color))return d;
  const next={...d.fills.find(f=>f.id===id)!,...change};
  if(!validDepthAppearance(next))throw Error('深度偏移须为整数。');
  if(next.color==='transparent'&&(Object.hasOwn(change,'depthOffset')||Object.hasOwn(change,'depthScope')))throw Error('透明挖空不支持深度偏移。');
  if(next.color==='transparent'&&next.mist?.enabled)next.mist={...next.mist,enabled:false};
  if(!validFillMist(next.mist))throw Error('雾化填充参数无效。');
  return {...d,fills:d.fills.map(f=>f.id===id?next:f)};
 }
 const offset=d.offsets.find(o=>o.id===id);if(!offset)return d;const next={...offset,...change};
 if(!validContourMist(next.mist)||next.translation!==undefined&&!finitePoint(next.translation)||!validInkEnds(next.inkEnds)||![next.distance,next.start,next.end,next.taper,next.width].every(Number.isFinite)||Math.abs(next.distance)>2||next.start<0||next.end>1||next.start>=next.end||next.taper<0||next.taper>.5||next.width<=0||next.width>1)throw Error('偏移参数无效：起点必须小于终点。');
 return {...d,offsets:d.offsets.map(o=>o.id===id?next:o)};
}
export function deletePaint(d:Doc,id:string):Doc{requireObject(d,id);return {...d,fills:d.fills.filter(x=>x.id!==id),offsets:d.offsets.filter(x=>x.id!==id),layers:d.layers.map(l=>({...l,items:l.items.filter(x=>x!==id)}))};}
export function reorderPaint(d:Doc,id:string,target:string,after=false):Doc{
 id=d.groups?.find(g=>g.id===id)?.curveIds[0]??id;target=d.groups?.find(g=>g.id===target)?.curveIds[0]??target;
 const l=layerFor(d,id);if(!l||l.id!==layerFor(d,target)?.id)return d;
 const container=groupFor(d,id),targetGroup=groupFor(d,target),isStroke=!!curveById(d,id),group=container?groupObjectIds(d,container):isStroke?strokeObjectIds(d,strokeFor(d,id)):[id];
 const other=targetGroup?groupObjectIds(d,targetGroup):curveById(d,target)?(isStroke?strokeObjectIds(d,strokeFor(d,target)):strokeIds(strokeFor(d,target))):[target];if(group.some(id=>other.includes(id)))return d;
 group.forEach(id=>requireObject(d,id));const items=l.items.filter(id=>!group.includes(id)),at=after?Math.max(...other.map(id=>items.indexOf(id)))+1:Math.min(...other.map(id=>items.indexOf(id)));items.splice(at,0,...group);
 return {...d,layers:d.layers.map(x=>x.id===l.id?{...l,items}:x)};
}
export function movePaint(d:Doc,id:string,target:string):Doc{
 requireObject(d,id);const layer=d.layers.find(l=>l.id===target);if(!layer)throw Error('请先新建绘制层。');
 return {...d,layers:d.layers.map(l=>({...l,items:l.id===target?[id,...l.items.filter(x=>x!==id)]:l.items.filter(x=>x!==id)}))};
}
/** One transaction for a sidebar drop: move the complete stroke plus its fills,
 * then optionally insert before/after a target item. Offset/fill rows remain movable. */
export function dropPaint(d:Doc,id:string,targetLayer:string,targetItem?:string,after=false):Doc{
 id=d.groups?.find(g=>g.id===id)?.curveIds[0]??id;targetItem=d.groups?.find(g=>g.id===targetItem)?.curveIds[0]??targetItem;
 if(!objectById(d,id)||targetItem&&layerFor(d,targetItem)?.id!==targetLayer)return d;
 if(curveById(d,id)&&targetItem)targetItem=layerTree(d,targetLayer).find(item=>item.fills.includes(targetItem!))?.id??targetItem;
 let n=d;
 if(layerFor(d,id)?.id!==targetLayer)n=curveById(d,id)?moveToLayer(d,selectionUnit(d,id),targetLayer):movePaint(d,id,targetLayer);
 return targetItem?reorderPaint(n,id,targetItem,after):n;
}
export function detachOffset(d:Doc,id:string):{document:Doc;ids:string[]}{
 requireObject(d,id);const o=d.offsets.find(o=>o.id===id);if(!o)throw Error('偏移线不存在。');const g=offsetGeometry(d,o);if(g.error)throw Error(g.error);const layer=layerFor(d,id)!;let n=deletePaint(d,id);const ids:string[]=[];
 for(const shape of g.shapes){const cid=uid();ids.push(cid);n=createCurve(n,layer.id,shape,o.width,`${o.name} · ${ids.length}`,cid);}
 for(let i=1;i<ids.length;i++)n=connect(n,{curveId:ids[i-1],end:1},{curveId:ids[i],end:0},'SMOOTH');
 if(o.inkEnds){n=setInkEnd(n,ids[0],0,o.inkEnds[0]);n=setInkEnd(n,ids.at(-1)!,1,o.inkEnds[1]);}
 const stroke=strokeFor(n,ids[0]),reversed=stroke.segments[0].id!==ids[0]||stroke.segments[0].reverse;n=setInk(n,ids,{profile:o.profile,profileReverse:!!o.profileReverse!==reversed});
 if(o.mist)n={...n,curves:n.curves.map(c=>ids.includes(c.id)?{...c,mist:{...o.mist!}}:c)};
 n={...n,layers:n.layers.map(l=>l.id===layer.id?{...l,items:layer.items.flatMap(x=>x===id?strokeIds(stroke):[x])}:l)};
 return {document:normalizeOrder(n),ids};
}
