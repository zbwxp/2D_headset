import {isSection} from '../../domain/curves/model';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {CurveEdge} from '../../domain/curves/model';
export type Side = 'LEFT' | 'RIGHT';
export interface PairRow<T> { primary:T; mirror?:T }
/** Only reciprocal, opposite-side partners collapse. Never infer sides from names. */
export function pairRows<T extends {id:string}>(items:T[], partner:(x:T)=>string|undefined, side:(x:T)=>Side|undefined):PairRow<T>[] {
 const byId=new Map(items.map(x=>[x.id,x])),seen=new Set<string>(),rows:PairRow<T>[]=[];
 for(const x of items){if(seen.has(x.id))continue;const y=byId.get(partner(x)??'');
  if(y&&y.id!==x.id&&partner(y)===x.id&&side(x)&&side(y)&&side(x)!==side(y)){
   rows.push({primary:side(x)==='RIGHT'?x:y,mirror:side(x)==='LEFT'?x:y});seen.add(y.id);
  }else rows.push({primary:x});seen.add(x.id);
 }return rows;
}
export const pointSide=(x:{type:string}):Side|undefined=>x.type==='LEFT'||x.type==='RIGHT'?x.type:undefined;
export function curveSide(p:LandmarkProject,c:CurveEdge):Side|undefined {
 if(isSection(c))return c.side==='CENTERLINE'?undefined:c.side;
 const sides=[c.startLandmarkId,c.endLandmarkId].map(id=>p.landmarks.find(l=>l.id===id)).filter(Boolean).map(l=>pointSide(l!)).filter(Boolean);
 return sides.length&&sides.every(s=>s===sides[0])?sides[0]:undefined;
}
export const landmarkRows=(p:LandmarkProject)=>pairRows(p.landmarks,x=>x.mirrorPartnerId,pointSide);
export const curveRows=(p:LandmarkProject)=>pairRows(p.curves,x=>x.mirrorPartnerCurveId,x=>curveSide(p,x));
export const patchRows=(p:LandmarkProject)=>pairRows(p.patches??[],x=>x.mirrorPartnerId,x=>{
 const partner=p.patches?.find(y=>y.id===x.mirrorPartnerId);
 // For a loop crossing the center, identify side from a deterministic exclusive
 // mirrored boundary pair. Common boundaries cannot define which member is R.
 const edges=x.boundaryUses.map(b=>b.curveId).filter(id=>!partner?.boundaryUses.some(b=>b.curveId===id))
  .map(id=>p.curves.find(c=>c.id===id)).filter((c):c is CurveEdge=>!!c)
  .sort((a,b)=>[a.id,a.mirrorPartnerCurveId??a.id].sort()[0].localeCompare([b.id,b.mirrorPartnerCurveId??b.id].sort()[0]));
 return edges.map(c=>curveSide(p,c)).find(Boolean);
});
/** Existing Curve rename convention; only strip a side prefix for a verified pair. */
export const curveBaseName=(c:CurveEdge,paired:boolean)=>paired?c.name.replace(/^[左右]/,''):c.name;
