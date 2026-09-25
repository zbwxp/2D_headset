import {CHIN} from '../../domain/chin/model';
import {chinHitDirection} from '../../domain/chin/geometry';
import {addChinPoint} from '../../domain/chin/management';
import {objectHidden} from './visibility';
import {patchPointHit} from './patchPointHit';
import {addPatchPoint} from '../../domain/patches/point';
import {modulePickable} from './moduleAccess';
import {geometryObjects} from '../../domain/modules/ownership';
import {HELMET} from '../../domain/head/scaffold';
import {Vector3,Ray} from 'three';
import type {Vec2,Vec3} from '../../domain/project/types';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {OrthographicViewState} from '../../rendering/orthographic';
import {editSurfacePicker} from '../../rendering/edit2d/picking';
import {surfaceRef,type ObjectRef} from './state';
import {screenRay,headScreenRay,ellipsoidBranches,type Branch} from './constrainedDrag';
import {hitCap,addCapPoint} from '../../domain/head/caps';
import {addSurfacePoint} from '../../domain/head/surfacePoint';
import {createToolDraft,stageToolDraft} from './draft';
import {useEditor} from '../../app/store';
import {regionCandidates,type RegionCandidate} from '../../domain/head/regions';
export interface SurfaceHit {ref:ObjectRef;screen:Vec2;world:Vec3;depth:number;local:{triangle:number;barycentric:Vec3}|{u:number;v:number}}
export function surfaceHit(p:LandmarkProject,screen:Vec2,v:OrthographicViewState,patchOnly=false):SurfaceHit|null {
 const h=editSurfacePicker.current?.pick(screen,new Set((patchOnly?(p.patches??[]).map(x=>x.id):[...geometryObjects(p).map(x=>x.id),HELMET,CHIN]).filter(id=>modulePickable(id)&&!objectHidden(id))));if(!h)return null;const ref=surfaceRef(p,h.id);let local:SurfaceHit['local']={triangle:h.triangle,barycentric:h.barycentric};
 if(ref.kind==='surface'&&ref.source==='CAP'){const ray=headScreenRay(p,screen,v),cap=hitCap(p,ref.id,ray.origin,ray.direction);if(!cap)return null;local={u:cap.u,v:cap.v};}
 return {ref,screen,world:h.world,depth:h.depth,local};
}
export function previewSurfacePoint(screen:Vec2,v:OrthographicViewState){
 const s=useEditor.getState(),t=s.tool;if(t.kind!=='surfacePoint')return;
 try{const p=s.project;if(s.activeModule==='EYES'){const hit=patchPointHit(p,screen,v,new Set((p.patches??[]).filter(x=>p.geometryModules?.[x.id]==='EYES'&&!objectHidden(x.id)).map(x=>x.id)));if(!hit){s.notify('请点击眼部圆柱前面的曲面');return;}const r=addPatchPoint(p,hit.id,hit.u,hit.v),points=r.project.landmarks.filter(l=>!p.landmarks.some(x=>x.id===l.id));s.setTool({...t,draft:stageToolDraft(createToolDraft(p),{points})});return;}const ids=new Set([...(p.loomisCaps??[]).map(c=>c.id),...(p.loomisRegions??[]).map(c=>c.id),HELMET,CHIN]),hit=editSurfacePicker.current?.pick(screen,ids),cap=hit&&p.loomisCaps?.find(c=>c.id===hit.id),ray=headScreenRay(p,screen,v);
 let r:ReturnType<typeof addSurfacePoint>;
 if(hit?.id===CHIN)r=addChinPoint(p,chinHitDirection(hit.triangle,hit.barycentric),t.centerline);
 else if(cap){const h=hitCap(p,cap.id,ray.origin,ray.direction);if(!h)return;r=addCapPoint(p,cap.id,h.u,h.v,t.centerline);}
 else {const direction=ellipsoidBranches(p,screen,v)[t.branch??'front'];if(!direction){s.notify('当前位置未命中 Construction Surface');return;}r=addSurfacePoint(p,direction,t.centerline);}
 const points=r.project.landmarks.filter(l=>!p.landmarks.some(x=>x.id===l.id));s.setTool({...t,draft:stageToolDraft(createToolDraft(p),{points})});
 }catch(e){s.notify((e as Error).message);}
}
export function pickRegionCandidate(candidates:RegionCandidate[],screen:Vec2,v:OrthographicViewState,p?:LandmarkProject){
 const r=p?headScreenRay(p,screen,v):screenRay(screen,v),ray=new Ray(new Vector3(...r.origin),new Vector3(...r.direction));let distance=Infinity,result:RegionCandidate|undefined;
 for(const candidate of candidates)for(const f of candidate.mesh.triangles){const vertices=candidate.mesh.vertices,hit=ray.intersectTriangle(new Vector3(...vertices[f[0]]),new Vector3(...vertices[f[1]]),new Vector3(...vertices[f[2]]),false,new Vector3());if(hit){const d=hit.distanceTo(ray.origin);if(d<distance){distance=d;result=candidate;}}}return result;
}
export function commitRegion(screen:Vec2,v:OrthographicViewState){const s=useEditor.getState(),t=s.tool;if(t.kind!=='region'||!t.preview)return;try{const c=pickRegionCandidate(regionCandidates(s.project,t.ids),screen,v,s.project);if(!c)return;const id=crypto.randomUUID();s.addLoomisRegion({id,name:'Loomis Region',cuts:c.cuts,seed:c.seed});s.cancelTool();s.selectObject({kind:'surface',source:'REGION',id});}catch(e){s.notify((e as Error).message);}}
