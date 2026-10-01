/** Pure, single-operation artwork-library plans. Store commits remain the host's responsibility. */
import type {LandmarkProject} from '../domain/landmarks/model';
import {emptyDrawing,parseDrawing} from '../domain/drawing/model';
import {saveDrawingSnapshot,restoreDrawingSnapshot,renameDrawingSnapshot,deleteDrawingSnapshot,snapshotMatches,parseDrawingSnapshots,type DrawingSnapshotState} from '../domain/drawing/snapshots';

type Common={expectedRevision?:string;dryRun?:boolean};
export type ArtworkRequest=Common&(
 | {op:'save';name:string;artworkId?:string}
 | {op:'restore';artworkId:string;discardUnsaved?:boolean}
 | {op:'rename';artworkId:string;name:string}
 | {op:'delete';artworkId:string}
);
export class ArtworkApiError extends Error {constructor(readonly code:string,message:string){super(message);}}
const fail=(code:string,message:string):never=>{throw new ArtworkApiError(code,message);};
const name=(value:unknown,label:string,max=256)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail('INVALID_REQUEST',`${label} must be a nonempty string of at most ${max} characters.`);return value as string;};

export function artworkOverview(project:LandmarkProject){
 const library=project.drawingSnapshots,activeId=library?.activeId??null,drawing=project.drawing??emptyDrawing(),dirty=!activeId||!snapshotMatches(drawing,library!,activeId);
 return {activeId,dirty,items:(library?.items??[]).map(item=>({id:item.id,name:item.name,active:item.id===activeId,layerCount:item.drawing.layers.length,curveCount:item.drawing.curves.length,hasReference:!!item.reference,rigIds:(project.vectorRecording?.rigs??[]).filter(r=>r.artworkId===item.id).map(r=>r.id)}))};
}

export function prepareArtworkAction(project:LandmarkProject,raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('INVALID_REQUEST','Expected one artwork operation object.');
 const r=raw as Record<string,unknown>,fields:Record<string,string[]>={save:['name','artworkId'],restore:['artworkId','discardUnsaved'],rename:['artworkId','name'],delete:['artworkId']};
 if(typeof r.op!=='string'||!Object.hasOwn(fields,r.op))fail('UNKNOWN_COMMAND',`Unknown artwork operation: ${String(r.op)}.`);
 const op=r.op as ArtworkRequest['op'],unknown=Object.keys(r).filter(k=>!['op','expectedRevision','dryRun',...fields[op]].includes(k));
 if(unknown.length)fail('INVALID_REQUEST',`Unknown field(s): ${unknown.join(', ')}.`);
 for(const key of ['dryRun','discardUnsaved'])if(r[key]!==undefined&&typeof r[key]!=='boolean')fail('INVALID_REQUEST',`${key} must be a boolean.`);
 if(r.expectedRevision!==undefined)name(r.expectedRevision,'expectedRevision');
 const library=project.drawingSnapshots,id=r.artworkId===undefined?undefined:name(r.artworkId,'artworkId'),existing=id===undefined?undefined:library?.items.find(item=>item.id===id);
 if((id||op!=='save')&&!existing)fail('NOT_FOUND',`Unknown artwork ID: ${id??'(missing)'}.`);
 const before:DrawingSnapshotState={drawing:project.drawing,drawingSnapshots:library};let after=before;
 if(op==='save')after=saveDrawingSnapshot(before,name(r.name,'name',80),id);
 else if(op==='rename')after=renameDrawingSnapshot(before,id!,name(r.name,'name',80));
 else if(op==='restore'){
  if(artworkOverview(project).dirty&&r.discardUnsaved!==true)fail('UNSAVED_SOURCE','Working source has unsaved changes. Save a new artwork first, or explicitly set discardUnsaved:true to restore this saved artwork.');
  after=restoreDrawingSnapshot(before,id!);
 }else{
  const rig=project.vectorRecording?.rigs.find(r=>r.artworkId===id);
  if(rig)fail('ARTWORK_HAS_RIG',`Artwork ${id} has recording rig ${rig.id}. Deletion is blocked to preserve its keyforms; no rig migration or archive is implied.`);
  after=deleteDrawingSnapshot(before,id!);
 }
 // Validate the planned state without modifying the canonical source or library.
 if(after.drawing)parseDrawing(after.drawing);
 if(after.drawingSnapshots)parseDrawingSnapshots(after.drawingSnapshots);
 const changed=JSON.stringify(before)!==JSON.stringify(after),artworkId=op==='save'?after.drawingSnapshots!.activeId!:id!;
 return {state:after,changed,dryRun:r.dryRun===true,result:{op,artworkId,created:op==='save'&&!id,activeId:after.drawingSnapshots?.activeId??null,name:op==='delete'?existing!.name:after.drawingSnapshots!.items.find(item=>item.id===artworkId)!.name,workingSourcePreserved:op!=='restore'}};
}
