import {useId} from 'react';
import type {ContourMist,Point2} from '../../domain/drawing/model';
import type {InkRun} from '../../domain/drawing/appearance';
import {mistRasterLayout,mistWarpAt} from '../../domain/drawing/mist';

interface Bitmap {href:string;bounds:[number,number,number,number]}
// Runtime display only; original vectors are neither moved nor blurred. Density,
// pan and zoom reuse the same local bitmap. Cache has entry and byte limits.
const cache=new Map<string,Bitmap>();let cacheBytes=0;
function bitmap(run:InkRun,width:number){
 const origin=run.shapes[0][0],relative=(ps:Point2[])=>ps.map(p=>[+(p[0]-origin[0]).toFixed(10),+(p[1]-origin[1]).toFixed(10)] as Point2),outline=relative(run.outline),tips=run.tips.map(relative);
 const key=JSON.stringify([outline,tips,width]);let result=cache.get(key);
 if(!result){
  const layout=mistRasterLayout([...outline,...tips.flat()],width);if(!layout)return null;
  const {nx,ny,scale,sigma,bounds}=layout,x0=bounds[0],y1=bounds[3];
  const source=document.createElement('canvas');source.width=nx;source.height=ny;const ink=source.getContext('2d')!;
  ink.fillStyle='#191e22';
  const polygon=(points:Point2[])=>{if(points.length<3)return;ink.beginPath();points.forEach((p,i)=>{const x=(p[0]*250-x0)*scale,y=(y1-p[1]*250)*scale;if(i)ink.lineTo(x,y);else ink.moveTo(x,y);});ink.closePath();ink.fill();};
  polygon(outline);tips.forEach(polygon);
  const canvas=document.createElement('canvas');canvas.width=nx;canvas.height=ny;const ctx=canvas.getContext('2d')!;
  ctx.filter=`blur(${sigma*scale}px)`;ctx.drawImage(source,0,0);ctx.filter='none';
  const input=ctx.getImageData(0,0,nx,ny).data,output=ctx.createImageData(nx,ny),out=output.data;
  // A coarse displacement field keeps large previews inexpensive and spatially
  // coherent. Resampling the blurred ink gives continuous gray bands, no dots.
  const step=8,cols=Math.ceil(nx/step)+1,rows=Math.ceil(ny/step)+1;
  const field=Array.from({length:cols*rows},(_,i)=>mistWarpAt(x0+(i%cols)*step/scale,y1-Math.floor(i/cols)*step/scale,width*250));
  const alpha=(x:number,y:number)=>x<0||y<0||x>=nx||y>=ny?0:input[(y*nx+x)*4+3];
  for(let y=0;y<ny;y++){
   const gy=Math.floor(y/step),fy=y/step-gy;
   for(let x=0;x<nx;x++){
    const gx=Math.floor(x/step),fx=x/step-gx,a=field[gy*cols+gx],b=field[gy*cols+gx+1],c=field[(gy+1)*cols+gx],d=field[(gy+1)*cols+gx+1];
    const wa=(1-fx)*(1-fy),wb=fx*(1-fy),wc=(1-fx)*fy,wd=fx*fy;
    const sx=x+(a.dx*wa+b.dx*wb+c.dx*wc+d.dx*wd)*scale,sy=y-(a.dy*wa+b.dy*wb+c.dy*wc+d.dy*wd)*scale,ix=Math.floor(sx),iy=Math.floor(sy),tx=sx-ix,ty=sy-iy;
    const v=(alpha(ix,iy)*(1-tx)*(1-ty)+alpha(ix+1,iy)*tx*(1-ty)+alpha(ix,iy+1)*(1-tx)*ty+alpha(ix+1,iy+1)*tx*ty)*(a.shade*wa+b.shade*wb+c.shade*wc+d.shade*wd);
    const at=(y*nx+x)*4;out[at]=25;out[at+1]=30;out[at+2]=34;
    // Modest tonal steps evoke raster line-art at high zoom without dithering.
    out[at+3]=Math.min(255,Math.round(v/2)*2);
   }
  }
  ctx.putImageData(output,0,0);result={href:canvas.toDataURL(),bounds};cache.set(key,result);cacheBytes+=result.href.length*2;
  while(cache.size>96||cacheBytes>16*1024*1024){const first=cache.keys().next().value!;cacheBytes-=cache.get(first)!.href.length*2;cache.delete(first);}
 }
 return {...result,origin};
}
export default function MistInk({runs,mist,screen,unit}:{runs:InkRun[];mist:ContourMist;screen:(p:Point2)=>Point2;unit:number}){
 const gainId=useId(),boost=mist.density>1;
 if(!mist.enabled||mist.density<=0)return null;
 // SVG opacity clamps at 1: above 100% amplify the cached alpha instead.
 // Below 100% retain the original compositing exactly, with no extra filter.
 return <g data-testid="drawing-mist" opacity={Math.min(1,mist.density)} pointerEvents="none" aria-hidden="true">
 {boost&&<defs><filter id={gainId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB"><feComponentTransfer><feFuncA type="linear" slope={mist.density}/></feComponentTransfer></filter></defs>}
 <g filter={boost?`url(#${gainId})`:undefined}>{runs.map((run,i)=>{
  if(!run.shapes.length)return null;const image=bitmap(run,mist.width);if(!image)return null;
  const [x0,y0,x1,y1]=image.bounds,p=screen([image.origin[0]+x0/250,image.origin[1]+y1/250]);
  return <image key={i} data-testid="drawing-mist-image" href={image.href} x={p[0]} y={p[1]} width={(x1-x0)/250*unit} height={(y1-y0)/250*unit} preserveAspectRatio="none"/>;
 })}</g></g>;
}
