import {curveById,objectById,DEFAULT_CONTOUR_MIST,validContourMist,type ContourMist,type DrawingDocument as Doc,type Point2} from './model';
import {strokeInk} from './appearance';
import type {Stroke} from './strokes';

/** Exactly the selected curves/offsets; position links, joins and layers are untouched. */
export function setContourMist(d:Doc,ids:string[],change:Partial<ContourMist>):Doc{
 const selected=new Set(ids);if(!selected.size)return d;
 for(const id of selected){const o=objectById(d,id);if(!o||!('width' in o))throw Error('请选择曲线或偏移线。');if(o.locked)throw Error('对象已锁定。');if(!validContourMist({...DEFAULT_CONTOUR_MIST,...o.mist,...change}))throw Error('雾化参数无效。');}
 const apply=<T extends {id:string;mist?:ContourMist}>(o:T):T=>selected.has(o.id)?{...o,mist:{...DEFAULT_CONTOUR_MIST,...o.mist,...change}}:o;
 const curves=d.curves.map(apply),offsets=d.offsets.map(apply);
 return JSON.stringify([curves,offsets])===JSON.stringify([d.curves,d.offsets])?d:{...d,curves,offsets};
}
/** Use the same visible/trimmed/interval-cropped ink as the sharp vector renderer.
 * Equal settings share one pass across a chain; different members remain independent. */
export function strokeMist(d:Doc,s:Stroke){
 const groups=new Map<string,{mist:ContourMist;ids:Set<string>}>();
 for(const use of s.segments){const c=curveById(d,use.id),mist=c.mist;if(!c.visible||c.inkVisible===false||!mist?.enabled||mist.density<=0)continue;
  const key=JSON.stringify([mist.width,mist.density]);let g=groups.get(key);if(!g){g={mist,ids:new Set()};groups.set(key,g);}g.ids.add(c.id);
 }
 return [...groups.values()].map(g=>({...g,runs:strokeInk(d,s,g.ids)}));
}
/** Smooth low-frequency drift in logical pixel space. Never uses independent
 * pixel noise: neighbouring pixels see the same continuous displacement field. */
export function mistWarpAt(x:number,y:number,widthPx:number){
 const amplitude=Math.min(1.4,widthPx*.16),wave=Math.sin(x/17+y/29+.8),detail=Math.sin(x/6.7-y/11.3+2.1);
 return {dx:amplitude*(.7*wave+.3*detail),dy:amplitude*(.68*Math.sin(x/23-y/19+1.7)+.32*Math.sin(x/9.1+y/13.7)),shade:.87+.09*Math.sin(x/21+y/31)+.04*Math.sin(x/8.3-y/16.7)};
}
/** Bound the complete ink (including taper/cusp tips) and the displaced Gaussian
 * tail. Width controls the softness radius, not an independently sprayed area. */
export function mistRasterLayout(points:Point2[],width:number){
 if(!points.length)return null;
 const widthPx=width*250,pad=widthPx+Math.min(1.4,widthPx*.16)+2;
 const b=points.reduce((b,p)=>[Math.min(b[0],p[0]*250),Math.min(b[1],p[1]*250),Math.max(b[2],p[0]*250),Math.max(b[3],p[1]*250)],[Infinity,Infinity,-Infinity,-Infinity]);
 const w=b[2]-b[0]+2*pad,h=b[3]-b[1]+2*pad,scale=Math.min(2,2048/Math.max(w,h),Math.sqrt(1_500_000/(w*h)));
 const nx=Math.max(1,Math.ceil(w*scale)),ny=Math.max(1,Math.ceil(h*scale)),x0=b[0]-pad,y1=b[3]+pad;
 return {nx,ny,scale,sigma:widthPx/3,bounds:[x0,y1-ny/scale,x0+nx/scale,y1] as [number,number,number,number]};
}
