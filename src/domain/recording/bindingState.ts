import {evaluate} from './evaluation';
import type {Cubic,RecordedCurve,RecordingJunction,View} from './model';
const cache=new WeakMap<RecordingJunction,RecordedCurve>();
/** A discrete state field, never a fractional positional constraint. Tie belongs to unbound. */
export function junctionEnabled(j:RecordingJunction,view:View):boolean {
 if(!j.bindingKeys?.length)return true;
 let field=cache.get(j);
 if(!field){field={id:j.id,name:'',locked:false,visible:true,keys:j.bindingKeys.map(k=>({...k,shape:Array.from({length:4},()=>[k.bound?1:0,0]) as Cubic}))};cache.set(j,field);}
 return evaluate(field,view).shape[0][0]>.5;
}
