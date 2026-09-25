import {junctionEnabled} from './bindingState';
import {evaluate,type Evaluated} from './evaluation';
import {semanticPointId,validateJunctions,type Recording,type View,type Cubic,type Point2} from './model';
import {evaluatePoint} from './points';
export const endpointIndex=(end:'P0'|'P1'):0|3=>end==='P0'?0:3;
export const boundEndpoint=(r:Recording,id:string,end:number)=>r.junctions?.find(j=>j.followerCurveId===id&&endpointIndex(j.followerEndpoint)===end);
export interface JunctionResult extends Evaluated {view:View;rawShape:Cubic;translations:Partial<Record<0|3,Point2>>}
/** Raw sources stay immutable; each master is resolved before its followers. */
export function evaluateRecording(r:Recording,view:View):Map<string,JunctionResult>{
 const result=new Map<string,JunctionResult>();
 const resolve=(id:string):JunctionResult=>{
  const cached=result.get(id);if(cached)return cached;
  const c=r.curves.find(c=>c.id===id)!;const raw=evaluate(c,view);
  const e:JunctionResult={...raw,view,rawShape:raw.shape,shape:structuredClone(raw.shape),translations:{}};
  if(c.semantic)for(const end of [0,3] as const){
   const p=r.points!.find(p=>p.id===semanticPointId(c,end))!,point=evaluatePoint(p,view),h=end===0?1:2;
   const delta:Point2=[point.position[0]-raw.shape[end][0],point.position[1]-raw.shape[end][1]];
   e.shape[end]=[...point.position];e.shape[h]=[raw.shape[h][0]+delta[0],raw.shape[h][1]+delta[1]];e.translations[end]=delta;
   if(point.status==='frozen')e.status='frozen';
  }
  for(const j of r.junctions??[]){if(j.followerCurveId!==id||!junctionEnabled(j,view))continue;
   const master=resolve(j.masterCurveId);if(e.status==='frozen'||master.status==='frozen'||c.semantic)continue;
   const end=endpointIndex(j.followerEndpoint),h=end===0?1:2,m=master.shape[endpointIndex(j.masterEndpoint)],p=raw.shape[end];
   const delta:Point2=[m[0]-p[0],m[1]-p[1]];
   e.shape[end]=[...m];e.shape[h]=[raw.shape[h][0]+delta[0],raw.shape[h][1]+delta[1]];e.translations[end]=delta;
  }
  result.set(id,e);return e;
 };
 for(const c of r.curves)resolve(c.id);return result;
}
/** Canonical derived edit -> raw authored key. Bound positions are never authored here. */
export function inverseJunction(r:Recording,id:string,e:JunctionResult,shape:Cubic):Cubic{
 const raw=structuredClone(shape);
 for(const end of [0,3] as const){if(!e.translations[end])continue;
  raw[end]=[...e.rawShape[end]];const d=e.translations[end],h=end===0?1:2;
  if(d)raw[h]=[shape[h][0]-d[0],shape[h][1]-d[1]];
 }
 return raw;
}
export function bindEndpoints(r:Recording,master:{id:string;end:0|3},follower:{id:string;end:0|3},view:View,id:string):Recording{
 const c=r.curves.find(c=>c.id===follower.id);
 if(!c||!r.curves.some(c=>c.id===master.id))return r;
 const members=endpointEditGroup(r,follower);
 if(members.some(p=>r.curves.find(c=>c.id===p.id)?.locked)||members.some(p=>p.id===master.id&&p.end===master.end))return r;
 // Attach the existing group's root, preserving its internal relations.
 while(true){const incoming=boundEndpoint(r,follower.id,follower.end);if(!incoming)break;follower={id:incoming.masterCurveId,end:endpointIndex(incoming.masterEndpoint)};}
 const e=evaluateRecording(r,view);
 if(e.get(master.id)!.status==='frozen'||e.get(follower.id)!.status==='frozen')return r;
 const next:Recording={...r,junctions:[...(r.junctions??[]),{id,masterCurveId:master.id,masterEndpoint:master.end===0?'P0':'P1',followerCurveId:follower.id,followerEndpoint:follower.end===0?'P0':'P1',mode:'POSITION'}]};
 try{validateJunctions(next);}catch{return r;}return next;
}
export function deleteRecordedCurve(r:Recording,id:string):Recording{
 return {...r,curves:r.curves.filter(c=>c.id!==id),...(r.junctions?{junctions:r.junctions.filter(j=>j.masterCurveId!==id&&j.followerCurveId!==id)}:{})};
}

export interface RecordingEndpoint {id:string;end:0|3}
/** Authoring follows persistent membership, including frozen views. Navigation alone never creates keys. */
export function endpointEditGroup(r:Recording,endpoint:RecordingEndpoint,_e?:Map<string,JunctionResult>):RecordingEndpoint[]{
 const group:RecordingEndpoint[]=[endpoint];
 const has=(p:RecordingEndpoint)=>group.some(x=>x.id===p.id&&x.end===p.end);
 for(let i=0;i<group.length;i++)for(const j of r.junctions??[]){
  if(_e&&!junctionEnabled(j,_e.get(endpoint.id)!.view))continue;
  const master={id:j.masterCurveId,end:endpointIndex(j.masterEndpoint)},follower={id:j.followerCurveId,end:endpointIndex(j.followerEndpoint)};
  if(has(master)||has(follower)){if(!has(master))group.push(master);if(!has(follower))group.push(follower);}
 }
 return group;
}
export function canEditEndpoint(r:Recording,endpoint:RecordingEndpoint,e:Map<string,JunctionResult>):boolean {
 const group=endpointEditGroup(r,endpoint,e);
 return group.every(p=>{const c=r.curves.find(c=>c.id===p.id);if(!c||c.locked)return false;const id=semanticPointId(c,p.end);return !id||!!r.points?.some(point=>point.id===id&&!point.locked);});
}
