import {quadProjection,rectQuad,type DeformRect,type Quad} from '../drawing/deform';
import {shapeOf,objectById,type DrawingDocument,type Point2} from '../drawing/model';
import {offsetGeometry} from '../drawing/appearance';

/** Normalized destination corners make the same deformation reusable at other sizes.
 * source is fixed in canonical artwork coordinates; editing never overwrites vectors. */
export interface LayerPerspective {layerId:string;source:DeformRect;quad:Quad;enabled:boolean}
export type Matrix3=[number,number,number,number,number,number,number,number,number];
export const identity3=():Matrix3=>[1,0,0,0,1,0,0,0,1];
export const multiply3=(a:Matrix3,b:Matrix3):Matrix3=>Array.from({length:9},(_,i)=>{
 const r=Math.floor(i/3),c=i%3;return a[r*3]*b[c]+a[r*3+1]*b[c+3]+a[r*3+2]*b[c+6];
}) as Matrix3;
export function inverse3(m:Matrix3):Matrix3 {
 const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=f*g-d*i,C=d*h-e*g,det=a*A+b*B+c*C;
 if(!Number.isFinite(det)||Math.abs(det)<1e-10)throw Error('当前图层接近侧立，请转回一些角度再调整四角。');
 return [A,c*h-b*i,b*f-c*e,B,a*i-c*g,c*d-a*f,C,b*g-a*h,a*e-b*d].map(v=>v/det) as Matrix3;
}
export function map3(m:Matrix3,[x,y]:Point2):Point2 {
 const w=m[6]*x+m[7]*y+m[8];if(!Number.isFinite(w)||Math.abs(w)<1e-8)throw Error('透视超出有效范围。');
 return [(m[0]*x+m[1]*y+m[2])/w,(m[3]*x+m[4]*y+m[5])/w];
}
export const fromCSS=(m:number[]):Matrix3=>[m[0],m[4],m[12],m[1],m[5],m[13],m[3],m[7],m[15]];
export const toCSS=(m:Matrix3):number[]=>[m[0],m[3],0,m[6],m[1],m[4],0,m[7],0,0,1,0,m[2],m[5],0,m[8]];
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
