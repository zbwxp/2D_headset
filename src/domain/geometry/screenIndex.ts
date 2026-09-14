export interface ScreenBounds{minX:number;maxX:number;minY:number;maxY:number}
/** Inclusive bbox bins, followed by the unchanged exact depth test. */
export function screenIndex<T extends ScreenBounds>(items:T[],resolution=32){
 if(!items.length)return {query:(_x:number,_y:number):T[]=>[]};
 const minX=Math.min(...items.map(t=>t.minX)),maxX=Math.max(...items.map(t=>t.maxX)),minY=Math.min(...items.map(t=>t.minY)),maxY=Math.max(...items.map(t=>t.maxY));
 const w=Math.max(maxX-minX,1e-12),h=Math.max(maxY-minY,1e-12),bins=Array.from({length:resolution*resolution},()=>[] as T[]);
 const ix=(x:number)=>Math.max(0,Math.min(resolution-1,Math.floor((x-minX)/w*resolution))),iy=(y:number)=>Math.max(0,Math.min(resolution-1,Math.floor((y-minY)/h*resolution)));
 for(const item of items)for(let y=iy(item.minY);y<=iy(item.maxY);y++)for(let x=ix(item.minX);x<=ix(item.maxX);x++)bins[y*resolution+x].push(item);
 return {query(x:number,y:number){return x<minX||x>maxX||y<minY||y>maxY?[]:bins[iy(y)*resolution+ix(x)];}};
}

export interface ProjectedTriangle extends ScreenBounds{patch:string;pts:number[][]}
export function frontLayers(triangles:ProjectedTriangle[],x:number,y:number,z:number){
 const front=new Set<string>();
 for(const tr of triangles){
  if(x<tr.minX||x>tr.maxX||y<tr.minY||y>tr.maxY)continue;
  const [a,b,c]=tr.pts,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-12)continue;
  const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;
  if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8&&u*a[2]+v*b[2]+(1-u-v)*c[2]>z+1e-4)front.add(tr.patch);
 }
 return front.size;
}
