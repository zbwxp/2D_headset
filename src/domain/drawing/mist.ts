import {curveById,objectById,DEFAULT_CONTOUR_MIST,validContourMist,type ContourMist,type DrawingDocument as Doc} from './model';
import {strokeInk,type InkSampling,type InkRun} from './appearance';
import {memberInk} from './depth';
import type {Stroke} from './strokes';

/** Interpret old fog settings as a restrained ink edge, without rewriting a
 * loaded document or snapshot. New edits explicitly persist the new units. */
export function inkEdgeStyle(m?:ContourMist):ContourMist{
 if(!m)return DEFAULT_CONTOUR_MIST;
 if(m.mode==='INK_EDGE')return m;
 return {mode:'INK_EDGE',enabled:m.enabled,width:Math.max(.25,Math.min(3,.5*Math.sqrt(m.width*250)))/250,density:Math.min(1,Math.sqrt(m.density))};
}
/** Exactly the selected curves/offsets; position links, joins and layers are untouched. */
export function setContourMist(d:Doc,ids:string[],change:Partial<ContourMist>):Doc{
 const selected=new Set(ids);if(!selected.size)return d;
 const style=(m?:ContourMist)=>({...inkEdgeStyle(m),...change,mode:'INK_EDGE' as const});
 for(const id of selected){const o=objectById(d,id);if(!o||!('width' in o))throw Error('请选择曲线或偏移线。');if(o.locked)throw Error('对象已锁定。');if(!validContourMist(style(o.mist)))throw Error('像素笔触参数无效。');}
 const apply=<T extends {id:string;mist?:ContourMist}>(o:T):T=>selected.has(o.id)?{...o,mist:style(o.mist)}:o;
 const curves=d.curves.map(apply),offsets=d.offsets.map(apply);
 return JSON.stringify([curves,offsets])===JSON.stringify([d.curves,d.offsets])?d:{...d,curves,offsets};
}
export interface InkPass {owner?:string;mist?:ContourMist;runs:InkRun[]}
const active=(m?:ContourMist)=>m?.enabled&&m.density>0?inkEdgeStyle(m):undefined;
/** Equal styles preserve the native cubic fast path. Mixed member styles use
 * the same partition as depth ordering: joins/tapers are solved once for the
 * whole stroke, then assigned to their owners, never cut out and re-stroked. */
export function strokeInkPasses(d:Doc,s:Stroke,runs:InkRun[],sampling?:InkSampling):InkPass[]{
 const members=s.segments.map(u=>curveById(d,u.id)).filter(c=>c.visible&&c.inkVisible!==false);
 if(!members.length)return [];
 const first=active(members[0].mist),key=JSON.stringify(first);
 if(members.every(c=>JSON.stringify(active(c.mist))===key))return [{mist:first,runs}];
 const order=new Map(members.map((c,i)=>[c.id,i]));
 return [...memberInk(d,s,order,sampling)].reverse().map(([owner,runs])=>({owner,mist:active(curveById(d,owner).mist),runs}));
}
/** Logical pixel sizes scale with artwork zoom, not camera pan. Softness is
 * limited by ink width so a one-pixel line does not dissolve into a gray halo. */
export function inkEdgeParameters(m:ContourMist,lineWidth:number,unit:number){
 const style=inkEdgeStyle(m),px=unit/250,w=style.width*250;
 return {sigma:Math.min(w*.32,lineWidth*250*.32)*px,displacement:Math.min(.45,w*.18,lineWidth*250*.25)*px,mix:.9*style.density,frequency:.065/px};
}
