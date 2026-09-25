import {chinAttachments} from '../chin/junction';
import {isChin} from '../curves/model';
import {joinOccurrences} from '../curves/smoothJoin/model';
import {isFree3DShape,isDerived} from '../curves/model';
import {boundaryAnchors} from '../patches/boundary';
import {scaffoldHostIds,SIDE_R} from '../head/scaffold';
import {isSection,isRim,isOnPatch,isClosedSource,isHelmetLoop,isLogicalRing} from '../curves/model';
import {repairContinuity,relations} from '../continuity/model';
import type {LandmarkProject} from '../landmarks/model';
export type DependencyKey='frame:head'|'scaffold:head'|'chin:head'|`point:${string}`|`curve:${string}`|`patch:${string}`|`cap:${string}`|`natural:${string}`|`curveSource:${string}`|`join:${string}`;
/** Explicit dependency-first order; IDs rather than input array order determine traversal. */
export function dependencyGraph(p:LandmarkProject,stages=true){
 const dependencies=new Map<DependencyKey,DependencyKey[]>();
 dependencies.set("frame:head",[]);
 if(p.loomisScaffold)dependencies.set("scaffold:head",["frame:head"]);
 if(p.chinScaffold)dependencies.set('chin:head',['frame:head',...p.chinScaffold.bindings.map(b=>`curve:${b.curveId}` as DependencyKey)]);
 for(const l of p.landmarks){const q=l.placement;dependencies.set(`point:${l.id}`,q.kind==='CHIN_SURFACE'?['chin:head']:q.kind==='ON_PATCH'?[`patch:${q.hostPatchId}`]:q.kind==='LOOMIS_SCAFFOLD'?['scaffold:head',...scaffoldHostIds(q.role).map(id=>`curve:${id}` as DependencyKey)]:q.kind==='ON_SECTION_CAP'?[`cap:${q.hostSurfaceId}`]:q.kind!=='ON_CURVE'?((q.kind==='EYE_LOCAL'||q.kind==='FRAME_RELATIVE'||q.kind==='ON_LOOMIS_SURFACE')?['frame:head']:[]):q.role==='canonical'?[`curve:${q.hostCurveId}`]:[`curve:${q.hostCurveId}`,`point:${q.canonicalPointId}`]);}
 for(const c of p.curves)dependencies.set(`curve:${c.id}`,isChin(c)?['chin:head'] :[...(c.role==='canonical'&&!isDerived(c)&&isFree3DShape(c.shape)?['frame:head' as DependencyKey]:[]),...(isClosedSource(c)?['frame:head' as DependencyKey]:[`point:${c.startLandmarkId}` as DependencyKey,`point:${c.endLandmarkId}` as DependencyKey]),...(isHelmetLoop(c)?c.sourceCurveIds.map(id=>`curve:${id}` as DependencyKey):[]),...('controlPointIds' in c?c.controlPointIds.map(id=>`point:${id}` as DependencyKey):[]),...(isOnPatch(c)?[`patch:${c.hostPatchId}` as DependencyKey]:[]),...(isRim(c)?['scaffold:head' as DependencyKey]:[]),...(c.role==='mirror'?[`curve:${c.canonicalCurveId}` as DependencyKey]:[])]);
 for(const side of ['left','right'] as const)for(const [i,id] of (p.eyeScaffold?.[side].frontCurveIds??[]).entries())dependencies.set(`curve:${id}`,[`curve:${p.eyeScaffold![side].curveIds[i*4]}`,`curve:${p.eyeScaffold![side].curveIds[i*4+1]}`]);
 for(const cap of p.loomisCaps??[])dependencies.set(`cap:${cap.id}`,[`curve:${cap.hostSectionCurveId}`]);
 for(const patch of p.patches??[])dependencies.set(`patch:${patch.id}`,patch.boundaryUses.flatMap(b=>[`curve:${b.curveId}` as DependencyKey,...boundaryAnchors(b).map(id=>`point:${id}` as DependencyKey)]));
 if(stages&&(p.curveSmoothJoins?.length||p.chinScaffold?.version===3)){
  for(const c of p.curves)if(!isDerived(c)){
   const ds=dependencies.get(`curve:${c.id}`)!;
   dependencies.set(`curveSource:${c.id}`,ds.map(d=>d.startsWith('curve:')?`curveSource:${d.slice(6)}` as DependencyKey:d));
   dependencies.set(`curve:${c.id}`,[`curveSource:${c.id}`]);
  }
  for(const j of p.curveSmoothJoins??[]){
   dependencies.set(`join:${j.id}`,[`curveSource:${j.a.curveId}`,`curveSource:${j.b.curveId}`,`point:${j.pointId}`]);
   for(const x of joinOccurrences(p,j))for(const e of [x.a,x.b])dependencies.get(`curve:${e.curveId}`)!.push(`join:${j.id}`);
  }
 }
 if(stages&&p.chinScaffold?.version===3){
  const ids=chinAttachments(p).map(a=>a.curveId);
  dependencies.set('join:chin',[...ids.map(id=>`curveSource:${id}` as DependencyKey),'chin:head']);
  for(const id of ids)dependencies.get(`curve:${id}`)!.push('join:chin');
 }
 const order:DependencyKey[]=[],active=new Set<DependencyKey>(),done=new Set<DependencyKey>();
 const visit=(key:DependencyKey)=>{if(done.has(key))return;if(active.has(key))throw Error(`几何/Continuity Final feedback 依赖存在循环：${key}`);const ds=dependencies.get(key);if(!ds)throw Error(`几何依赖不存在：${key}`);active.add(key);for(const d of [...ds].sort())visit(d);active.delete(key);done.add(key);order.push(key);};
 [...dependencies.keys()].sort().forEach(visit);
 if(stages&&(p.curves.some(isOnPatch)||p.landmarks.some(l=>l.placement.kind==='ON_PATCH'))){
  // Validate source DAG first, then expand actual Natural -> Final dependencies.
  for(const x of p.patches??[]){
   const source=dependencies.get(`patch:${x.id}`)!;
   dependencies.set(`natural:${x.id}`,x.canonicalId?[`natural:${x.canonicalId}`]:source);
   dependencies.set(`patch:${x.id}`,x.canonicalId?[`patch:${x.canonicalId}`]:[`natural:${x.id}`]);
  }
  for(const r of relations(p))if(r.pair)for(const id of r.pair){const x=p.patches!.find(x=>x.id===id)!;if(!x.canonicalId)dependencies.get(`patch:${id}`)!.push(...r.pair.map(q=>`natural:${q}` as DependencyKey));}
  order.length=0;done.clear();active.clear();[...dependencies.keys()].sort().forEach(visit);
 }
 return {dependencies,order};
}
export function deleteClosure(p:LandmarkProject,seeds:DependencyKey[]):LandmarkProject {
 const {dependencies}=dependencyGraph(p,false),removed=new Set<DependencyKey>(),queue=[...seeds];
 while(queue.length){const k=queue.pop()!;if(removed.has(k))continue;removed.add(k);
  const id=k.slice(k.indexOf(':')+1),partner=k.startsWith('point:')?p.landmarks.find(l=>l.id===id)?.mirrorPartnerId:k.startsWith('cap:')?p.loomisCaps?.find(c=>c.hostSectionCurveId===p.curves.find(c=>c.id===p.loomisCaps?.find(c=>c.id===id)?.hostSectionCurveId)?.mirrorPartnerCurveId)?.id:k.startsWith('curve:')?p.curves.find(c=>c.id===id)?.mirrorPartnerCurveId:p.patches?.find(x=>x.id===id)?.mirrorPartnerId;
  if(k.startsWith('point:'))for(const c of p.curves)if(isLogicalRing(c)&&c.logicalEndpoints?.includes(id))queue.push(`curve:${c.id}`);
  if(partner)queue.push(`${k.startsWith('point:')?'point':k.startsWith('curve:')?'curve':k.startsWith('cap:')?'cap':'patch'}:${partner}`);
  for(const [next,ds]of dependencies)if(next!=='chin:head'&&ds.includes(k))queue.push(next);
 }
 if(p.landmarks.some(l=>l.systemRole&&removed.has(`point:${l.id}`))||p.curves.some(c=>'systemRole' in c&&c.systemRole&&removed.has(`curve:${c.id}`)))throw Error('系统 Default 对象不可删除；请复制后编辑用户对象。');
 const curves=p.curves.filter(c=>!removed.has(`curve:${c.id}`)),curveIds=new Set(curves.map(c=>c.id));
 const badPatches=new Set((p.patches??[]).filter(x=>x.boundaryUses.some(b=>!curveIds.has(b.curveId)||removed.has(`point:${b.startLandmarkId}`)||removed.has(`point:${b.endLandmarkId}`))).flatMap(x=>[x.id,x.mirrorPartnerId]));
 return repairContinuity({...p,...(p.chinScaffold?{chinScaffold:{...p.chinScaffold,bindings:p.chinScaffold.bindings.filter(b=>curveIds.has(b.curveId))}}:{}),curveSmoothJoins:p.curveSmoothJoins?.filter(j=>joinOccurrences(p,j).every(x=>!removed.has(`point:${x.pointId}`)&&[x.a,x.b].every(e=>curveIds.has(e.curveId)))),loomisCaps:p.loomisCaps?.filter(c=>!removed.has(`cap:${c.id}`)),landmarks:p.landmarks.filter(l=>!removed.has(`point:${l.id}`)),loomisRegions:p.loomisRegions?.filter(r=>r.cuts.every(c=>!removed.has(`curve:${c.curveId}`))),centerlineOrder:p.centerlineOrder.filter(id=>!removed.has(`point:${id}`)),curves,
 ...(p.patches?{patches:p.patches.filter(x=>!badPatches.has(x.id)&&!removed.has(`patch:${x.id}`))}:{}),
 ...(p.surfaceSmooth?{surfaceSmooth:{...p.surfaceSmooth,edgeInfluenceOverrides:Object.fromEntries(Object.entries(p.surfaceSmooth.edgeInfluenceOverrides).filter(([id])=>curveIds.has(id)))}}:{})});
}

/** Compare source geometry only, then walk descendants. Selection/name/locks do not dirty geometry. */
export function dirtyDescendants(old:LandmarkProject,next:LandmarkProject){
 const graph=dependencyGraph(next),dirty=new Set<DependencyKey>();
 if(JSON.stringify(old.headFrame)!==JSON.stringify(next.headFrame))dirty.add('frame:head');
 if(JSON.stringify(old.chinScaffold)!==JSON.stringify(next.chinScaffold))dirty.add('chin:head');
 if(JSON.stringify(old.loomisScaffold)!==JSON.stringify(next.loomisScaffold))dirty.add('scaffold:head');
 if(JSON.stringify(old.eyeScaffold)!==JSON.stringify(next.eyeScaffold))for(const l of next.landmarks)if(l.placement.kind==='EYE_LOCAL')dirty.add(`point:${l.id}`);
 const oldPoints=new Map(old.landmarks.map(l=>[l.id,l])),oldCurves=new Map(old.curves.map(c=>[c.id,c]));
 for(const l of next.landmarks)if(JSON.stringify(l.placement)!==JSON.stringify(oldPoints.get(l.id)?.placement))dirty.add(`point:${l.id}`);
 const curveInput=(c:LandmarkProject['curves'][number]|undefined)=>c&&[c.startLandmarkId,c.endLandmarkId,c.role,c.role==='canonical'?(isChin(c)?c.slot:isHelmetLoop(c)?c.sourceCurveIds:isSection(c)?c.section:isRim(c)?c.systemRole:isOnPatch(c)?[c.hostPatchId,c.path]:'controlPointIds' in c?c.controlPointIds:c.shape):c.canonicalCurveId];
 for(const c of next.curves)if(JSON.stringify(curveInput(c))!==JSON.stringify(curveInput(oldCurves.get(c.id)))){dirty.add(`curve:${c.id}`);if(graph.dependencies.has(`curveSource:${c.id}`))dirty.add(`curveSource:${c.id}`);}

 if(JSON.stringify(old.curveSmoothJoins)!==JSON.stringify(next.curveSmoothJoins)){
  const previous=new Map((old.curveSmoothJoins??[]).map(j=>[j.id,j]));
  const current=new Map((next.curveSmoothJoins??[]).map(j=>[j.id,j]));
  for(const id of new Set([...previous.keys(),...current.keys()]))if(JSON.stringify(previous.get(id))!==JSON.stringify(current.get(id))){
   dirty.add(`join:${id}`);
   for(const [p,j]of [[old,previous.get(id)],[next,current.get(id)]] as const)if(j)for(const x of joinOccurrences(p,j))for(const e of [x.a,x.b])dirty.add(`curve:${e.curveId}`);
  }
 }
 const before=new Map((old.patches??[]).map(x=>[x.id,x]));
 for(const x of next.patches??[]){
  const a=before.get(x.id);
  if(JSON.stringify([x.boundaryUses,x.fullness,x.canonicalId])!==JSON.stringify(a?[a.boundaryUses,a.fullness,a.canonicalId]:null))dirty.add(`patch:${x.id}`);
  if(graph.dependencies.has(`natural:${x.id}`)&&JSON.stringify([x.boundaryUses,x.canonicalId])!==JSON.stringify(a?[a.boundaryUses,a.canonicalId]:null))dirty.add(`natural:${x.id}`);
 }
 if(JSON.stringify(old.surfaceContinuity)!==JSON.stringify(next.surfaceContinuity)){
  const previous=new Map(relations(old).map(r=>[r.key,r]));
  for(const r of relations(next)){const a=previous.get(r.key);if(JSON.stringify(r.pair)!==JSON.stringify(a?.pair))for(const id of [...(r.pair??[]),...(a?.pair??[])]){dirty.add(`patch:${id}`);const x=next.patches?.find(x=>x.id===id);if(x?.canonicalId)dirty.add(`patch:${x.canonicalId}`);}}
 }
 for(const key of graph.order)if(graph.dependencies.get(key)!.some(d=>dirty.has(d)))dirty.add(key);
 const ids=(prefix:string)=>new Set([...dirty].filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length)));
 return {points:ids('point:'),curves:ids('curve:'),patches:ids('patch:'),order:graph.order.filter(k=>dirty.has(k))};
}
