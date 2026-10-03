import {quadProjection,rectQuad,type DeformRect,type Quad} from '../drawing/deform';
import {shapeOf,objectById,type DrawingDocument,type Point2} from '../drawing/model';
import {offsetGeometry} from '../drawing/appearance';
import type {Matrix3} from '../deformation/homography';

/** Normalized destination corners make the same deformation reusable at other sizes.
 * source is fixed in canonical artwork coordinates; editing never overwrites vectors. */
export interface LayerPerspective {layerId:string;source:DeformRect;quad:Quad;enabled:boolean}
export {identity3,multiply3,inverse3,map3,fromCSS,toCSS,type Matrix3} from '../deformation/homography';
const UNIT:DeformRect={min:[0,0],max:[1,1]};
export const neutralQuad=():Quad=>rectQuad(UNIT);
export const normalizedPoint=(r:DeformRect,p:Point2):Point2=>p.map((v,i)=>(v-r.min[i])/(r.max[i]-r.min[i])) as Point2;
export const sourcePoint=(r:DeformRect,p:Point2):Point2=>p.map((v,i)=>r.min[i]+v*(r.max[i]-r.min[i])) as Point2;
export const perspectiveMatrix=(p:LayerPerspective):Matrix3=>quadProjection(p.source,p.quad.map(q=>sourcePoint(p.source,q)) as Quad).matrix;
export function assertPerspective(p:LayerPerspective){
 if(!p||typeof p.layerId!=='string'||!p.layerId||typeof p.enabled!=='boolean'||!p.source||![p.source.min,p.source.max].every(q=>Array.isArray(q)&&q.length===2&&q.every(Number.isFinite))||!Array.isArray(p.quad)||p.quad.length!==4||!p.quad.every(q=>Array.isArray(q)&&q.length===2&&q.every(Number.isFinite)))throw Error('图层透视参数无效');
 if(!perspectiveMatrix(p).every(Number.isFinite))throw Error('图层透视参数无效');
}
export function requirePerspectiveLayer(d:DrawingDocument,id:string){
 const layer=d.layers.find(l=>l.id===id);if(!layer)throw Error('请先选择一个图层');
 if(layer.locked||layer.items.some(id=>objectById(d,id)?.locked))throw Error('图层包含锁定对象，请先解锁再调整透视。');
 return layer;
}
export function createPerspective(d:DrawingDocument,id:string,quad=neutralQuad()):LayerPerspective {
 const layer=requirePerspectiveLayer(d,id),ids=new Set(layer.items),points:Point2[]=[];
 // Include hidden outlines and independent fill boundaries: showing them later must
 // not resize the saved control frame. Use the control hull, not a sampled curve box.
 const curves=new Set(d.curves.filter(c=>ids.has(c.id)).map(c=>c.id));
 d.fills.filter(f=>ids.has(f.id)).forEach(f=>f.boundary.forEach(c=>curves.add(c.id)));
 curves.forEach(id=>points.push(...shapeOf(d,id)));
 d.offsets.filter(o=>ids.has(o.id)).forEach(o=>offsetGeometry(d,o).shapes.forEach(s=>points.push(...s)));
 if(!points.length)throw Error('这个图层还没有可变形的线稿。');
 const min:Point2=[Infinity,Infinity],max:Point2=[-Infinity,-Infinity];
 for(const p of points)for(const i of [0,1] as const){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
 const pad=Math.max(.025,Math.max(max[0]-min[0],max[1]-min[1])*.04);
 const p:LayerPerspective={layerId:id,source:{min:[min[0]-pad,min[1]-pad],max:[max[0]+pad,max[1]+pad]},quad:structuredClone(quad),enabled:true};
 assertPerspective(p);return p;
}
/** Binding recalibrates canonical geometry by a similarity. Carry the fixed frame
 * with it, so rebinding doesn't unexpectedly change a manual deformation. */
export function rebasePerspective(p:LayerPerspective,scale:number,translation:Point2):LayerPerspective {
 const move=(q:Point2):Point2=>[q[0]*scale+translation[0],q[1]*scale+translation[1]];
 return {...p,source:{min:move(p.source.min),max:move(p.source.max)}};
}
