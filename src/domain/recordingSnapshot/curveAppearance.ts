import {validContourMist,DEFAULT_CONTOUR_MIST,type ContourMist,type DrawingCurve,type DrawingDocument,type InkEndStyle,type Profile} from '../drawing/model';
import {appearanceDifference,mergeAppearanceObject,applyAppearanceObject} from './appearancePatch';
import {InputCache} from '../geometry/cache';
import type {CurveSplitIntent} from '../drawing/layerEditIntent';
import type {SnapshotDeformationState} from './model';
import {retainSnapshotRouteMaterialInput} from './routeMaterialSource';

/** Explicit null clears an optional source property; absence follows it live.
 * Endpoint patches are fieldwise so joining one end never freezes the other. */
export type SnapshotInkEndAppearance={[K in keyof InkEndStyle]?:InkEndStyle[K]|null};
export interface SnapshotCurveAppearance {
 name?:string;width?:number;profile?:Profile|null;profileReverse?:boolean|null;strokeName?:string|null;inkVisible?:boolean|null;
 mist?:Partial<ContourMist>|null;depthOffset?:number|null;depthScope?:DrawingCurve['depthScope']|null;localPaintOrder?:boolean|null;
 inkEnds?:{start?:SnapshotInkEndAppearance;end?:SnapshotInkEndAppearance}|null;
}
export type SnapshotCurveAppearanceMap=Record<string,SnapshotCurveAppearance>;
export const snapshotCurveAppearanceFields=['name','width','profile','profileReverse','strokeName','inkVisible','inkEnds','mist','depthOffset','depthScope','localPaintOrder'] as const;
const scalarFields=['name','width','profile','profileReverse','strokeName','inkVisible','depthOffset','depthScope','localPaintOrder'] as const;
const inkFields=['taper','extension','taperWidthScale','interior'] as const;
export const contourMistFields=['enabled','width','density','mode'] as const;
export function validateContourMistPatch(value:unknown):void {
 if(!record(value)||Object.keys(value).some(key=>!contourMistFields.includes(key as typeof contourMistFields[number])))throw Error('Invalid snapshot ink-edge appearance.');
 const patch=value as Record<string,unknown>;
 if(patch.enabled!==undefined&&typeof patch.enabled!=='boolean'||patch.mode!==undefined&&patch.mode!==null&&patch.mode!=='INK_EDGE'||patch.width!==undefined&&(typeof patch.width!=='number'||!Number.isFinite(patch.width)||patch.width<.25/250||patch.width>60/250)||patch.density!==undefined&&(typeof patch.density!=='number'||!Number.isFinite(patch.density)||patch.density<0||patch.density>5))throw Error('Invalid snapshot ink-edge appearance.');
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const clone=<T,>(value:T):T=>structuredClone(value);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Shared parser and runtime validator. No geometry, object visibility, locks or new
 * interpolation/property registry can enter through an appearance patch. */
export function validateSnapshotCurveAppearance(value:unknown):asserts value is SnapshotCurveAppearanceMap {
 const fail=():never=>{throw Error('Invalid snapshot curve appearance override.');};
 if(!record(value)||Object.keys(value).length>65536)fail();
 for(const [id,patch] of Object.entries(value as Record<string,unknown>)){
  if(!id||id.length>16384||!record(patch)||Object.keys(patch).some(key=>!snapshotCurveAppearanceFields.includes(key as typeof snapshotCurveAppearanceFields[number])))fail();
  const p=patch as Record<string,unknown>;
  if(p.name!==undefined&&(typeof p.name!=='string'||!p.name.trim()||p.name.length>256))fail();
  if(p.inkVisible!==undefined&&p.inkVisible!==null&&typeof p.inkVisible!=='boolean')fail();
  if(p.mist!==undefined&&p.mist!==null)validateContourMistPatch(p.mist);
  if(p.depthOffset!==undefined&&p.depthOffset!==null&&(!Number.isSafeInteger(p.depthOffset)||Math.abs(p.depthOffset as number)>10000))fail();
  if(p.depthScope!==undefined&&p.depthScope!==null&&!['PARENT','LAYER'].includes(String(p.depthScope)))fail();
  if(p.localPaintOrder!==undefined&&p.localPaintOrder!==null&&typeof p.localPaintOrder!=='boolean')fail();
  if(p.width!==undefined&&(typeof p.width!=='number'||!Number.isFinite(p.width)||p.width<=0||p.width>1))fail();
  if(p.profile!==undefined&&p.profile!==null&&!['UNIFORM','TAPER_END','TAPER_BOTH','EYELID'].includes(String(p.profile)))fail();
  if(p.profileReverse!==undefined&&p.profileReverse!==null&&typeof p.profileReverse!=='boolean')fail();
  if(p.strokeName!==undefined&&p.strokeName!==null&&(typeof p.strokeName!=='string'||!p.strokeName.trim()||p.strokeName.length>256))fail();
  if(p.inkEnds!==undefined&&p.inkEnds!==null){
   if(!record(p.inkEnds)||Object.keys(p.inkEnds).some(key=>key!=='start'&&key!=='end'))fail();
   for(const end of Object.values(p.inkEnds as object)){
    if(!record(end)||Object.keys(end).some(key=>!inkFields.includes(key as typeof inkFields[number])))fail();
    for(const [key,v] of Object.entries(end)){if(v===null)continue;if(key==='interior'){if(typeof v!=='boolean')fail();}else if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>({taper:20,extension:2,taperWidthScale:200} as Record<string,number>)[key])fail();}
   }
  }
 }
}
export function snapshotCurveAppearanceDifference(before:Pick<DrawingCurve,typeof snapshotCurveAppearanceFields[number]>,after:Pick<DrawingCurve,typeof snapshotCurveAppearanceFields[number]>):SnapshotCurveAppearance|undefined {
 const patch:SnapshotCurveAppearance={};
 const mist=appearanceDifference(before.mist,after.mist,contourMistFields);if(mist!==undefined)patch.mist=mist as Partial<ContourMist>|null;
 for(const key of scalarFields)if(!same(before[key],after[key]))Object.assign(patch,{[key]:after[key]??null});
 if(!same(before.inkEnds,after.inkEnds)){
  if(after.inkEnds===undefined)patch.inkEnds=null;
  else {patch.inkEnds={};for(const [index,end] of (['start','end'] as const).entries()){
   const change:SnapshotInkEndAppearance={};for(const key of inkFields)if(!same(before.inkEnds?.[index][key],after.inkEnds[index][key]))Object.assign(change,{[key]:after.inkEnds[index][key]??null});
   if(Object.keys(change).length)patch.inkEnds[end]=change;
  }}
 }
 return Object.keys(patch).length?patch:undefined;
}
export function unsupportedSnapshotCurveAppearanceFields(before:DrawingCurve,after:DrawingCurve):string[] {
 return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>key!=='nodes'&&key!=='handles'&&!snapshotCurveAppearanceFields.includes(key as typeof snapshotCurveAppearanceFields[number])&&!same(before[key as keyof DrawingCurve],after[key as keyof DrawingCurve]));
}
export function restoreSnapshotCurveAppearance(curve:DrawingCurve,before:DrawingCurve):DrawingCurve {
 const result={...curve};for(const key of snapshotCurveAppearanceFields){Reflect.deleteProperty(result,key);if(before[key]!==undefined)Object.assign(result,{[key]:before[key]});}return result;
}
function mergePatch(before:SnapshotCurveAppearance,after:SnapshotCurveAppearance):SnapshotCurveAppearance {
 const merged={...clone(before),...clone(after)};
 if(after.mist!==undefined)merged.mist=mergeAppearanceObject(before.mist,after.mist,DEFAULT_CONTOUR_MIST);
 if(after.inkEnds&&before.inkEnds!==undefined){
  const cleared:SnapshotInkEndAppearance={taper:null,extension:null,taperWidthScale:null,interior:null};
  const prior=before.inkEnds??{start:cleared,end:cleared};
  merged.inkEnds={...clone(prior),...clone(after.inkEnds)};
  for(const end of ['start','end'] as const)if(after.inkEnds[end])merged.inkEnds[end]={...prior[end],...clone(after.inkEnds[end])};
 }
 return merged;
}
export function mergeSnapshotCurveAppearance(before:SnapshotCurveAppearanceMap|undefined,after:SnapshotCurveAppearanceMap|undefined):SnapshotCurveAppearanceMap {
 const result=clone(before??{});for(const [id,patch] of Object.entries(after??{}))Object.defineProperty(result,id,{value:mergePatch(result[id]??{},patch),enumerable:true,writable:true,configurable:true});return result;
}
export function applySnapshotCurveAppearanceToCurve<T extends Pick<DrawingCurve,typeof snapshotCurveAppearanceFields[number]>>(curve:T,patch:SnapshotCurveAppearance):T {
 const result={...curve};
 if(patch.mist!==undefined){const mist=applyAppearanceObject(curve.mist,patch.mist,DEFAULT_CONTOUR_MIST);if(mist===undefined)delete result.mist;else {if(!validContourMist(mist))throw Error('Snapshot ink-edge appearance is incompatible with its current source.');result.mist=mist;}}
 for(const key of scalarFields)if(patch[key]!==undefined){if(patch[key]===null)Reflect.deleteProperty(result,key);else Object.assign(result,{[key]:patch[key]});}
 if(patch.inkEnds===null)delete result.inkEnds;
 else if(patch.inkEnds!==undefined){
  result.inkEnds=clone(curve.inkEnds??[{},{}]);
  for(const [index,end] of (['start','end'] as const).entries())for(const key of inkFields){const v=patch.inkEnds[end]?.[key];if(v===null)delete result.inkEnds[index][key];else if(v!==undefined)Object.assign(result.inkEnds[index],{[key]:v});}
 }
 return result;
}
const applied=new WeakMap<DrawingDocument,InputCache<DrawingDocument>>();
/** Ink is authored in the same fixed logical units as Drawing. Layer/curve
 * placements only move geometry; width and endpoint-ink lengths do not scale. */
export function applySnapshotCurveAppearance(source:DrawingDocument,state:SnapshotDeformationState):DrawingDocument {
 const patches=new Map<string,SnapshotCurveAppearance>();for(const layer of source.layers)for(const [id,patch] of Object.entries(state.layers[layer.id]?.curveAppearance??{}))if(layer.items.includes(id))patches.set(id,patch);
 if(!patches.size)return source;
 let cache=applied.get(source);if(!cache){cache=new InputCache(16);applied.set(source,cache);}const key=JSON.stringify([...patches]),known=cache.get(key);if(known)return known;
 // Retaining nodes keeps the inherited affine material adapter. Route input
 // ownership is document keyed and must also survive this appearance-only clone.
 return cache.set(key,retainSnapshotRouteMaterialInput({...source,curves:source.curves.map(curve=>patches.has(curve.id)?applySnapshotCurveAppearanceToCurve(curve,patches.get(curve.id)!):curve)},source));
}
/** Split preserves the outer ends. A new material seam inherits Drawing's
 * neutral seam ink rather than duplicating the old outer endpoint patch. */
export function splitSnapshotCurveAppearance(map:SnapshotCurveAppearanceMap,intent:CurveSplitIntent):SnapshotCurveAppearanceMap {
 const prior=map[intent.curveId];if(!prior)return map;const result={...map};delete result[intent.curveId];
 for(const [index,id] of intent.childCurveIds.entries()){
  const value=clone(prior);if(prior.inkEnds){const end=index===0?'start':'end';value.inkEnds=prior.inkEnds[end]?{[end]:clone(prior.inkEnds[end])}:{};}
  Object.defineProperty(result,id,{value,enumerable:true,writable:true,configurable:true});
 }
 return result;
}
