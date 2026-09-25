import {curveById,nodeAt,editable,add,sub,length,type DrawingDocument as Doc,type EndpointLink,type Point2} from './model';
/** Geometric coupling is deliberately separate from shared-node stroke topology. */
export function linkedNodeIds(d:Doc,nodeId:string):Set<string>{
 const nodes=new Set([nodeId]),queue=[nodeId];
 for(const id of queue)for(const link of d.endpointLinks??[]){const a=nodeAt(d,link.a).id,b=nodeAt(d,link.b).id,next=a===id?b:b===id?a:undefined;if(next&&!nodes.has(next)){nodes.add(next);queue.push(next);}}
 return nodes;
}
export const linksAtNode=(d:Doc,nodeId:string)=>(d.endpointLinks??[]).filter(link=>nodeAt(d,link.a).id===nodeId||nodeAt(d,link.b).id===nodeId);
export function cleanEndpointLinks(d:Doc):Doc{
 if(!d.endpointLinks)return d;const seen=new Set<string>(),endpointLinks:EndpointLink[]=[];
 for(const link of d.endpointLinks){if(!curveById(d,link.a.curveId)||!curveById(d,link.b.curveId))continue;const a=nodeAt(d,link.a).id,b=nodeAt(d,link.b).id,key=[a,b].sort().join(':');if(a===b||seen.has(key))continue;seen.add(key);endpointLinks.push(link);}
 return {...d,endpointLinks};
}
/** Propagate edited positions only. Followers translate their adjacent handles;
 * their other endpoints, widths, layer membership and stroke order are untouched. */
export function followLinkedNodes(before:Doc,next:Doc,edited:Set<string>,allowHidden=false):Doc{
 if(!before.endpointLinks?.length)return next;
 const targets=new Map<string,Point2>();
 for(const id of edited){const a=before.nodes.find(n=>n.id===id),b=next.nodes.find(n=>n.id===id);if(!a||!b||length(sub(a.position,b.position))<1e-12)continue;
  for(const linked of linkedNodeIds(before,id)){const prior=targets.get(linked);if(prior&&length(sub(prior,b.position))>1e-8)throw Error('联动端点不能移动到不同位置。');targets.set(linked,b.position);}
 }
 const deltas=new Map<string,Point2>();for(const [id,target] of targets){const node=next.nodes.find(n=>n.id===id);if(node&&length(sub(node.position,target))>1e-12)deltas.set(id,sub(target,node.position));}
 if(!deltas.size)return next;
 for(const c of next.curves)if(c.nodes.some(id=>deltas.has(id))&&(allowHidden?c.locked:!editable(before,c.id)))throw Error('联动端点所在曲线或图层已隐藏或锁定。');
 return {...next,nodes:next.nodes.map(n=>deltas.has(n.id)?{...n,position:[...targets.get(n.id)!] as Point2}:n),curves:next.curves.map(c=>c.nodes.some(id=>deltas.has(id))?{...c,handles:c.handles.map((p,i)=>deltas.has(c.nodes[i])?add(p,deltas.get(c.nodes[i])!):p) as [Point2,Point2]}:c)};
}
