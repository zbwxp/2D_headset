import type {LandmarkProject} from '../landmarks/model';
export type DependencyKey=`point:${string}`|`curve:${string}`;
/** Explicit dependency-first order; IDs rather than input array order determine traversal. */
export function dependencyGraph(p:LandmarkProject){
 const dependencies=new Map<DependencyKey,DependencyKey[]>();
 for(const l of p.landmarks){const q=l.placement;dependencies.set(`point:${l.id}`,q.kind==='WORLD'?[]:q.role==='canonical'?[`curve:${q.hostCurveId}`]:[`curve:${q.hostCurveId}`,`point:${q.canonicalPointId}`]);}
 for(const c of p.curves)dependencies.set(`curve:${c.id}`,[`point:${c.startLandmarkId}`,`point:${c.endLandmarkId}`,...(c.role==='mirror'?[`curve:${c.canonicalCurveId}` as DependencyKey]:[])]);
 const order:DependencyKey[]=[],active=new Set<DependencyKey>(),done=new Set<DependencyKey>();
 const visit=(key:DependencyKey)=>{if(done.has(key))return;if(active.has(key))throw Error(`几何依赖存在循环：${key}`);const ds=dependencies.get(key);if(!ds)throw Error(`几何依赖不存在：${key}`);active.add(key);for(const d of [...ds].sort())visit(d);active.delete(key);done.add(key);order.push(key);};
 [...dependencies.keys()].sort().forEach(visit);return {dependencies,order};
}
export function deleteClosure(p:LandmarkProject,seeds:DependencyKey[]):LandmarkProject {
 const {dependencies}=dependencyGraph(p),removed=new Set<DependencyKey>(),queue=[...seeds];
 while(queue.length){const k=queue.pop()!;if(removed.has(k))continue;removed.add(k);
  const id=k.slice(k.indexOf(':')+1),partner=k.startsWith('point:')?p.landmarks.find(l=>l.id===id)?.mirrorPartnerId:p.curves.find(c=>c.id===id)?.mirrorPartnerCurveId;
  if(partner)queue.push(`${k.startsWith('point:')?'point':'curve'}:${partner}`);
  for(const [next,ds]of dependencies)if(ds.includes(k))queue.push(next);
 }
 const curves=p.curves.filter(c=>!removed.has(`curve:${c.id}`)),curveIds=new Set(curves.map(c=>c.id));
 const badPatches=new Set((p.patches??[]).filter(x=>x.boundaryEdgeIds.some(id=>!curveIds.has(id))).flatMap(x=>[x.id,x.mirrorPartnerId]));
 return {...p,landmarks:p.landmarks.filter(l=>!removed.has(`point:${l.id}`)),centerlineOrder:p.centerlineOrder.filter(id=>!removed.has(`point:${id}`)),curves,
 ...(p.patches?{patches:p.patches.filter(x=>!badPatches.has(x.id))}:{}),
 ...(p.surfaceSmooth?{surfaceSmooth:{...p.surfaceSmooth,edgeInfluenceOverrides:Object.fromEntries(Object.entries(p.surfaceSmooth.edgeInfluenceOverrides).filter(([id])=>curveIds.has(id)))}}:{})};
}

/** Compare source geometry only, then walk descendants. Selection/name/locks do not dirty geometry. */
export function dirtyDescendants(old:LandmarkProject,next:LandmarkProject){
 const graph=dependencyGraph(next),dirty=new Set<DependencyKey>();
 const oldPoints=new Map(old.landmarks.map(l=>[l.id,l])),oldCurves=new Map(old.curves.map(c=>[c.id,c]));
 for(const l of next.landmarks)if(JSON.stringify(l.placement)!==JSON.stringify(oldPoints.get(l.id)?.placement))dirty.add(`point:${l.id}`);
 const curveInput=(c:LandmarkProject['curves'][number]|undefined)=>c&&[c.startLandmarkId,c.endLandmarkId,c.role,c.role==='canonical'?c.shape:c.canonicalCurveId];
 for(const c of next.curves)if(JSON.stringify(curveInput(c))!==JSON.stringify(curveInput(oldCurves.get(c.id))))dirty.add(`curve:${c.id}`);
 for(const key of graph.order)if(graph.dependencies.get(key)!.some(d=>dirty.has(d)))dirty.add(key);
 const points=new Set([...dirty].filter(k=>k.startsWith('point:')).map(k=>k.slice(6))),curves=new Set([...dirty].filter(k=>k.startsWith('curve:')).map(k=>k.slice(6)));
 const before=new Map((old.patches??[]).map(p=>[p.id,p]));const patches=new Set((next.patches??[]).filter(p=>p.boundaryEdgeIds.some(id=>curves.has(id))||JSON.stringify([p.boundaryEdgeIds,p.fullness,p.canonicalId])!==JSON.stringify(before.has(p.id)?[before.get(p.id)!.boundaryEdgeIds,before.get(p.id)!.fullness,before.get(p.id)!.canonicalId]:null)).map(p=>p.id));
 for(const p of next.patches??[])if(p.canonicalId&&patches.has(p.canonicalId))patches.add(p.id);
 return {points,curves,patches,order:graph.order.filter(k=>dirty.has(k))};
}
