import {transportDeformedIntervals} from './deform';
import type {DrawingDocument as Doc,Point2} from './model';
const equalPoint=(a:Point2,b:Point2)=>a[0]===b[0]&&a[1]===b[1];
/** Final source-geometry boundary for pointer drafts, numeric/property edits,
 * nudges and store commits. Explicit interval edits and already-transported
 * quad/API results own their new interval array and must never be transported
 * a second time. Topology-changing commands require their own exact remap. */
export function finalizeGeometryEdit(before:Doc|undefined,after:Doc):Doc {
 if(!before||before===after||!before.displayIntervals?.length||before.displayIntervals!==after.displayIntervals)return after;
 if(before.curves.length!==after.curves.length||before.nodes.length!==after.nodes.length)return after;
 const curves=new Map(after.curves.map(c=>[c.id,c])),nodes=new Map(after.nodes.map(n=>[n.id,n]));
 if(before.curves.some(c=>!curves.has(c.id)||c.nodes.some((id,i)=>curves.get(c.id)!.nodes[i]!==id))||before.nodes.some(n=>!nodes.has(n.id)))return after;
 const moved=before.nodes.some(n=>!equalPoint(n.position,nodes.get(n.id)!.position))||before.curves.some(c=>c.handles.some((h,i)=>!equalPoint(h,curves.get(c.id)!.handles[i])))||JSON.stringify(before.joins)!==JSON.stringify(after.joins)||JSON.stringify(before.endpointLinks)!==JSON.stringify(after.endpointLinks);
 return moved?transportDeformedIntervals(before,after):after;
}
