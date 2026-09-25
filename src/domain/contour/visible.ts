import type {Vec3} from '../project/types';
import {projectMesh,type ContourMesh,type Orientation,type Point,CONTOUR_RESOLUTION} from './silhouette';
export type ScreenPoint=[number,number,number];
export interface MeshEdge {a:number;b:number;faces:number[]}
/** Local derived indexing only. Recovers duplicated chart/Region vertices, never changes source topology. */
export function localEdges(mesh:ContourMesh):MeshEdge[]{
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const v of mesh.vertices)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],v[k]);hi[k]=Math.max(hi[k],v[k]);}
 const size=Math.max(...hi.map((v,k)=>v-lo[k]))||1,map=new Map<string,number>(),ids=mesh.vertices.map((v,i)=>{const key=v.map((x,k)=>Math.round((x-lo[k])/size*1e10)).join(',');if(!map.has(key))map.set(key,i);return map.get(key)!;}),edges=new Map<string,MeshEdge>();
 mesh.triangles.forEach((t,face)=>{const vs=t.indices.map(i=>ids[i]);if(new Set(vs).size!==3)return;for(let j=0;j<3;j++){const a=vs[j],b=vs[(j+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');const e=edges.get(key)??{a,b,faces:[]};e.faces.push(face);edges.set(key,e);}});return [...edges.values()];
}
export interface PerspectiveProjection {position:Vec3;fov:number}
export function projection(mesh:ContourMesh,q:Orientation,size=CONTOUR_RESOLUTION,vertices:Vec3[]=mesh.vertices,perspective?:PerspectiveProjection){
 // Reuse the exact old XY framing. Camera local +Z points toward the observer.
 const xy=projectMesh(mesh,q,size,vertices),L=Math.hypot(...q),[x,y,z,w]=q.map(a=>a/L),forward=[2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)];
 if(!xy.length)return {points:[] as ScreenPoint[],epsilon:0};
 if(perspective){
  const right=[1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y)],up=[2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)];
  const focal=size/(2*Math.tan(perspective.fov*Math.PI/360));
  const points:ScreenPoint[]=vertices.map(v=>{
   const r=v.map((x,k)=>x-perspective.position[k]),distance=-r.reduce((s,x,k)=>s+x*forward[k],0);
   return [size/2+focal*r.reduce((s,x,k)=>s+x*right[k],0)/distance,size/2-focal*r.reduce((s,x,k)=>s+x*up[k],0)/distance,1/distance];
  });
  // Reciprocal depth is affine in screen space, for both triangles and lines.
  return {points,epsilon:1e-7};
 }
 const points:ScreenPoint[]=vertices.map((v,i)=>[...xy[i],v.reduce((s,a,k)=>s+a*forward[k],0)] as ScreenPoint);
 let min=Infinity,max=-Infinity;for(const p of points){min=Math.min(min,p[2]);max=Math.max(max,p[2]);}
 let extent=0;for(const v of mesh.vertices)extent=Math.max(extent,Math.hypot(...v.map((x,k)=>x-(mesh.vertices[0]?.[k]??0))));
 return {points,epsilon:Math.max(max-min,extent,1e-12)*1e-5};
}
interface DepthTriangle {a:ScreenPoint;b:ScreenPoint;c:ScreenPoint;det:number;face:number}
const DEPTH_TILE_SIZE=8;
interface DepthIndex {columns:number;bins:number[][];triangles:DepthTriangle[]}
export interface Depth {index?:DepthIndex;values:Float64Array;dx:Float64Array;dy:Float64Array;face:Int32Array;size:number}
export function* depthSteps(points:ScreenPoint[],mesh:ContourMesh,size=CONTOUR_RESOLUTION):Generator<void,Depth>{
 const columns=Math.ceil(size/DEPTH_TILE_SIZE),index:DepthIndex={columns,bins:Array.from({length:columns*columns},()=>[]),triangles:[]};
 const face=new Int32Array(size*size).fill(-1),values=new Float64Array(size*size).fill(-Infinity),slopeX=new Float64Array(size*size),slopeY=new Float64Array(size*size);
 for(let i=0;i<mesh.triangles.length;i++){
 const [a,b,c]=mesh.triangles[i].indices.map(i=>points[i]);const det=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(Math.abs(det)<1e-12)continue;
 // Index the full projected bounds, including triangles missing every pixel center.
 const id=index.triangles.length;index.triangles.push({a,b,c,det,face:i});
 const bx0=Math.max(0,Math.floor((Math.min(a[0],b[0],c[0])-1e-7)/DEPTH_TILE_SIZE)),bx1=Math.min(columns-1,Math.floor((Math.max(a[0],b[0],c[0])+1e-7)/DEPTH_TILE_SIZE));
 const by0=Math.max(0,Math.floor((Math.min(a[1],b[1],c[1])-1e-7)/DEPTH_TILE_SIZE)),by1=Math.min(columns-1,Math.floor((Math.max(a[1],b[1],c[1])+1e-7)/DEPTH_TILE_SIZE));
 for(let y=by0;y<=by1;y++)for(let x=bx0;x<=bx1;x++)index.bins[y*columns+x].push(id);
 const dx=((b[2]-a[2])*(c[1]-a[1])-(c[2]-a[2])*(b[1]-a[1]))/det,dy=((b[0]-a[0])*(c[2]-a[2])-(c[0]-a[0])*(b[2]-a[2]))/det;
 const y0=Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1])-.5)),y1=Math.min(size-1,Math.floor(Math.max(a[1],b[1],c[1])-.5));
 for(let y=y0;y<=y1;y++){const py=y+.5;let lo=Infinity,hi=-Infinity;for(const [v,w] of [[a,b],[b,c],[c,a]])if((v[1]<=py&&py<w[1])||(w[1]<=py&&py<v[1])){const x=v[0]+(py-v[1])*(w[0]-v[0])/(w[1]-v[1]);lo=Math.min(lo,x);hi=Math.max(hi,x);}
 for(let x=Math.max(0,Math.ceil(lo-.5));x<=Math.min(size-1,Math.floor(hi-.5));x++){const at=y*size+x,z=a[2]+dx*(x+.5-a[0])+dy*(py-a[1]);if(z>values[at]){values[at]=z;face[at]=i;slopeX[at]=dx;slopeY[at]=dy;}}
 if((y-y0)%64===63)yield;
 }if(i%256===255)yield;
 }return {values,face,dx:slopeX,dy:slopeY,size,index};
}
/** Query at the actual sample position; never extrapolate a non-covering face. */
export function depthAt(p:ScreenPoint,d:Depth){
 const x=Math.floor(p[0]),y=Math.floor(p[1]);
 if(x<0||y<0||x>=d.size||y>=d.size)return {front:Infinity,face:-1};
 if(!d.index){const i=y*d.size+x;return {front:d.values[i]+d.dx[i]*(p[0]-x-.5)+d.dy[i]*(p[1]-y-.5),face:d.face[i]};}
 const index=d.index;let front=-Infinity,face=-1;
 for(const id of index.bins[Math.floor(y/DEPTH_TILE_SIZE)*index.columns+Math.floor(x/DEPTH_TILE_SIZE)]){
  const t=index.triangles[id],{a,b,c,det}=t;
  const u=((p[0]-a[0])*(c[1]-a[1])-(p[1]-a[1])*(c[0]-a[0]))/det;
  const v=((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/det;
  if(u< -1e-10||v< -1e-10||u+v>1+1e-10)continue;
  const z=a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]);
  if(z>front){front=z;face=t.face;}
 }
 return {front,face};
}
export function visible(p:ScreenPoint,d:Depth,epsilon:number){return p[2]>=depthAt(p,d).front-epsilon;}
export interface ContourChain {points:ScreenPoint[];localFaces:number[][]}
export const MAX_REPAIR_PIXELS=4;
/** Unknown visibility is repaired only between visible samples on the same chain. */
export function* visibilitySteps(lines:(ScreenPoint[]|ContourChain)[],depth:Depth,epsilon:number):Generator<void,Point[][]>{
 const out:Point[][]=[];let work=0;
 for(const candidate of lines){
  const line=Array.isArray(candidate)?candidate:candidate.points,faces=Array.isArray(candidate)?undefined:candidate.localFaces;
  const samples:{p:ScreenPoint;state:number;s:number}[]=[];let distance=0;
  for(let i=1;i<line.length;i++){
   const a=line[i-1],b=line[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(length*2));
   for(let j=i===1?0:1;j<=n;j++){
    const t=j/n,p=a.map((v,k)=>v+(b[k]-v)*t) as ScreenPoint;const hit=depthAt(p,depth);let state=p[2]>=hit.front-epsilon?1:0;
    const x=Math.floor(p[0]),y=Math.floor(p[1]);
    if(!state&&faces&&x>=0&&y>=0&&x<depth.size&&y<depth.size){
     const {front,face}=hit;
     // Only a local incident face with a tiny scale-relative depth disagreement
     // is uncertain. Other surfaces and distant parts of this surface remain hidden.
     if(faces[i-1].includes(face)&&front-p[2]<=epsilon*8)state=2;
    }
    samples.push({p,state,s:distance+length*t});if(++work%2048===0)yield;
   }distance+=length;
  }
  if(faces)for(let i=0;i<samples.length;i++){
   if(samples[i].state!==2)continue;const start=i;while(i<samples.length&&samples[i].state===2)i++;
   if(start>0&&i<samples.length&&samples[start-1].state===1&&samples[i].state===1&&samples[i].s-samples[start-1].s<=MAX_REPAIR_PIXELS)
    for(let k=start;k<i;k++)samples[k].state=1;
  }
  let path:Point[]=[];const flush=()=>{if(path.length>1)out.push(path);path=[];};
  for(const {p,state} of samples){if(state===1)path.push([p[0],p[1]]);else flush();}flush();
 }return out;
}
/** Walk actual edge adjacency; never connect unrelated nearby screen endpoints. */
export function tangentChains(mesh:ContourMesh,points:ScreenPoint[]):ContourChain[]{
 const facing=mesh.triangles.map(t=>{const [a,b,c]=t.indices.map(i=>points[i]);return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);});
 const edges=(mesh.edges??[]).filter(e=>e.faces.length===2&&facing[e.faces[0]]*facing[e.faces[1]]<0);
 const adjacency=new Map<number,number[]>(),incident=new Map<number,Set<number>>();
 for(const e of mesh.edges??[])for(const v of [e.a,e.b]){const a=incident.get(v)??new Set<number>();e.faces.forEach(f=>a.add(f));incident.set(v,a);}
 edges.forEach((e,i)=>{for(const v of [e.a,e.b]){const a=adjacency.get(v)??[];a.push(i);adjacency.set(v,a);}});
 const used=new Set<number>(),out:ContourChain[]=[];
 const walk=(start:number,index:number)=>{
  const chain:ContourChain={points:[points[start]],localFaces:[]};let v=start,i=index;
  while(!used.has(i)){
   used.add(i);const e=edges[i],next=e.a===v?e.b:e.a;
   chain.points.push(points[next]);chain.localFaces.push([...new Set([...(incident.get(v)??[]),...(incident.get(next)??[])])]);
   v=next;const adjacent=adjacency.get(v)!;if(adjacent.length!==2)break;
   const nextEdge=adjacent.find(k=>!used.has(k));if(nextEdge===undefined)break;i=nextEdge;
  }out.push(chain);
 };
 for(const [v,es] of adjacency)if(es.length!==2)for(const e of es)if(!used.has(e))walk(v,e);
 edges.forEach((e,i)=>{if(!used.has(i))walk(e.a,i);});return out;
}
export function tangentLines(mesh:ContourMesh,points:ScreenPoint[]){
 const facing=mesh.triangles.map(t=>{const [a,b,c]=t.indices.map(i=>points[i]);return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);});
 return (mesh.edges??[]).filter(e=>e.faces.length===2&&facing[e.faces[0]]*facing[e.faces[1]]<0).map(e=>[points[e.a],points[e.b]]);
}
