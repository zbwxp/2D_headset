import {add,sub,mul,length,finitePoint,curveById,nodeAt,endKey,type DrawingDocument,type Endpoint,type Point2} from './model';

/** Persistent authoring relation. It does not mirror paint, ordering or appearance. */
export interface MirrorCurvePair {id:string;a:string;b:string;reverse:boolean}
export interface MirrorEditingConfig {enabled:boolean;curvePairs:MirrorCurvePair[];axisNodeIds?:string[]}
export type MirrorDrawing=DrawingDocument&{mirrorEditing?:MirrorEditingConfig};
/** Explicit, FINAL intended control values, separate from command-generated followers.
 * Keep the last direct write per node/handle in a batch, including writes to BOTH
 * sides. Do not include reflected/linked followers as new authored writes. */
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
const reflect=(p:Point2,axis:number):Point2=>[2*axis-p[0],p[1]];
const pointCopy=(p:Point2):Point2=>[p[0],p[1]];
const configOf=(d:DrawingDocument)=>(d as MirrorDrawing).mirrorEditing;
interface Compiled {
 config:MirrorEditingConfig;axis:number;nodeGroup:Map<string,string>;groups:Map<string,string[]>;
 groupMirror:Map<string,string>;axisGroups:Set<string>;handleMirror:Map<string,string>;
 pairedCurves:Set<string>;
}

function compile(d:DrawingDocument,config=configOf(d)):Compiled|undefined {
 if(config===undefined)return undefined;
 if(!config||typeof config.enabled!=='boolean'||!Array.isArray(config.curvePairs)||config.axisNodeIds!==undefined&&!Array.isArray(config.axisNodeIds))fail('INVALID_CONFIG','镜像编辑配置无效。');
 const axis=d.mirrorAxisX??0;if(!Number.isFinite(axis))fail('INVALID_CONFIG','镜像轴坐标无效。');
 const parent=new Map(d.nodes.map(n=>[n.id,n.id]));
 const root=(id:string):string=>{if(!parent.has(id))return fail('INVALID_REFERENCE',`镜像节点不存在：${id}`);let r=id;while(parent.get(r)!==r)r=parent.get(r)!;return r;};
 for(const l of d.endpointLinks??[]){
  for(const e of [l.a,l.b])if(!curveById(d,e.curveId)||![0,1].includes(e.end))fail('INVALID_REFERENCE','端点联动引用无效。');
  const a=root(nodeAt(d,l.a).id),b=root(nodeAt(d,l.b).id);if(a!==b)parent.set(b,a);
 }
 const nodeGroup=new Map(d.nodes.map(n=>[n.id,root(n.id)])),groups=new Map<string,string[]>();
 for(const [id,r] of nodeGroup)groups.set(r,[...(groups.get(r)??[]),id]);
 const groupMirror=new Map<string,string>(),handleMirror=new Map<string,string>(),nodeMirror=new Map<string,string>(),pairedCurves=new Set<string>(),pairIds=new Set<string>();
 const relation=(m:Map<string,string>,a:string,b:string)=>{
  if(m.has(a)&&m.get(a)!==b||m.has(b)&&m.get(b)!==a)fail('PAIR_CONFLICT','镜像配对不一致：一个成员不能对应多个不同成员。');
  m.set(a,b);m.set(b,a);
 };
 for(const p of config.curvePairs){
  if(!p||typeof p.id!=='string'||!p.id||pairIds.has(p.id)||typeof p.a!=='string'||typeof p.b!=='string'||typeof p.reverse!=='boolean')fail('INVALID_CONFIG','镜像曲线配对无效或重复。');
  pairIds.add(p.id);const a=curveById(d,p.a),b=curveById(d,p.b);if(!a||!b)fail('INVALID_REFERENCE','镜像配对引用了不存在的曲线。');
  if(pairedCurves.has(p.a)||pairedCurves.has(p.b))fail('PAIR_CONFLICT','一条曲线只能属于一个镜像配对。');
  pairedCurves.add(p.a);pairedCurves.add(p.b);
  for(const e of [0,1] as const){const f=(p.reverse?1-e:e) as 0|1;
   relation(nodeMirror,a.nodes[e],b.nodes[f]);
   relation(groupMirror,nodeGroup.get(a.nodes[e])!,nodeGroup.get(b.nodes[f])!);
   relation(handleMirror,endKey({curveId:a.id,end:e}),endKey({curveId:b.id,end:f}));
  }
 }
 const axisGroups=new Set<string>();
 for(const [a,b] of groupMirror)if(a===b)axisGroups.add(a);
 for(const id of config.axisNodeIds??[]){if(typeof id!=='string'||!nodeGroup.has(id))fail('INVALID_REFERENCE','轴上节点引用无效。');const group=nodeGroup.get(id)!;axisGroups.add(group);const other=groupMirror.get(group);if(other)axisGroups.add(other);}
 return {config,axis,nodeGroup,groups,groupMirror,axisGroups,handleMirror,pairedCurves};
}

function assertSymmetric(d:DrawingDocument,r:Compiled){
 const points=new Map(d.nodes.map(n=>[n.id,n.position]));
 for(const [group,ids] of r.groups){
  const p=points.get(ids[0])!;
  if(ids.some(id=>!finitePoint(points.get(id))||!near(points.get(id)!,p)))fail('CONSTRAINT_CONFLICT','端点联动组件的位置不一致。');
  if(r.axisGroups.has(group)&&Math.abs(p[0]-r.axis)>EPS)fail('ASYMMETRIC_SOURCE','中心节点不在镜像轴上，请先调整或关闭镜像编辑。');
  const other=r.groupMirror.get(group);if(other&&!near(reflect(p,r.axis),points.get(r.groups.get(other)![0])!))fail('ASYMMETRIC_SOURCE','现有节点不对称；开启镜像不会覆盖任意一侧。');
 }
 const handles=new Map(d.curves.flatMap(c=>c.handles.map((p,end)=>[endKey({curveId:c.id,end:end as 0|1}),p] as const)));
 for(const [a,b] of r.handleMirror)if(!finitePoint(handles.get(a))||!finitePoint(handles.get(b))||!near(reflect(handles.get(a)!,r.axis),handles.get(b)!))fail('ASYMMETRIC_SOURCE','现有控制柄不对称；开启镜像不会覆盖任意一侧。');
}

/** Validation never repairs geometry. Disabled configurations retain identities
 * but permit asymmetry; enabling must validate the already-authored geometry. */
export function validateMirrorEditing(d:DrawingDocument,config=configOf(d)){
 const r=compile(d,config);if(r?.config.enabled)assertSymmetric(d,r);
 return {enabled:!!r?.config.enabled,pairCount:r?.config.curvePairs.length??0,pairedCurveIds:[...(r?.pairedCurves??[])],axisNodeIds:r?[...r.axisGroups].flatMap(id=>r.groups.get(id)!):[]};
}

/** Call BEFORE a node-drag gesture computes its optional handle-follow rotation. */
export function constrainMirrorNodePosition(d:DrawingDocument,nodeId:string,position:Point2):Point2 {
 if(!finitePoint(position))return fail('INVALID_CONFIG','镜像编辑坐标无效。');
 const r=compile(d);if(!r?.config.enabled)return pointCopy(position);
 if(!r.nodeGroup.has(nodeId))fail('INVALID_REFERENCE','镜像节点不存在。');
 return r.axisGroups.has(r.nodeGroup.get(nodeId)!)?[r.axis,position[1]]:pointCopy(position);
}

/** Whole-curve transforms/fits should collect only explicitly selected members,
 * after their final handle fitting, not the reflected or linked follower curves. */
export function mirrorWritesForCurves(d:DrawingDocument,curveIds:readonly string[]):MirrorAuthoredWrites {
 const nodes=new Map<string,Point2>(),handles:NonNullable<MirrorAuthoredWrites['handles']>=[];
 for(const id of new Set(curveIds)){const c=curveById(d,id);if(!c)fail('INVALID_REFERENCE',`曲线不存在：${id}`);
  for(const end of [0,1] as const){nodes.set(c.nodes[end],pointCopy(nodeAt(d,{curveId:id,end}).position));handles.push({curveId:id,end,position:pointCopy(c.handles[end])});}
 }
 return {nodes:[...nodes].map(([nodeId,position])=>({nodeId,position})),handles};
}

/** Finish a geometry command ONCE, after node-follow rotations / fitted handles.
 * No source is mutated. The result keeps all non-geometry metadata from `after`.
 * The caller owns one undo transaction and interval material transport AFTER this
 * step. This is not a topology editor or a best-fit constraint solver. */
export function applyMirrorEditing(before:DrawingDocument,after:DrawingDocument,writes:MirrorAuthoredWrites={}):DrawingDocument {
 const r=compile(before);if(!r?.config.enabled)return after;assertSymmetric(before,r);
 if((after.mirrorAxisX??0)!==r.axis)fail('CONSTRAINT_CONFLICT','请先关闭镜像编辑，再移动镜像轴。');
 const oldNodes=new Map(before.nodes.map(n=>[n.id,n.position])),rawNodes=new Map(after.nodes.map(n=>[n.id,n.position]));
 for(const id of r.pairedCurves){const a=curveById(before,id),b=curveById(after,id);if(!b||a.nodes.some((n,i)=>n!==b.nodes[i]))fail('TOPOLOGY_CHANGED','请先解除相关镜像配对，再修改源曲线拓扑。');}
 for(const [group,ids] of r.groups)if(r.groupMirror.has(group)||r.axisGroups.has(group))for(const id of ids)if(!rawNodes.has(id))fail('TOPOLOGY_CHANGED','镜像编辑期间不能删除关联节点。');
 const directNodes=new Map<string,Point2>(),directHandles=new Map<string,Point2>();
 for(const w of writes.nodes??[]){if(!r.nodeGroup.has(w.nodeId)||!rawNodes.has(w.nodeId)||!finitePoint(w.position))fail('INVALID_REFERENCE','直接编辑的镜像节点或坐标无效。');directNodes.set(w.nodeId,pointCopy(w.position));}
 for(const w of writes.handles??[]){if(!curveById(after,w.curveId)||![0,1].includes(w.end)||!finitePoint(w.position))fail('INVALID_REFERENCE','直接编辑的控制柄或坐标无效。');directHandles.set(endKey(w),pointCopy(w.position));}
 const targets=new Map<string,Point2>(),visited=new Set<string>();
 for(const [group,ids] of r.groups){
  if(visited.has(group))continue;const other=r.groupMirror.get(group),orbit=other&&other!==group?[group,other]:[group];orbit.forEach(x=>visited.add(x));
  const candidates:(readonly [Point2,boolean])[]=[];
  for(const g of orbit)for(const id of r.groups.get(g)!){const p=directNodes.get(id);if(p)candidates.push([p,g!==group]);}
  const explicit=candidates.length>0;
  if(!explicit)for(const g of orbit)for(const id of r.groups.get(g)!)if(rawNodes.has(id)&&changedPoint(oldNodes.get(id)!,rawNodes.get(id)!))candidates.push([rawNodes.get(id)!,g!==group]);
  if(!candidates.length)continue;
  const canonical=candidates.map(([p,reversed])=>{const q=reversed?reflect(p,r.axis):p;return r.axisGroups.has(group)?[r.axis,q[1]] as Point2:pointCopy(q);});
  if(canonical.some(p=>!near(p,canonical[0])))fail(explicit?'AUTHORED_CONFLICT':'CONSTRAINT_CONFLICT','两侧或联动节点的直接编辑目标不符合镜像关系。');
  for(const g of orbit){let p=g===group?canonical[0]:reflect(canonical[0],r.axis);if(r.axisGroups.has(g))p=[r.axis,p[1]];for(const id of r.groups.get(g)!)if(rawNodes.has(id))targets.set(id,p);}
 }
 const finalNodes=new Map([...rawNodes].map(([id,p])=>[id,targets.get(id)??p]));
 const points=new Map<string,Point2>(),rawChanged=new Set<string>(),handleEnds=new Map<string,Endpoint>();
 for(const c of after.curves)for(const end of [0,1] as const){
  const key=endKey({curveId:c.id,end}),old=curveById(before,c.id),delta=sub(finalNodes.get(c.nodes[end])!,rawNodes.get(c.nodes[end])!);
  points.set(key,add(c.handles[end],delta));handleEnds.set(key,{curveId:c.id,end});
  if(old&&changedPoint(old.handles[end],c.handles[end]))rawChanged.add(key);
  const explicit=directHandles.get(key);if(explicit)directHandles.set(key,add(explicit,delta));
 }
 type Edge={to:string;kind:'mirror'|'smooth'};
 const edges=new Map<string,Edge[]>();const edge=(a:string,b:string,kind:Edge['kind'])=>edges.set(a,[...(edges.get(a)??[]),{to:b,kind}]);
 for(const [a,b] of r.handleMirror)edge(a,b,'mirror');
 for(const j of after.joins)if(j.mode==='SMOOTH'){edge(endKey(j.a),endKey(j.b),'smooth');edge(endKey(j.b),endKey(j.a),'smooth');}
 const fixed=new Map<string,Point2>(),seen=new Set<string>();
 const origin=(key:string)=>{const e=handleEnds.get(key);if(!e)return fail('TOPOLOGY_CHANGED','镜像控制柄引用已改变。');return finalNodes.get(curveById(after,e.curveId).nodes[e.end])!;};
 for(const start of points.keys()){
  if(seen.has(start))continue;const component=[start];seen.add(start);
  for(const id of component)for(const e of edges.get(id)??[])if(!seen.has(e.to)){seen.add(e.to);component.push(e.to);}
  const authored=component.filter(id=>directHandles.has(id)),changed=component.filter(id=>rawChanged.has(id));
  // A node command/transform can alter both a real shared-node neighbour and a
  // position-linked follower. The directly authored NODE identity tells which
  // side supplied the final handle rotation/transform, even at a linked chin.
  const atAuthoredNode=changed.filter(id=>{const e=handleEnds.get(id)!;return directNodes.has(curveById(after,e.curveId).nodes[e.end]);});
  const seeds=authored.length?authored:atAuthoredNode.length?atAuthoredNode:changed;
  if(!seeds.length)continue;
  const queue:Array<[string,Point2]>=seeds.map(id=>[id,pointCopy(directHandles.get(id)??points.get(id)!)]),smoothQueue:string[]=[];
  const conflict=()=>fail(authored.length?'AUTHORED_CONFLICT':'CONSTRAINT_CONFLICT','控制柄的镜像、平滑接笔或双侧编辑约束冲突。');
  let i=0,j=0;
  while(i<queue.length||j<smoothQueue.length){
   // First satisfy exact control reflection. Smooth only constrains the ray,
   // so a reflected/explicit target may legitimately acquire a new length.
   if(i<queue.length){
    const [id,input]=queue[i++],p=r.handleMirror.get(id)===id?[r.axis,input[1]] as Point2:input;
    const prior=fixed.get(id);if(prior){if(!near(prior,p))conflict();continue;}
    fixed.set(id,p);smoothQueue.push(id);
    for(const e of edges.get(id)??[])if(e.kind==='mirror')queue.push([e.to,reflect(p,r.axis)]);
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
 assertSymmetric(result,compile(result,r.config)!);return result;
}
