import {objectById,type DrawingDocument as Doc} from './model';

/** Container icons summarize current members; they never act as permission gates. */
export function objectState(d:Doc,ids:readonly string[]){
 const objects=ids.map(id=>objectById(d,id)).filter(Boolean);
 return {count:objects.length,anyVisible:objects.some(o=>o.visible),allVisible:objects.length>0&&objects.every(o=>o.visible),anyLocked:objects.some(o=>o.locked),allLocked:objects.length>0&&objects.every(o=>o.locked)};
}

/** One-shot batch, including fills/offsets. Does not change ink masks or future members. */
export function setObjectState(d:Doc,ids:readonly string[],change:{visible?:boolean;locked?:boolean}):Doc{
 const selected=new Set(ids),entries=Object.entries(change).filter(([,v])=>v!==undefined) as ['visible'|'locked',boolean][];
 const changed=(o:{id:string;visible:boolean;locked:boolean})=>selected.has(o.id)&&entries.some(([k,v])=>o[k]!==v);
 if(![...d.curves,...d.fills,...d.offsets].some(changed))return d;
 const update=<T extends {id:string;visible:boolean;locked:boolean}>(o:T):T=>changed(o)?{...o,...Object.fromEntries(entries)}:o;
 return {...d,curves:d.curves.map(update),fills:d.fills.map(update),offsets:d.offsets.map(update)};
}
