import type {LandmarkProject} from '../landmarks/model';
import type {SurfacePatch} from '../patches/model';
import type {PatchMesh} from '../patches/geometry';
import type {Vec3} from '../project/types';
import {chinField,chinSurfaceAttached} from './junction';
import {sub,dot,add,scale} from '../geometry/core';
/** Resolve a 0.01R neighborhood even on a much larger face. Edge decisions
 * use world distances, so adjacent sectors refine their common edge together.
 * Red/green subdivision has no T-junctions within a patch. */
export function refineChin(p:LandmarkProject,x:SurfacePatch,mesh:PatchMesh,uv:[number,number][],f:(u:number,v:number)=>Vec3){
 if(!chinSurfaceAttached(p,x))return;
 const field=chinField(p),C=field.center;
 for(let pass=0;pass<7;pass++){
  const splits=new Map<string,number>(),key=(a:number,b:number)=>a<b?a+':'+b:b+':'+a;
  for(const t of mesh.triangles)for(let i=0;i<3;i++){
   const a=t[i],b=t[(i+1)%3],k=key(a,b);if(splits.has(k))continue;
   const A=mesh.vertices[a],B=mesh.vertices[b],d=sub(B,A),l=Math.hypot(...d),r=field.radius(scale(add(A,B),.5));
   if(l<=r/7)continue;
   const s=Math.max(0,Math.min(1,dot(sub(C,A),d)/(l*l))),distance=Math.hypot(...sub(C,add(A,scale(d,s))));
   if(distance>1.15*r)continue;
   const q:[number,number]=[(uv[a][0]+uv[b][0])/2,(uv[a][1]+uv[b][1])/2];splits.set(k,mesh.vertices.length);mesh.vertices.push(f(...q));uv.push(q);
  }
  if(!splits.size)break;
  mesh.triangles=mesh.triangles.flatMap(([a,b,c])=>{
   const ab=splits.get(key(a,b)),bc=splits.get(key(b,c)),ca=splits.get(key(c,a));
   if(ab!==undefined&&bc!==undefined&&ca!==undefined)return [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]];
   if(ab!==undefined&&bc!==undefined)return [[ab,b,bc],[a,ab,c],[ab,bc,c]];
   if(bc!==undefined&&ca!==undefined)return [[bc,c,ca],[b,bc,a],[bc,ca,a]];
   if(ca!==undefined&&ab!==undefined)return [[ca,a,ab],[c,ca,b],[ca,ab,b]];
   if(ab!==undefined)return [[a,ab,c],[ab,b,c]];
   if(bc!==undefined)return [[b,bc,a],[bc,c,a]];
   if(ca!==undefined)return [[c,ca,b],[ca,a,b]];
   return [[a,b,c]];
  });
 }
}
