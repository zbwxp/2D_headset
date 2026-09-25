import {CHIN} from '../../domain/chin/model';
import {isChin} from '../../domain/curves/model';
import {gazeSide} from '../../domain/eyes/gaze';
import {eyeSide} from '../../domain/eyes/scaffold';
import {uiText} from '../i18n';
import type {LandmarkProject} from '../../domain/landmarks/model';
import {isSection,isRim,isOnPatch,isHelmetLoop} from '../../domain/curves/model';
import {HELMET,systemOwned,scaffoldHostIds} from '../../domain/head/scaffold';
import {capPartner} from '../../domain/head/caps';
import {isLoomisLocked} from '../../domain/head/locks';
import {landmarkRows,curveRows,patchRows,curveBaseName,curveSide} from '../shared/pairRows';
import {landmarkBaseName} from '../../domain/landmarks/management';
import {surfaceRef,type ObjectRef} from './state';
export interface UIObject {ref:ObjectRef;name:string;source:string;system:boolean;mirror?:ObjectRef;locked:boolean}
export interface ObjectRowData {primary:UIObject;mirror?:UIObject;name:string}
export function resolveObject(p:LandmarkProject,ref:ObjectRef):UIObject|undefined{
 let name:string|undefined,source='',system=false,mirror:ObjectRef|undefined;
 if(ref.kind==='point'){const l=p.landmarks.find(x=>x.id===ref.id);if(!l)return;name=l.systemRole==='CHIN_M'?uiText('下巴连接点'):l.name;source=l.placement.kind;system=!!l.systemRole;if(l.mirrorPartnerId)mirror={kind:'point',id:l.mirrorPartnerId};}
 else if(ref.kind==='curve'){const c=p.curves.find(x=>x.id===ref.id);if(!c)return;name=c.name;source=isChin(c)?'CHIN_SEAM':'controlPointIds' in c?'CONTROL_POINTS':isOnPatch(c)?'ON_PATCH':isSection(c)?'LOOMIS_SECTION':isRim(c)?'HELMET_RIM':isHelmetLoop(c)?'HELMET_LOOP':'FREE';system=systemOwned(p,c.id);if(c.mirrorPartnerCurveId)mirror={kind:'curve',id:c.mirrorPartnerCurveId};}
 else if(ref.kind==='frame'){if(!p.headFrame)return;name=uiText('HeadFrame');source='HEAD_FRAME';system=true;}
 else {source=ref.source;if(ref.source==='CHIN'){if(!p.chinScaffold||p.chinScaffold.version===3)return;name=uiText('下巴连接点');system=true;}
 else if(ref.source==='HELMET'){if(!p.loomisScaffold)return;name=uiText('Default Helmet');system=true;}
 else if(ref.source==='IRIS'){const side=gazeSide(p,ref.id);if(!side)return;name=uiText(side==='left'?'Left Gaze Eyeball':'Right Gaze Eyeball');system=true;}
 else if(ref.source==='PATCH'){const x=p.patches?.find(x=>x.id===ref.id);if(!x)return;name=x.name??uiText(`${x.type} Surface ${patchRows(p).findIndex(r=>r.primary.id===x.id||r.mirror?.id===x.id)+1}`);source='PATCH';if(x.mirrorPartnerId)mirror=surfaceRef(p,x.mirrorPartnerId);}
 else if(ref.source==='CAP'){const c=p.loomisCaps?.find(x=>x.id===ref.id);if(!c)return;name=c.name;const m=capPartner(p,c.id);if(m&&m.id!==c.id)mirror=surfaceRef(p,m.id);}
 else {const r=p.loomisRegions?.find(x=>x.id===ref.id);if(!r)return;name=r.name;const partner=r.id.endsWith(':mirror')?r.id.slice(0,-7):r.id+':mirror';if(p.loomisRegions?.some(x=>x.id===partner))mirror=surfaceRef(p,partner);}}
 if(eyeSide(p,ref.id)){source='EYE_SCAFFOLD';system=true;}
 return {ref,name:name!,source,system,mirror,locked:isLoomisLocked(p,ref.id)};
}
export function objectRows(p:LandmarkProject,kind:'point'|'curve'|'surface'):ObjectRowData[]{
 const pair=(a:ObjectRef,b:ObjectRef|undefined,name?:string)=>{const primary=resolveObject(p,a)!;return {primary,mirror:b?resolveObject(p,b):undefined,name:name??primary.name};};
 if(kind==='point')return landmarkRows(p).map(r=>pair({kind,id:r.primary.id},r.mirror?{kind,id:r.mirror.id}:undefined,r.primary.systemRole==='CHIN_M'?uiText('下巴连接点'):r.mirror?landmarkBaseName(r.primary):r.primary.name));
 if(kind==='curve')return curveRows(p).map(r=>pair({kind,id:r.primary.id},r.mirror?{kind,id:r.mirror.id}:undefined,curveBaseName(r.primary,!!r.mirror)));
 const rows=patchRows(p).map((r,i)=>pair(surfaceRef(p,r.primary.id),r.mirror?surfaceRef(p,r.mirror.id):undefined,r.primary.name??uiText(`${r.primary.type} Surface ${i+1}`)));
 // The chin is presented once as a semantic point; its transition surface is
 // still pickable and addressable internally, but is not a separate asset row.
 if(p.loomisScaffold)rows.push(pair(surfaceRef(p,HELMET),undefined));
 const seen=new Set<string>();for(const c of p.loomisCaps??[]){if(seen.has(c.id))continue;const m=capPartner(p,c.id);seen.add(c.id);if(m)seen.add(m.id);const swap=m&&m.id!==c.id&&curveSide(p,p.curves.find(x=>x.id===c.hostSectionCurveId)!)==='LEFT';rows.push(pair(surfaceRef(p,swap?m.id:c.id),m&&m.id!==c.id?surfaceRef(p,swap?c.id:m.id):undefined));}
 for(const r of p.loomisRegions??[])if(!r.id.endsWith(':mirror'))rows.push(pair(surfaceRef(p,r.id),p.loomisRegions?.some(x=>x.id===r.id+':mirror')?surfaceRef(p,r.id+':mirror'):undefined));return rows;
}
export interface Relation {label:string;ref:ObjectRef}
export function objectRelations(p:LandmarkProject,o:UIObject):Relation[]{
 const result:Relation[]=[],add=(label:string,ref:ObjectRef)=>{if(resolveObject(p,ref))result.push({label,ref});};const id=o.ref.id;
 if(o.mirror)add('Mirror',o.mirror);
 if(o.ref.kind==='point'){
 const l=p.landmarks.find(x=>x.id===id)!,q=l.placement;
 if(q.kind==='CHIN_SURFACE'){if(p.chinScaffold?.version===3)add('Frame',{kind:'frame',id:'head'});else add('Host',surfaceRef(p,CHIN));}
 if(q.kind==='ON_CURVE')add('Host Curve',{kind:'curve',id:q.hostCurveId});
 if(q.kind==='ON_PATCH')add('Host Surface',surfaceRef(p,q.hostPatchId));
 if(q.kind==='ON_SECTION_CAP')add('Host',surfaceRef(p,q.hostSurfaceId));
 if(q.kind==='ON_LOOMIS_SURFACE'||q.kind==='FRAME_RELATIVE')add('Frame',{kind:'frame',id:'head'});
 if(q.kind==='LOOMIS_SCAFFOLD'&&q.role.startsWith('APEX'))add('Host',surfaceRef(p,HELMET));
 if(q.kind==='LOOMIS_SCAFFOLD')for(const curveId of scaffoldHostIds(q.role))add('Host',{kind:'curve',id:curveId});
 for(const c of p.curves)if(c.startLandmarkId===id||c.endLandmarkId===id||('controlPointIds' in c&&c.controlPointIds.includes(id)))add('Used by',{kind:'curve',id:c.id});
 }else if(o.ref.kind==='curve'){
 const c=p.curves.find(x=>x.id===id)!;if(c.startLandmarkId)add('Start',{kind:'point',id:c.startLandmarkId});if(c.endLandmarkId)add('End',{kind:'point',id:c.endLandmarkId});
 if(isChin(c))add('Host',surfaceRef(p,CHIN));
 if(isHelmetLoop(c))for(const id of c.sourceCurveIds)add('Source Curve',{kind:'curve',id});
 if('controlPointIds' in c)for(const id of c.controlPointIds)add('Control',{kind:'point',id});
 if(isOnPatch(c))add('Host Surface',surfaceRef(p,c.hostPatchId));
 if(isSection(c)||isRim(c))add('Frame',{kind:'frame',id:'head'});
 for(const l of p.landmarks)if(l.placement.kind==='ON_CURVE'&&l.placement.hostCurveId===id)add('On curve',{kind:'point',id:l.id});
 for(const x of p.patches??[])if(x.boundaryUses.some(b=>b.curveId===id))add('Used by',surfaceRef(p,x.id));
 for(const x of p.loomisCaps??[])if(x.hostSectionCurveId===id)add('Cap',surfaceRef(p,x.id));
 for(const x of p.loomisRegions??[])if(x.cuts.some(c=>c.curveId===id))add('Region',surfaceRef(p,x.id));
 }else if(o.ref.kind==='surface'){
 if(o.ref.source==='PATCH'){const x=p.patches!.find(x=>x.id===id)!;for(const b of x.boundaryUses)add('Boundary',{kind:'curve',id:b.curveId});for(const y of p.patches??[])if(y.id!==id&&y.boundaryUses.some(b=>x.boundaryUses.some(a=>a.curveId===b.curveId)))add('Boundary neighbor',surfaceRef(p,y.id));}
 if(o.ref.source==='CAP'){const x=p.loomisCaps!.find(x=>x.id===id)!;add('Host Curve',{kind:'curve',id:x.hostSectionCurveId});for(const l of p.landmarks)if(l.placement.kind==='ON_SECTION_CAP'&&l.placement.hostSurfaceId===id)add('Hosted point',{kind:'point',id:l.id});}
 if(o.ref.source==='REGION')for(const c of p.loomisRegions!.find(x=>x.id===id)!.cuts)add('Source Section',{kind:'curve',id:c.curveId});
 if(o.ref.source==='HELMET'||o.ref.source==='CHIN')add('Frame',{kind:'frame',id:'head'});
 if(o.ref.source==='CHIN')for(const b of p.chinScaffold?.bindings??[])add('Source Curve',{kind:'curve',id:b.curveId});
 }return result;
}
export function capabilities(o:UIObject){return {delete:{enabled:!o.system&&!o.locked,reason:o.system?'系统对象不可删除':o.locked?'对象已锁定':undefined},rename:o.source!=='CHIN'&&o.source!=='HELMET'&&o.source!=='HELMET_RIM',bezier:o.source==='FREE',duplicate:o.ref.kind==='point'||o.source==='LOOMIS_SECTION',onCurve:o.ref.kind==='curve',fullness:o.source==='PATCH'};}
/** Registry describes field families; complex fields remain ordinary React renderers. */
export const descriptorRegistry={CHIN_SURFACE:'chinPoint',CHIN_SEAM:'chinCurve',CHIN:'chin',CONTROL_POINTS:'controlPoints',EYE_LOCAL:'eyeLocalPoint',WORLD:'spatialPoint',FRAME_RELATIVE:'spatialPoint',ON_CURVE:'onCurvePoint',ON_LOOMIS_SURFACE:'surfacePoint',ON_SECTION_CAP:'surfacePoint',LOOMIS_SCAFFOLD:'systemPoint',ON_PATCH:'onPatch',FREE:'bezier',LOOMIS_SECTION:'section',HELMET_RIM:'rim',HELMET_LOOP:'helmetLoop',PATCH:'patch',HELMET:'helmet',CAP:'cap',REGION:'region',HEAD_FRAME:'frame'} as const;
