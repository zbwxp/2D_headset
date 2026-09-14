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
