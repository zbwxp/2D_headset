import type {AssemblyDocument,AssemblyPose} from './model';

type Orientation=Pick<AssemblyPose,'yaw'|'pitch'|'roll'>;
export interface AssemblyViewSlot extends Orientation {id:string;slot:number;name:string}
const orientation=(p:Orientation):Orientation=>({yaw:p.yaw,pitch:p.pitch,roll:p.roll});
const title=(name:string)=>{name=name.trim();if(!name||name.length>80)throw Error('Slot 名称请输入 1–80 个字符。');return name;};
export const matchesViewSlot=(a:AssemblyDocument,s:AssemblyViewSlot)=>['yaw','pitch','roll'].every(k=>a.pose[k as keyof Orientation]===s[k as keyof Orientation]);
export function saveViewSlot(a:AssemblyDocument,id:string,name:string,slot?:number):AssemblyDocument{
 if(slot===undefined){slot=0;while(a.viewSlots?.some(s=>s.slot===slot))slot++;}
 if(!id||!Number.isSafeInteger(slot)||slot<0||a.viewSlots?.some(s=>s.id===id||s.slot===slot))return a;
 return {...a,viewSlots:[...(a.viewSlots??[]),{id,slot,name:title(name),...orientation(a.pose)}],activeViewSlotId:id};
}
export function applyViewSlot(a:AssemblyDocument,id:string):AssemblyDocument{
 const s=a.viewSlots?.find(s=>s.id===id);if(!s||a.activeViewSlotId===id&&matchesViewSlot(a,s))return a;
 return {...a,pose:{...a.pose,...orientation(s)},activeViewSlotId:id};
}
export function updateViewSlot(a:AssemblyDocument,id:string):AssemblyDocument{
 const s=a.viewSlots?.find(s=>s.id===id);if(!s||matchesViewSlot(a,s))return a;
 return {...a,viewSlots:a.viewSlots!.map(v=>v.id===id?{...v,...orientation(a.pose)}:v)};
}
export function renameViewSlot(a:AssemblyDocument,id:string,name:string):AssemblyDocument{
 const s=a.viewSlots?.find(s=>s.id===id);if(!s)return a;name=title(name);if(name===s.name)return a;
 return {...a,viewSlots:a.viewSlots!.map(v=>v.id===id?{...v,name}:v)};
}
export function deleteViewSlot(a:AssemblyDocument,id:string):AssemblyDocument{
 if(!a.viewSlots?.some(s=>s.id===id))return a;
 return {...a,viewSlots:a.viewSlots.filter(s=>s.id!==id),...(a.activeViewSlotId===id?{activeViewSlotId:undefined}:{})};
}
export function parseViewSlots(value:unknown,active:unknown):{viewSlots?:AssemblyViewSlot[];activeViewSlotId?:string}{
 const fail=():never=>{throw Error('主轴视角 Slot 数据无效');};
 if(value===undefined){if(active!==undefined)fail();return {};}
 if(!Array.isArray(value))return fail();
 const ids=new Set<string>(),slots=new Set<number>();
 for(const s of value){
  if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||!Number.isSafeInteger(s.slot)||s.slot<0||slots.has(s.slot)||typeof s.name!=='string'||!s.name.trim()||s.name.length>80||![s.yaw,s.pitch,s.roll].every(v=>typeof v==='number'&&Number.isFinite(v)))fail();
  ids.add(s.id);slots.add(s.slot);
 }
 if(active!==undefined&&(typeof active!=='string'||!ids.has(active)))fail();
 return {viewSlots:value.map(s=>({id:s.id,slot:s.slot,name:s.name,...orientation(s)})),...(typeof active==='string'?{activeViewSlotId:active}:{})};
}
