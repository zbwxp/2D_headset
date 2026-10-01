import {emptyDrawing,parseDrawing,type DrawingDocument} from '../domain/drawing/model';
import {saveDrawingSnapshot,snapshotMatches,type DrawingSnapshotState} from '../domain/drawing/snapshots';
export const HAIRLESS_EXAMPLE_NAME='无发·对称双脸片·下颌显线';
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
