import type {DrawingDocument,DrawingCurve,DrawingNode,DrawingLayer,FillRegion,OffsetRelation,EndpointLink,Endpoint,TangentJoin} from './model';
import type {StrokeIndex} from './strokes';
import {InputCache} from '../geometry/cache';

/** IDs and continuation only. Numeric geometry, visibility, brushes, interval
 * collections and paint-depth fields must always come from the current Drawing. */
export interface DrawingTopologyPlan {
 readonly key:string;
 readonly strokes:Map<string,StrokeIndex>;
 localConnections?:Map<string,Endpoint>;
 materialDependencies?:DrawingMaterialDependencyIndex;
}
export interface DrawingReadContext {
 readonly curves:Map<string,DrawingCurve>;
 readonly nodes:Map<string,DrawingNode>;
 readonly layers:Map<string,DrawingLayer>;
 readonly fills:Map<string,FillRegion>;
 readonly offsets:Map<string,OffsetRelation>;
 readonly endpointLinks:Map<string,EndpointLink>;
 readonly joins:Map<string,TangentJoin>;
 /** Same first-owner semantics as Drawing's existing layer lookup. */
 readonly owners:Map<string,DrawingLayer>;
 readonly topology:DrawingTopologyPlan;
 /** Visibility is current-document state, never retained with topology. */
 readonly visibleStrokes:Map<string,StrokeIndex>;
}
const prepared=new WeakMap<DrawingDocument,DrawingReadContext>();
// Bounded, value-guarded ID plans contain no Drawing objects or numeric data.
// New immutable samples can therefore retain connectivity without rebuilding
// it, while each current document still owns fresh geometry/visibility maps.
const topologyPlans=new InputCache<DrawingTopologyPlan>(128);
let nextMaterialDependencyToken=0;
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
const counts={contexts:0,topologyKeys:0,topologyPlans:0,topologyRetains:0,strokeKeys:0,strokeBuilds:0,preparedStrokeMisses:0,localConnectionBuilds:0,materialDependencyIndexes:0,materialPathPlans:0};
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
 const key=topologyKey(d),known=prior?.topology.key===key?prior.topology:topologyPlans.get(key),retain=!!known;
 const topology=known??topologyPlans.set(key,{key,strokes:new Map<string,StrokeIndex>()});
 counts.contexts++;if(retain)counts.topologyRetains++;else counts.topologyPlans++;
 const owners=new Map<string,DrawingLayer>();
 for(const layer of d.layers)for(const id of layer.items)if(!owners.has(id))owners.set(id,layer);
 const context:DrawingReadContext={curves:index(d.curves),nodes:index(d.nodes),layers:index(d.layers),fills:index(d.fills),offsets:index(d.offsets),endpointLinks:index(d.endpointLinks??[]),joins:index(d.joins),owners,topology,visibleStrokes:new Map()};
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

/** Only IDs and document order are retained with topology. The current read
 * context supplies every numeric/material object when a signature is read. */
interface DrawingPathDependencyPlan {
 readonly curveIds:readonly string[];
 readonly nodeIds:readonly string[];
 readonly joinIds:readonly string[];
 readonly linkIds:readonly string[];
}
interface MaterialRelationIndex {
 readonly order:Map<string,number>;
 readonly ends:Map<string,readonly [string,string]>;
 readonly incident:Map<string,string[]>;
}
interface DrawingMaterialDependencyIndex {
 readonly curveOrder:Map<string,number>;
 readonly nodeOrder:Map<string,number>;
 readonly curveNodes:Map<string,readonly string[]>;
 readonly joins:MaterialRelationIndex;
 readonly links:MaterialRelationIndex;
 readonly structuralIdToken:number;
 readonly uniqueIds:boolean;
 readonly paths:InputCache<DrawingPathDependencyPlan>;
}
function materialRelationIndex(relations:readonly {id:string;a:Endpoint;b:Endpoint}[]):MaterialRelationIndex {
 const order=new Map<string,number>(),ends=new Map<string,readonly [string,string]>(),incident=new Map<string,string[]>();
 relations.forEach((relation,i)=>{
  order.set(relation.id,i);ends.set(relation.id,[relation.a.curveId,relation.b.curveId]);
  for(const id of new Set([relation.a.curveId,relation.b.curveId])){
   const ids=incident.get(id);if(ids)ids.push(relation.id);else incident.set(id,[relation.id]);
  }
 });
 return {order,ends,incident};
}
function materialDependencyIndex(d:DrawingDocument):DrawingMaterialDependencyIndex {
 counts.materialDependencyIndexes++;
 const ids=(items:readonly {id:string}[])=>items.map(item=>item.id),curveIds=ids(d.curves),nodeIds=ids(d.nodes),joinIds=ids(d.joins),linkIds=ids(d.endpointLinks??[]);
 const order=(values:string[])=>new Map(values.map((id,i)=>[id,i]));
 return {curveOrder:order(curveIds),nodeOrder:order(nodeIds),curveNodes:new Map(d.curves.map(curve=>[curve.id,[...curve.nodes]])),
  joins:materialRelationIndex(d.joins),links:materialRelationIndex(d.endpointLinks??[]),
  // The value-guarded topology key includes every structural ID and its order.
  // A unique token avoids serializing that scene-sized key for each native path.
  structuralIdToken:++nextMaterialDependencyToken,
  // Imported/mutable duplicate-ID documents keep the original array-filter
  // semantics instead of collapsing distinct objects through the read maps.
  uniqueIds:[curveIds,nodeIds,joinIds,linkIds].every(values=>new Set(values).size===values.length),
  paths:new InputCache<DrawingPathDependencyPlan>(256)};
}
/** Reuse only bounded structural dependency addresses. Interval collections,
 * route selection, ARC geometry, and material fields are deliberately absent. */
export function drawingMaterialPathDependencies(drawing:DrawingDocument,pathCurveIds:readonly string[]) {
 const context=preparedDrawingReadContext(drawing);if(!context)return undefined;
 const index=context.topology.materialDependencies??=materialDependencyIndex(drawing);if(!index.uniqueIds)return undefined;
 const key=JSON.stringify(pathCurveIds),known=index.paths.get(key);
 if(known)return {context,dependencies:known,structuralIdToken:index.structuralIdToken};
 counts.materialPathPlans++;
 const inOrder=(ids:Iterable<string>,order:Map<string,number>)=>[...new Set(ids)].filter(id=>order.has(id)).sort((a,b)=>order.get(a)!-order.get(b)!);
 const relations=(source:MaterialRelationIndex)=>inOrder(pathCurveIds.flatMap(id=>source.incident.get(id)??[]),source.order);
 const joinIds=relations(index.joins),linkIds=relations(index.links);
 const curveIds=inOrder([...pathCurveIds,...joinIds.flatMap(id=>index.joins.ends.get(id)!),...linkIds.flatMap(id=>index.links.ends.get(id)!)],index.curveOrder);
 const nodeIds=inOrder(curveIds.flatMap(id=>index.curveNodes.get(id)!),index.nodeOrder);
 const dependencies=index.paths.set(key,{curveIds,nodeIds,joinIds,linkIds});
 return {context,dependencies,structuralIdToken:index.structuralIdToken};
}
