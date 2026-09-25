import {Ray,Vector3} from 'three';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {Vec2} from '../../domain/project/types';
import type {OrthographicViewState} from '../../rendering/orthographic';
import {evaluator} from '../../domain/patches/geometry';
import {displayTransform} from '../../rendering/moduleDisplay';
import {screenRay} from './constrainedDrag';
/** Intersect the same displayed surface, retaining parameter coordinates rather than mesh IDs. */
export function patchPointHit(p:LandmarkProject,screen:Vec2,view:OrthographicViewState,ids:Set<string>){
 if(p.patchDisplay?.visible===false)return;
 const r=screenRay(screen,view),ray=new Ray(new Vector3(...r.origin),new Vector3(...r.direction));let result:{id:string;u:number;v:number;depth:number}|undefined;
 for(const patch of p.patches??[]){if(!ids.has(patch.id)||patch.type!=='quad')continue;
 const f=evaluator(p,patch),pose=displayTransform(p,patch.id,view.forward),n=32,points=Array.from({length:(n+1)**2},(_,i)=>new Vector3(...pose.display(f(i%(n+1)/n,Math.floor(i/(n+1))/n))));
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i;for(const indices of [[a,a+1,a+n+1],[a+1,a+n+2,a+n+1]]){
 const [A,B,C]=indices.map(k=>points[k]),hit=ray.intersectTriangle(A,B,C,false,new Vector3());if(!hit)continue;const depth=hit.distanceTo(ray.origin);if(result&&depth>=result.depth)continue;
 const ab=B.clone().sub(A),ac=C.clone().sub(A),ah=hit.clone().sub(A),den=ab.dot(ab)*ac.dot(ac)-ab.dot(ac)**2;if(Math.abs(den)<1e-20)continue;
 const b=(ac.dot(ac)*ah.dot(ab)-ab.dot(ac)*ah.dot(ac))/den,c=(ab.dot(ab)*ah.dot(ac)-ab.dot(ac)*ah.dot(ab))/den,w=[1-b-c,b,c];
 result={id:patch.id,u:indices.reduce((s,k,t)=>s+w[t]*(k%(n+1)/n),0),v:indices.reduce((s,k,t)=>s+w[t]*(Math.floor(k/(n+1))/n),0),depth};
 }}
 }return result;
}
