import type {LandmarkProject} from './model';
import {validatePlacements} from './placement';
import {isClosedSource} from '../curves/model';
import {followEndpoints} from '../curves/geometry';
import {validateOnPatch} from '../curves/onPatch';
import {validateJoins} from '../curves/smoothJoin/model';
import {isLoomisLocked,blockedLoomisEdit} from '../head/locks';
import {ownerOf} from '../modules/ownership';
import {boundaryKey,validateBoundary,type PatchBoundaryUse} from '../patches/boundary';
import {relations,type Relationship} from '../continuity/model';

/** A merge keeps the first anchor's identity and arc-length position. */
export function mergePointReason(p:LandmarkProject,id:string):string|undefined {
 const l=p.landmarks.find(l=>l.id===id),q=l?.placement;
 if(!l||q?.kind!=='ON_CURVE')return '请选择曲线定位点。';
 if(l.systemRole||q.role==='canonical'&&q.ringEndpoint)return '系统定位点不能合并。';
 if([q.offsetX??0,q.offsetY??0,q.offsetZ??0].some(v=>v!==0))return '只能合并 XYZ Offset 全部为 0 的曲线定位点。';
 if(isLoomisLocked(p,id))return '请先解锁要合并的定位点。';
}

export function mergeCurvePoints(p:LandmarkProject,keepId:string,removeId:string):LandmarkProject {
 if(keepId===removeId)throw Error('请选择另一个曲线定位点。');
 const replacements=new Map<string,string>();
 const pair=(keep:string,remove:string)=>{
  for(const id of [keep,remove]){const reason=mergePointReason(p,id);if(reason)throw Error(reason);}
  const a=p.landmarks.find(l=>l.id===keep)!,b=p.landmarks.find(l=>l.id===remove)!;
  if(a.placement.kind!=='ON_CURVE'||b.placement.kind!=='ON_CURVE')throw Error('请选择曲线定位点。');
  if(a.placement.hostCurveId!==b.placement.hostCurveId)throw Error('两个定位点必须在同一条宿主曲线上。');
  if(a.type!==b.type||a.placement.role!==b.placement.role||!!a.mirrorPartnerId!==!!b.mirrorPartnerId)throw Error('两个定位点必须具有相同的左右镜像关系。');
  if(ownerOf(p,keep)!==ownerOf(p,remove))throw Error('不能合并不同模块的定位点。');
  replacements.set(remove,keep);
  return [a.mirrorPartnerId,b.mirrorPartnerId];
 };
 const [keepMirror,removeMirror]=pair(keepId,removeId);
 if(keepMirror&&removeMirror)pair(keepMirror,removeMirror);
 const remap=(id:string)=>replacements.get(id)??id;
 const boundary=(b:PatchBoundaryUse):PatchBoundaryUse=>b.kind==='closed'?b:{...b,startLandmarkId:remap(b.startLandmarkId),endLandmarkId:remap(b.endLandmarkId)};
 const curves=p.curves.map(c=>{
  if(isClosedSource(c))return c;
  const startLandmarkId=remap(c.startLandmarkId),endLandmarkId=remap(c.endLandmarkId);
  if(startLandmarkId===c.startLandmarkId&&endLandmarkId===c.endLandmarkId)return c;
  if(startLandmarkId===endLandmarkId)throw Error('合并会使相连曲线的两个端点重合，请先处理这条曲线。');
  return {...c,startLandmarkId,endLandmarkId};
 });
 let next:LandmarkProject={...p,curves,landmarks:p.landmarks.filter(l=>!replacements.has(l.id)),centerlineOrder:p.centerlineOrder.filter(id=>!replacements.has(id))};
 if(p.geometryModules)next.geometryModules=Object.fromEntries(Object.entries(p.geometryModules).filter(([id])=>!replacements.has(id)));
 if(p.curveSmoothJoins)next.curveSmoothJoins=p.curveSmoothJoins.map(j=>replacements.has(j.pointId)?{...j,pointId:remap(j.pointId)}:j);
 // Preserve existing surfaces; only rewrite their point references. Never prune a Patch as a side effect.
 if(p.patches)next.patches=p.patches.map(patch=>{
  if(!patch.boundaryUses.some(b=>b.kind!=='closed'&&(replacements.has(b.startLandmarkId)||replacements.has(b.endLandmarkId))))return patch;
  const boundaryUses=patch.boundaryUses.map(boundary);
  const vertices=(uses:PatchBoundaryUse[])=>new Set(uses.flatMap(b=>b.kind==='closed'?[]:[b.startLandmarkId,b.endLandmarkId])).size;
  if(vertices(boundaryUses)!==vertices(patch.boundaryUses)||boundaryUses.some(b=>b.kind!=='closed'&&b.startLandmarkId===b.endLandmarkId))throw Error('合并会塌缩现有 Patch 边界，请先处理该边界。');
  return {...patch,boundaryUses};
 });
 if(p.surfaceContinuity){
  const overrides:Record<string,Relationship>={};
  for(const r of relations(p)){
   const value=r.mode==='crease'?{mode:'crease' as const}:r.mode==='manual'&&r.pair?{mode:'manual' as const,patchIds:r.pair}:undefined;
   if(value)overrides[boundaryKey(next,boundary(r.use))]=value;
  }
  next.surfaceContinuity={overrides};
 }
 validatePlacements(next);
 next=followEndpoints(p,next);
 validateJoins(next);validateOnPatch(next);
 next.patches?.forEach(patch=>patch.boundaryUses.forEach(b=>validateBoundary(next,b)));
 if(blockedLoomisEdit(p,next))throw Error('该操作会修改或删除已锁定的 Loomis 对象，请先解锁。');
 return next;
}
