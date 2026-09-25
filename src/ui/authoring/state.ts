import {CHIN} from '../../domain/chin/model';
import {gazeSide} from '../../domain/eyes/gaze';
import {canPickModule} from '../../domain/modules/ownership';
import type {LandmarkProject} from '../../domain/landmarks/model';
import type {PatchCreation} from '../patches/authoring';
import {HELMET} from '../../domain/head/scaffold';
export type SurfaceSource='PATCH'|'CHIN'|'HELMET'|'CAP'|'REGION'|'IRIS';
export type ObjectRef={kind:'point';id:string}|{kind:'curve';id:string}|{kind:'surface';source:SurfaceSource;id:string}|{kind:'frame';id:'head'};
export type ToolSession=({kind:'mergePoint';keepId?:string}|{kind:'onPatch';hostId?:string;startId?:string;startBoundary?:number;previewId?:string}|{kind:'select'}|{kind:'curve';pending:{startId:string|null}}|{kind:'patch';pending:PatchCreation}|{kind:'surfacePoint';centerline:boolean;branch?:'front'|'back'}|{kind:'region';ids:string[];preview:boolean}) & {draft?:ToolDraft};
/** Runtime draft only. Compound commands commit this source delta atomically. */
export interface ToolDraft {base:LandmarkProject;points:LandmarkProject['landmarks'];curves:LandmarkProject['curves'];patches:NonNullable<LandmarkProject['patches']>}
export const selectTool:ToolSession={kind:'select'};
export function surfaceRef(p:LandmarkProject,id:string):ObjectRef{return {kind:'surface',id,source:id===CHIN?'CHIN':gazeSide(p,id)?'IRIS':id===HELMET?'HELMET':p.loomisCaps?.some(x=>x.id===id)?'CAP':p.loomisRegions?.some(x=>x.id===id)?'REGION':'PATCH'};}
export function validRef(p:LandmarkProject,r:ObjectRef|null){if(!r)return true;return r.kind==='point'?p.landmarks.some(x=>x.id===r.id):r.kind==='curve'?p.curves.some(x=>x.id===r.id):r.kind==='frame'?!!p.headFrame:r.source==='CHIN'?r.id===CHIN&&!!p.chinScaffold:r.source==='IRIS'?!!gazeSide(p,r.id):r.source==='HELMET'?r.id===HELMET&&!!p.loomisScaffold:r.source==='PATCH'?!!p.patches?.some(x=>x.id===r.id):r.source==='CAP'?!!p.loomisCaps?.some(x=>x.id===r.id):!!p.loomisRegions?.some(x=>x.id===r.id);}
const legacy=['selectedId','selectedCurveId','selectedPatchId','curveCreation','patchCreation'] as const;
/** Transition writer for existing actions. Legacy fields are read-only projections, never stored. */
export function normalizeEditorUpdate(previous:any,patch:any){
 const next={...previous,...patch},p=next.project as LandmarkProject;
 let selection:ObjectRef|null=patch.selection!==undefined?patch.selection:previous?.selection??null;
 if(!Object.hasOwn(patch,'selection')){
  if(patch.selectedPatchId)selection=surfaceRef(p,patch.selectedPatchId);
  else if(patch.selectedCurveId)selection={kind:'curve',id:patch.selectedCurveId};
  else if(patch.selectedId)selection={kind:'point',id:patch.selectedId};
  else if(selection&&((selection.kind==='point'&&patch.selectedId===null)||(selection.kind==='curve'&&patch.selectedCurveId===null)||(selection.kind==='surface'&&patch.selectedPatchId===null)))selection=null;
 }
 let tool:ToolSession=patch.tool??previous?.tool??selectTool;
 if(!Object.hasOwn(patch,'tool')){
  if(patch.patchCreation)tool={kind:'patch',pending:patch.patchCreation};
  else if(patch.curveCreation)tool={kind:'curve',pending:patch.curveCreation};
  else if((tool.kind==='patch'&&patch.patchCreation===null)||(tool.kind==='curve'&&patch.curveCreation===null))tool=selectTool;
 }
 for(const k of legacy)delete next[k];
 next.selection=validRef(p,selection)&&(!selection||canPickModule(p,selection.id,next.activeModule??'HEADSET'))?selection:null;next.tool=tool;
 Object.defineProperties(next,{
  selectedId:{enumerable:true,get:()=>next.selection?.kind==='point'?next.selection.id:null},
  selectedCurveId:{enumerable:true,get:()=>next.selection?.kind==='curve'?next.selection.id:null},
  selectedPatchId:{enumerable:true,get:()=>next.selection?.kind==='surface'?next.selection.id:null},
  curveCreation:{enumerable:true,get:()=>next.tool.kind==='curve'?next.tool.pending:null},
  patchCreation:{enumerable:true,get:()=>next.tool.kind==='patch'?next.tool.pending:null}
 });return next;
}
export function undoToolStep(t:ToolSession):ToolSession{
 if(t.kind==='mergePoint')return {kind:'mergePoint'};
 if(t.kind==='onPatch')return t.previewId?{kind:'onPatch',hostId:t.hostId}:t.startId?{kind:'onPatch',hostId:t.hostId}:{kind:'onPatch'};
 if(t.kind==='curve')return {...t,pending:{startId:null}};
 if(t.kind==='region')return {...t,preview:false,ids:t.preview?t.ids:t.ids.slice(0,-1)};
 if(t.kind==='patch'){const p=t.pending;return {...t,pending:p.start?{...p,start:undefined,hover:undefined}:p.host?{...p,host:undefined}: {...p,uses:p.uses.slice(0,-1)}};}
 return t;
}
