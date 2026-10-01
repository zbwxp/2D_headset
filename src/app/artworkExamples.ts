import {emptyDrawing,parseDrawing,type DrawingDocument} from '../domain/drawing/model';
import {saveDrawingSnapshot,snapshotMatches,restoreDrawingSnapshot,type DrawingSnapshotState} from '../domain/drawing/snapshots';
export const HAIRLESS_EXAMPLE_NAME='无发·对称双脸片·下颌显线';
export const MIRROR_EXAMPLE_NAME='无发·对称双脸片·镜像编辑';
export const SIDE_EXAMPLE_NAME='右侧90°参考画稿';
export async function loadHairlessExample(load=async()=>{const response=await fetch(new URL('../assets/hairless-symmetric-two-face.json',import.meta.url),{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('阶段画稿载入失败');return response.text();}):Promise<DrawingDocument>{return parseDrawing(JSON.parse(await load()));}
function uniqueName(state:DrawingSnapshotState,requested:string){
 const names=new Set(state.drawingSnapshots?.items.map(x=>x.name)??[]),base=requested.trim().slice(0,70)||'画稿';let name=base,index=2;while(names.has(name))name=`${base} · ${index++}`;return name;
}
/** Add an independent artwork, never replace a saved item. Return intermediate
 * states so the store can migrate a $working rig to its preserved first save
 * before activating the imported artwork. The caller groups all steps in ONE undo. */
export function planArtworkImport(state:DrawingSnapshotState,imported:DrawingDocument,name:string){
 const drawing=parseDrawing(imported),steps:DrawingSnapshotState[]=[];let next=state,preservedDraftId:string|undefined;
 const active=state.drawingSnapshots?.items.find(x=>x.id===state.drawingSnapshots?.activeId);
 if(state.drawing&&(!active||!snapshotMatches(state.drawing,state.drawingSnapshots!,active.id))){
  next=saveDrawingSnapshot(state,uniqueName(state,`${active?.name??'未命名画稿'} · 导入前草稿`));preservedDraftId=next.drawingSnapshots!.activeId;steps.push(next);
 }
 next=saveDrawingSnapshot({...next,drawing},uniqueName(next,name));steps.push(next);
 return {steps,state:next,artworkId:next.drawingSnapshots!.activeId!,preservedDraftId};
}
/** Callers with an authored empty working rig should preserve its ownership too. */
export const sourceForExampleImport=(drawing:DrawingDocument|undefined,hasWorkingRig:boolean)=>drawing??(hasWorkingRig?emptyDrawing():undefined);

export async function loadArtworkExamplePack(load?:()=>Promise<{front:string;side:string}>){
 const payload=load?await load():await (async()=>{const responses=await Promise.all([fetch(new URL('../assets/hairless-symmetric-two-face-mirror.json',import.meta.url),{signal:AbortSignal.timeout(30000)}),fetch(new URL('../assets/right90-reference.json',import.meta.url),{signal:AbortSignal.timeout(30000)})]);if(responses.some(r=>!r.ok))throw Error('示例画稿载入失败');const [front,side]=await Promise.all(responses.map(r=>r.text()));return {front,side};})();
 return {front:parseDrawing(JSON.parse(payload.front)),side:parseDrawing(JSON.parse(payload.side))};
}
/** Explicit sample-pack action only: keep the front active and make its separate
 * side reference immediately available in the saved-artwork overlay chooser. */
export function planArtworkExamplePack(state:DrawingSnapshotState,pack:{front:DrawingDocument;side:DrawingDocument}){
 const front=planArtworkImport(state,pack.front,MIRROR_EXAMPLE_NAME),side=planArtworkImport(front.state,pack.side,SIDE_EXAMPLE_NAME),restored=restoreDrawingSnapshot(side.state,front.artworkId);
 return {steps:[...front.steps,...side.steps,restored],state:restored,artworkId:front.artworkId,referenceArtworkId:side.artworkId,preservedDraftId:front.preservedDraftId};
}
