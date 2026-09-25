import type {LandmarkProject} from '../landmarks/model';
import {addPatch} from '../patches/model';
import {rebuildEyeScaffold} from './scaffold';
/** One ordinary quad per eye. Its upper/lower boundaries each span both quarter arcs. */
export function addEyeFrontPatches(p:LandmarkProject):LandmarkProject{
 const e=p.eyeScaffold;if(!e||e.coord)return p;
 const old=(p.patches??[]).filter(x=>(['left','right'] as const).some(side=>[0,1].some(q=>{const c=e[side].curveIds,ids=[c[q],c[4+q],c[8+q],c[9+q]];return x.boundaryUses.length===4&&x.boundaryUses.every(b=>ids.includes(b.curveId));})));
 const removed=new Set(old.map(x=>x.id));
 if(p.curves.some(c=>'hostPatchId' in c&&removed.has(c.hostPatchId))||p.landmarks.some(l=>l.placement.kind==='ON_PATCH'&&removed.has(l.placement.hostPatchId)))throw Error('旧眼柱面上已有附着曲线；请先移除依赖后合并前半周曲面。');
 let next=p;
 if(!e.right.frontCurveIds||!e.left.frontCurveIds)next=rebuildEyeScaffold({...p,eyeScaffold:{...e,left:{...e.left,frontCurveIds:e.left.frontCurveIds??[crypto.randomUUID(),crypto.randomUUID()]},right:{...e.right,frontCurveIds:e.right.frontCurveIds??[crypto.randomUUID(),crypto.randomUUID()]}}});
 if(removed.size)next={...next,patches:next.patches?.filter(x=>!removed.has(x.id))};
 const a=next.eyeScaffold!.right,ids=[...a.frontCurveIds!,a.curveIds[8],a.curveIds[10]];
 if(next.patches?.some(x=>x.boundaryUses.length===4&&x.boundaryUses.every(b=>ids.includes(b.curveId))))return next;
 const previous=new Set(next.patches?.map(x=>x.id));next=addPatch(next,ids);
 return {...next,patches:next.patches!.map(x=>previous.has(x.id)?x:{...x,name:'眼柱前面'}),geometryModules:{...next.geometryModules,...Object.fromEntries(next.patches!.filter(x=>!previous.has(x.id)).map(x=>[x.id,'EYES' as const]))}};
}
