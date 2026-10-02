import type {RecordingScenes} from './model';
import {validateRecordingScenes} from './validation';

const fail=(message:string):never=>{throw Error(`Invalid recording scene JSON: ${message}`);};
function object(value:unknown,allowed:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('expected object');
 const o=value as Record<string,unknown>,unknown=Object.keys(o).filter(k=>!allowed.includes(k));
 if(unknown.length)fail(`unknown field ${unknown.join(', ')}`);return o;
}
const array=(value:unknown,max:number)=>{if(!Array.isArray(value)||value.length>max)return fail('array limit');return value;};
const name=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value.length>256)fail('name');};
const id=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>4096)fail('identifier');};
const optionalId=(value:unknown)=>{if(value!==undefined)id(value);};
const angle=(value:unknown)=>object(value,['x','y']);
function reference(value:unknown,withObject=false){const r=object(value,withObject?['instanceId','sourceLayerId','sourceObjectId']:['instanceId','sourceLayerId']);id(r.instanceId);id(r.sourceLayerId);optionalId(r.sourceObjectId);}
function grid(value:unknown){
 const g=object(value,['rows','columns','bounds','nodes']);object(g.bounds,['min','max']);
 for(const node of array(g.nodes,10201))object(node,['position','handleU','handleV','twist']);
}
const trackFields=['keys','draft','interpolation'];
function track(o:Record<string,unknown>,value:(v:unknown)=>void){
 for(const item of array(o.keys,4096)){const k=object(item,['id','name','angle','value']);if(k.name!==undefined)name(k.name);angle(k.angle);value(k.value);}
 if(o.draft!==undefined){const d=object(o.draft,['angle','value']);angle(d.angle);value(d.value);}
}
function sourceFrames(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('source frames');
 if(Object.keys(value).length>4096)fail('source frames limit');
 for(const [key,raw] of Object.entries(value)){id(key);const frame=object(raw,['signature','curveIds','rangeIds']);if(typeof frame.signature!=='string'||frame.signature.length>1000000)fail('frame signature');array(frame.curveIds,16384).forEach(id);array(frame.rangeIds,16384).forEach(id);}
}

/** Strict external schema. Source references may be orphaned; the evaluator
 * reports them locally, and their authored channels remain serializable. */
export function parseRecordingScenes(value:unknown):RecordingScenes{
 const data=object(value,['version','activeSceneId','scenes']);optionalId(data.activeSceneId);
 for(const raw of array(data.scenes,500)){
  const scene=object(raw,['id','name','angle','viewpoints','instances','warps','bindings','visibilityTracks','intervalTracks','depthTracks','legacy','tolerance']);name(scene.name);angle(scene.angle);
  if(scene.viewpoints!==undefined)for(const raw of array(scene.viewpoints,4096)){const viewpoint=object(raw,['id','name','angle']);id(viewpoint.id);name(viewpoint.name);angle(viewpoint.angle);}
  if(scene.legacy!==undefined){const legacy=object(scene.legacy,['rigId','appearancePending']);id(legacy.rigId);if(legacy.appearancePending!==undefined&&typeof legacy.appearancePending!=='boolean')fail('legacy appearance flag');}
  if(scene.tolerance!==undefined&&(typeof scene.tolerance!=='number'||!Number.isFinite(scene.tolerance)||scene.tolerance<.000001||scene.tolerance>1))fail('tolerance');
  for(const raw of array(scene.instances,1000)){
   const instance=object(raw,['id','artworkId','name','layerIds','sourceSignature','sourceStructureSignature','sourceIntervalFrames']);name(instance.name);
   if(instance.layerIds!==undefined)array(instance.layerIds,16384).forEach(id);optionalId(instance.sourceSignature);optionalId(instance.sourceStructureSignature);if(instance.sourceIntervalFrames!==undefined)sourceFrames(instance.sourceIntervalFrames);
  }
  for(const raw of array(scene.warps,1000)){const warp=object(raw,['id','name','parentId','restGrid',...trackFields]);name(warp.name);optionalId(warp.parentId);grid(warp.restGrid);track(warp,grid);}
  for(const raw of array(scene.bindings,16384)){const binding=object(raw,['instanceId','sourceLayerId','warpId']);id(binding.instanceId);id(binding.sourceLayerId);id(binding.warpId);}
  for(const raw of array(scene.visibilityTracks,16384)){const t=object(raw,['id','target',...trackFields]);reference(t.target,true);track(t,()=>{});}
  for(const raw of array(scene.intervalTracks,4096)){
   const t=object(raw,['id','instanceId','sourceTrackId','materialIssue',...trackFields]);
   if(t.materialIssue!==undefined){const issue=object(t.materialIssue,['sourceSignature','message']);id(issue.sourceSignature);if(typeof issue.message!=='string'||issue.message.length>4096)fail('material issue message');}
   track(t,v=>{object(v,['appearance','enabled']);});
  }
  if(scene.depthTracks!==undefined)for(const raw of array(scene.depthTracks,16384)){const t=object(raw,['id','target',...trackFields]);reference(t.target);track(t,()=>{});}
 }
 validateRecordingScenes(value as RecordingScenes);
 return structuredClone(value as RecordingScenes);
}
