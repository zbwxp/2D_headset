import type {LandmarkProject} from '../landmarks/model';
import type {Vec2} from '../project/types';
import {loop,type SurfacePatch} from './model';
import {mirrorBoundary,boundaryGeometry,boundaryParameters,curveLocationOfLandmark,type PatchBoundaryUse} from './boundary';
import {evaluationContext} from '../geometry/evaluation';
import {normalizedArcLengthToT} from '../geometry/bezier';
/** Parameter ordering is the evaluator's ordering, including mirrored canonical charts. */
export function domainBoundaries(p:LandmarkProject,x:SurfacePatch):PatchBoundaryUse[]{
 if(x.canonicalId)return domainBoundaries(p,p.patches!.find(q=>q.id===x.canonicalId)!).map(b=>mirrorBoundary(p,b));
 return x.type==='loop'?x.boundaryUses:loop(p,x.boundaryUses).map(r=>r.use);
}
export function boundaryToDomain(type:SurfacePatch['type'],occurrence:number,t:number):Vec2 {
 if(type==='loop')return [t,occurrence];
 if(type==='lens')return [occurrence===0?t:1-t,occurrence];
 return (type==='quad'?[[t,0],[1,t],[1-t,1],[0,1-t]]:[[t,0],[1-t,t],[0,1-t]])[occurrence] as Vec2;
}
/** Topological membership + exact projected host location; no nearest-world anchor guessing. */
export function boundaryPointLocation(p:LandmarkProject,x:SurfacePatch,id:string,occurrence:number){
 const b=domainBoundaries(p,x)[occurrence];if(!b)throw Error('ON_PATCH boundary occurrence 不存在');
 const ctx=evaluationContext(p),s=curveLocationOfLandmark(b.curveId,id,ctx),g=ctx.curve(b.curveId);
 let t:number;
 if(b.kind==='closed')t=b.reversed?(1-s)%1:s;
 else {
  const {t0,t1}=boundaryParameters(p,b),host=normalizedArcLengthToT(g.arcLengthLUT(),s);let delta=t1-t0,d=host-t0;
  if(g.closed){if(b.reversed){if(delta>=0)delta-=1;while(d>1e-10)d-=1;}else{if(delta<=0)delta+=1;while(d< -1e-10)d+=1;}}
  t=d/delta;
 }
 if(!Number.isFinite(t)||t< -1e-7||t>1+1e-7)throw Error('Point 不在该 Patch boundary 区间内');
 t=Math.max(0,Math.min(1,t));
 const expected=boundaryGeometry(p,b).evaluate(t),actual=ctx.pointPosition(id),scale=Math.max(1,g.arcLengthLUT().at(-1)!);
 if(Math.hypot(...actual.map((v,i)=>v-expected[i]))>scale*1e-7)throw Error('Point 的 spatial Offset 使它离开 Host Patch boundary；请先归零 Offset');
 return {occurrence,t,uv:boundaryToDomain(x.type,occurrence,t)};
}
export function endpointLocations(p:LandmarkProject,x:SurfacePatch,id:string){
 const q=p.landmarks.find(l=>l.id===id)?.placement;
 if(q?.kind==='ON_PATCH')return q.hostPatchId===x.id?[surfacePointLocation(p,x,id,-1)]:[];
 return domainBoundaries(p,x).flatMap((_,i)=>{try{return [boundaryPointLocation(p,x,id,i)];}catch{return [];}});
}

/** -1 identifies an explicitly hosted surface point; nonnegative values retain legacy boundary occurrences. */
export function surfacePointLocation(p:LandmarkProject,x:SurfacePatch,id:string,occurrence:number){
 if(occurrence!==-1)return boundaryPointLocation(p,x,id,occurrence);
 const q=p.landmarks.find(l=>l.id===id)?.placement;
 if(q?.kind!=='ON_PATCH'||q.hostPatchId!==x.id)throw Error('Point 必须附着于所选 Host Patch');
 if(![q.u,q.v].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||(x.type==='tri'&&q.u+q.v>1+1e-10))throw Error('Point 超出 Host Patch 参数域');
 return {occurrence:-1,t:0,uv:[q.u,q.v] as Vec2};
}
