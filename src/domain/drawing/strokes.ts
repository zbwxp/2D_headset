import {reconcileGroups} from './groups';
import {endKey,curveById,shapeOf,type DrawingDocument,type Endpoint,type Cubic} from './model';
import {InputCache} from '../geometry/cache';
import {derivedUses} from './roundedJoin';
export interface StrokePath {segments:{id:string;reverse:boolean}[];closed:boolean}
export interface Stroke extends StrokePath {id:string;/** Branches share a group but never acquire artificial connecting segments. */paths?:StrokePath[]}
export const strokePaths=(s:Stroke):StrokePath[]=>s.paths??[s];
export const strokeName=(d:DrawingDocument,s:Stroke)=>s.segments.map(x=>curveById(d,x.id).strokeName).find(Boolean)??curveById(d,s.id).name;
interface StrokeIndex {strokes:Stroke[];byCurve:Map<string,Stroke>}
const topologyCache=new InputCache<StrokeIndex>(128);
const emptyIndex:StrokeIndex={strokes:[],byCurve:new Map()};
/** Only connectivity/order determine strokes. Key by values, not document identity:
 * commands may mutate their private draft, while handle drags change no topology.
 * The bounded cache contains IDs only, never documents or undo history. */
function strokeIndex(d:DrawingDocument,layerId:string,visibleOnly=false):StrokeIndex{
 const layer=d.layers.find(l=>l.id===layerId);if(!layer)return emptyIndex;
 const curves=new Map(d.curves.map(c=>[c.id,c]));
 const ids=layer.items.filter(id=>curves.has(id)&&(!visibleOnly||curves.get(id)!.visible)),allowed=new Set(ids);
 const joins=d.joins.filter(j=>allowed.has(j.a.curveId)&&allowed.has(j.b.curveId));
 const key=JSON.stringify([ids.map(id=>[id,...curves.get(id)!.nodes]),joins.map(j=>[j.a.curveId,j.a.end,j.b.curveId,j.b.end])]);
 const cached=topologyCache.get(key);if(cached)return cached;
 const pairs=new Map<string,Endpoint>(),atNode=new Map<string,Endpoint[]>();
 const nodeId=(e:Endpoint)=>curves.get(e.curveId)!.nodes[e.end];
 for(const curveId of ids)for(const end of [0,1] as const){const e={curveId,end},node=nodeId(e);atNode.set(node,[...(atNode.get(node)??[]),e]);}
 for(const j of joins){pairs.set(endKey(j.a),j.b);pairs.set(endKey(j.b),j.a);}
 // A simple POSITION connection continues the same ink path without aligning handles.
 for(const ends of atNode.values())if(ends.length===2){pairs.set(endKey(ends[0]),ends[1]);pairs.set(endKey(ends[1]),ends[0]);}
 const grouped=new Set<string>(),result:Stroke[]=[];
 for(const seed of ids){if(grouped.has(seed))continue;
  const component=new Set([seed]),queue=[seed];for(const id of queue)for(const n of curves.get(id)!.nodes)for(const next of atNode.get(n)??[])if(!component.has(next.curveId)){component.add(next.curveId);queue.push(next.curveId);}
  component.forEach(id=>grouped.add(id));
  const ends=ids.filter(id=>component.has(id)).flatMap(curveId=>([0,1] as const).map(end=>({curveId,end}))),seen=new Set<string>(),paths:StrokePath[]=[];
  while(seen.size<component.size){
   const remaining=ends.filter(e=>!seen.has(e.curveId)),start=remaining.filter(e=>!pairs.has(endKey(e))).sort((a,b)=>nodeId(a).localeCompare(nodeId(b))||endKey(a).localeCompare(endKey(b)))[0]??remaining[0];
   const segments:StrokePath['segments']=[];let at:Endpoint|undefined=start;
   while(at&&!seen.has(at.curveId)){seen.add(at.curveId);segments.push({id:at.curveId,reverse:at.end===1});at=pairs.get(endKey({curveId:at.curveId,end:at.end===0?1:0}));}
   paths.push({segments,closed:!!at&&at.curveId===start.curveId&&at.end===start.end});
  }
  result.push({id:seed,segments:paths.flatMap(p=>p.segments),closed:paths.length===1&&paths[0].closed,...(paths.length>1?{paths}:{})});
 }
 return topologyCache.set(key,{strokes:result,byCurve:new Map(result.flatMap(s=>s.segments.map(x=>[x.id,s] as const)))});
}
/** A shared node defines group membership. Tangent joins only define the local shape. */
export const strokes=(d:DrawingDocument,layerId:string,visibleOnly=false)=>strokeIndex(d,layerId,visibleOnly).strokes;
export const strokeFor=(d:DrawingDocument,id:string)=>strokeIndex(d,d.layers.find(l=>l.items.includes(id))?.id??'').byCurve.get(id)!;
export const strokeIds=(s:Stroke)=>s.segments.map(x=>x.id);
export const orientedShape=(d:DrawingDocument,segment:Stroke['segments'][number])=>{const shape=shapeOf(d,segment.id);return (segment.reverse?[...shape].reverse():shape) as Cubic;};
export function strokePath(d:DrawingDocument,stroke:Stroke,point:(p:[number,number])=>[number,number]=p=>p):string{
 return strokePaths(stroke).map(path=>derivedUses(d,path.segments,path.closed).shapes.map((shape,i)=>{const s=shape.map(point);return `${i===0?`M ${s[0]} `:''}C ${s[1]} ${s[2]} ${s[3]}`;}).join(' ')+(path.closed?' Z':'')).join(' ');
}
export const strokeWidth=(d:DrawingDocument,s:Stroke)=>curveById(d,s.segments[0].id).width;
/** Store each derived stroke contiguously, using its first listed member as anchor. */
export interface PaintItem {id:string;kind:'stroke'|'fill'|'offset';stroke?:Stroke}
export function paintItems(d:DrawingDocument,layerId:string){
 const index=strokeIndex(d,layerId),seen=new Set<string>();return (d.layers.find(l=>l.id===layerId)?.items??[]).flatMap<PaintItem>(id=>{
  if(seen.has(id))return [];const stroke=index.byCurve.get(id);if(stroke){strokeIds(stroke).forEach(id=>seen.add(id));return [{id:stroke.id,kind:'stroke' as const,stroke}];}
  seen.add(id);return [{id,kind:(d.fills.some(f=>f.id===id)?'fill':'offset') as 'fill'|'offset',stroke:undefined}];
 });
}
/** UI ownership is derived from boundary references, never a second stored hierarchy.
 * Missing or multi-stroke boundaries remain top-level so diagnostics stay reachable. */
export function strokeFillIds(d:DrawingDocument,s:Stroke){
 const members=new Set(strokeIds(s)),layer=d.layers.find(l=>l.items.includes(s.id));
 return layer?.items.filter(id=>d.fills.some(f=>f.id===id&&f.boundary.length>0&&f.boundary.every(x=>members.has(x.id))))??[];
}
export function strokeObjectIds(d:DrawingDocument,s:Stroke){
 const ids=new Set([...strokeIds(s),...strokeFillIds(d,s)]);
 return d.layers.flatMap(l=>l.items).filter(id=>ids.has(id));
}
/** Sidebar tree only: rendering still uses the original flat paint order. */
export function layerTree(d:DrawingDocument,layerId:string){
 const entries=paintItems(d,layerId).map(item=>({...item,fills:item.stroke?strokeFillIds(d,item.stroke):[]})),nested=new Set(entries.flatMap(item=>item.fills));
 return entries.filter(item=>!nested.has(item.id));
}
export function normalizeOrder(d:DrawingDocument):DrawingDocument{return reconcileGroups({...d,layers:d.layers.map(l=>({...l,items:paintItems(d,l.id).flatMap(x=>x.stroke?l.items.filter(id=>x.stroke!.segments.some(s=>s.id===id)):[x.id])}))});}
