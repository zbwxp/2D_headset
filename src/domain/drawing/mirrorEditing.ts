import {add,sub,mul,length,finitePoint,curveById,nodeAt,endKey,type DrawingDocument,type Endpoint,type Point2} from './model';

/** Stable routing metadata for edit propagation, never a geometry constraint. */
export interface MirrorCurvePair {id:string;a:string;b:string;reverse:boolean}
export interface MirrorEditingConfig {enabled:boolean;curvePairs:MirrorCurvePair[];axisNodeIds?:string[]}
export type MirrorDrawing=DrawingDocument&{mirrorEditing?:MirrorEditingConfig};
/** Final direct writes, excluding mirror/topology followers. Both sides may be
 * explicitly authored; each keeps its own target. Last write per control wins. */
export interface MirrorAuthoredWrites {
 nodes?:Array<{nodeId:string;position:Point2}>;
 handles?:Array<Endpoint&{position:Point2}>;
}
export type MirrorEditingErrorCode='INVALID_CONFIG'|'INVALID_REFERENCE'|'PAIR_CONFLICT'|'ASYMMETRIC_SOURCE'|'TOPOLOGY_CHANGED'|'AUTHORED_CONFLICT'|'CONSTRAINT_CONFLICT'|'LOCKED';
export class MirrorEditingError extends Error {
 constructor(readonly code:MirrorEditingErrorCode,message:string){super(message);this.name='MirrorEditingError';}
}
const EPS=1e-8;
const fail=(code:MirrorEditingErrorCode,message:string):never=>{throw new MirrorEditingError(code,message);};
const near=(a:Point2,b:Point2)=>length(sub(a,b))<=EPS;
const identical=(a:Point2,b:Point2)=>a[0]===b[0]&&a[1]===b[1];
const changedPoint=(a:Point2,b:Point2)=>!identical(a,b);
const reflectDelta=([x,y]:Point2):Point2=>[-x,y];
const pointCopy=(p:Point2):Point2=>[p[0],p[1]];
const configOf=(d:DrawingDocument)=>(d as MirrorDrawing).mirrorEditing;
interface Compiled {
 config:MirrorEditingConfig;nodeGroup:Map<string,string>;groups:Map<string,string[]>;
 groupMirrors:Map<string,Set<string>>;axisGroups:Set<string>;handleMirror:Map<string,string>;
 pairedCurves:Set<string>;
}

function compile(d:DrawingDocument,config=configOf(d)):Compiled|undefined {
 if(config===undefined)return undefined;
 if(!config||typeof config.enabled!=='boolean'||!Array.isArray(config.curvePairs)||config.axisNodeIds!==undefined&&!Array.isArray(config.axisNodeIds))fail('INVALID_CONFIG','镜像编辑配置无效。');
 if(!Number.isFinite(d.mirrorAxisX??0))fail('INVALID_CONFIG','镜像轴坐标无效。');
 const parent=new Map(d.nodes.map(n=>[n.id,n.id]));
 const root=(id:string):string=>{if(!parent.has(id))return fail('INVALID_REFERENCE',`镜像节点不存在：${id}`);let r=id;while(parent.get(r)!==r)r=parent.get(r)!;return r;};
 for(const l of d.endpointLinks??[]){
  for(const e of [l.a,l.b])if(!curveById(d,e.curveId)||![0,1].includes(e.end))fail('INVALID_REFERENCE','端点联动引用无效。');
  const a=root(nodeAt(d,l.a).id),b=root(nodeAt(d,l.b).id);if(a!==b)parent.set(b,a);
 }
 const nodeGroup=new Map(d.nodes.map(n=>[n.id,root(n.id)])),groups=new Map<string,string[]>();
 for(const [id,r] of nodeGroup)groups.set(r,[...(groups.get(r)??[]),id]);
 const groupMirrors=new Map<string,Set<string>>(),handleMirror=new Map<string,string>(),pairedCurves=new Set<string>(),pairIds=new Set<string>();
 const relation=(a:string,b:string)=>{groupMirrors.set(a,new Set([...(groupMirrors.get(a)??[]),b]));groupMirrors.set(b,new Set([...(groupMirrors.get(b)??[]),a]));};
 for(const p of config.curvePairs){
  if(!p||typeof p.id!=='string'||!p.id||pairIds.has(p.id)||typeof p.a!=='string'||typeof p.b!=='string'||typeof p.reverse!=='boolean')fail('INVALID_CONFIG','镜像曲线配对无效或重复。');
  pairIds.add(p.id);const a=curveById(d,p.a),b=curveById(d,p.b);if(!a||!b)fail('INVALID_REFERENCE','镜像配对引用了不存在的曲线。');
  if(pairedCurves.has(p.a)||pairedCurves.has(p.b))fail('PAIR_CONFLICT','一条曲线只能属于一个镜像配对。');
  pairedCurves.add(p.a);pairedCurves.add(p.b);
  for(const e of [0,1] as const){const f=(p.reverse?1-e:e) as 0|1;
   relation(nodeGroup.get(a.nodes[e])!,nodeGroup.get(b.nodes[f])!);
   const x=endKey({curveId:a.id,end:e}),y=endKey({curveId:b.id,end:f});handleMirror.set(x,y);handleMirror.set(y,x);
  }
 }
 // Retain legacy axis-node identities for compatibility, without projecting them.
 const axisGroups=new Set<string>();
 for(const [a,bs] of groupMirrors)if(bs.has(a))axisGroups.add(a);
 for(const id of config.axisNodeIds??[]){if(typeof id!=='string'||!nodeGroup.has(id))fail('INVALID_REFERENCE','轴上节点引用无效。');const group=nodeGroup.get(id)!;axisGroups.add(group);for(const other of groupMirrors.get(group)??[])axisGroups.add(other);}
 return {config,nodeGroup,groups,groupMirrors,axisGroups,handleMirror,pairedCurves};
}

/** Validate references only. Loading or enabling never rewrites or rejects
 * existing asymmetric geometry. Endpoint links are validated by the document. */
export function validateMirrorEditing(d:DrawingDocument,config=configOf(d)){
 const r=compile(d,config);
 return {enabled:!!r?.config.enabled,pairCount:r?.config.curvePairs.length??0,pairedCurveIds:[...(r?.pairedCurves??[])],axisNodeIds:r?[...r.axisGroups].flatMap(id=>r.groups.get(id)!):[]};
}

/** Compatibility entry point for pointer drags. Mirror editing never clamps. */
export function constrainMirrorNodePosition(d:DrawingDocument,nodeId:string,position:Point2):Point2 {
 if(!finitePoint(position))return fail('INVALID_CONFIG','镜像编辑坐标无效。');
 if(!d.nodes.some(n=>n.id===nodeId))fail('INVALID_REFERENCE','镜像节点不存在。');
 return pointCopy(position);
}

/** Collect selected controls after their final fitted/rotated handles. */
export function mirrorWritesForCurves(d:DrawingDocument,curveIds:readonly string[]):MirrorAuthoredWrites {
 const nodes=new Map<string,Point2>(),handles:NonNullable<MirrorAuthoredWrites['handles']>=[];
 for(const id of new Set(curveIds)){const c=curveById(d,id);if(!c)fail('INVALID_REFERENCE',`曲线不存在：${id}`);
  for(const end of [0,1] as const){nodes.set(c.nodes[end],pointCopy(nodeAt(d,{curveId:id,end}).position));handles.push({curveId:id,end,position:pointCopy(c.handles[end])});}
 }
 return {nodes:[...nodes].map(([nodeId,position])=>({nodeId,position})),handles};
}

/** Propagate the reflected edit delta once. Existing asymmetry is preserved.
 * Nodes move first; handles propagate their node-relative vector delta so node
 * translation is never applied twice. Real links and smooth joins retain their
 * topology rules; mirrors never override a directly authored counterpart. */
export function applyMirrorEditing(before:DrawingDocument,after:DrawingDocument,writes:MirrorAuthoredWrites={}):DrawingDocument {
 if(!configOf(before)?.enabled)return after;
 // Topology commands own their remapping/metadata cleanup, not mirrored edits.
 if(JSON.stringify(before.mirrorEditing)!==JSON.stringify(after.mirrorEditing)||JSON.stringify(before.endpointLinks)!==JSON.stringify(after.endpointLinks)||before.curves.some(c=>{const next=curveById(after,c.id);return !next||c.nodes.some((id,i)=>id!==next.nodes[i]);}))return after;
 const r=compile(before)!;
 const oldNodes=new Map(before.nodes.map(n=>[n.id,n.position])),rawNodes=new Map(after.nodes.map(n=>[n.id,n.position]));
 const directNodes=new Map<string,Point2>(),directHandles=new Map<string,Point2>();
 for(const w of writes.nodes??[]){if(!r.nodeGroup.has(w.nodeId)||!rawNodes.has(w.nodeId)||!finitePoint(w.position))fail('INVALID_REFERENCE','直接编辑的镜像节点或坐标无效。');directNodes.set(w.nodeId,pointCopy(w.position));}
 for(const w of writes.handles??[]){if(!curveById(after,w.curveId)||![0,1].includes(w.end)||!finitePoint(w.position))fail('INVALID_REFERENCE','直接编辑的控制柄或坐标无效。');directHandles.set(endKey(w),pointCopy(w.position));}
 const oldGroups=new Map<string,Point2>(),authoredGroups=new Map<string,Point2>(),changedGroups=new Map<string,Point2>();
 for(const [group,ids] of r.groups){
  const old=oldNodes.get(ids[0])!;oldGroups.set(group,old);
  if(ids.some(id=>!near(oldNodes.get(id)!,old)))fail('CONSTRAINT_CONFLICT','端点联动组件的位置不一致。');
  const explicit=ids.filter(id=>directNodes.has(id)).map(id=>directNodes.get(id)!);
  if(explicit.length){if(explicit.some(p=>!near(p,explicit[0])))fail('AUTHORED_CONFLICT','同一联动节点不能同时移动到不同位置。');authoredGroups.set(group,explicit[0]);}
  const changed=ids.filter(id=>rawNodes.has(id)&&changedPoint(oldNodes.get(id)!,rawNodes.get(id)!)).map(id=>rawNodes.get(id)!);
  if(changed.length){if(changed.some(p=>!near(p,changed[0])))fail('CONSTRAINT_CONFLICT','端点联动组件的位置不一致。');changedGroups.set(group,changed[0]);}
 }
 const targets=new Map<string,Point2>(),visited=new Set<string>();
 for(const group of r.groups.keys()){
  if(visited.has(group))continue;const component=[group];visited.add(group);
  for(const id of component)for(const other of r.groupMirrors.get(id)??[])if(!visited.has(other)){visited.add(other);component.push(other);}
  const authored=component.filter(id=>authoredGroups.has(id)),seeds=authored.length?authored:component.filter(id=>changedGroups.has(id)),protectedGroups=new Set(seeds),fixed=new Map<string,Point2>();
  const queue:Array<[string,Point2]>=seeds.map(id=>[id,authoredGroups.get(id)??changedGroups.get(id)!]);
  for(let i=0;i<queue.length;i++){
   const [id,p]=queue[i],prior=fixed.get(id);if(prior){if(!near(prior,p))fail('CONSTRAINT_CONFLICT','镜像编辑对同一联动节点产生了不同目标。');continue;}fixed.set(id,p);
   for(const other of r.groupMirrors.get(id)??[])if(other!==id&&!protectedGroups.has(other))queue.push([other,add(oldGroups.get(other)!,reflectDelta(sub(p,oldGroups.get(id)!)))]);
  }
  for(const [id,p] of fixed)for(const nodeId of r.groups.get(id)!)if(rawNodes.has(nodeId))targets.set(nodeId,p);
 }
 const finalNodes=new Map([...rawNodes].map(([id,p])=>[id,targets.get(id)??p]));
 const points=new Map<string,Point2>(),oldVectors=new Map<string,Point2>(),rawChanged=new Set<string>(),handleEnds=new Map<string,Endpoint>();
 for(const c of after.curves)for(const end of [0,1] as const){
  const key=endKey({curveId:c.id,end}),old=curveById(before,c.id),delta=sub(finalNodes.get(c.nodes[end])!,rawNodes.get(c.nodes[end])!);
  points.set(key,add(c.handles[end],delta));handleEnds.set(key,{curveId:c.id,end});
  if(old){const oldVector=sub(old.handles[end],oldNodes.get(old.nodes[end])!);oldVectors.set(key,oldVector);if(changedPoint(oldVector,sub(c.handles[end],rawNodes.get(c.nodes[end])!)))rawChanged.add(key);}
  const explicit=directHandles.get(key);if(explicit)directHandles.set(key,add(explicit,delta));
 }
 type Edge={to:string;kind:'mirror'|'smooth'};
 const edges=new Map<string,Edge[]>(),smoothGroup=new Map<string,string>();const edge=(a:string,b:string,kind:Edge['kind'])=>edges.set(a,[...(edges.get(a)??[]),{to:b,kind}]);
 for(const [a,b] of r.handleMirror)if(a!==b){edge(a,b,'mirror');}
 for(const j of after.joins)if(j.mode==='SMOOTH'){edge(endKey(j.a),endKey(j.b),'smooth');edge(endKey(j.b),endKey(j.a),'smooth');}
 for(const key of points.keys())if(!smoothGroup.has(key)){const ids=[key];smoothGroup.set(key,key);for(const id of ids)for(const e of edges.get(id)??[])if(e.kind==='smooth'&&!smoothGroup.has(e.to)){smoothGroup.set(e.to,key);ids.push(e.to);}}
 const fixed=new Map<string,Point2>(),seen=new Set<string>();
 const origin=(key:string)=>{const e=handleEnds.get(key);if(!e)return fail('TOPOLOGY_CHANGED','镜像控制柄引用已改变。');return finalNodes.get(curveById(after,e.curveId).nodes[e.end])!;};
 for(const start of points.keys()){
  if(seen.has(start))continue;const component=[start];seen.add(start);
  for(const id of component)for(const e of edges.get(id)??[])if(!seen.has(e.to)){seen.add(e.to);component.push(e.to);}
  const authored=component.filter(id=>directHandles.has(id)),changed=component.filter(id=>rawChanged.has(id));
  const atAuthoredNode=changed.filter(id=>{const e=handleEnds.get(id)!;return directNodes.has(curveById(after,e.curveId).nodes[e.end]);});
  const seeds=authored.length?authored:atAuthoredNode.length?atAuthoredNode:changed;
  if(!seeds.length)continue;
  const protectedSmooth=new Set(seeds.map(id=>smoothGroup.get(id)!));
  const queue:Array<[string,Point2]>=seeds.map(id=>[id,pointCopy(directHandles.get(id)??points.get(id)!)]),smoothQueue:string[]=[];
  const conflict=()=>fail(authored.length?'AUTHORED_CONFLICT':'CONSTRAINT_CONFLICT','同一控制柄或平滑接笔收到不兼容的编辑目标。');
  let i=0,j=0;
  while(i<queue.length||j<smoothQueue.length){
   if(i<queue.length){
    const [id,p]=queue[i++],prior=fixed.get(id);if(prior){if(!near(prior,p))conflict();continue;}
    fixed.set(id,p);smoothQueue.push(id);
    for(const e of edges.get(id)??[])if(e.kind==='mirror'&&!protectedSmooth.has(smoothGroup.get(e.to)!)&&smoothGroup.get(id)!==smoothGroup.get(e.to)){
     const delta=reflectDelta(sub(sub(p,origin(id)),oldVectors.get(id)!));queue.push([e.to,add(origin(e.to),add(oldVectors.get(e.to)!,delta))]);
    }
   }else{
    const id=smoothQueue[j++],vector=sub(fixed.get(id)!,origin(id)),size=length(vector);
    for(const e of edges.get(id)??[])if(e.kind==='smooth'){
     const target=fixed.get(e.to),v=sub(target??points.get(e.to)!,origin(e.to)),targetLength=length(v);
     if(size<1e-7||targetLength<1e-7)fail('CONSTRAINT_CONFLICT','平滑连接柄不能缩为零。');
     if(target){if(!near(mul(vector,1/size),mul(v,-1/targetLength)))conflict();}
     else queue.push([e.to,add(origin(e.to),mul(vector,-targetLength/size))]);
    }
   }
  }
 }
 for(const [key,p] of fixed)points.set(key,p);
 let changed=false;
 const nodes=after.nodes.map(n=>{const p=finalNodes.get(n.id)!;if(!finitePoint(p))fail('CONSTRAINT_CONFLICT','镜像产生了无效节点。');if(identical(n.position,p))return n;changed=true;return {...n,position:pointCopy(p)};});
 const curves=after.curves.map(c=>{const h=c.handles.map((_,end)=>points.get(endKey({curveId:c.id,end:end as 0|1}))!) as [Point2,Point2];if(!h.every(finitePoint))fail('CONSTRAINT_CONFLICT','镜像产生了无效控制柄。');if(h.every((p,i)=>identical(p,c.handles[i])))return c;changed=true;return {...c,handles:h.map(pointCopy) as [Point2,Point2]};});
 const result=changed?{...after,nodes,curves}:after;
 for(const c of result.curves){const old=curveById(before,c.id);if(!old)continue;
  const moved=c.nodes.some((id,i)=>changedPoint(finalNodes.get(id)!,oldNodes.get(old.nodes[i])!))||c.handles.some((p,i)=>changedPoint(p,old.handles[i]));
  if(moved&&old.locked)fail('LOCKED','镜像或联动成员已锁定，整次编辑已取消。');
 }
 return result;
}
