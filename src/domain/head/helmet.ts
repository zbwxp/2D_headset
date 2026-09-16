import {rimHeight} from './rim';
import type {LandmarkProject} from '../landmarks/model';
import type {Vec3} from '../project/types';
import type {PatchMesh} from '../patches/geometry';
import {HELMET,helmetRelative,type LoomisScaffold} from './scaffold';
import {toHead} from './frame';
import {sphereTriangles} from './regions';
import {InputCache} from '../geometry/cache';
const cache=new InputCache<PatchMesh>(64);
export const helmetKey=(p:LandmarkProject)=>JSON.stringify([p.headFrame,p.loomisScaffold?.sidePosition,p.loomisScaffold?.roundness,p.loomisScaffold?.rimSag,p.loomisScaffold?.visible]);
/** Upper cranium union side-cap region above its analytic Rim. */
export function helmetDomain(s:LoomisScaffold,v:Vec3){return Math.max(v[1],Math.min(Math.abs(v[0])-s.sidePosition,v[1]-rimHeight(s,v[2])));}
export function helmetMesh(p:LandmarkProject):PatchMesh{
 if(!p.loomisScaffold)return {vertices:[],triangles:[]};const key=helmetKey(p),hit=cache.get(key);if(hit)return hit;
 const s=p.loomisScaffold,vertices:Vec3[]=[],triangles:number[][]=[],lookup=new Map<string,number>();
 const vertex=(v:Vec3)=>{const k=v.map(n=>n.toFixed(11)).join(','),found=lookup.get(k);if(found!==undefined)return found;const id=vertices.length;vertices.push(toHead(p,helmetRelative(s,v)));lookup.set(k,id);return id;};
 const interp=(a:Vec3,b:Vec3,t:number):Vec3=>{const q=a.map((v,i)=>v*(1-t)+b[i]*t) as Vec3,L=Math.hypot(...q);return q.map(v=>v/L) as Vec3;};
 for(const face of sphereTriangles()){
  const poly:Vec3[]=[];for(let i=0;i<3;i++){const a=face[i],b=face[(i+1)%3],va=helmetDomain(s,a),vb=helmetDomain(s,b);if(va>=0)poly.push(a);if((va<0)!==(vb<0)){let lo=0,hi=1;for(let j=0;j<40;j++){const mid=(lo+hi)/2;if((helmetDomain(s,interp(a,b,mid))<0)===(va<0))lo=mid;else hi=mid;}poly.push(interp(a,b,(lo+hi)/2));}}
  for(let i=1;i+1<poly.length;i++){const ids=[vertex(poly[0]),vertex(poly[i]),vertex(poly[i+1])];if(new Set(ids).size===3)triangles.push(ids);}
 }
 const mesh={vertices,triangles};cache.set(key,mesh);return mesh;
}
export const helmetSurfaces=(p:LandmarkProject)=>p.loomisScaffold?.visible?[{id:HELMET,mesh:helmetMesh(p)}]:[];
