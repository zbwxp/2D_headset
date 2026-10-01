import {parseDrawing,type DrawingDocument,type Point2} from '../drawing/model';
import {parseDrawingSnapshots,type DrawingSnapshots} from '../drawing/snapshots';
import {fillGeometry,fillVisible,strokeInk,offsetGeometry,extendedInk} from '../drawing/appearance';
import {depthPaintBatches} from '../drawing/depth';
import {strokePaths} from '../drawing/strokes';
import type {HairNet,Hairstyle,Vec3} from './model';
import {pumpkinSurface,hairWorld} from './profile';

/** Source vectors are authoritative. GPU images/meshes are disposable preview caches. */
export interface HairBake {version:1;drawing:DrawingDocument;net:HairNet}
export interface HairStudio {version:1;drawing:DrawingDocument;drawingSnapshots?:DrawingSnapshots;baked?:HairBake}
export const createHairStudio=(drawing:DrawingDocument):HairStudio=>({version:1,drawing:structuredClone(drawing)});
export function importHairStudio(h:Hairstyle,drawing:DrawingDocument):Hairstyle {
 return {...h,studio:{...h.studio,version:1,drawing:structuredClone(drawing)}};
}
export function hairBakeSource(d:DrawingDocument,showFills=true,fillVisibility:Readonly<Record<string,boolean>>={}):DrawingDocument {
 const {reference,...source}=d;void reference;
 return structuredClone({...source,fills:d.fills.map(f=>({...f,visible:f.visible&&(fillVisibility[d.layers.find(l=>l.items.includes(f.id))?.id??'']??showFills)}))});
}
export function parseHairStudio(value:unknown,parseNet:(v:unknown)=>HairNet):HairStudio {
 const s=value as HairStudio;if(!s||s.version!==1)throw Error('发型绘制与烘焙数据无效');
 const result:HairStudio={version:1,drawing:parseDrawing(s.drawing)};
 if(s.drawingSnapshots)result.drawingSnapshots=parseDrawingSnapshots(s.drawingSnapshots);
 if(s.baked){if(s.baked.version!==1||s.baked.drawing?.reference)throw Error('发网烘焙数据无效');result.baked={version:1,net:parseNet(s.baked.net),drawing:parseDrawing(s.baked.drawing)};}
 return result;
}
export type PaintBounds=[number,number,number,number];
/** Use evaluated ink, including cuts/extensions, not raw hidden control points. */
export function hairPaintBounds(d:DrawingDocument):PaintBounds {
 const ink={...d,curves:d.curves.map(c=>c.visible?c:{...c,inkVisible:false})};
 let bounds:PaintBounds=[Infinity,Infinity,-Infinity,-Infinity];
 const include=(points:Point2[],pad=0)=>{for(const [x,y] of points)bounds=[Math.min(bounds[0],x-pad),Math.min(bounds[1],y-pad),Math.max(bounds[2],x+pad),Math.max(bounds[3],y+pad)];};
 const done=new Set<string>();
 for(const b of depthPaintBatches(d)){
  if(done.has(b.item.id))continue;done.add(b.item.id);
  if(b.item.stroke){for(const s of strokePaths(b.item.stroke)){
   const runs=strokeInk(ink,{...s,id:b.item.id}),curves=s.segments.map(x=>d.curves.find(c=>c.id===x.id)!).filter(Boolean);
   const pad=Math.max(0,...curves.map(c=>c.width*5+(c.mist?.enabled?c.mist.width*2:0)));
   for(const run of runs)include([...run.shapes.flat(),...run.outline,...run.tips.flat()],pad);
  }}else if(b.item.kind==='fill'){
   const f=d.fills.find(f=>f.id===b.item.id)!;if(!fillVisible(d,f)||f.color==='transparent')continue;
   const g=fillGeometry(d,f);if(g.error)throw Error(`填充“${f.name}”边界未闭合，请先修复或隐藏。`);
   include(g.shapes.flat(),f.mist?.enabled?f.mist.width:0);
  }else{
   const o=d.offsets.find(o=>o.id===b.item.id);if(!o?.visible)continue;const g=offsetGeometry(d,o);if(!g.error)include(extendedInk(g.shapes,o.inkEnds).shapes.flat(),o.width*5+(o.mist?.enabled?o.mist.width*2:0));
  }
 }
 if(!Number.isFinite(bounds[0]))throw Error('没有可烘焙的可见线稿或填充。请先显示面发图层。');
 return [bounds[0]-.025,bounds[1]-.025,bounds[2]+.025,bounds[3]+.025];
}
export interface HairBakeMesh {vertices:Vec3[];uv:Point2[];triangles:[number,number,number][]}
/** Fixed front UVs: orbiting never re-evaluates display intervals or source curves. */
export function hairBakeMesh(net:HairNet,bounds:PaintBounds,frontOnly=true,cols=160,rows=96):HairBakeMesh {
 const vertices:Vec3[]=[],uv:Point2[]=[],triangles:[number,number,number][]=[];
 for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
  const az=-Math.PI/2+i/cols*Math.PI*(frontOnly?1:2),t=j/rows;
  const p=net.profile?.version===2?pumpkinSurface(net,az,t):hairWorld(net,[Math.sin(t*Math.PI)*Math.sin(az),Math.cos(t*Math.PI),Math.sin(t*Math.PI)*Math.cos(az)]);
  vertices.push(p);uv.push([(p[0]-bounds[0])/(bounds[2]-bounds[0]),(p[1]-bounds[1])/(bounds[3]-bounds[1])]);
 }
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+cols+1;triangles.push([a,b,a+1],[a+1,b,b+1]);}
 return {vertices,uv,triangles};
}
