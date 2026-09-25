import {validateRecordingReference,type RecordingReferenceImage} from './reference';
export type Point2 = [number, number];
export type Cubic = [Point2, Point2, Point2, Point2];
export interface View { yaw: number; pitch: number }
export interface ViewKey extends View { shape: Cubic }
export interface VisibilityKey extends View {visible:boolean}
/** Display-only spans in the full source cubic's stable parameter, shared across views. */
export interface DrawingRegion {id:string;start:number;end:number}
export interface DrawingRegions {enabled:boolean;regions:DrawingRegion[]}
export interface RecordedPoint {
 id:string;name:string;visible:boolean;locked:boolean;
 keys:(View & {position:Point2})[];
 visibilityKeys?:VisibilityKey[];
}
export interface RecordedCurve {
 id: string; name: string; visible: boolean; locked: boolean;
 /** Display/grouping classification only; absent in legacy ordinary curves. */
 auxiliary?: boolean;
 /** Shared recorded points own the endpoints; key handles remain endpoint-relative. */
 semantic?: {startPointId:string;endPointId:string};
 drawing?:DrawingRegions;
 keys: ViewKey[]; visibilityKeys?: VisibilityKey[];
}
export interface SmoothStyle {radiusScale:number;tensionA:number;tensionB:number}
export interface SmoothKey extends View, SmoothStyle {}
export interface BindingKey extends View {bound:boolean}
interface JunctionEndpoints {
 bindingKeys?:BindingKey[];
 id:string;masterCurveId:string;masterEndpoint:'P0'|'P1';
 followerCurveId:string;followerEndpoint:'P0'|'P1';
}
export type RecordingJunction = JunctionEndpoints & ({mode:'POSITION'} | {mode:'SMOOTH';baseRadius:number;smoothKeys:SmoothKey[]});
export interface Recording { version: 1; curves: RecordedCurve[]; points?:RecordedPoint[]; junctions?:RecordingJunction[]; reference?:RecordingReferenceImage }
export function validateJunctions(r:Recording):void {
 const ids=new Set<string>(),incoming=new Set<string>(),curves=new Set(r.curves.map(c=>c.id));
 if(r.junctions!==undefined&&!Array.isArray(r.junctions))throw Error('Invalid junctions');
 const graph=new Map<string,string[]>(),smoothEnds=new Set<string>();
 for(const j of r.junctions??[]){
  const key=j&&`${j.followerCurveId}:${j.followerEndpoint}`;
  if(!j||typeof j.id!=='string'||!j.id||ids.has(j.id)||!['POSITION','SMOOTH'].includes(j.mode)||!curves.has(j.masterCurveId)||!curves.has(j.followerCurveId)||!['P0','P1'].includes(j.masterEndpoint)||!['P0','P1'].includes(j.followerEndpoint)||incoming.has(key))throw Error('Invalid junction');
  const master=r.curves.find(c=>c.id===j.masterCurveId)!,follower=r.curves.find(c=>c.id===j.followerCurveId)!;
  if(follower.semantic&&semanticPointId(follower,j.followerEndpoint==='P0'?0:3)!==semanticPointId(master,j.masterEndpoint==='P0'?0:3))throw Error('Semantic endpoint has a different point owner');
  if(j.bindingKeys!==undefined){if(!Array.isArray(j.bindingKeys)||!j.bindingKeys.length)throw Error('Invalid binding keys');j.bindingKeys.forEach((k,i)=>{if(!k||typeof k.bound!=='boolean'||![k.yaw,k.pitch].every(Number.isFinite)||k.yaw<0||k.yaw>180||Math.abs(k.pitch)>89||j.bindingKeys!.slice(0,i).some(x=>sameView(x,k)))throw Error('Invalid binding key');});}
  if(j.mode==='SMOOTH'){
   if(!Number.isFinite(j.baseRadius)||j.baseRadius<=0||j.baseRadius>=1||!Array.isArray(j.smoothKeys))throw Error('Invalid Smooth Junction');
   for(const k of [`${j.masterCurveId}:${j.masterEndpoint}`,key]){if(smoothEnds.has(k))throw Error('Endpoint already smoothed');smoothEnds.add(k);}
   j.smoothKeys.forEach((k,i)=>{if(!k||![k.yaw,k.pitch,k.radiusScale,k.tensionA,k.tensionB].every(Number.isFinite)||k.yaw<0||k.yaw>180||Math.abs(k.pitch)>89||k.radiusScale<=0||k.tensionA<=0||k.tensionB<=0||j.smoothKeys.slice(0,i).some(x=>sameView(x,k)))throw Error('Invalid Smooth Key');});
  }
  ids.add(j.id);incoming.add(key);graph.set(j.masterCurveId,[...(graph.get(j.masterCurveId)??[]),j.followerCurveId]);
 }
 const active=new Set<string>(),done=new Set<string>();
 const visit=(id:string)=>{if(active.has(id))throw Error('Junction cycle');if(done.has(id))return;active.add(id);for(const next of graph.get(id)??[])visit(next);active.delete(id);done.add(id);};
 for(const id of curves)visit(id);
}
export const emptyRecording = (): Recording => ({version: 1, curves: []});
// Degrees. Matching tolerance is not a snapping/quantization grid.
export const VIEW_EPS = 1e-6;
export function canonical(v: View): View {
 const yaw=((v.yaw+180)%360+360)%360-180;
 return {yaw:Math.abs(yaw),pitch:Math.max(-89,Math.min(89,v.pitch))};
}
export function mirrored(v: View) { return v.yaw<0 && Math.abs(v.yaw)<180; }
export function mirrorShape(s: Cubic): Cubic { return s.map(([x,y])=>[-x,y]) as Cubic; }
export function displayShape(s:Cubic,v:View):Cubic { return mirrored(v)?mirrorShape(s):s; }
export const sameView=(a:View,b:View)=>Math.hypot(a.yaw-b.yaw,a.pitch-b.pitch)<=VIEW_EPS;
export const semanticPointId=(c:RecordedCurve,end:0|3)=>end===0?c.semantic?.startPointId:c.semantic?.endPointId;
export function parseRecording(value: unknown): Recording {
 if(value===undefined)return emptyRecording();
 const r=value as Recording;
 const fail=()=>{throw new Error('Invalid Recording Room data');};
 const validateVisibility=(keys:VisibilityKey[]|undefined)=>{
  if(keys===undefined)return;
  if(!Array.isArray(keys)||!keys.length)fail();
  keys.forEach((k,i)=>{if(!k||typeof k.visible!=='boolean'||![k.yaw,k.pitch].every(Number.isFinite)||k.yaw<0||k.yaw>180||Math.abs(k.pitch)>89||keys.slice(0,i).some(x=>sameView(x,k)))fail();});
 };
 if(!r||r.version!==1||!Array.isArray(r.curves))return fail();
 const ids=new Set<string>();
 if(r.points!==undefined&&!Array.isArray(r.points))fail();
 for(const p of r.points??[]){
  if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.name!=='string'||typeof p.visible!=='boolean'||typeof p.locked!=='boolean'||!Array.isArray(p.keys)||!p.keys.length)fail();
  ids.add(p.id);
  validateVisibility(p.visibilityKeys);
  p.keys.forEach((k,i)=>{if(!k||![k.yaw,k.pitch].every(Number.isFinite)||k.yaw<0||k.yaw>180||Math.abs(k.pitch)>89||!Array.isArray(k.position)||k.position.length!==2||!k.position.every(Number.isFinite)||p.keys.slice(0,i).some(x=>sameView(x,k)))fail();});
 }
 const pointIds=new Set(ids);
 for(const c of r.curves){
  if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||typeof c.name!=='string'||typeof c.visible!=='boolean'||typeof c.locked!=='boolean'||!Array.isArray(c.keys)||!c.keys.length)fail();
  if(c.auxiliary!==undefined&&typeof c.auxiliary!=='boolean')fail();
  if(c.drawing!==undefined){
   const d=c.drawing;
   if(!d||typeof d.enabled!=='boolean'||!Array.isArray(d.regions))fail();
   const regionIds=new Set<string>();
   for(const region of d.regions){
    if(!region||typeof region.id!=='string'||!region.id||regionIds.has(region.id)||![region.start,region.end].every(Number.isFinite)||region.start<0||region.end>1||region.start>=region.end)fail();
    regionIds.add(region.id);
   }
  }
  if(c.semantic!==undefined&&(!c.semantic||!pointIds.has(c.semantic.startPointId)||!pointIds.has(c.semantic.endPointId)||c.semantic.startPointId===c.semantic.endPointId))fail();
  validateVisibility(c.visibilityKeys);
  ids.add(c.id);
  c.keys.forEach((k,i)=>{
   if(!k||![k.yaw,k.pitch].every(Number.isFinite)||k.yaw<0||k.yaw>180||k.pitch< -89||k.pitch>89||!Array.isArray(k.shape)||k.shape.length!==4||!k.shape.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))||c.keys.slice(0,i).some(x=>sameView(x,k)))fail();
  });
 }
 validateJunctions(r);
 validateRecordingReference(r.reference);
 const result=structuredClone(r);
 // Retired Gridify metadata is discarded; all saved shape samples stay intact.
 for(const c of result.curves)delete (c as RecordedCurve & {gridStepDegrees?:unknown}).gridStepDegrees;
 return result;
}
