import {curveById,objectById,nodeAt,length,sub,type DrawingDocument as Doc} from './model';
import {strokeFor,strokeObjectIds,normalizeOrder} from './strokes';
import {deleteObjects} from './commands';
import {cleanEndpointLinks} from './endpointLinks';

/** In-document cut clipboard. IDs and coordinates survive the transfer so fills,
 * offsets and endpoint links keep referring to the same authored geometry. */
export interface DrawingCut extends Pick<Doc,'curves'|'nodes'|'fills'|'offsets'|'joins'|'groups'|'displayIntervals'|'endpointLinks'> {items:string[]}

export function cutDrawing(d:Doc,selected:string[]):{document:Doc;clipboard:DrawingCut}|null{
 const moving=new Set(selected.flatMap(id=>curveById(d,id)?strokeObjectIds(d,strokeFor(d,id)):objectById(d,id)?[id]:[]));
 if(!moving.size)return null;
 for(const f of d.fills)if(f.boundary.length&&f.boundary.every(x=>moving.has(x.id)))moving.add(f.id);
 const items=d.layers.flatMap(l=>l.items).filter(id=>moving.has(id));
 if(items.some(id=>objectById(d,id)!.locked))throw Error('对象已锁定。');
 const curves=d.curves.filter(c=>moving.has(c.id)),nodes=new Set(curves.flatMap(c=>c.nodes));
 const clipboard:DrawingCut=structuredClone({items,curves,nodes:d.nodes.filter(n=>nodes.has(n.id)),
  fills:d.fills.filter(f=>moving.has(f.id)),offsets:d.offsets.filter(o=>moving.has(o.id)),
  joins:d.joins.filter(j=>moving.has(j.a.curveId)&&moving.has(j.b.curveId)),
  // Moving only part of an organizational group detaches those complete strokes.
  ...(d.groups?{groups:d.groups.filter(g=>g.curveIds.every(id=>moving.has(id)))}:{}),
  ...(d.displayIntervals?{displayIntervals:d.displayIntervals.filter(t=>moving.has(t.anchor.id))}:{}),
  ...(d.endpointLinks?{endpointLinks:d.endpointLinks.filter(j=>moving.has(j.a.curveId)||moving.has(j.b.curveId))}:{})});
 return {document:deleteObjects(d,items),clipboard};
}

export function pasteDrawingCut(d:Doc,clipboard:DrawingCut,target:string):Doc{
 if(!d.layers.some(l=>l.id===target))throw Error('请先选择粘贴目标图层。');
 const alive=clipboard.items.filter(id=>objectById(d,id));
 if(alive.length){
  // Undo may have restored a cut; repeat Paste is a move, never a duplicate.
  if(alive.length!==clipboard.items.length)throw Error('剪切内容已改变，请重新剪切。');
  const current=cutDrawing(d,alive)!;
  if(current.clipboard.items.length!==clipboard.items.length)throw Error('剪切内容已改变，请重新剪切。');
  return pasteDrawingCut(current.document,current.clipboard,target);
 }
 const existingIds=new Set([...d.curves,...d.nodes,...d.fills,...d.offsets,...d.joins,...(d.groups??[]),...(d.displayIntervals??[]),...(d.endpointLinks??[]),...d.layers,...(d.displayIntervals??[]).flatMap(t=>t.ranges)].map(x=>x.id));
 const incoming=[...clipboard.curves,...clipboard.nodes,...clipboard.fills,...clipboard.offsets,...clipboard.joins,...(clipboard.groups??[]),...(clipboard.displayIntervals??[]),...(clipboard.endpointLinks??[]),...(clipboard.displayIntervals??[]).flatMap(t=>t.ranges)];
 if(incoming.some(x=>existingIds.has(x.id)))throw Error('剪切内容已改变，请重新剪切。');
 let n:Doc={...d,curves:[...d.curves,...clipboard.curves],nodes:[...d.nodes,...clipboard.nodes],fills:[...d.fills,...clipboard.fills],offsets:[...d.offsets,...clipboard.offsets],joins:[...d.joins,...clipboard.joins],
  layers:d.layers.map(l=>l.id===target?{...l,items:[...clipboard.items,...l.items]}:l),
  ...(clipboard.groups?.length?{groups:[...(d.groups??[]),...clipboard.groups]}:{}),
  ...(clipboard.displayIntervals?.length?{displayIntervals:[...(d.displayIntervals??[]),...clipboard.displayIntervals]}:{})};
 const links=(clipboard.endpointLinks??[]).filter(j=>curveById(n,j.a.curveId)&&curveById(n,j.b.curveId));
 // An uncut linked endpoint may have moved in the meantime. Do not silently
 // relocate the artwork or restore a geometrically invalid relation.
 if(links.some(j=>length(sub(nodeAt(n,j.a).position,nodeAt(n,j.b).position))>1e-7))throw Error('关联端点已移动，请先撤销该移动再粘贴。');
 if(links.length)n=cleanEndpointLinks({...n,endpointLinks:[...(n.endpointLinks??[]),...links]});
 return normalizeOrder(n);
}
