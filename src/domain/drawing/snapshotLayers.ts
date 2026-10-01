import {curveById,nodeAt,length,sub,type DrawingDocument as Doc,type EndpointLink} from './model';

/** Replace one authored layer, without moving other layers or changing the active
 * checkpoint/reference alignment. IDs survive so recordings keep correspondence. */
export function restoreSnapshotLayer(d:Doc,source:Omit<Doc,'reference'>,layerId:string):{document:Doc;detachedLinks:number;affectedPaint:number}{
 const current=d.layers.find(l=>l.id===layerId),saved=source.layers.find(l=>l.id===layerId);
 if(!current)throw Error('当前图层不存在。');
 if(!saved)throw Error('此快照中没有该图层。');
 const outgoing=new Set(current.items),incoming=new Set(saved.items);
 // Do not steal objects that the user has since moved to a different layer.
 if(d.layers.some(l=>l.id!==layerId&&l.items.some(id=>incoming.has(id))))throw Error('快照中的部分对象已移至其他图层，请先移回再恢复。');
 const curves=source.curves.filter(c=>incoming.has(c.id)),nodeIds=new Set(curves.flatMap(c=>c.nodes));
 const outsideCurves=d.curves.filter(c=>!outgoing.has(c.id)),outsideNodes=new Set(outsideCurves.flatMap(c=>c.nodes));
 const belongs=(id:string)=>incoming.has(id),outside=(id:string)=>!outgoing.has(id);
 const oldLinks=(d.endpointLinks??[]).filter(l=>outgoing.has(l.a.curveId)||outgoing.has(l.b.curveId));
 const savedLinks=(source.endpointLinks??[]).filter(l=>belongs(l.a.curveId)||belongs(l.b.curveId));
 const replacement=structuredClone({layer:saved,curves,nodes:source.nodes.filter(n=>nodeIds.has(n.id)),
  fills:source.fills.filter(f=>belongs(f.id)),offsets:source.offsets.filter(o=>belongs(o.id)),
  joins:source.joins.filter(j=>belongs(j.a.curveId)&&belongs(j.b.curveId)),
  groups:(source.groups??[]).filter(g=>g.curveIds.every(belongs)),
  displayIntervals:(source.displayIntervals??[]).filter(t=>belongs(t.anchor.id)),links:savedLinks});
 const n:Doc={...d,
  layers:d.layers.map(l=>l.id===layerId?replacement.layer:l),
  curves:[...outsideCurves,...replacement.curves],nodes:[...d.nodes.filter(n=>outsideNodes.has(n.id)),...replacement.nodes],
  fills:[...d.fills.filter(f=>outside(f.id)),...replacement.fills],offsets:[...d.offsets.filter(o=>outside(o.id)),...replacement.offsets],
  joins:[...d.joins.filter(j=>outside(j.a.curveId)&&outside(j.b.curveId)),...replacement.joins],
  ...((d.groups||source.groups)?{groups:[...(d.groups??[]).filter(g=>g.curveIds.every(outside)),...replacement.groups]}:{}),
  ...((d.displayIntervals||source.displayIntervals)?{displayIntervals:[...(d.displayIntervals??[]).filter(t=>outside(t.anchor.id)),...replacement.displayIntervals]}:{}),
 };
 // A node/group/track may have moved with an object. Reject identity conflicts
 // rather than silently cloning it and breaking snapshot correspondence.
 const ids=new Set<string>();
 for(const x of [...n.layers,...n.curves,...n.nodes,...n.fills,...n.offsets,...n.joins,...(n.groups??[]),...(n.displayIntervals??[]),...(n.displayIntervals??[]).flatMap(t=>t.ranges)]){
  if(ids.has(x.id))throw Error('快照中的部分对象已移至其他图层，请先移回再恢复。');ids.add(x.id);
 }
 const links:EndpointLink[]=(d.endpointLinks??[]).filter(l=>outside(l.a.curveId)&&outside(l.b.curveId));
 const pairs=new Set(links.map(l=>[nodeAt(n,l.a).id,nodeAt(n,l.b).id].sort().join(':')));
 links.forEach(l=>ids.add(l.id));
 const candidates=new Map(replacement.links.map(l=>[l.id,l]));
 // Current external links may have been authored after the checkpoint. Retain
 // them only when they still match, never move unselected geometry to satisfy one.
 for(const l of oldLinks)if(outgoing.has(l.a.curveId)!==outgoing.has(l.b.curveId)&&!candidates.has(l.id))candidates.set(l.id,l);
 let detachedLinks=0;
 for(const l of candidates.values()){
  if(!curveById(n,l.a.curveId)||!curveById(n,l.b.curveId)){detachedLinks++;continue;}
  const a=nodeAt(n,l.a),b=nodeAt(n,l.b),key=[a.id,b.id].sort().join(':');
  if(a.id===b.id||pairs.has(key))continue;
  if(length(sub(a.position,b.position))>1e-7){detachedLinks++;continue;}
  if(ids.has(l.id))throw Error('快照中的部分对象已移至其他图层，请先移回再恢复。');
  ids.add(l.id);pairs.add(key);links.push(l);
 }
 if(d.endpointLinks||source.endpointLinks)n.endpointLinks=links;
 const removed=new Set(d.curves.filter(c=>outgoing.has(c.id)&&!incoming.has(c.id)).map(c=>c.id));
 const affectedPaint=d.fills.filter(f=>outside(f.id)&&f.boundary.some(c=>removed.has(c.id))).length+d.offsets.filter(o=>outside(o.id)&&o.source.some(c=>removed.has(c.id))).length;
 return {document:n,detachedLinks,affectedPaint};
}
