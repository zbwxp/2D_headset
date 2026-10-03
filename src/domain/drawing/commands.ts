import type {DrawingMaterialSourceResolver} from './pathMaterialSupport';
import {pruneMirrorEditingMetadata} from './mirrorCommands';
import {reconcileGroups,transformable} from './groups';
import {setObjectState} from './objectState';
import {groupFor,DEFAULT_PEN_TAPER_SCALE,MAX_PEN_TAPER_SCALE} from './model';
import {linkedNodeIds,followLinkedNodes,cleanEndpointLinks} from './endpointLinks';
import {roundedJoins} from './roundedJoin';
import {retainDisplayIntervals,splitDisplayIntervals,displayRouteFor} from './displayIntervals';
import {split} from '../geometry/bezier';
import {assertCurveSplitIntent,type CurveSplitIntent} from './layerEditIntent';
import {add,sub,mul,length,finitePoint,uid,objectById,nodeAt,curveById,shapeOf,layerFor,members,joinAt,sameEnd,editable,type DrawingDocument as Doc,type DrawingCurve,type DrawingLayer,type Endpoint,type Point2,type Cubic,type TangentJoin} from './model';
import {normalizeOrder,strokeFor,strokeIds,strokeObjectIds,strokes,strokePaths} from './strokes';
export class RelatedSelection extends Error {constructor(public ids:string[]){super('本次操作会影响未选中的关联曲线。');}}
const copy=(d:Doc):Doc=>({...d,fills:[...d.fills],layers:d.layers.map(l=>({...l,items:[...l.items]})),curves:d.curves.map(c=>({...c,nodes:[...c.nodes],handles:c.handles.map(p=>[...p]) as [Point2,Point2]})),nodes:d.nodes.map(n=>({...n,position:[...n.position]})),joins:d.joins.map(j=>({...j,a:{...j.a},b:{...j.b}}))});
const check=(d:Doc,ids:string[],allowHidden=false)=>{if(ids.some(id=>allowHidden?!curveById(d,id)||curveById(d,id).locked:!editable(d,id)))throw Error('关联对象已隐藏或锁定，无法修改。');};
const requireLayer=(d:Doc,id:string)=>{const l=d.layers.find(l=>l.id===id);if(!l)throw Error('请先新建绘制层。');return l;};
const clean=(d:Doc):Doc=>reconcileGroups(cleanEndpointLinks({...d,nodes:d.nodes.filter(n=>d.curves.some(c=>c.nodes.includes(n.id))),joins:d.joins.filter(j=>[j.a,j.b].every(e=>d.curves.some(c=>c.id===e.curveId)))}));
const nextName=(names:string[],base:string)=>{let i=1;while(names.includes(`${base}${i}`))i++;return `${base}${i}`;};
export function addLayer(d:Doc,name=nextName(d.layers.map(l=>l.name),'图层')):Doc{return {...d,layers:[{id:uid(),name,visible:true,locked:false,items:[]},...d.layers]};}
export function layerChange(d:Doc,id:string,change:Partial<Pick<DrawingLayer,'name'|'visible'|'locked'>>):Doc{
 const l=d.layers.find(l=>l.id===id);if(!l)return d;
 if(change.name!==undefined&&!change.name.trim())return d;
 const n=setObjectState(d,l.items,{visible:change.visible,locked:change.locked});
 return change.name!==undefined&&change.name!==l.name?{...n,layers:n.layers.map(x=>x.id===id?{...x,name:change.name!}:x)}:n;
}
export function curveChange(d:Doc,id:string,change:Partial<Pick<DrawingCurve,'name'|'visible'|'locked'>>):Doc{
 const c=curveById(d,id);if(!c)return d;
 if(c.locked&&change.name!==undefined)throw Error('对象已锁定。');
 if(change.name!==undefined&&!change.name.trim())return d;
 if(Object.entries(change).every(([k,v])=>c[k as keyof DrawingCurve]===v))return d;
 return {...d,curves:d.curves.map(x=>x===c?{...c,...change}:x)};
}
export function createCurve(d:Doc,layerId:string,shape:Cubic,width=.008,name?:string,id:string=uid()):Doc{
 requireLayer(d,layerId);if(!Number.isFinite(width)||width<=0||width>1)throw Error('线宽无效。');if(!shape.every(finitePoint))throw Error('曲线坐标无效。');
 const nodes:[string,string]=[uid(),uid()];
 return {...d,nodes:[...d.nodes,...nodes.map((id,i)=>({id,position:[...shape[i?3:0]] as Point2}))],curves:[...d.curves,{id,name:name??nextName(d.curves.map(c=>c.name),'曲线'),nodes,handles:[[...shape[1]],[...shape[2]]],visible:true,locked:false,width}],layers:d.layers.map(l=>l.id===layerId?{...l,items:[id,...l.items]}:l)};
}
/** New Pen authoring only. Loading, splitting, copying and ellipses keep their own ink. */
export function createPenCurve(d:Doc,layerId:string,shape:Cubic,width=.008,id:string=uid(),taperScale=DEFAULT_PEN_TAPER_SCALE):Doc{
 if(!Number.isFinite(taperScale)||taperScale<0||taperScale>MAX_PEN_TAPER_SCALE)throw Error('请输入 0–200 之间的倍数。');
 const n=createCurve(d,layerId,shape,width,undefined,id);
 // These defaults are only read at an open stroke's outer ends. Joined interior
 // ends remain uniform; creating a new segment never activates an interior tip.
 return {...n,curves:n.curves.map(c=>c.id===id?{...c,inkEnds:[{taperWidthScale:taperScale},{taperWidthScale:taperScale}]}:c)};
}
export function relatedIds(d:Doc,ids:string[]):string[]{const nodes=new Set(ids.flatMap(id=>curveById(d,id)?.nodes??[]));return d.curves.filter(c=>c.nodes.some(n=>nodes.has(n))).map(c=>c.id);}
function checkScope(d:Doc,ids:string[],allowRelated:boolean,allowHidden=false){const needed=relatedIds(d,ids);if(needed.some(id=>allowHidden?curveById(d,id).locked:!transformable(d,id,ids)))throw Error('关联对象已隐藏或锁定，无法修改。');if(!allowRelated&&needed.some(id=>!ids.includes(id)))throw new RelatedSelection(needed);return needed;}
const changedShapes=(d:Doc,n:Doc,ids=d.curves.map(c=>c.id))=>ids.filter(id=>{const before=shapeOf(d,id),after=shapeOf(n,id);return before.some((p,i)=>length(sub(p,after[i]))>1e-12);});
/** Partial neighbours receive only the affected node/handle transform, never a
 * recursive whole-curve transform. This limits expansion to the actual edit. */
export function transform(d:Doc,ids:string[],map:(p:Point2)=>Point2,allowRelated=false,allowHidden=false):Doc{
 if(!ids.length)return d;checkScope(d,ids,allowRelated,allowHidden);const n=copy(d),selected=new Set(ids),nodes=new Set(ids.flatMap(id=>curveById(d,id).nodes));
 for(const node of n.nodes)if(nodes.has(node.id))node.position=map(node.position);
 for(const c of n.curves)for(const e of [0,1] as const)if(selected.has(c.id)||nodes.has(c.nodes[e]))c.handles[e]=map(c.handles[e]);
 for(const j of n.joins)if(j.mode==='ARC'&&selected.has(j.a.curveId)&&selected.has(j.b.curveId)){const p=nodeAt(d,j.a).position,q=map(p),r=j.radius!,sx=length(sub(map(add(p,[r,0])),q))/r,sy=length(sub(map(add(p,[0,r])),q))/r;j.radius=Math.min(2,r*Math.sqrt(sx*sy));}
 if(n.nodes.some(x=>!finitePoint(x.position))||n.curves.some(c=>!c.handles.every(finitePoint)))throw Error('变换数值无效。');
 for(const j of n.joins)if(j.mode!=='CUSP')for(const e of [j.a,j.b])if(length(sub(curveById(n,e.curveId).handles[e.end],nodeAt(n,e).position))<1e-7)throw Error('变换会使连接柄退化。');
 const linked=followLinkedNodes(d,n,nodes,allowHidden);return JSON.stringify(linked)===JSON.stringify(d)?d:linked;
}
export function moveNode(d:Doc,nodeId:string,position:Point2,allowHidden=false):Doc{
 if(!finitePoint(position))return d;const node=d.nodes.find(n=>n.id===nodeId);if(!node||length(sub(position,node.position))<1e-12)return d;
 const nodes=linkedNodeIds(d,nodeId),group=d.curves.filter(c=>c.nodes.some(id=>nodes.has(id)));check(d,group.map(c=>c.id),allowHidden);const n=copy(d);
 for(const id of nodes){const old=d.nodes.find(n=>n.id===id)!,delta=sub(position,old.position);n.nodes.find(x=>x.id===id)!.position=[...position];
  for(const e of members(d,id)){const c=curveById(n,e.curveId);c.handles[e.end]=add(c.handles[e.end],delta);}}
 return n;
}
/** Two clicks: keep A, move B and its linked endpoints, then couple the positions. */
export function linkEndpoints(d:Doc,a:Endpoint,b:Endpoint,preserveAuthoredBrush=false):Doc{
 if(sameEnd(a,b))throw Error('请选择另一个端点。');const na=nodeAt(d,a),nb=nodeAt(d,b);
 if(linkedNodeIds(d,na.id).has(nb.id))return d;
 check(d,[...linkedNodeIds(d,na.id),...linkedNodeIds(d,nb.id)].flatMap(id=>members(d,id).map(e=>e.curveId)));
 const moved=moveNode(d,nb.id,na.position),n={...moved,endpointLinks:[...(moved.endpointLinks??[]),{id:uid(),a:{...a},b:{...b}}]};
 // New structured authoring preserves authored 末端笔触. Any connected-line
 // suppression belongs to derived rendering; legacy UI behavior stays opt-in here.
 return preserveAuthoredBrush?n:clearConnectedInk(n,new Set([...linkedNodeIds(d,na.id),...linkedNodeIds(d,nb.id)]));
}
/** Joining geometry creates a plain connection. Ink can be explicitly added afterwards. */
function clearConnectedInk(d:Doc,nodes:Set<string>):Doc{return {...d,curves:d.curves.map(c=>c.nodes.some(n=>nodes.has(n))?{...c,inkEnds:([0,1] as const).map(end=>nodes.has(c.nodes[end])?{taper:0,extension:0}:c.inkEnds?.[end]??{}) as import('./model').InkEnds}:c)};}
export function unlinkEndpoints(d:Doc,id:string):Doc{
 if(d.displayIntervals?.some(t=>t.displayRoute?.throughLinkIds.includes(id)))throw Error('此联动正用于贯通显示路径，请先解除显示贯通。');
 const link=d.endpointLinks?.find(x=>x.id===id);if(!link)return d;check(d,[link.a.curveId,link.b.curveId]);return {...d,endpointLinks:d.endpointLinks!.filter(x=>x.id!==id)};
}

export function moveHandle(d:Doc,e:Endpoint,position:Point2,allowHidden=false):Doc{
 const j=joinAt(d,e),partner=j&&j.mode==='SMOOTH'?(sameEnd(j.a,e)?j.b:j.a):null;
 if(!finitePoint(position))return d;const node=nodeAt(d,e).position,delta=sub(position,node),size=length(delta);
 if(j&&j.mode!=='CUSP'&&size<1e-7)throw Error('连接柄不能缩为零；请先解除方向约束。');
 if(length(sub(curveById(d,e.curveId).handles[e.end],position))<1e-12)return d;
 const n=copy(d);curveById(n,e.curveId).handles[e.end]=[...position];
 if(partner){const c=curveById(n,partner.curveId),sizeB=length(sub(c.handles[partner.end],node)),direction=mul(delta,-1);c.handles[partner.end]=add(node,mul(direction,sizeB/size));}
 check(d,changedShapes(d,n,[e.curveId,...(partner&&partner.curveId!==e.curveId?[partner.curveId]:[])]),allowHidden);return n;
}
/** Merge only: shared-node targets are not silently rebound/moved. */
export function merge(d:Doc,a:Endpoint,b:Endpoint):Doc{
 if(sameEnd(a,b))return d;if(members(d,nodeAt(d,b).id).length>1)throw Error('移动端点已绑定，请先解除绑定。');
 if(layerFor(d,a.curveId)?.id!==layerFor(d,b.curveId)?.id)throw Error('连接仅支持同一图层。');
 return moveNode(d,nodeAt(d,b).id,nodeAt(d,a).position);
}
export function connect(d:Doc,a:Endpoint,b:Endpoint,mode:'POSITION'|'SMOOTH'|'CUSP'|'ARC',radius?:number,preserveAuthoredBrush=false):Doc{
 if(displayRouteFor(d,a.curveId)||displayRouteFor(d,b.curveId))throw Error('请先解除显示贯通，再更改源节点连接。');
 if(sameEnd(a,b))throw Error('请选择另一个端点。');
 if(layerFor(d,a.curveId)?.id!==layerFor(d,b.curveId)?.id)throw Error('连接仅支持同一图层。');
 const na=nodeAt(d,a),nb=nodeAt(d,b),linked=new Set([...linkedNodeIds(d,na.id),...linkedNodeIds(d,nb.id)]),affected=[...linked].flatMap(id=>members(d,id).map(e=>e.curveId));check(d,affected);
 const priorA=joinAt(d,a),priorB=joinAt(d,b),existing=priorA&&priorB?.id===priorA.id?priorA:null;
 if(mode!=='POSITION'&&((priorA&&!existing)||(priorB&&!existing)))throw Error('端点已与另一条曲线接笔，请先解除接笔。');
 if((mode==='SMOOTH'||mode==='ARC')&&[a,b].some(e=>length(sub(curveById(d,e.curveId).handles[e.end],nodeAt(d,e).position))<1e-7))throw Error('请先拉出有效 handle，再建立方向约束。');
 let n=copy(moveNode(d,nb.id,na.position));
 if(na.id!==nb.id){for(const c of n.curves)for(const e of [0,1] as const)if(c.nodes[e]===nb.id)c.nodes[e]=na.id;n.nodes=n.nodes.filter(x=>x.id!==nb.id);}n=cleanEndpointLinks(n);
 if(na.id!==nb.id&&!preserveAuthoredBrush)n=clearConnectedInk(n,linkedNodeIds(n,na.id));
 if(existing)n.joins=n.joins.filter(j=>j.id!==existing.id);

 const firstStroke=strokeFor(d,a.curveId),secondStroke=strokeFor(d,b.curveId),first=strokeIds(firstStroke),other=strokeIds(secondStroke).filter(id=>!first.includes(id));
 const layer=n.layers.find(l=>l.id===layerFor(d,a.curveId)!.id)!,old=[...layer.items],anchor=old.findIndex(id=>first.includes(id));
 const ordered=old.filter(id=>!other.includes(id)),at=ordered.findIndex(id=>id===old[anchor]);ordered.splice(at+first.length,0,...other);layer.items=ordered;
 const width=curveById(n,a.curveId).width;check(d,[...first,...other]);for(const id of [...first,...other]){const c=curveById(n,id);c.width=width;c.profile=curveById(d,a.curveId).profile;c.profileReverse=curveById(d,a.curveId).profileReverse;const name=first.map(id=>curveById(d,id).strokeName).find(Boolean)??other.map(id=>curveById(d,id).strokeName).find(Boolean);if(name)c.strokeName=name;}
 if(mode==='POSITION')return pruneMirrorEditingMetadata(d,normalizeOrder(clean(n)));
 if(mode==='ARC'&&radius!==undefined&&(!Number.isFinite(radius)||radius<=0||radius>2))throw Error('圆弧影响范围无效。');
 n.joins.push({id:existing?.id??uid(),a:{...a},b:{...b},mode,...(mode==='ARC'?{radius:radius??(existing?.mode==='ARC'?existing.radius:.08)}:{})});
 if(mode==='ARC'||mode==='CUSP')return pruneMirrorEditingMetadata(d,normalizeOrder(n));
 const va=sub(curveById(n,a.curveId).handles[a.end],na.position),hb=curveById(n,b.curveId).handles[b.end],len=length(sub(hb,na.position));
 curveById(n,b.curveId).handles[b.end]=add(na.position,mul(mul(va,-1),len/length(va)));
 return pruneMirrorEditingMetadata(d,normalizeOrder(n));
}
export function removeJoin(d:Doc,id:string):Doc{const j=d.joins.find(j=>j.id===id);if(!j)return d;check(d,[j.a.curveId,j.b.curveId]);return {...d,joins:d.joins.filter(j=>j.id!==id)};}
export function unbind(d:Doc,e:Endpoint):Doc{
 if(displayRouteFor(d,e.curveId))throw Error('请先解除显示贯通，再拆开源节点。');
 const partner=joinAt(d,e);check(d,[e.curveId,...(partner?[partner.a.curveId,partner.b.curveId]:[])]);const node=nodeAt(d,e);if(members(d,node.id).length===1)return d;
 const n=copy(d),id=uid();curveById(n,e.curveId).nodes[e.end]=id;n.nodes.push({id,position:[...node.position]});n.joins=n.joins.filter(j=>!sameEnd(j.a,e)&&!sameEnd(j.b,e));return pruneMirrorEditingMetadata(d,clean(n));
}
export function widthChange(d:Doc,ids:string[],width:number):Doc{
 if(!Number.isFinite(width)||width<=0||width>1)return d;
 const all=[...new Set(ids.flatMap(id=>strokeIds(strokeFor(d,id))))];check(d,all);
 return {...d,curves:d.curves.map(c=>all.includes(c.id)?{...c,width}:c)};
}
export function deleteCurves(d:Doc,ids:string[]):Doc{
 return deleteObjects(d,ids);
}
/** List deletion is allowed for hidden objects; locks still protect objects and join partners. */
export function deleteObjects(d:Doc,ids:string[]):Doc{
 const selected=new Set(ids.filter(id=>objectById(d,id)));if(!selected.size)return d;
 // Paint paths depend on their explicit source curves. Remove those dependents
 // in this same source edit, keeping the layer slot when its last item leaves.
 for(const fill of d.fills)if(fill.boundary.some(use=>selected.has(use.id)))selected.add(fill.id);
 for(const offset of d.offsets)if(offset.source.some(use=>selected.has(use.id)))selected.add(offset.id);
 if([...selected].some(id=>curveById(d,id)&&displayRouteFor(d,id)))throw Error('请先解除显示贯通，再删除其源曲线。');
 // Deleting a member also removes its relations. Honor the same partner locks
 // as an explicit unlink, including links whose other member is in another layer.
 const related=[...d.joins,...(d.endpointLinks??[])].filter(j=>selected.has(j.a.curveId)||selected.has(j.b.curveId)).flatMap(j=>[j.a.curveId,j.b.curveId]);
 if([...selected,...related].some(id=>objectById(d,id)?.locked))throw Error('对象已锁定。');
 return pruneMirrorEditingMetadata(d,retainDisplayIntervals(d,clean({...d,curves:d.curves.filter(c=>!selected.has(c.id)),fills:d.fills.filter(f=>!selected.has(f.id)),offsets:d.offsets.filter(o=>!selected.has(o.id)),layers:d.layers.map(l=>({...l,items:l.items.filter(id=>!selected.has(id))}))})));
}
export function deleteLayer(d:Doc,id:string):Doc{
 return deleteLayers(d,[id]);
}
/** Atomic multi-layer deletion, with the same lock protection as object deletion. */
export function deleteLayers(d:Doc,ids:readonly string[]):Doc{
 const layers=d.layers.filter(l=>ids.includes(l.id));if(!layers.length)return d;
 const n=deleteObjects(d,layers.flatMap(l=>l.items));
 return {...n,layers:n.layers.filter(l=>!ids.includes(l.id))};
}
/** Standalone copies remain editable; whole-layer copies retain every member's state. */
export function duplicateCurves(d:Doc,ids:string[],layerId=layerFor(d,ids[0])?.id,offset:Point2=[.04,-.04],copyGroupFills=true,preserveMemberState=false):{document:Doc;ids:string[]}{
 if(!ids.length||!layerId)return {document:d,ids:[]};requireLayer(d,layerId);
 if(ids.some(id=>displayRouteFor(d,id)))throw Error('贯通画稿请使用画稿图层导入，以完整复制跨层依赖。');
 const n=copy(d),nodeMap=new Map<string,string>(),curveMap=new Map<string,string>();
 for(const id of ids){const c=curveById(d,id);for(const nodeId of c.nodes)if(!nodeMap.has(nodeId)){const newId=uid();nodeMap.set(nodeId,newId);n.nodes.push({id:newId,position:add(d.nodes.find(x=>x.id===nodeId)!.position,offset)});}
  const newId=uid();curveMap.set(id,newId);n.curves.push({...c,id:newId,name:nextName(n.curves.map(c=>c.name),c.name+' · '),nodes:c.nodes.map(id=>nodeMap.get(id)!) as [string,string],handles:c.handles.map(p=>add(p,offset)) as [Point2,Point2],visible:preserveMemberState?c.visible:true,locked:preserveMemberState?c.locked:false});}
 for(const j of d.joins)if(curveMap.has(j.a.curveId)&&curveMap.has(j.b.curveId))n.joins.push({...j,id:uid(),a:{...j.a,curveId:curveMap.get(j.a.curveId)!},b:{...j.b,curveId:curveMap.get(j.b.curveId)!}});
 if(d.endpointLinks)n.endpointLinks=[...d.endpointLinks,...d.endpointLinks.filter(j=>curveMap.has(j.a.curveId)&&curveMap.has(j.b.curveId)).map(j=>({...j,id:uid(),a:{...j.a,curveId:curveMap.get(j.a.curveId)!},b:{...j.b,curveId:curveMap.get(j.b.curveId)!}}))];
 const created=ids.map(id=>curveMap.get(id)!);n.layers.find(l=>l.id===layerId)!.items.unshift(...created);
 if(d.groups)n.groups=[...d.groups,...d.groups.filter(g=>g.curveIds.every(id=>curveMap.has(id))).map(g=>({...g,id:uid(),name:nextName(d.groups!.map(g=>g.name),g.name+' · '),curveIds:g.curveIds.map(id=>curveMap.get(id)!),visible:true,locked:false}))];
 if(d.displayIntervals)n.displayIntervals=[...d.displayIntervals,...d.displayIntervals.filter(t=>curveMap.has(t.anchor.id)).map(t=>({...t,id:uid(),anchor:{...t.anchor,id:curveMap.get(t.anchor.id)!},ranges:t.ranges.map(r=>({...r,id:uid()}))}))];
 if(copyGroupFills){const objectMap=new Map(curveMap);for(const f of d.fills){const g=groupFor(d,f.id);if(!g||!g.curveIds.every(id=>curveMap.has(id)))continue;const id=uid();objectMap.set(f.id,id);n.fills.push({...f,id,boundary:f.boundary.map(x=>({...x,id:curveMap.get(x.id)!})),locked:preserveMemberState?f.locked:false});}
  if(objectMap.size>curveMap.size){const layer=n.layers.find(l=>l.id===layerId)!,clones=new Set(objectMap.values());layer.items=[...d.layers.flatMap(l=>l.items).filter(id=>objectMap.has(id)).map(id=>objectMap.get(id)!),...layer.items.filter(id=>!clones.has(id))];}}

 // Cloning assigns new node IDs; preserve asymmetric ink direction if traversal reverses.
 for(const original of d.layers.flatMap(l=>strokes(d,l.id)).flatMap(strokePaths)){if(!original.segments.every(x=>curveMap.has(x.id)))continue;
  const first=original.segments[0],expected=nodeMap.get(curveById(d,first.id).nodes[first.reverse?1:0]),cloned=strokePaths(strokeFor(n,curveMap.get(first.id)!)).find(p=>p.segments.some(x=>x.id===curveMap.get(first.id)))!,actual=cloned.segments[0];
  if(!original.closed&&curveById(n,actual.id).nodes[actual.reverse?1:0]!==expected)for(const x of cloned.segments){const c=curveById(n,x.id);c.profileReverse=!c.profileReverse;}
 }
 return {document:normalizeOrder(n),ids:created};
}
export function duplicateLayer(d:Doc,id:string):Doc{
 const l=d.layers.find(l=>l.id===id);if(!l)return d;let n=addLayer(d,nextName(d.layers.map(l=>l.name),l.name+' · '));const layer=n.layers[0].id,source=l.items.filter(id=>curveById(d,id)),result=duplicateCurves(n,source,layer,[0,0],false,true);n=result.document;
 const map=new Map(source.map((id,i)=>[id,result.ids[i]])),uses=(xs:import('./model').CurveUse[])=>xs.map(x=>({...x,id:map.get(x.id)??x.id}));
 for(const oid of l.items){const f=d.fills.find(x=>x.id===oid),o=d.offsets.find(x=>x.id===oid),newId=uid();if(f){map.set(oid,newId);n={...n,fills:[...n.fills,{...f,id:newId,boundary:uses(f.boundary)}]};}if(o){map.set(oid,newId);n={...n,offsets:[...n.offsets,{...o,id:newId,source:uses(o.source)}]};}}
 return {...n,layers:n.layers.map(l2=>l2.id===layer?{...l2,items:l.items.map(id=>map.get(id)!)}:l2)};
}
export function reorderLayers(d:Doc,id:string,target:string,after=false):Doc{
 const layer=d.layers.find(l=>l.id===id);if(!layer||id===target)return d;
 const layers=d.layers.filter(l=>l.id!==id),index=layers.findIndex(l=>l.id===target);if(index<0)return d;layers.splice(index+(after?1:0),0,layer);return {...d,layers};
}
export function reorderStroke(d:Doc,id:string,targetId:string,after=false):Doc{
 const l=layerFor(d,id);if(!l||l.id!==layerFor(d,targetId)?.id)return d;const group=strokeIds(strokeFor(d,id)),target=strokeIds(strokeFor(d,targetId));if(group.some(id=>target.includes(id)))return d;check(d,group);
 const ids=l.items.filter(id=>!group.includes(id)),index=after?Math.max(...target.map(id=>ids.indexOf(id)))+1:Math.min(...target.map(id=>ids.indexOf(id)));ids.splice(index,0,...group);return {...d,layers:d.layers.map(x=>x===l?{...l,items:ids}:x)};
}
export function moveToLayer(d:Doc,ids:string[],target:string):Doc{
 if(!ids.length)return d;requireLayer(d,target);
 // Layer organization preserves hidden states; locked objects cannot be moved.
 const unlocked=(xs:string[])=>{if(xs.some(id=>!objectById(d,id)||objectById(d,id)!.locked))throw Error('对象已锁定。');};
 unlocked(ids);let required=relatedIds(d,ids);for(;;){const next=relatedIds(d,required);if(next.length===required.length)break;required=next;}unlocked(required);if(required.some(id=>!ids.includes(id)))throw new RelatedSelection(required);
 if(ids.every(id=>layerFor(d,id)?.id===target))return d;
 const moving=new Set(ids);
 for(const f of d.fills)if(f.boundary.length&&f.boundary.every(x=>moving.has(x.id)&&layerFor(d,x.id)?.id===layerFor(d,f.id)?.id))moving.add(f.id);
 const ordered=d.layers.flatMap(l=>l.items).filter(id=>moving.has(id));unlocked(ordered);
 const n=copy(d);if(n.groups)n.groups=n.groups.map(g=>g.curveIds.every(id=>moving.has(id))?g:{...g,curveIds:g.curveIds.filter(id=>!moving.has(id))}).filter(g=>g.curveIds.length);for(const l of n.layers)l.items=l.items.filter(id=>!moving.has(id));n.layers.find(l=>l.id===target)!.items.unshift(...ordered);return normalizeOrder(n);
}
export function splitCurve(d:Doc,id:string,t:number,options:{intent?:CurveSplitIntent;propagate?:boolean;materialSource?:DrawingMaterialSourceResolver}={}):{document:Doc;ids:string[]}{
 const intent=options.intent;if(intent){if(intent.curveId!==id||intent.t!==t)throw Error('The split command and explicit intent disagree.');assertCurveSplitIntent(d,intent);}
 if(options.propagate&&!intent)throw Error('Propagating a split requires an explicit identity plan.');
 if(!options.propagate)check(d,[id]);if(!Number.isFinite(t)||t<=1e-5||t>=1-1e-5)throw Error('请在曲线内部选择分割位置。');
 for(const j of d.joins){if(j.mode!=='ARC')continue;const g=roundedJoins(d).get(j.id)!;if(g.error)continue;for(const [e,at] of [[j.a,g.aT],[j.b,g.bT]] as const)if(e.curveId===id&&(e.end===0?t<=at:t>=at))throw Error('该位置属于圆弧过渡范围，请在保留的源曲线上分割。');}
 const shape=shapeOf(d,id),[left,right]=split(shape.map(([x,y])=>[x,y,0]),t).map(s=>s.map(([x,y])=>[x,y]) as Cubic);
 if(length(sub(left[2],left[3]))<1e-7||length(sub(right[1],right[0]))<1e-7)throw Error('该位置切向退化，请换一个分割位置。');
 const n=copy(d),old=curveById(n,id),leftId=intent?.childCurveIds[0]??id,newId=intent?.childCurveIds[1]??uid(),nodeId=intent?.seamNodeId??uid(),oldEnd=old.nodes[1],inkEnds=old.inkEnds;
 n.nodes.push({id:nodeId,position:left[3]});old.id=leftId;old.nodes[1]=nodeId;old.handles=[left[1],left[2]];const base=old.name;old.name=nextName(n.curves.filter(c=>c.id!==leftId).map(c=>c.name),base+' · ');
 const created={...old,id:newId,name:nextName(n.curves.map(c=>c.name),base+' · '),nodes:[nodeId,oldEnd] as [string,string],handles:[right[1],right[2]] as [Point2,Point2]};if(inkEnds){old.inkEnds=[inkEnds[0],{}];created.inkEnds=[{},inkEnds[1]];}n.curves.push(created);
 const endpoint=(e:Endpoint):Endpoint=>e.curveId===id?{curveId:e.end===0?leftId:newId,end:e.end}:e;
 for(const j of n.joins)for(const key of ['a','b'] as const)j[key]=endpoint(j[key]);
 if(n.endpointLinks)n.endpointLinks=n.endpointLinks.map(j=>({...j,a:endpoint(j.a),b:endpoint(j.b)}));
 n.joins.push({id:intent?.seamJoinId??uid(),a:{curveId:leftId,end:1},b:{curveId:newId,end:0},mode:'SMOOTH'});
 const replace=(xs:import('./model').CurveUse[])=>xs.flatMap(x=>x.id!==id?[x]:x.reverse?[{id:newId,reverse:true},{id:leftId,reverse:true}]:[{id:leftId,reverse:false},{id:newId,reverse:false}]);n.fills=n.fills.map(f=>({...f,boundary:replace(f.boundary)}));n.offsets=n.offsets.map(o=>({...o,source:replace(o.source)}));
 for(const layer of n.layers)layer.items=layer.items.flatMap(item=>item===id?[leftId,newId]:[item]);
 if(n.groups)n.groups=n.groups.map(group=>({...group,curveIds:group.curveIds.flatMap(curve=>curve===id?[leftId,newId]:[curve])}));
 // Splitting shortens the source allocated to each endpoint. Do not silently
 // expand a previously clamped arc and violate the exact-split contract.
 const before=roundedJoins(d),after=roundedJoins(n);
 for(const j of d.joins)if(j.mode==='ARC'&&[j.a.curveId,j.b.curveId].includes(id)){
  const a=before.get(j.id)!,b=after.get(j.id)!;
  if(!a.error&&(b.error||Math.abs(a.distance-b.distance)>1e-5))throw Error('分割会改变圆弧范围，请先减小影响范围再分割。');
 }
 return {document:pruneMirrorEditingMetadata(d,normalizeOrder(splitDisplayIntervals(d,n,id,newId,intent,options.materialSource,t))),ids:[leftId,newId]};
}
export function ellipse(d:Doc,layerId:string,a:Point2,b:Point2,width:number):{document:Doc;ids:string[]}{
 const center=mul(add(a,b),.5),rx=Math.abs(b[0]-a[0])/2,ry=Math.abs(b[1]-a[1])/2,k=.5522847498307936;
 if(Math.min(rx,ry)<1e-5)throw Error('请拖出有宽度和高度的椭圆。');
 const shapes:Cubic[]=[[[1,0],[1,k],[k,1],[0,1]],[[0,1],[-k,1],[-1,k],[-1,0]],[[-1,0],[-1,-k],[-k,-1],[0,-1]],[[0,-1],[k,-1],[1,-k],[1,0]]];
 let n=d;const ids:string[]=[];for(const s of shapes){const id=uid();ids.push(id);n=createCurve(n,layerId,s.map(p=>add(center,[p[0]*rx,p[1]*ry])) as Cubic,width,nextName(n.curves.map(c=>c.name),'椭圆'),id);}
 for(let i=0;i<4;i++)n=connect(n,{curveId:ids[i],end:1},{curveId:ids[(i+1)%4],end:0},'SMOOTH');return {document:n,ids};
}
export function mirrorEdit(d:Doc,source:string,target:string,allowRelated=false):Doc{
 if(source===target)return d;check(d,[target]);const desired=shapeOf(d,source).map(([x,y])=>[2*(d.mirrorAxisX??0)-x,y]) as Cubic;
 let n=moveNode(d,nodeAt(d,{curveId:target,end:0}).id,desired[0]);n=moveNode(n,nodeAt(n,{curveId:target,end:1}).id,desired[3]);
 n=moveHandle(n,{curveId:target,end:0},desired[1]);n=moveHandle(n,{curveId:target,end:1},desired[2]);
 const affected=changedShapes(d,n),shared=relatedIds(d,[target]);if(!allowRelated&&affected.some(id=>id!==target&&shared.includes(id)))throw new RelatedSelection([target,...affected.filter(id=>id!==target)]);return n;
}

export function setMirrorAxis(d:Doc,x:number):Doc{if(!Number.isFinite(x)||x===(d.mirrorAxisX??0))return d;return {...d,mirrorAxisX:x};}
export function setArcRadius(d:Doc,id:string,radius:number):Doc{const j=d.joins.find(j=>j.id===id);if(j?.mode!=='ARC')return d;check(d,[j.a.curveId,j.b.curveId]);if(!Number.isFinite(radius)||radius<=0||radius>2)throw Error('圆弧影响范围无效。');return radius===j.radius?d:{...d,joins:d.joins.map(x=>x===j?{...x,radius}:x)};}
/** Store a label on existing members, never a second persistent Path topology. */
export function renameStroke(d:Doc,id:string,name:string):Doc{
 const label=name.trim(),stroke=strokeFor(d,id);if(!label||!stroke)return d;
 const ids=strokeIds(stroke);check(d,ids);if(ids.every(id=>curveById(d,id).strokeName===label))return d;
 return {...d,curves:d.curves.map(c=>ids.includes(c.id)?{...c,strokeName:label}:c)};
}

/** Visibility and locking are group-level UI actions on existing member flags. */
export function setStrokeState(d:Doc,id:string,change:Partial<Pick<DrawingCurve,'visible'|'locked'>>):Doc{
 const stroke=strokeFor(d,id);if(!stroke)return d;
 return setObjectState(d,strokeObjectIds(d,stroke),change);
}
