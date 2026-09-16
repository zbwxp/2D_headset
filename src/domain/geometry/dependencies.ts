import {boundaryAnchors} from '../patches/boundary';
import {scaffoldHostIds,SIDE_R} from '../head/scaffold';
import {isSection,isRim} from '../curves/model';
import {repairContinuity} from '../continuity/model';
import type {LandmarkProject} from '../landmarks/model';
export type DependencyKey='frame:head'|'scaffold:head'|`point:${string}`|`curve:${string}`|`patch:${string}`|`cap:${string}`;
/** Explicit dependency-first order; IDs rather than input array order determine traversal. */
export function dependencyGraph(p:LandmarkProject){
 const dependencies=new Map<DependencyKey,DependencyKey[]>();
 dependencies.set("frame:head",[]);
 if(p.loomisScaffold)dependencies.set("scaffold:head",["frame:head"]);
 for(const l of p.landmarks){const q=l.placement;dependencies.set(`point:${l.id}`,q.kind==='LOOMIS_SCAFFOLD'?['scaffold:head',...scaffoldHostIds(q.role).map(id=>`curve:${id}` as DependencyKey)]:q.kind==='ON_SECTION_CAP'?[`cap:${q.hostSurfaceId}`]:q.kind!=='ON_CURVE'?((q.kind==='FRAME_RELATIVE'||q.kind==='ON_LOOMIS_SURFACE')?['frame:head']:[]):q.role==='canonical'?[`curve:${q.hostCurveId}`]:[`curve:${q.hostCurveId}`,`point:${q.canonicalPointId}`]);}
 for(const c of p.curves)dependencies.set(`curve:${c.id}`,[...(isSection(c)?['frame:head' as DependencyKey]:[`point:${c.startLandmarkId}` as DependencyKey,`point:${c.endLandmarkId}` as DependencyKey]),...(isRim(c)?['scaffold:head' as DependencyKey]:[]),...(c.role==='mirror'?[`curve:${c.canonicalCurveId}` as DependencyKey]:[])]);
 for(const cap of p.loomisCaps??[])dependencies.set(`cap:${cap.id}`,[`curve:${cap.hostSectionCurveId}`]);
 for(const patch of p.patches??[])dependencies.set(`patch:${patch.id}`,patch.boundaryUses.flatMap(b=>[`curve:${b.curveId}` as DependencyKey,...boundaryAnchors(b).map(id=>`point:${id}` as DependencyKey)]));
 const order:DependencyKey[]=[],active=new Set<DependencyKey>(),done=new Set<DependencyKey>();
 const visit=(key:DependencyKey)=>{if(done.has(key))return;if(active.has(key))throw Error(`几何依赖存在循环：${key}`);const ds=dependencies.get(key);if(!ds)throw Error(`几何依赖不存在：${key}`);active.add(key);for(const d of [...ds].sort())visit(d);active.delete(key);done.add(key);order.push(key);};
 [...dependencies.keys()].sort().forEach(visit);return {dependencies,order};
}
export function deleteClosure(p:LandmarkProject,seeds:DependencyKey[]):LandmarkProject {
 const {dependencies}=dependencyGraph(p),removed=new Set<DependencyKey>(),queue=[...seeds];
 while(queue.length){const k=queue.pop()!;if(removed.has(k))continue;removed.add(k);
  const id=k.slice(k.indexOf(':')+1),partner=k.startsWith('point:')?p.landmarks.find(l=>l.id===id)?.mirrorPartnerId:k.startsWith('cap:')?p.loomisCaps?.find(c=>c.hostSectionCurveId===p.curves.find(c=>c.id===p.loomisCaps?.find(c=>c.id===id)?.hostSectionCurveId)?.mirrorPartnerCurveId)?.id:k.startsWith('curve:')?p.curves.find(c=>c.id===id)?.mirrorPartnerCurveId:p.patches?.find(x=>x.id===id)?.mirrorPartnerId;
  if(k.startsWith('point:'))for(const c of p.curves)if(isSection(c)&&c.logicalEndpoints?.includes(id))queue.push(`curve:${c.id}`);
  if(partner)queue.push(`${k.startsWith('point:')?'point':k.startsWith('curve:')?'curve':k.startsWith('cap:')?'cap':'patch'}:${partner}`);
  for(const [next,ds]of dependencies)if(ds.includes(k))queue.push(next);
 }
 if(p.landmarks.some(l=>l.systemRole&&removed.has(`point:${l.id}`))||p.curves.some(c=>'systemRole' in c&&c.systemRole&&removed.has(`curve:${c.id}`)))throw Error('系统 Default 对象不可删除；请复制后编辑用户对象。');
 const curves=p.curves.filter(c=>!removed.has(`curve:${c.id}`)),curveIds=new Set(curves.map(c=>c.id));
 const badPatches=new Set((p.patches??[]).filter(x=>x.boundaryUses.some(b=>!curveIds.has(b.curveId)||removed.has(`point:${b.startLandmarkId}`)||removed.has(`point:${b.endLandmarkId}`))).flatMap(x=>[x.id,x.mirrorPartnerId]));
 return repairContinuity({...p,loomisCaps:p.loomisCaps?.filter(c=>!removed.has(`cap:${c.id}`)),landmarks:p.landmarks.filter(l=>!removed.has(`point:${l.id}`)),loomisRegions:p.loomisRegions?.filter(r=>r.cuts.every(c=>!removed.has(`curve:${c.curveId}`))),centerlineOrder:p.centerlineOrder.filter(id=>!removed.has(`point:${id}`)),curves,
 ...(p.patches?{patches:p.patches.filter(x=>!badPatches.has(x.id))}:{}),
 ...(p.surfaceSmooth?{surfaceSmooth:{...p.surfaceSmooth,edgeInfluenceOverrides:Object.fromEntries(Object.entries(p.surfaceSmooth.edgeInfluenceOverrides).filter(([id])=>curveIds.has(id)))}}:{})});
}

/** Compare source geometry only, then walk descendants. Selection/name/locks do not dirty geometry. */
export function dirtyDescendants(old:LandmarkProject,next:LandmarkProject){
 const graph=dependencyGraph(next),dirty=new Set<DependencyKey>();
 if(JSON.stringify(old.headFrame)!==JSON.stringify(next.headFrame))dirty.add('frame:head');
 if(JSON.stringify(old.loomisScaffold)!==JSON.stringify(next.loomisScaffold))dirty.add('scaffold:head');
 const oldPoints=new Map(old.landmarks.map(l=>[l.id,l])),oldCurves=new Map(old.curves.map(c=>[c.id,c]));
 for(const l of next.landmarks)if(JSON.stringify(l.placement)!==JSON.stringify(oldPoints.get(l.id)?.placement))dirty.add(`point:${l.id}`);
 const curveInput=(c:LandmarkProject['curves'][number]|undefined)=>c&&[c.startLandmarkId,c.endLandmarkId,c.role,c.role==='canonical'?(isSection(c)?c.section:isRim(c)?c.systemRole:c.shape):c.canonicalCurveId];
 for(const c of next.curves)if(JSON.stringify(curveInput(c))!==JSON.stringify(curveInput(oldCurves.get(c.id))))dirty.add(`curve:${c.id}`);
 for(const key of graph.order)if(graph.dependencies.get(key)!.some(d=>dirty.has(d)))dirty.add(key);
 const points=new Set([...dirty].filter(k=>k.startsWith('point:')).map(k=>k.slice(6))),curves=new Set([...dirty].filter(k=>k.startsWith('curve:')).map(k=>k.slice(6)));
 const before=new Map((old.patches??[]).map(p=>[p.id,p]));const patches=new Set((next.patches??[]).filter(p=>p.boundaryUses.some(b=>curves.has(b.curveId)||boundaryAnchors(b).some(id=>points.has(id)))||JSON.stringify([p.boundaryUses,p.fullness,p.canonicalId])!==JSON.stringify(before.has(p.id)?[before.get(p.id)!.boundaryUses,before.get(p.id)!.fullness,before.get(p.id)!.canonicalId]:null)).map(p=>p.id));
 for(const p of next.patches??[])if(p.canonicalId&&patches.has(p.canonicalId))patches.add(p.id);
 return {points,curves,patches,order:graph.order.filter(k=>dirty.has(k))};
}
