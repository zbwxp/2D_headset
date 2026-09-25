import type {Vec3} from '../project/types';
export const CONTOUR_RESOLUTION=768;
export const CONTOUR_SUBDIVISIONS=24;
export type Orientation=[number,number,number,number];
export type Point=[number,number];
export interface ContourTriangle {indices:[number,number,number];patchId:string;triangleId:number}
export interface ContourMesh {vertices:Vec3[];triangles:ContourTriangle[];edges?:{a:number;b:number;faces:number[]}[];boundaries?:Vec3[][];alwaysLines?:Vec3[][]}
export interface Silhouette {openPaths?:Point[][];paths:Point[][];resolution:number;coveredPixels:number}
function rotate(v:Vec3,q:Orientation):Vec3 {
 const length=Math.hypot(...q);const [x,y,z,w]=q.map(v=>v/length);
 const [a,b,c]=v,t:[number,number,number]=[2*(y*c-z*b),2*(z*a-x*c),2*(x*b-y*a)];
 return [a+w*t[0]+y*t[2]-z*t[1],b+w*t[1]+z*t[0]-x*t[2],c+w*t[2]+x*t[1]-y*t[0]];
}
const framing=new WeakMap<ContourMesh,{center:number[];radius:number}>();
/** Orthographic orientation only: no FOV, distance, pan, or viewport dimensions. */
export function projectMesh(mesh:ContourMesh,q:Orientation,size=CONTOUR_RESOLUTION,vertices:Vec3[]=mesh.vertices):Point[]{
 if(!mesh.vertices.length)return [];
 let bounds=framing.get(mesh);
 if(!bounds){
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const p of mesh.vertices)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}
 const center=lo.map((x,i)=>(x+hi[i])/2);
 let radius=0;for(const p of mesh.vertices)radius=Math.max(radius,Math.hypot(...p.map((x,i)=>x-center[i])));
 bounds={center,radius};framing.set(mesh,bounds);
 }
 const {center,radius}=bounds;
 if(!Number.isFinite(radius)||radius<=1e-14)return [];
 const right=rotate([1,0,0],q),up=rotate([0,1,0],q),scale=(size-32)/(2*radius);
 return vertices.map(p=>{const x=p[0]-center[0],y=p[1]-center[1],z=p[2]-center[2];return [size/2+scale*(x*right[0]+y*right[1]+z*right[2]),size/2-scale*(x*up[0]+y*up[1]+z*up[2])];});
}
/** Union coverage, independent of winding/depth/triangle order.
 * Source triangles retain patch/triangle provenance; a future depth/ID raster can share this projection.
 */
export function* rasterSteps(points:Point[],triangles:ContourTriangle[],size=CONTOUR_RESOLUTION){
 const mask=new Uint8Array(size*size);
 for(let index=0;index<triangles.length;index++){
 const ids=triangles[index].indices,a=points[ids[0]],b=points[ids[1]],c=points[ids[2]];
 if(a&&b&&c){
 const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 if(Math.abs(area)>=1e-10){
 const ymin=Math.max(0,Math.ceil(Math.min(a[1],b[1],c[1])-.5)),ymax=Math.min(size-1,Math.floor(Math.max(a[1],b[1],c[1])-.5));
 for(let y=ymin;y<=ymax;y++){
 const scan=y+.5;let lo=Infinity,hi=-Infinity;
 // Preserve the original half-open, pixel-center coverage rule without per-row arrays.
 for(let e=0;e<3;e++){
 const v=e===0?a:e===1?b:c,w=e===0?b:e===1?c:a;
 if((v[1]<=scan&&scan<w[1])||(w[1]<=scan&&scan<v[1])){
 const x=v[0]+(scan-v[1])*(w[0]-v[0])/(w[1]-v[1]);lo=Math.min(lo,x);hi=Math.max(hi,x);
 }
 }
 const x0=Math.max(0,Math.ceil(lo-.5)),x1=Math.min(size-1,Math.floor(hi-.5));
 if(x1>=x0)mask.fill(1,y*size+x0,y*size+x1+1);
 }
 }
 }
 if((index&511)===511)yield;
 }
 return mask;
}
function finish<T>(steps:Generator<void,T>):T{let next=steps.next();while(!next.done)next=steps.next();return next.value;}
export function rasterUnion(points:Point[],triangles:ContourTriangle[],size=CONTOUR_RESOLUTION):Uint8Array{
 return finish(rasterSteps(points,triangles,size));
}
/** Only edges adjacent to exterior background survive; enclosed holes are never stroked. */
export function* traceSteps(mask:Uint8Array,size:number):Generator<void,Point[][]>{
 const exterior=new Uint8Array(mask.length),queue=new Int32Array(mask.length);let read=0,write=0;
 const visit=(i:number)=>{if(!mask[i]&&!exterior[i]){exterior[i]=1;queue[write++]=i;}};
 for(let i=0;i<size;i++){visit(i);visit((size-1)*size+i);visit(i*size);visit(i*size+size-1);}
 while(read<write){const i=queue[read++],x=i%size,y=Math.floor(i/size);if(x)visit(i-1);if(x<size-1)visit(i+1);if(y)visit(i-size);if(y<size-1)visit(i+size);if((read&16383)===0)yield;}
 const width=size+1,edges=new Set<number>(),steps=[1,width,-1,-width];
 const edge=(x:number,y:number,d:number)=>edges.add((y*width+x)*4+d);
 for(let y=0;y<size;y++){if((y&31)===0)yield;for(let x=0;x<size;x++){const i=y*size+x;if(!mask[i])continue;
 if(!y||exterior[i-size])edge(x,y,0);
 if(x===size-1||exterior[i+1])edge(x+1,y,1);
 if(y===size-1||exterior[i+size])edge(x+1,y+1,2);
 if(!x||exterior[i-1])edge(x,y+1,3);
 }
 }
 const paths:Point[][]=[];
 while(edges.size){
 const first=edges.values().next().value!,start=Math.floor(first/4);let key=first;const path:Point[]=[];let lastDirection=-1;
 while(edges.has(key)){
 if((edges.size&1023)===0)yield;
 edges.delete(key);const vertex=Math.floor(key/4),direction=key%4,point:Point=[vertex%width,Math.floor(vertex/width)];
 if(direction!==lastDirection)path.push(point);
 lastDirection=direction;const end=vertex+steps[direction];
 if(end===start)break;
 const next=[(direction+1)%4,direction,(direction+3)%4,(direction+2)%4].map(d=>end*4+d).find(k=>edges.has(k));
 if(next===undefined)break;key=next;
 }
 if(path.length>=3)paths.push(path);
 }
 return paths;
}
export function traceExterior(mask:Uint8Array,size:number):Point[][]{return finish(traceSteps(mask,size));}
export function silhouette(mesh:ContourMesh,q:Orientation,size=CONTOUR_RESOLUTION):Silhouette{
 const points=projectMesh(mesh,q,size),mask=rasterUnion(points,mesh.triangles,size);
 return {paths:traceExterior(mask,size),resolution:size,coveredPixels:mask.reduce((a,b)=>a+b,0)};
}
