import type {LandmarkProject} from '../../landmarks/model';
import {isDerived,type BezierCurve} from '../model';
export type Endpoint='START'|'END';
export interface JoinEndpoint {curveId:string;endpoint:Endpoint}
/** One canonical relation. A mirrored occurrence is derived, never persisted twice. */
export interface CurveSmoothJoin {id:string;pointId:string;a:JoinEndpoint;b:JoinEndpoint;radiusRatio:number}
export interface JoinOccurrence extends CurveSmoothJoin {mirrored:boolean}
export const JOIN_RADIUS={default:.08,min:0,max:.35} as const;
export const endpointId=(c:BezierCurve,e:Endpoint)=>e==='START'?c.startLandmarkId:c.endLandmarkId;
export const endpointKey=(e:JoinEndpoint)=>JSON.stringify([e.curveId,e.endpoint]);
export function joinOccurrences(p:LandmarkProject,j:CurveSmoothJoin):JoinOccurrence[]{
 const out:JoinOccurrence[]=[{...j,mirrored:false}];
 const point=p.landmarks.find(l=>l.id===j.pointId),pointId=point?.mirrorPartnerId??(point?.type==='CENTERLINE'?point.id:undefined);
 const mirrorEnd=(e:JoinEndpoint):JoinEndpoint|undefined=>{const c=p.curves.find(c=>c.id===e.curveId);if(!c||isDerived(c))return;
  const target=p.curves.find(x=>x.id===c.mirrorPartnerCurveId);if(!target||isDerived(target))return;
  if(endpointId(target,e.endpoint)!==pointId)return;return {...e,curveId:target.id};};
 const a=mirrorEnd(j.a),b=mirrorEnd(j.b);
 if(pointId&&a&&b){const keys=new Set([endpointKey(j.a),endpointKey(j.b)]);if(pointId!==j.pointId||!keys.has(endpointKey(a))||!keys.has(endpointKey(b)))out.push({...j,pointId,a,b,mirrored:true});}
 return out;
}
export function incidentFreeEndpoints(p:LandmarkProject,pointId:string):JoinEndpoint[]{
 return p.curves.flatMap(c=>isDerived(c)?[]:(['START','END'] as const).filter(e=>endpointId(c,e)===pointId).map(endpoint=>({curveId:c.id,endpoint})));
}
export function validateJoins(p:LandmarkProject){
 const ids=new Set<string>(),occupied=new Set<string>();
 for(const j of p.curveSmoothJoins??[]){
  if(!j||typeof j.id!=='string'||!j.id||ids.has(j.id)||typeof j.pointId!=='string'||!p.landmarks.some(l=>l.id===j.pointId))throw Error('Invalid Smooth Join identity');ids.add(j.id);
  if(!Number.isFinite(j.radiusRatio)||j.radiusRatio<JOIN_RADIUS.min||j.radiusRatio>JOIN_RADIUS.max)throw Error('Smooth Radius must be between 0 and 0.35');
  if(!j.a||!j.b||j.a.curveId===j.b.curveId)throw Error('Smooth Join requires two different FREE curves');
  for(const occurrence of joinOccurrences(p,j))for(const e of [occurrence.a,occurrence.b]){
   const c=p.curves.find(c=>c.id===e.curveId);
   if(!c||isDerived(c))throw Error('Smooth Join supports FREE curves only');
   if(!['START','END'].includes(e.endpoint)||endpointId(c,e.endpoint)!==occurrence.pointId)throw Error('Smooth Join endpoints must share the same Point ID');
   const key=endpointKey(e);if(occupied.has(key))throw Error('This curve endpoint already belongs to a Smooth Join');occupied.add(key);
  }
 }
}
export function parseJoins(input:unknown,p:LandmarkProject):CurveSmoothJoin[]{
 if(!Array.isArray(input))throw Error('Invalid Smooth Joins data');
 const joins=input.map(j=>{if(!j||!j.a||!j.b)throw Error('Invalid Smooth Join data');return {id:j.id,pointId:j.pointId,a:{curveId:j.a.curveId,endpoint:j.a.endpoint},b:{curveId:j.b.curveId,endpoint:j.b.endpoint},radiusRatio:j.radiusRatio};});
 validateJoins({...p,curveSmoothJoins:joins});return joins;
}
