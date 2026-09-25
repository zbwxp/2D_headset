import type {Vec3} from '../project/types';
import type {ContourMesh,Orientation} from './silhouette';
import {localEdges,type PerspectiveProjection} from './visible';
/** Clip against the same near/far planes as the inspection camera before dividing by Z. */
export function clipPerspective(mesh:ContourMesh,q:Orientation,camera:PerspectiveProjection):ContourMesh{
 const length=Math.hypot(...q),[x,y,z,w]=q.map(v=>v/length),forward=[2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)];
 const depth=(p:Vec3)=>-p.reduce((s,v,k)=>s+(v-camera.position[k])*forward[k],0);
 const near=.1,far=100;
 if(mesh.vertices.every(p=>depth(p)>=near&&depth(p)<=far))return mesh;
 const mix=(a:Vec3,b:Vec3,t:number)=>a.map((v,k)=>v+(b[k]-v)*t) as Vec3;
 const polygon=(input:Vec3[],limit:number,lower:boolean)=>{
  const out:Vec3[]=[];
  for(let i=0;i<input.length;i++){const a=input[i],b=input[(i+1)%input.length],da=depth(a),db=depth(b),ia=lower?da>=limit:da<=limit,ib=lower?db>=limit:db<=limit;
   if(ia)out.push(a);if(ia!==ib)out.push(mix(a,b,(limit-da)/(db-da)));
  }return out;
 };
 const result:ContourMesh={vertices:[],triangles:[],edges:[],boundaries:[],alwaysLines:[]};
 const groups=new Map<string,ContourMesh>();
 for(const t of mesh.triangles){const ps=polygon(polygon(t.indices.map(i=>mesh.vertices[i]),near,true),far,false);if(ps.length<3)continue;
  let g=groups.get(t.patchId);if(!g){g={vertices:[],triangles:[]};groups.set(t.patchId,g);}const at=g.vertices.length;g.vertices.push(...ps);
  for(let i=1;i+1<ps.length;i++)g.triangles.push({...t,indices:[at,at+i,at+i+1]});
 }
 for(const g of groups.values()){const v=result.vertices.length,f=result.triangles.length;result.edges!.push(...localEdges(g).map(e=>({a:e.a+v,b:e.b+v,faces:e.faces.map(i=>i+f)})));result.vertices.push(...g.vertices);result.triangles.push(...g.triangles.map(t=>({...t,indices:t.indices.map(i=>i+v) as [number,number,number]})));}
 for(const kind of ['boundaries','alwaysLines'] as const)for(const line of mesh[kind]??[])for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i],da=depth(a),db=depth(b);let lo=0,hi=1;
  if(Math.abs(db-da)<1e-14){if(da<near||da>far)continue;}else{const u=(near-da)/(db-da),v=(far-da)/(db-da);lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));}
  if(lo<=hi)result[kind]!.push([mix(a,b,lo),mix(a,b,hi)]);
 }
 result.vertices.push(...result.alwaysLines!.flat());
 if(!result.vertices.length)result.vertices.push(...result.boundaries!.flat());
 return result;
}
