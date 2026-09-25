import {displayPoint} from '../../rendering/moduleDisplay';
import {useEditor} from '../../app/store';
import {surfaceHit} from './surfaceHit';
import {createToolDraft,materializeToolDraft} from './draft';
import {domainBoundaries,endpointLocations,surfacePointLocation} from '../../domain/patches/domain';
import {boundaryGeometry} from '../../domain/patches/boundary';
import {addOnCurvePoint,setOnCurveS} from '../../domain/landmarks/placement';
import {createOnPatch} from '../../domain/curves/onPatch';
import {evaluationContext} from '../../domain/geometry/evaluation';
import {worldToScreen,type OrthographicViewState} from '../../rendering/orthographic';
import type {Vec2} from '../../domain/project/types';
export function pickOnPatch(screen:Vec2,view:OrthographicViewState,pointId?:string){
 const s=useEditor.getState(),tool=s.tool;if(tool.kind!=='onPatch')return;
 try{
  if(!tool.hostId){const hit=surfaceHit(s.project,screen,view,true);if(hit?.ref.kind!=='surface'||hit.ref.source!=='PATCH'){s.notify('On Surface Curve 只接受 Patch；请选择一个普通 Patch');return;}s.setTool({...tool,hostId:hit.ref.id});return;}
  if(tool.previewId)return;
  const before=tool.draft?materializeToolDraft(s.project,tool.draft):s.project,host=before.patches!.find(x=>x.id===tool.hostId)!;
  const boundaries=domainBoundaries(before,host);let id=pointId,occurrence:number|undefined,p=before;
  if(id){const loc=endpointLocations(p,host,id);if(!loc.length)throw Error('该点未附着于所选面，也不在其合法边界上');occurrence=loc[0].occurrence;}
  if(!id){
   // Prefer legitimate existing anchors in screen space; never infer topology from proximity alone.
   let distance=12**2;
   for(const l of p.landmarks){if(l.id===tool.startId)continue;const loc=endpointLocations(p,host,l.id);if(!loc.length)continue;const q=worldToScreen(displayPoint(p,l.id,evaluationContext(p).pointPosition(l.id),view.forward),view),d=(q[0]-screen[0])**2+(q[1]-screen[1])**2;if(d<distance){distance=d;id=l.id;occurrence=loc[0].occurrence;}}
  }
  if(!id){
   let best={distance:16**2,index:-1,t:0};
   boundaries.forEach((b,index)=>{const g=boundaryGeometry(p,b);for(let k=0;k<=256;k++){const q=worldToScreen(displayPoint(p,host.id,g.evaluate(k/256),view.forward),view),d=(q[0]-screen[0])**2+(q[1]-screen[1])**2;if(d<best.distance)best={distance:d,index,t:k/256};}});
   if(best.index<0)throw Error('请点击所选 Patch 的 boundary');
   const b=boundaries[best.index],target=boundaryGeometry(p,b).evaluate(best.t),g=evaluationContext(p).curve(b.curveId);
   // s is normalized arc length; refine the provider inversion locally in s.
   let n=0,score=Infinity;for(let k=0;k<=512;k++){const q=g.atArcLength(k/512),d=q.reduce((a,v,i)=>a+(v-target[i])**2,0);if(d<score){score=d;n=k/512;}}
   let lo=Math.max(0,n-1/512),hi=Math.min(1,n+1/512);const d=(s:number)=>g.atArcLength(s).reduce((a,v,i)=>a+(v-target[i])**2,0);
   for(let k=0;k<20;k++){const a=lo+(hi-lo)/3,z=hi-(hi-lo)/3;if(d(a)<d(z))hi=z;else lo=a;}
   const r=addOnCurvePoint(p,b.curveId);p=setOnCurveS(r.project,r.selectedId,(lo+hi)/2);id=r.selectedId;occurrence=best.index;
  }
  if(id===tool.startId)throw Error('请选择不同的第二个 endpoint');
  if(!tool.startId){s.setTool({...tool,startId:id,startBoundary:occurrence,draft:{...createToolDraft(s.project),points:p.landmarks.filter(l=>!s.project.landmarks.some(x=>x.id===l.id))}});return;}
  const A=surfacePointLocation(p,host,tool.startId,tool.startBoundary!),B=surfacePointLocation(p,host,id,occurrence!);const r=createOnPatch(p,host.id,tool.startId,id,{startBoundary:A.occurrence,endBoundary:B.occurrence,winding:host.type==='loop'?Math.round(A.uv[0]-B.uv[0]):0,...(host.type==='loop'?{referenceU:[A.uv[0],B.uv[0]] as [number,number]}:{})});s.setTool({...tool,previewId:r.selectedId,draft:{...createToolDraft(s.project),points:r.project.landmarks.filter(l=>!s.project.landmarks.some(x=>x.id===l.id)),curves:r.project.curves.filter(c=>!s.project.curves.some(x=>x.id===c.id))}});
 }catch(e){s.notify((e as Error).message);}
}
