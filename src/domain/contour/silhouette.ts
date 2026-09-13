import type {Vec3} from '../project/types';
export const CONTOUR_RESOLUTION=768;
export const CONTOUR_SUBDIVISIONS=24;
export type Orientation=[number,number,number,number];
export type Point=[number,number];
export interface ContourTriangle {indices:[number,number,number];patchId:string;triangleId:number}
export interface ContourMesh {vertices:Vec3[];triangles:ContourTriangle[]}
export interface Silhouette {paths:Point[][];resolution:number;coveredPixels:number}
function rotate(v:Vec3,q:Orientation):Vec3 {
 const length=Math.hypot(...q);const [x,y,z,w]=q.map(v=>v/length);
 const [a,b,c]=v,t:[number,number,number]=[2*(y*c-z*b),2*(z*a-x*c),2*(x*b-y*a)];
 return [a+w*t[0]+y*t[2]-z*t[1],b+w*t[1]+z*t[0]-x*t[2],c+w*t[2]+x*t[1]-y*t[0]];
}
/** Orthographic orientation only: no FOV, distance, pan, or viewport dimensions. */
export function projectMesh(mesh:ContourMesh,q:Orientation,size=CONTOUR_RESOLUTION):Point[]{
 if(!mesh.vertices.length)return [];
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const p of mesh.vertices)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}
 const center=lo.map((x,i)=>(x+hi[i])/2);
 let radius=0;for(const p of mesh.vertices)radius=Math.max(radius,Math.hypot(...p.map((x,i)=>x-center[i])));
 if(!Number.isFinite(radius)||radius<=1e-14)return [];
 const right=rotate([1,0,0],q),up=rotate([0,1,0],q),scale=(size-32)/(2*radius);
 return mesh.vertices.map(p=>{const d=p.map((x,i)=>x-center[i]);return [size/2+scale*d.reduce((s,x,i)=>s+x*right[i],0),size/2-scale*d.reduce((s,x,i)=>s+x*up[i],0)];});
}
/** Union coverage, independent of winding/depth/triangle order.
 * Source triangles retain patch/triangle provenance; a future depth/ID raster can share this projection.
 */
export function rasterUnion(points:Point[],triangles:ContourTriangle[],size=CONTOUR_RESOLUTION):Uint8Array{
 const mask=new Uint8Array(size*size);
 for(const tri of triangles){
 const p=tri.indices.map(i=>points[i]);if(p.some(x=>!x))continue;
 const area=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);if(Math.abs(area)<1e-10)continue;
 const ymin=Math.max(0,Math.ceil(Math.min(...p.map(x=>x[1]))-.5)),ymax=Math.min(size-1,Math.floor(Math.max(...p.map(x=>x[1]))-.5));
 for(let y=ymin;y<=ymax;y++){
 const scan=y+.5,xs:number[]=[];
 for(let e=0;e<3;e++){const a=p[e],b=p[(e+1)%3];if((a[1]<=scan&&scan<b[1])||(b[1]<=scan&&scan<a[1]))xs.push(a[0]+(scan-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
 if(xs.length<2)continue;
 const x0=Math.max(0,Math.ceil(Math.min(...xs)-.5)),x1=Math.min(size-1,Math.floor(Math.max(...xs)-.5));
 if(x1>=x0)mask.fill(1,y*size+x0,y*size+x1+1);
 }
 }
 return mask;
}
/** Only edges adjacent to exterior background survive; enclosed holes are never stroked. */
export function traceExterior(mask:Uint8Array,size:number):Point[][]{
 const exterior=new Uint8Array(mask.length),queue=new Int32Array(mask.length);let read=0,write=0;
 const visit=(i:number)=>{if(!mask[i]&&!exterior[i]){exterior[i]=1;queue[write++]=i;}};
 for(let i=0;i<size;i++){visit(i);visit((size-1)*size+i);visit(i*size);visit(i*size+size-1);}
 while(read<write){const i=queue[read++],x=i%size,y=Math.floor(i/size);if(x)visit(i-1);if(x<size-1)visit(i+1);if(y)visit(i-size);if(y<size-1)visit(i+size);}
 const width=size+1,edges=new Set<number>(),steps=[1,width,-1,-width];
 const edge=(x:number,y:number,d:number)=>edges.add((y*width+x)*4+d);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=y*size+x;if(!mask[i])continue;
 if(!y||exterior[i-size])edge(x,y,0);
 if(x===size-1||exterior[i+1])edge(x+1,y,1);
 if(y===size-1||exterior[i+size])edge(x+1,y+1,2);
 if(!x||exterior[i-1])edge(x,y+1,3);
 }
 const paths:Point[][]=[];
 while(edges.size){
 const first=edges.values().next().value!,start=Math.floor(first/4);let key=first;const path:Point[]=[];let lastDirection=-1;
 while(edges.has(key)){
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
export function silhouette(mesh:ContourMesh,q:Orientation,size=CONTOUR_RESOLUTION):Silhouette{
 const points=projectMesh(mesh,q,size),mask=rasterUnion(points,mesh.triangles,size);
 return {paths:traceExterior(mask,size),resolution:size,coveredPixels:mask.reduce((a,b)=>a+b,0)};
}
