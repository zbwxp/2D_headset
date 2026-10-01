import {renderToStaticMarkup} from 'react-dom/server';
import PaintScene from '../drawing/PaintScene';
import {hairPaintBounds,hairBakeMesh,type HairBake,type PaintBounds,type HairBakeMesh} from '../../domain/hairstyle/studio';
import type {Point2} from '../../domain/drawing/model';
export interface PreparedHairBake {canvas:HTMLCanvasElement;bounds:PaintBounds;mesh:HairBakeMesh}
// Keep at most two image caches, not one large bitmap per undo-history document.
const cache=new Map<HairBake,Promise<PreparedHairBake>>();
export function prepareHairBake(bake:HairBake):Promise<PreparedHairBake>{
 const old=cache.get(bake);if(old){cache.delete(bake);cache.set(bake,old);return old;}
 const result=prepare(bake).catch(error=>{if(cache.get(bake)===result)cache.delete(bake);throw error;});cache.set(bake,result);
 while(cache.size>2)cache.delete(cache.keys().next().value!);
 return result;
}
async function prepare(bake:HairBake):Promise<PreparedHairBake>{
 const d=bake.drawing,bounds=hairPaintBounds(d),w=bounds[2]-bounds[0],h=bounds[3]-bounds[1],unit=3072/Math.max(w,h);
 const width=Math.max(2,Math.ceil(w*unit)),height=Math.max(2,Math.ceil(h*unit));
 const screen=([x,y]:Point2):Point2=>[(x-bounds[0])*unit,(bounds[3]-y)*unit];
 const noop=()=>{};
 const source=renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}><PaintScene d={d} screen={screen} unit={unit} preview showFills referenceMoving={false} tool="select" curveDown={noop} paintDown={noop} arcDown={noop}/></svg>);
 const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml;charset=utf-8'}));
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 try{
  const img=new Image();await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(Error('无法生成烘焙预览，请重试。'));img.src=url;});
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('浏览器不支持二维绘制。');ctx.drawImage(img,0,0);
 }finally{URL.revokeObjectURL(url);}
 const mesh=hairBakeMesh(bake.net,bounds);
 // Compare visible paint against the projected front shell. Never silently lose
 // off-shell artwork (the reference image and editor helpers were never painted).
 const scale=1024/Math.max(width,height),cw=Math.max(1,Math.ceil(width*scale)),ch=Math.max(1,Math.ceil(height*scale));
 const check=document.createElement('canvas');check.width=cw;check.height=ch;const c=check.getContext('2d',{willReadFrequently:true})!;
 c.drawImage(canvas,0,0,cw,ch);const paint=c.getImageData(0,0,cw,ch).data;c.clearRect(0,0,cw,ch);
 c.fillStyle='#fff';c.strokeStyle='#fff';c.lineWidth=2;c.lineJoin='round';c.beginPath();
 for(const tri of mesh.triangles){tri.forEach((i,j)=>{const p=screen([mesh.vertices[i][0],mesh.vertices[i][1]]);if(j)c.lineTo(p[0]*cw/width,p[1]*ch/height);else c.moveTo(p[0]*cw/width,p[1]*ch/height);});c.closePath();}
 c.fill();c.stroke();const mask=c.getImageData(0,0,cw,ch).data;let outside=0,painted=0;
 for(let i=3;i<paint.length;i+=4)if(paint[i]>24){painted++;if(mask[i]<24)outside++;}
 if(!painted)throw Error('当前没有可见线稿或填充。请先显示要烘焙的面发。');
 if(outside>Math.max(4,painted*.002))throw Error(`约 ${(outside/painted*100).toFixed(1)}% 的可见内容在发网之外。请隐藏其他图层，或调整发网位置、大小和壳形后重试。`);
 return {canvas,bounds,mesh};
}
