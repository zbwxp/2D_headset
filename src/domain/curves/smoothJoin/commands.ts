import type {LandmarkProject} from '../../landmarks/model';
import {dependencyGraph} from '../../geometry/dependencies';
import {evaluationContext} from '../../geometry/evaluation';
import {resolveJoin} from './geometry';
import {validateJoins,type JoinEndpoint} from './model';
export function addSmoothJoin(p:LandmarkProject,pointId:string,a:JoinEndpoint,b:JoinEndpoint,radiusRatio:number):LandmarkProject{
 const j={id:crypto.randomUUID(),pointId,a,b,radiusRatio},next:LandmarkProject={...p,version:'landmarks-0.6.3',curveSmoothJoins:[...p.curveSmoothJoins??[],j]};
 validateJoins(next);dependencyGraph(next);
 const ctx=evaluationContext(next),r=resolveJoin(next,j,id=>ctx.sourceCurve(id));if(r.warning)throw Error(r.warning);return next;
}
export function setJoinRadius(p:LandmarkProject,id:string,radiusRatio:number):LandmarkProject{
 const next={...p,curveSmoothJoins:p.curveSmoothJoins?.map(j=>j.id===id?{...j,radiusRatio}:j)};validateJoins(next);return next;
}
export function removeSmoothJoin(p:LandmarkProject,id:string):LandmarkProject{return {...p,curveSmoothJoins:p.curveSmoothJoins?.filter(j=>j.id!==id)};}
