import type {DrawingDocument,DrawingCurve,DrawingNode,DrawingLayer,FillRegion,OffsetRelation,EndpointLink,Endpoint} from './model';
import type {StrokeIndex} from './strokes';

/** IDs and continuation only. Numeric geometry, visibility, brushes, interval
 * collections and paint-depth fields must always come from the current Drawing. */
export interface DrawingTopologyPlan {
 readonly key:string;
 readonly strokes:Map<string,StrokeIndex>;
 localConnections?:Map<string,Endpoint>;
}
export interface DrawingReadContext {
 readonly curves:Map<string,DrawingCurve>;
 readonly nodes:Map<string,DrawingNode>;
 readonly layers:Map<string,DrawingLayer>;
 readonly fills:Map<string,FillRegion>;
 readonly offsets:Map<string,OffsetRelation>;
 readonly endpointLinks:Map<string,EndpointLink>;
 /** Same first-owner semantics as Drawing's existing layer lookup. */
 readonly owners:Map<string,DrawingLayer>;
 readonly topology:DrawingTopologyPlan;
 /** Visibility is current-document state, never retained with topology. */
 readonly visibleStrokes:Map<string,StrokeIndex>;
}
const prepared=new WeakMap<DrawingDocument,DrawingReadContext>();
type ReadStamp=readonly unknown[];
interface ScopedRead {stamp:ReadStamp;context:DrawingReadContext}
let activeScope:WeakMap<DrawingDocument,ScopedRead>|undefined;
const readStamp=(d:DrawingDocument):ReadStamp=>[d.curves,d.nodes,d.layers,d.joins,d.endpointLinks,d.fills,d.offsets,d.groups];
/** Evaluation owns its transient buffers for this synchronous read pass. Nested
 * material/mirror samplers share the pass, but nothing leaks into later mutable
 * authoring. Interval collections remain live and are deliberately not cached. */
export function withDrawingReadScope<T>(read:()=>T):T {
 if(activeScope)return read();
 const prior=activeScope;activeScope=new WeakMap();
 try{return read();}finally{activeScope=prior;}
}
const counts={contexts:0,topologyKeys:0,topologyPlans:0,topologyRetains:0,strokeKeys:0,strokeBuilds:0,preparedStrokeMisses:0,localConnectionBuilds:0};
/** Structural work counters, not wall-clock instrumentation. */
export const drawingReadContextStats=()=>({...counts});
export function countDrawingReadWork(kind:keyof typeof counts):void {counts[kind]++;}

function topologyKey(d:DrawingDocument):string {
 counts.topologyKeys++;
 const uses=(items:{id:string;reverse:boolean}[])=>items.map(u=>[u.id,u.reverse]);
 const ends=(relation:{a:Endpoint;b:Endpoint})=>[relation.a.curveId,relation.a.end,relation.b.curveId,relation.b.end];
 return JSON.stringify([
  d.curves.map(c=>[c.id,...c.nodes]),d.nodes.map(n=>n.id),
  d.layers.map(l=>[l.id,l.items]),d.joins.map(j=>[j.id,...ends(j)]),
  (d.endpointLinks??[]).map(l=>[l.id,...ends(l),l.throughDisplay===true]),
  d.fills.map(f=>[f.id,uses(f.boundary)]),d.offsets.map(o=>[o.id,uses(o.source)]),
  (d.groups??[]).map(g=>[g.id,g.curveIds]),
 ]);
}
const index=<T extends {id:string}>(items:T[])=>new Map(items.map(item=>[item.id,item]));
function createContext(d:DrawingDocument,prior?:DrawingReadContext,persist=true):DrawingReadContext {
 const key=topologyKey(d),retain=prior?.topology.key===key;
 const topology=retain?prior.topology:{key,strokes:new Map<string,StrokeIndex>()};
 counts.contexts++;if(retain)counts.topologyRetains++;else counts.topologyPlans++;
 const owners=new Map<string,DrawingLayer>();
 for(const layer of d.layers)for(const id of layer.items)if(!owners.has(id))owners.set(id,layer);
 const context:DrawingReadContext={curves:index(d.curves),nodes:index(d.nodes),layers:index(d.layers),fills:index(d.fills),offsets:index(d.offsets),endpointLinks:index(d.endpointLinks??[]),owners,topology,visibleStrokes:new Map()};
 if(persist)prepared.set(d,context);return context;
}
/** Explicit runtime opt-in. The caller owns this evaluated Drawing and promises
 * never to mutate it after preparation. Authoring/import drafts must not opt in.
 * Preparation does not freeze, clone, normalize, or serialize any Drawing data. */
export function prepareDrawingReadContext(drawing:DrawingDocument):DrawingReadContext {
 return prepared.get(drawing)??createContext(drawing);
}
export function preparedDrawingReadContext(drawing:DrawingDocument):DrawingReadContext|undefined {
 const explicit=prepared.get(drawing);if(explicit)return explicit;
 if(!activeScope)return undefined;
 const stamp=readStamp(drawing),known=activeScope.get(drawing);
 if(known&&stamp.every((value,i)=>value===known.stamp[i]))return known.context;
 const context=createContext(drawing,known?.context,false);activeScope.set(drawing,{stamp,context});return context;
}
/** Use only at a proven topology-preserving evaluation stage. Fresh object
 * indexes always follow next's live geometry/material. A single structural guard
 * also makes accidental relation/source/membership changes rebuild the plan.
 * An unprepared source never implicitly opts its mutable descendants in. */
export function retainPreparedDrawingReadContext(next:DrawingDocument,prior:DrawingDocument):DrawingReadContext|undefined {
 const source=prepared.get(prior);if(!source)return undefined;
 return prepared.get(next)??createContext(next,source);
}
