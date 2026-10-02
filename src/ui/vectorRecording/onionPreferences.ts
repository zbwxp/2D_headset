import {normalizeSceneOnionSettings,type SceneOnionSettings} from './angleInspection';
import type {SceneOnionEndpoints} from './endpointOnion';

export interface OnionPreferences {settings:SceneOnionSettings;endpoints:SceneOnionEndpoints}
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;
const copy=(value:OnionPreferences):OnionPreferences=>({settings:{...value.settings},endpoints:{...value.endpoints}});
export const onionPreferenceKey=(projectId:string|number,recordingId:string)=>`contour-onion-view-v1:${JSON.stringify([projectId,recordingId])}`;

/** View preferences stay outside project serialization and history. In-memory
 * fallback preserves mode switches when browser storage is unavailable. */
export function createOnionPreferenceStorage(storage:()=>Storage|undefined){
 const memory=new Map<string,OnionPreferences>();
 return {
  read(key:string,fallback:OnionPreferences):OnionPreferences {
   const cached=memory.get(key);if(cached)return copy(cached);
   try{
    const raw:unknown=JSON.parse(storage()?.getItem(key)??'null');
    if(!raw||typeof raw!=='object')return copy(fallback);
    const value=raw as Partial<OnionPreferences>,s=value.settings,e=value.endpoints;
    if(!s||typeof s.enabled!=='boolean'||(s.step!==5&&s.step!==10)||(s.axis!=='x'&&s.axis!=='y')||![s.min,s.max,s.opacity].every(n=>typeof n==='number'&&Number.isFinite(n))||!e||typeof e.startSnapshotId!=='string'||typeof e.endSnapshotId!=='string')return copy(fallback);
    const result={settings:normalizeSceneOnionSettings(s),endpoints:{...e}};memory.set(key,result);return copy(result);
   }catch{return copy(fallback);}
  },
  save(key:string,value:OnionPreferences){const saved=copy(value);memory.set(key,saved);try{storage()?.setItem(key,JSON.stringify(saved));}catch{/* Keep the preference for this page. */}}
 };
}
export const snapshotOnionPreferences=createOnionPreferenceStorage(()=>typeof window==='undefined'?undefined:window.localStorage);
