import {displayPoint} from '../../rendering/moduleDisplay';
import type {ToolSession} from './state';
import type {SemanticLandmark} from '../../domain/landmarks/model';
export type HitKind='point'|'curve'|'surface'|'empty';
export function placementCapability(p:SemanticLandmark){
 const q=p.placement;
 if(q.kind==='CHIN_SURFACE'||q.kind==='LOOMIS_SCAFFOLD'||q.kind==='ON_CURVE'&&q.role==='canonical'&&q.ringEndpoint)return 'select';
 return ({EYE_LOCAL:'spatial',WORLD:'spatial',FRAME_RELATIVE:'spatial',ON_CURVE:'curve',ON_LOOMIS_SURFACE:'ellipsoid',ON_SECTION_CAP:'cap',ON_PATCH:'patch'} as const)[q.kind];
}
/** Sole interpretation policy shared by SVG point/curve adapters and background hits. */
export function dispatch2D(tool:ToolSession,hit:HitKind,pan=false){
 if(pan)return 'pan';
 if(tool.kind==='mergePoint')return hit==='point'?'mergePoint':'ignore';
 if(tool.kind==='onPatch')return 'onPatch';
 if(tool.kind==='surfacePoint')return 'surfacePoint';
 if(tool.kind==='region')return tool.preview?'region':'ignore';
 if(tool.kind==='curve')return hit==='point'?'curveEndpoint':'ignore';
 if(tool.kind==='patch')return hit==='point'?'patchAnchor':hit==='curve'?'patchEdge':'ignore';
 return hit==='point'?'point':hit==='curve'?'curve':hit==='surface'?'surface':'pan';
}

import type {LandmarkProject} from '../../domain/landmarks/model';
import type {Vec2} from '../../domain/project/types';
import {pointPosition} from '../../domain/geometry/evaluation';
import {worldToScreen,type OrthographicViewState} from '../../rendering/orthographic';
/** Fine-object hit policy: choose a point before a curve, and only then query a surface.
 * Native SVG curve ribbons remain the precise curve hit adapter; they do not interpret tools.
 */
export function fineHit2D(p:LandmarkProject,view:OrthographicViewState,xy:Vec2,curveId?:string,nativePointId?:string,hidden:(id:string)=>boolean=()=>false):{kind:'point'|'curve';id:string}|null {
 if(nativePointId&&!hidden(nativePointId))return {kind:'point',id:nativePointId};
 let point:string|undefined,best=8*8;
 for(const l of p.landmarks){if(hidden(l.id))continue;const q=worldToScreen(displayPoint(p,l.id,pointPosition(p,l.id),view.forward),view),distance=(q[0]-xy[0])**2+(q[1]-xy[1])**2;if(distance<best){best=distance;point=l.id;}}
 return point?{kind:'point',id:point}:curveId&&!hidden(curveId)?{kind:'curve',id:curveId}:null;
}

import {evaluationContext} from '../../domain/geometry/evaluation';
/** Collect all nearby fine objects so overlapping derived/source curves remain reachable. */
export function fineHits2D(p:LandmarkProject,view:OrthographicViewState,xy:Vec2,hidden:(id:string)=>boolean=()=>false){
 const ctx=evaluationContext(p),hits:{kind:'point'|'curve';id:string;distance:number}[]=[];
 for(const l of p.landmarks){if(hidden(l.id))continue;const q=worldToScreen(displayPoint(p,l.id,pointPosition(p,l.id),view.forward),view),distance=Math.hypot(q[0]-xy[0],q[1]-xy[1]);if(distance<=8)hits.push({kind:'point',id:l.id,distance});}
 for(const c of p.curves){if(hidden(c.id))continue;let distance=Infinity;const g=ctx.curve(c.id);let a=worldToScreen(displayPoint(p,c.id,g.evaluate(0),view.forward),view);
 for(let i=1;i<=96;i++){const b=worldToScreen(displayPoint(p,c.id,g.evaluate(i/96),view.forward),view),dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((xy[0]-a[0])*dx+(xy[1]-a[1])*dy)/(dx*dx+dy*dy||1)));distance=Math.min(distance,Math.hypot(xy[0]-a[0]-t*dx,xy[1]-a[1]-t*dy));a=b;}
 if(distance<=6)hits.push({kind:'curve',id:c.id,distance});}
 return hits.sort((a,b)=>(a.kind===b.kind?a.distance-b.distance:a.kind==='point'?-1:1)||a.id.localeCompare(b.id));
}
