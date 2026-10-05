import {DEFAULT_FILL_MIST,validDepthAppearance,type DrawingDocument,type FillRegion,type FillMist,type OffsetRelation,type Point2} from '../drawing/model';
import {appearanceDifference,sameAppearance,mergeAppearanceObject,applyAppearanceObject,validateAppearanceMap,appearanceRecord} from './appearancePatch';
import {snapshotCurveAppearanceDifference,mergeSnapshotCurveAppearance,applySnapshotCurveAppearanceToCurve,validateSnapshotCurveAppearance,type SnapshotCurveAppearance} from './curveAppearance';
import {InputCache} from '../geometry/cache';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';
import type {SnapshotDeformationState} from './model';

export type SnapshotFillAppearance={kind:'fill';name?:string;color?:FillRegion['color'];mist?:Partial<FillMist>|null;depthOffset?:number|null;depthScope?:FillRegion['depthScope']|null};
export type SnapshotOffsetAppearance=Pick<SnapshotCurveAppearance,'name'|'width'|'profile'|'profileReverse'|'inkEnds'|'mist'>&{kind:'offset';distance?:number;start?:number;end?:number;taper?:number;translation?:Point2|null};
export type SnapshotPaintAppearance=SnapshotFillAppearance|SnapshotOffsetAppearance;
export type SnapshotPaintAppearanceMap=Record<string,SnapshotPaintAppearance>;
const fillFields=['name','color','mist','depthOffset','depthScope'] as const,offsetFields=['name','width','profile','profileReverse','inkEnds','mist','distance','start','end','taper','translation'] as const,mistFields=['enabled','width','opacity','side'] as const;
const inkFields=['name','width','profile','profileReverse','inkEnds','mist'] as const;
const fail=():never=>{throw Error('Invalid snapshot paint appearance override.');};
export function validateSnapshotPaintAppearance(value:unknown):asserts value is SnapshotPaintAppearanceMap{
 validateAppearanceMap(value,patch=>{
  const allowed=patch.kind==='fill'?fillFields:patch.kind==='offset'?offsetFields:fail();
  if(Object.keys(patch).some(key=>key!=='kind'&&!(allowed as readonly string[]).includes(key)))fail();
  if(patch.name!==undefined&&(typeof patch.name!=='string'||!patch.name.trim()||patch.name.length>256))fail();
  const num=(key:string,min:number,max:number)=>{const v=patch[key];if(v!==undefined&&(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max))fail();};
  if(patch.kind==='fill'){
   if(!validDepthAppearance({depthOffset:patch.depthOffset??undefined,depthScope:patch.depthScope??undefined}))fail();
   if(patch.color!==undefined&&!['white','black','transparent'].includes(String(patch.color)))fail();
   if(patch.mist!==undefined&&patch.mist!==null){const mist=patch.mist;if(!appearanceRecord(mist)||Object.keys(mist).some(key=>!mistFields.includes(key as typeof mistFields[number])))fail();
    const m=mist as Record<string,unknown>;
    if(m.enabled!==undefined&&typeof m.enabled!=='boolean'||m.side!==undefined&&!['INSIDE','OUTSIDE','BOTH'].includes(String(m.side))||m.width!==undefined&&(typeof m.width!=='number'||!Number.isFinite(m.width)||m.width<.25/250||m.width>200/250)||m.opacity!==undefined&&(typeof m.opacity!=='number'||!Number.isFinite(m.opacity)||m.opacity<0||m.opacity>1))fail();
   }
  }else{
   validateSnapshotCurveAppearance({paint:Object.fromEntries(inkFields.filter(key=>patch[key]!==undefined).map(key=>[key,patch[key]]))});
   num('distance',-2,2);num('start',0,1);num('end',0,1);num('taper',0,.5);
   if(patch.start!==undefined&&patch.end!==undefined&&(patch.start as number)>=(patch.end as number))fail();
   if(patch.translation!==undefined&&patch.translation!==null&&(!Array.isArray(patch.translation)||patch.translation.length!==2||patch.translation.some(value=>typeof value!=='number'||!Number.isFinite(value))))fail();
  }
 });
}
export function snapshotPaintAppearanceDifference(before:FillRegion|OffsetRelation,after:FillRegion|OffsetRelation):SnapshotPaintAppearance|undefined{
 const kind='color' in before?'fill':'offset';if(('color' in after)!==(kind==='fill'))throw Error('Paint kind cannot change through appearance.');
 const fields=kind==='fill'?fillFields:offsetFields;
 const unsupported=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!(fields as readonly string[]).includes(key)&&!sameAppearance((before as unknown as Record<string,unknown>)[key],(after as unknown as Record<string,unknown>)[key]));
 if(unsupported.length)throw Error(`Paint ${before.id} changes unsupported local fields: ${unsupported.join(', ')}.`);
 if(kind==='fill'){
  const a=before as FillRegion,b=after as FillRegion,patch:SnapshotFillAppearance={kind};
  for(const key of ['name','color','depthOffset','depthScope'] as const)if(a[key]!==b[key])Object.assign(patch,{[key]:b[key]??null});
  const mist=appearanceDifference(a.mist,b.mist,mistFields);if(mist!==undefined)patch.mist=mist;
  return Object.keys(patch).length>1?patch:undefined;
 }
 const a=before as OffsetRelation,b=after as OffsetRelation,patch:SnapshotOffsetAppearance={kind,...snapshotCurveAppearanceDifference(a,b)};
 for(const key of ['distance','start','end','taper','translation'] as const)if(!sameAppearance(a[key],b[key]))Object.assign(patch,{[key]:b[key]??null});
 return Object.keys(patch).length>1?patch:undefined;
}
export function mergeSnapshotPaintAppearance(before:SnapshotPaintAppearanceMap|undefined,after:SnapshotPaintAppearanceMap|undefined):SnapshotPaintAppearanceMap{
 const result=structuredClone(before??{});
 for(const [id,patch] of Object.entries(after??{})){
  const previous=result[id];if(previous&&previous.kind!==patch.kind)fail();
  let merged:SnapshotPaintAppearance={...structuredClone(previous),...structuredClone(patch)};
  if(patch.kind==='fill'&&previous?.kind==='fill'&&patch.mist!==undefined)merged={...merged,mist:mergeAppearanceObject(previous.mist,patch.mist,DEFAULT_FILL_MIST)} as SnapshotFillAppearance;
  if(patch.kind==='offset'&&previous?.kind==='offset')merged={...merged,...mergeSnapshotCurveAppearance({[id]:Object.fromEntries(inkFields.filter(key=>previous[key]!==undefined).map(key=>[key,previous[key]]))},{[id]:Object.fromEntries(inkFields.filter(key=>patch[key]!==undefined).map(key=>[key,patch[key]]))})[id]} as SnapshotOffsetAppearance;
  Object.defineProperty(result,id,{value:merged,enumerable:true,writable:true,configurable:true});
 }
 return result;
}
export function applySnapshotPaintAppearanceToObject<T extends FillRegion|OffsetRelation>(object:T,patch:SnapshotPaintAppearance):T{
 if(patch.kind==='fill'){
  if(!('color' in object))fail();const result={...object} as FillRegion;
  for(const key of ['name','color','depthOffset','depthScope'] as const)if(patch[key]!==undefined){if(patch[key]===null)Reflect.deleteProperty(result,key);else Object.assign(result,{[key]:patch[key]});}
  if(patch.mist!==undefined){const mist=applyAppearanceObject(result.mist,patch.mist,DEFAULT_FILL_MIST);if(mist===undefined)delete result.mist;else result.mist=mist;}
  // A live source may change to transparent after a local mist edit.
  if(result.color==='transparent'&&result.mist?.enabled)result.mist={...result.mist,enabled:false};
  return result as T;
 }
 if('color' in object)fail();const result=applySnapshotCurveAppearanceToCurve(object as OffsetRelation,patch);
 for(const key of ['distance','start','end','taper','translation'] as const)if(patch[key]!==undefined){if(patch[key]===null)Reflect.deleteProperty(result,key);else Object.assign(result,{[key]:structuredClone(patch[key])});}
 return result as T;
}
const applied=new WeakMap<DrawingDocument,InputCache<DrawingDocument>>();
export function applySnapshotPaintAppearance(source:DrawingDocument,state:SnapshotDeformationState):DrawingDocument{
 const patches=new Map<string,SnapshotPaintAppearance>();for(const layer of source.layers)for(const [id,patch] of Object.entries(state.layers[layer.id]?.paintAppearance??{}))if(layer.items.includes(id))patches.set(id,patch);
 if(!patches.size)return source;let cache=applied.get(source);if(!cache){cache=new InputCache(16);applied.set(source,cache);}const key=JSON.stringify([...patches]),known=cache.get(key);if(known)return known;
 return cache.set(key,retainSnapshotRouteMaterialInput({...source,fills:source.fills.map(fill=>patches.has(fill.id)?applySnapshotPaintAppearanceToObject(fill,patches.get(fill.id)!):fill),offsets:source.offsets.map(offset=>patches.has(offset.id)?applySnapshotPaintAppearanceToObject(offset,patches.get(offset.id)!):offset)},source));
}
