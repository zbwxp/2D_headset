import type {LandmarkProject} from '../landmarks/model';
import {onPatchControls} from '../curves/onPatch';
import {isChin,isClosedSource,isOnPatch} from '../curves/model';
import {pointPosition} from '../geometry/evaluation';
import {spatialPlacement,toRelative} from '../head/frame';
import {pointId,chinRoles,defaultRanges,type ChinArm,ensureChin} from './model';
import type {SurfacePatch} from '../patches/model';
import {repairContinuity} from '../continuity/model';
import {domainBoundaries} from '../patches/domain';

/** Replace the obsolete cap topology, rather than hiding it. Source files are
 * untouched. Authored curve/patch UUIDs survive; a collapsed fourth edge becomes
 * an ordinary triangle. A second load is an exact no-op. */
export function migrateChinNode(p:LandmarkProject):LandmarkProject {
 const s=p.chinScaffold;if(!s)return p;if(s.version===3)return {...p,version:'landmarks-0.9.7'};
 const center=pointId('CHIN_M'),ids=new Set(chinRoles.map(pointId)),seams=new Set(p.curves.filter(isChin).map(c=>c.id));
 const P=toRelative(p,pointPosition(p,center));
 const remap=(id:string)=>ids.has(id)?center:id;
 const arms:Record<string,ChinArm>={};
 for(const c of p.curves)if(!isChin(c)&&!isClosedSource(c))for(const id of [c.startLandmarkId,c.endLandmarkId])if(ids.has(id)){
  const role=p.landmarks.find(l=>l.id===id)?.systemRole;
  arms[c.id]=role==='CHIN_N'||role==='CHIN_B'?'DOWN':role==='CHIN_C'||role==='CHIN_F'?'UP':role==='CHIN_RR'||role==='CHIN_LR'?'LOWER_PAIR':'UPPER_PAIR';
 }
 const oldDomains=new Map((p.patches??[]).filter(x=>x.type==='quad'&&x.boundaryUses.some(b=>seams.has(b.curveId))).map(x=>[x.id,domainBoundaries(p,x)]));
 const oldPaths=new Map(p.curves.flatMap(c=>isOnPatch(c)&&c.role==='canonical'&&oldDomains.has(c.hostPatchId)?[[c.id,onPatchControls(p,c).controls] as const]:[]));
 const landmarks=p.landmarks.filter(l=>!ids.has(l.id)||l.id===center).map(l=>{
  const q=l.placement;
  if(l.id!==center&&(q.kind==='CHIN_SURFACE'||q.kind==='ON_CURVE'&&seams.has(q.hostCurveId)))return {...l,systemRole:undefined,placement:spatialPlacement(p,pointPosition(p,l.id))};
  return l;
 });
 const patches=(p.patches??[]).flatMap<SurfacePatch>(x=>{
  const bs=x.boundaryUses.filter(b=>!seams.has(b.curveId)).map(b=>b.kind==='closed'?b:{...b,startLandmarkId:remap(b.startLandmarkId),endLandmarkId:remap(b.endLandmarkId)}).filter(b=>b.kind==='closed'||b.startLandmarkId!==b.endLandmarkId);
  if(bs.length===x.boundaryUses.length)return [{...x,boundaryUses:bs}];
  return bs.length>=2?[{...x,boundaryUses:bs,type:bs.length===2?'lens':bs.length===3?'tri':'quad'}]:[];
 });
 let next:LandmarkProject={...p,version:'landmarks-0.9.7',chinScaffold:{...s,version:3,parameters:{...s.parameters,y:P[1],z:P[2]},bindings:[],ranges:{...defaultRanges},arms},landmarks,patches,
  curves:p.curves.filter(c=>!isChin(c)).map(c=>isClosedSource(c)?c:{...c,startLandmarkId:remap(c.startLandmarkId),endLandmarkId:remap(c.endLandmarkId)}),
  centerlineOrder:[...new Set(p.centerlineOrder.map(remap))],curveSmoothJoins:p.curveSmoothJoins?.filter(j=>!ids.has(j.pointId)&&!seams.has(j.a.curveId)&&!seams.has(j.b.curveId))};
 next=ensureChin(next);
 // Transport hosted UVs when collapsing a quad corner pair. Sum the old
 // bilinear vertex weights at the common vertex, then use triangular weights.
 const uv=(id:string,u:number,v:number):[number,number]=>{
  const old=oldDomains.get(id),x=next.patches?.find(x=>x.id===id);if(!old||x?.type!=='tri')return [u,v];
  const w=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v],weights=new Map<string,number>();
  old.forEach((b,i)=>weights.set(remap(b.startLandmarkId!), (weights.get(remap(b.startLandmarkId!))??0)+w[i]));
  const ring=domainBoundaries(next,x);return [weights.get(ring[1].startLandmarkId!)??0,weights.get(ring[2].startLandmarkId!)??0];
 };
 next={...next,landmarks:next.landmarks.map(l=>{const q=l.placement;if(q.kind!=='ON_PATCH'||!oldDomains.has(q.hostPatchId))return l;const [u,v]=uv(q.hostPatchId,q.u,q.v);return {...l,placement:{...q,u,v}};})};
 // Boundary-hosted curves keep their host boundary identity after reordering.
 next={...next,curves:next.curves.map(c=>{
  if(!('geometryType'in c)||c.geometryType!=='ON_PATCH'||c.role!=='canonical'||!oldDomains.has(c.hostPatchId))return c;
  const old=oldDomains.get(c.hostPatchId)!,x=next.patches!.find(x=>x.id===c.hostPatchId);if(!x)return c;
  const ring=domainBoundaries(next,x),occ=(i:number,id:string)=>{if(i<0)return i;const j=ring.findIndex(b=>b.curveId===old[i]?.curveId);return j>=0?j:ring.findIndex(b=>b.startLandmarkId===id||b.endLandmarkId===id);};
  const cp=oldPaths.get(c.id)?.map(q=>uv(c.hostPatchId,...q));
  const offsets=cp?[[cp[1][0]-cp[0][0],cp[1][1]-cp[0][1]],[cp[2][0]-cp[3][0],cp[2][1]-cp[3][1]]] as [[number,number],[number,number]]:c.path.handleOffsets;
  return {...c,path:{...c.path,startBoundary:occ(c.path.startBoundary,c.startLandmarkId),endBoundary:occ(c.path.endBoundary,c.endLandmarkId),handleOffsets:offsets}};
 })};
 return repairContinuity(next);
}
