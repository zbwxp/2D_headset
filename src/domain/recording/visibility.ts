import {evaluate} from './evaluation';
import {canonical,sameView,type Cubic,type RecordedCurve,type RecordedPoint,type Recording,type View} from './model';
type RecordedElement=RecordedCurve|RecordedPoint;
const cache=new WeakMap<RecordedElement,RecordedCurve>();
export function visibleAtView(c:RecordedElement,v:View):boolean {
 if(!c.visibilityKeys?.length)return true;
 let field=cache.get(c);
 if(!field){field={...c,keys:c.visibilityKeys.map(k=>({...k,shape:Array.from({length:4},()=>[k.visible?1:0,0]) as Cubic}))};cache.set(c,field);}
 return evaluate(field,v).shape[0][0]>.5;
}
export const curveVisible=(c:RecordedCurve,v:View)=>c.visible&&visibleAtView(c,v);
export const pointVisible=(p:RecordedPoint,v:View)=>p.visible&&visibleAtView(p,v);
export function setViewVisibility(r:Recording,id:string,view:View,visible:boolean):Recording {
 const curve=r.curves.find(c=>c.id===id),c=curve??r.points?.find(p=>p.id===id);if(!c||c.locked)return r;
 const key={...canonical(view),visible};
 if(c.visibilityKeys?.some(k=>sameView(k,key)&&k.visible===visible))return r;
 const keys=c.visibilityKeys??c.keys.map(k=>({yaw:k.yaw,pitch:k.pitch,visible:true}));
 const visibilityKeys=keys.some(k=>sameView(k,key))?keys.map(k=>sameView(k,key)?key:k):[...keys,key];
 return curve?{...r,curves:r.curves.map(x=>x===curve?{...x,visibilityKeys}:x)}:{...r,points:r.points!.map(p=>p===c?{...p,visibilityKeys}:p)};
}
