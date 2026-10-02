import {emptyDrawing,type DrawingDocument} from '../domain/drawing/model';
import {saveDrawingSnapshot,snapshotDrawing,snapshotMatches,stashDrawingWorkingCopy,type DrawingSnapshotState,type DrawingSnapshots} from '../domain/drawing/snapshots';
import {drawingWorkingCopyIntent} from '../domain/drawing/workingCopyIntent';
import type {LandmarkProject} from '../domain/landmarks/model';

type WorkingSourceState=DrawingSnapshotState&Partial<Pick<LandmarkProject,'vectorRecording'|'recordingScenes'>>;
const emptyLibrary=():DrawingSnapshots=>({version:1,items:[],images:[]});
const meaningful=(d:DrawingDocument)=>!!(d.curves.length||d.nodes.length||d.fills.length||d.offsets.length||d.layers.length||d.reference||d.mirrorAxisX!==undefined||d.mirrorEditing);

/** Prepare the complete source transition before store mutation. Current callers
 * carry WCs themselves; this also protects old callers that pass only drawing
 * and snapshots. Explicit discard/checkpoint intent is a private WeakMap marker. */
export function prepareDrawingWorkingCopyTransition(before:WorkingSourceState,incoming:DrawingSnapshotState):{state:DrawingSnapshotState;promotedWorkingArtworkId?:string}{
 const intent=drawingWorkingCopyIntent(incoming),discard=new Set(intent.discardIds??[]),stashed=stashDrawingWorkingCopy(before,[...discard]);
 const copies=new Map([...Object.entries(stashed.drawingWorkingCopies??{}),...Object.entries(incoming.drawingWorkingCopies??{})]);
 const oldActive=before.drawingSnapshots?.activeId;
 if(oldActive&&before.drawing&&!discard.has(oldActive)&&before.drawingSnapshots?.items.some(a=>a.id===oldActive)){
  if(snapshotMatches(before.drawing,before.drawingSnapshots,oldActive))copies.delete(oldActive);else copies.set(oldActive,before.drawing);
 }
 let library=incoming.drawingSnapshots,active=library?.activeId,drawing=incoming.drawing,promotedWorkingArtworkId:string|undefined;
 const checkpoints=new Set(intent.checkpointIds??[]);
 if(library)for(const item of library.items){const old=before.drawingSnapshots?.items.find(a=>a.id===item.id);if(!old)checkpoints.add(item.id);else if(drawing&&snapshotMatches(drawing,library,item.id)&&JSON.stringify(snapshotDrawing(before.drawingSnapshots!,item.id))!==JSON.stringify(snapshotDrawing(library,item.id)))checkpoints.add(item.id);}
 for(const key of [...discard,...checkpoints])copies.delete(key);
 const workingReferences=!!before.vectorRecording?.rigs.some(r=>r.artworkId==='$working')||!!before.recordingScenes?.scenes.some(s=>s.instances.some(i=>i.artworkId==='$working'));
 const oldDrawing=before.drawing??(workingReferences?emptyDrawing():undefined);
 if(!oldActive&&active&&oldDrawing&&!discard.has('$working')){
  const created=library!.items.filter(a=>!before.drawingSnapshots?.items.some(old=>old.id===a.id));
  const savedWorking=created.find(a=>snapshotMatches(oldDrawing,library!,a.id));
  // A composed "save unnamed B, then switch to existing C" still promotes B.
  if(savedWorking)promotedWorkingArtworkId=savedWorking.id;
  else if(workingReferences||meaningful(oldDrawing)){
   const names=new Set(library?.items.map(a=>a.name)??[]),base='未命名画稿 · 切换前工作副本';let name=base,index=2;while(names.has(name))name=`${base} · ${index++}`;
   const preserved=saveDrawingSnapshot({drawing:oldDrawing,drawingSnapshots:{...(library??emptyLibrary()),activeId:undefined},drawingWorkingCopies:Object.fromEntries(copies)},name);
   promotedWorkingArtworkId=preserved.drawingSnapshots!.activeId;library={...preserved.drawingSnapshots!,activeId:active};
  }
 }
 const known=new Set(library?.items.map(a=>a.id)??[]);for(const key of copies.keys())if(!known.has(key))copies.delete(key);
 // A checkpoint update is explicit. Ordinary switches prefer the target WC.
 if(active&&active!==oldActive&&!checkpoints.has(active)&&copies.has(active))drawing=structuredClone(copies.get(active)!);
 if(active&&drawing&&library&&snapshotMatches(drawing,library,active))copies.delete(active);
 return {state:{drawing,drawingSnapshots:library,drawingWorkingCopies:Object.fromEntries(copies)},...(promotedWorkingArtworkId?{promotedWorkingArtworkId}:{})};
}
