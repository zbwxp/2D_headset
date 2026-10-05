import {endKey,type DrawingDocument,type DrawingCurve,type DrawingNode,type DrawingLayer,type Endpoint,type EndpointLink} from './model';
import {deriveSmoothComponents} from '../endpointRelations/smoothComponent';

type SmoothComponent=ReturnType<typeof deriveSmoothComponents>[number];
export interface DrawingControlDependencyIndex {
 readonly curves:ReadonlyMap<string,DrawingCurve>;readonly nodes:ReadonlyMap<string,DrawingNode>;
 readonly layers:ReadonlyMap<string,DrawingLayer>;readonly curveOwners:ReadonlyMap<string,string>;
 readonly linksByCurve:ReadonlyMap<string,readonly EndpointLink[]>;
 readonly nodeIncidence:ReadonlyMap<string,readonly Endpoint[]>;readonly linkedNodes:ReadonlyMap<string,readonly string[]>;
 readonly nodeAuthorities:ReadonlyMap<string,string>;readonly smoothComponents:readonly SmoothComponent[];
 readonly smoothByHandle:ReadonlyMap<string,SmoothComponent>;readonly handleFollowers:ReadonlyMap<string,readonly Endpoint[]>;
 readonly nodeFollowers:ReadonlyMap<string,readonly string[]>;readonly curvePositions:ReadonlyMap<string,number>;readonly nodePositions:ReadonlyMap<string,number>;
}
const dependencies=new WeakMap<DrawingDocument,DrawingControlDependencyIndex>();
let dependencyIndexes=0;
export const drawingControlDependencyStats=()=>({dependencyIndexes});
const append=<T>(map:Map<string,T[]>,key:string,value:T)=>{const values=map.get(key);if(values)values.push(value);else map.set(key,[value]);};
/** Frozen-document reverse addresses shared by authoring and recording. No
 * positions or relation graphs are rediscovered during a pointer update. */
export function drawingControlDependencyIndex(drawing:DrawingDocument):DrawingControlDependencyIndex {
 const known=dependencies.get(drawing);if(known)return known;dependencyIndexes++;
 const curves=new Map(drawing.curves.map(c=>[c.id,c])),nodes=new Map(drawing.nodes.map(n=>[n.id,n])),nodeIncidence=new Map<string,Endpoint[]>(),links=new Map<string,string[]>();
 for(const curve of drawing.curves)for(const end of [0,1] as const)append(nodeIncidence,curve.nodes[end],{curveId:curve.id,end});
 for(const link of drawing.endpointLinks??[]){const a=curves.get(link.a.curveId)?.nodes[link.a.end],b=curves.get(link.b.curveId)?.nodes[link.b.end];if(a&&b){append(links,a,b);append(links,b,a);}}
 const layers=new Map(drawing.layers.map(layer=>[layer.id,layer])),curveOwners=new Map<string,string>(),linksByCurve=new Map<string,EndpointLink[]>();
 for(const layer of drawing.layers)for(const id of layer.items)if(!curveOwners.has(id))curveOwners.set(id,layer.id);
 for(const link of drawing.endpointLinks??[])for(const id of new Set([link.a.curveId,link.b.curveId]))append(linksByCurve,id,link);
 const linkedNodes=new Map<string,readonly string[]>(),nodeAuthorities=new Map<string,string>();
 for(const id of nodes.keys())if(!linkedNodes.has(id)){const ids=[id],seen=new Set(ids);for(const next of ids)for(const other of links.get(next)??[])if(!seen.has(other)){seen.add(other);ids.push(other);}const authority=[...ids].sort()[0];for(const member of ids){linkedNodes.set(member,ids);nodeAuthorities.set(member,authority);}}
 const smoothComponents=deriveSmoothComponents([...drawing.joins.filter(j=>j.mode==='SMOOTH'),...(drawing.endpointLinks??[]).filter(l=>l.joinBrush?.kind==='SMOOTH')]),smoothByHandle=new Map<string,SmoothComponent>(),handleFollowers=new Map<string,Endpoint[]>(),nodeFollowers=new Map<string,string[]>();
 for(const component of smoothComponents)for(const member of component.members){smoothByHandle.set(endKey(member.endpoint),component);for(const other of component.members)append(handleFollowers,endKey(member.endpoint),other.endpoint);}
 for(const [id,ids] of linkedNodes)for(const other of ids)append(nodeFollowers,id,other);
 if(drawing.mirrorEditing?.enabled)for(const pair of drawing.mirrorEditing.curvePairs){const a=curves.get(pair.a),b=curves.get(pair.b);if(!a||!b)continue;for(const end of [0,1] as const){const other=(pair.reverse?1-end:end) as 0|1;append(handleFollowers,endKey({curveId:a.id,end}),{curveId:b.id,end:other});append(handleFollowers,endKey({curveId:b.id,end:other}),{curveId:a.id,end});append(nodeFollowers,a.nodes[end],b.nodes[other]);append(nodeFollowers,b.nodes[other],a.nodes[end]);}}
 const index:DrawingControlDependencyIndex={curves,nodes,layers,curveOwners,linksByCurve,nodeIncidence,linkedNodes,nodeAuthorities,smoothComponents,smoothByHandle,handleFollowers,nodeFollowers,curvePositions:new Map(drawing.curves.map((c,i)=>[c.id,i])),nodePositions:new Map(drawing.nodes.map((n,i)=>[n.id,i]))};dependencies.set(drawing,index);return index;
}
