import {useId} from 'react';
import type {Cubic,FillRegion,Point2} from '../../domain/drawing/model';
import {boundaryDistances,fillMistAlpha,fillMistLayout} from '../../domain/drawing/fillMist';

interface Bitmap {href:string;bytes:number}
const cache=new Map<string,Bitmap>();let bytes=0;
function bitmap(shapes:Cubic[],f:FillRegion,resolution:number){
 const mist=f.mist!,layout=fillMistLayout(shapes,mist,resolution);if(!layout)return null;
 const {relative,origin,nx,ny,scale,bounds}=layout,key=JSON.stringify([relative,mist.width,mist.side,f.color,resolution]);let result=cache.get(key);
 if(!result){
  const path=new Path2D(),pixel=([x,y]:Point2):Point2=>[(x*250-bounds[0])*scale,(bounds[3]-y*250)*scale];
  path.moveTo(...pixel(relative[0][0]));for(const s of relative)path.bezierCurveTo(...pixel(s[1]),...pixel(s[2]),...pixel(s[3]));path.closePath();
  const canvas=document.createElement('canvas');canvas.width=nx;canvas.height=ny;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  ctx.fillStyle='#fff';ctx.fill(path,'evenodd');const interior=ctx.getImageData(0,0,nx,ny).data;
  ctx.clearRect(0,0,nx,ny);ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke(path);
  const edge=ctx.getImageData(0,0,nx,ny).data,seeds=new Uint8Array(nx*ny);
  for(let i=0;i<seeds.length;i++)seeds[i]=edge[i*4+3]>0?1:0;
  const distance=boundaryDistances(seeds,nx,ny),output=ctx.createImageData(nx,ny),color=f.color==='white'?255:0,width=mist.width*250*scale;
  for(let i=0;i<seeds.length;i++){
   const inside=interior[i*4+3]/255,side=mist.side==='INSIDE'?inside:mist.side==='OUTSIDE'?1-inside:1,at=i*4;
   output.data[at]=output.data[at+1]=output.data[at+2]=color;
   output.data[at+3]=Math.round(255*side*fillMistAlpha(distance[i],width));
  }
  ctx.putImageData(output,0,0);const href=canvas.toDataURL();result={href,bytes:href.length*2};cache.set(key,result);bytes+=result.bytes;
  while(cache.size>48||bytes>24*1024*1024){const first=cache.keys().next().value!;bytes-=cache.get(first)!.bytes;cache.delete(first);}
 }
 return {...result,origin,bounds};
}
export default function MistFill({fill,shapes,path,screen,unit,pick,selected,onPointerDown,interactive=false}:{fill:FillRegion;shapes:Cubic[];path:string;screen:(p:Point2)=>Point2;unit:number;pick:boolean;selected:boolean;onPointerDown:(e:React.PointerEvent)=>void;interactive?:boolean}){
 const clip=useId(),image=bitmap(shapes,fill,interactive ? .5 : 2),mist=fill.mist!;if(!image)return null;
 const [x0,y0,x1,y1]=image.bounds,a=screen([image.origin[0]+x0/250,image.origin[1]+y1/250]),w=(x1-x0)*unit/250,h=(y1-y0)*unit/250;
 const outer=`M ${a[0]-2} ${a[1]-2} H ${a[0]+w+2} V ${a[1]+h+2} H ${a[0]-2} Z`,clipPath=mist.side==='INSIDE'?path:`${outer} ${path}`;
 return <g data-testid="drawing-mist-fill" data-id={fill.id} data-side={mist.side}>
  <image data-testid="drawing-mist-fill-image" href={image.href} x={a[0]} y={a[1]} width={w} height={h} opacity={mist.opacity} preserveAspectRatio="none" pointerEvents="none"/>
  {selected&&<path d={path} fill="none" stroke="#2589b0" strokeWidth="1.5" pointerEvents="none"/>}
  {pick&&mist.opacity>0&&<>
   {mist.side!=='BOTH'&&<defs><clipPath id={clip} clipPathUnits="userSpaceOnUse"><path d={clipPath} clipRule="evenodd"/></clipPath></defs>}
   <path data-testid="drawing-mist-fill-hit" data-id={fill.id} d={path} fill="none" stroke="transparent" strokeWidth={2*mist.width*unit} clipPath={mist.side==='BOTH'?undefined:`url(#${clip})`} pointerEvents="stroke" onPointerDown={onPointerDown}/>
  </>}
 </g>;
}
