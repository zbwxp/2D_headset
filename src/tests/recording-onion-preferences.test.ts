import {expect,test} from 'vitest';
import {createOnionPreferenceStorage,onionPreferenceKey,type OnionPreferences} from '../ui/vectorRecording/onionPreferences';
import {DEFAULT_SCENE_ONION_SETTINGS} from '../ui/vectorRecording/angleInspection';
const defaults:OnionPreferences={settings:{...DEFAULT_SCENE_ONION_SETTINGS,min:-90,max:0},endpoints:{startSnapshotId:'zero',endSnapshotId:'side'}};
const changed:OnionPreferences={settings:{...defaults.settings,enabled:true,step:5,opacity:.24},endpoints:{startSnapshotId:'zero',endSnapshotId:'middle'}};
test('onion selections survive a new workspace session and remain isolated by project and recording',()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}},key=onionPreferenceKey('project-a','recording-a'),first=createOnionPreferenceStorage(()=>storage);
 first.save(key,changed);expect(first.read(key,defaults)).toEqual(changed);
 const reloaded=createOnionPreferenceStorage(()=>storage);expect(reloaded.read(key,defaults)).toEqual(changed);expect(reloaded.read(onionPreferenceKey('project-a','recording-b'),defaults)).toEqual(defaults);expect(reloaded.read(onionPreferenceKey('project-b','recording-a'),defaults)).toEqual(defaults);
 const returned=reloaded.read(key,defaults);returned.settings.enabled=false;expect(reloaded.read(key,defaults).settings.enabled).toBe(true);expect(defaults.settings.enabled).toBe(false);
});
test('unavailable browser storage still preserves preferences across mode switches in the page',()=>{
 const storage=createOnionPreferenceStorage(()=>{throw Error('Storage unavailable');});storage.save('workspace',changed);expect(storage.read('workspace',defaults)).toEqual(changed);expect(storage.read('other',defaults)).toEqual(defaults);
});
test('corrupt or invalid preferences fall back without changing project data',()=>{
 for(const raw of ['{','null','{"settings":{"enabled":true}}',JSON.stringify({...changed,settings:{...changed.settings,step:3}})]){const storage=createOnionPreferenceStorage(()=>({getItem:()=>raw,setItem:()=>{throw Error('Read must not write');}}));expect(storage.read('workspace',defaults)).toEqual(defaults);}
});
