import {evaluate,coverage} from './evaluation';
import {canonical,mirrored,sameView,type Cubic,type Point2,type RecordedCurve,type RecordedPoint,type Recording,type View} from './model';

const fields=new WeakMap<RecordedPoint,RecordedCurve>();
/** Reuse the existing view field; this adapter never creates a curve asset. */
export function pointField(p:RecordedPoint):RecordedCurve {
 let field=fields.get(p);
 if(!field){field={...p,keys:p.keys.map(k=>({yaw:k.yaw,pitch:k.pitch,shape:Array.from({length:4},()=>[...k.position]) as Cubic}))};fields.set(p,field);}
 return field;
}
export const pointCoverage=(p:RecordedPoint)=>coverage(pointField(p));
export function evaluatePoint(p:RecordedPoint,view:View){const e=evaluate(pointField(p),view);return {position:e.shape[0],status:e.status,at:e.at};}
export const displayPoint=(p:Point2,view:View):Point2=>[mirrored(view)?-p[0]:p[0],p[1]];
export function createRecordedPoint(r:Recording,view:View,id:string,name:string,displayed:Point2):Recording {
 if(!displayed.every(Number.isFinite)||r.curves.some(c=>c.id===id)||(r.points??[]).some(p=>p.id===id))return r;
 return {...r,points:[...(r.points??[]),{id,name,visible:true,locked:false,keys:[{...canonical(view),position:displayPoint(displayed,view)}]}]};
}
export function updateRecordedPoint(r:Recording,id:string,fn:(p:RecordedPoint)=>RecordedPoint):Recording {
 return {...r,points:(r.points??[]).map(p=>p.id===id?fn(p):p)};
}
/** Array order is the persisted list order; geometry and ID references stay intact. */
export function reorderRecordedPoint(r:Recording,id:string,targetId:string,after:boolean):Recording {
 const point=r.points?.find(p=>p.id===id);
 if(!point||id===targetId||!r.points!.some(p=>p.id===targetId))return r;
 const points=r.points!.filter(p=>p.id!==id);
 points.splice(points.findIndex(p=>p.id===targetId)+(after?1:0),0,point);
 return points.every((p,i)=>p===r.points![i])?r:{...r,points};
}
/** Canonical position write; an explicit command creates an exact key even when
 * its result matches the previously interpolated/frozen reference. */
function writePointKey(r:Recording,id:string,view:View,position:Point2):Recording {
 const p=r.points?.find(p=>p.id===id);if(!p||p.locked||!position.every(Number.isFinite))return r;
 const key={...canonical(view),position:[...position] as Point2},exact=p.keys.find(k=>sameView(k,key));
 if(exact&&exact.position[0]===position[0]&&exact.position[1]===position[1])return r;
 return updateRecordedPoint(r,id,p=>({...p,keys:exact?p.keys.map(k=>sameView(k,key)?key:k):[...p.keys,key]}));
}
export function editRecordedPoint(r:Recording,id:string,view:View,displayed:Point2):Recording {
 const p=r.points?.find(p=>p.id===id);if(!p||p.locked||!displayed.every(Number.isFinite))return r;
 const position=displayPoint(displayed,view),old=evaluatePoint(p,view).position;
 if(position[0]===old[0]&&position[1]===old[1])return r;
 return writePointKey(r,id,view,position);
}
export function mirrorRecordedPoint(r:Recording,source:string,target:string,view:View):Recording {
 const p=r.points?.find(p=>p.id===source);if(!p||source===target)return r;
 const e=evaluatePoint(p,view);if(e.status==='frozen')return r;
 // Mirror the visible position, then inverse whole-view mirror for storage.
 const displayed=displayPoint(e.position,view),mirrored:Point2=[displayed[0]===0?0:-displayed[0],displayed[1]];
 return writePointKey(r,target,view,displayPoint(mirrored,view));
}
export const pointUsers=(r:Recording,id:string)=>r.curves.filter(c=>c.semantic?.startPointId===id||c.semantic?.endPointId===id);
export function deleteRecordedPoint(r:Recording,id:string):Recording {
 if(r.points?.find(p=>p.id===id)?.locked||pointUsers(r,id).length)return r;
 return {...r,points:(r.points??[]).filter(p=>p.id!==id)};
}
export function createSemanticCurve(r:Recording,view:View,id:string,name:string,startPointId:string,endPointId:string):Recording {
 const a=r.points?.find(p=>p.id===startPointId),b=r.points?.find(p=>p.id===endPointId);
 if(!a||!b||a===b)return r;
 const pa=evaluatePoint(a,view),pb=evaluatePoint(b,view);
 if(pa.status==='frozen'||pb.status==='frozen')return r;
 const lerp=(t:number):Point2=>[pa.position[0]*(1-t)+pb.position[0]*t,pa.position[1]*(1-t)+pb.position[1]*t];
 const shape:Cubic=[[...pa.position],lerp(1/3),lerp(2/3),[...pb.position]];
 return {...r,curves:[...r.curves,{id,name,visible:true,locked:false,semantic:{startPointId,endPointId},keys:[{...canonical(view),shape}]}]};
}
