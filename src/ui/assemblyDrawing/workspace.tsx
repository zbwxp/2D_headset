import {resolvedAssemblyFrame} from '../../domain/assembly/deformRecording';
import {useEditor as rootEditor} from '../../app/store';
import {useDrawing} from './session';
import {assemblyDrawing,assemblySnapshots,createAssembly,frameOf,transformDrawing,updateDrawing,type AssemblyDocument} from '../../domain/assembly/model';
import type {DrawingDocument} from '../../domain/drawing/model';
import type {DrawingSnapshotState} from '../../domain/drawing/snapshots';
import {evaluatedIntervalDrawing,writeIntervalChanges,rehomeIntervalRecords} from '../../domain/assembly/timeline';
import {cardGeometryChanged} from '../../domain/assembly/cards';
type State=ReturnType<typeof rootEditor.getState>;
const cache=new WeakMap<State,State>();
export function updateAssemblyDrawing(a:AssemblyDocument,drawing:DrawingDocument):AssemblyDocument {
 const before=assemblyDrawing(a);
 if(a.timeline&&!a.timeline.editingBase&&cardGeometryChanged(before,drawing))throw Error('正在编辑角度姿态。请在「单线微调」里拖动端点和控制柄；增删曲线或修改共用形状请进入「编辑原稿」。');
 const intervalsChanged=JSON.stringify(before.displayIntervals)!==JSON.stringify(drawing.displayIntervals);
 let next=updateDrawing(a,drawing);
 // A style/list/reference edit must not bake the evaluated mask into the asset,
 // nor repeatedly round-trip identical projected geometry through the inverse.
 const canonical={...next.drawing,displayIntervals:a.drawing.displayIntervals};
 for(const k of ['nodes','curves','fills','offsets','joins'] as const)if(JSON.stringify(before[k])===JSON.stringify(drawing[k]))(canonical as any)[k]=a.drawing[k];
 next={...next,drawing:canonical};
 if(intervalsChanged){
  const edited=transformDrawing(drawing,a,true);
  // Scale conversions can add insignificant round-off to unedited tip styles.
  const clean=(v:unknown)=>JSON.stringify(v,(_k,n)=>typeof n==='number'?Math.round(n*1e10)/1e10:n);
  if(clean(edited.displayIntervals)!==clean(evaluatedIntervalDrawing(a).displayIntervals))next=writeIntervalChanges(next,edited);
 }
 next=rehomeIntervalRecords(a,next);
 return next;
}
export function changeAssemblySnapshots(a:AssemblyDocument,next:DrawingSnapshotState):AssemblyDocument {
 const previous=assemblySnapshots(a),frames={...a.frames},capturesCurrent=next.drawing===assemblyDrawing(a);
 const library=next.drawingSnapshots&&{...next.drawingSnapshots,items:next.drawingSnapshots.items.map(item=>{
  const old=previous?.items.find(x=>x.id===item.id);
  if(item.drawing===old?.drawing)return {...item,drawing:a.drawingSnapshots!.items.find(x=>x.id===item.id)!.drawing};
  frames[item.id]=structuredClone(frameOf(resolvedAssemblyFrame(a)));
  const {reference,...canonical}=a.drawing;void reference;
  return {...item,drawing:capturesCurrent?structuredClone(canonical):transformDrawing(item.drawing,a,true)};
 })};
 for(const id of Object.keys(frames))if(!library?.items.some(x=>x.id===id))delete frames[id];
 const restoring=next.drawing!==assemblyDrawing(a)&&library?.activeId&&frames[library.activeId];
 const frame=restoring?frames[library!.activeId!]:frameOf(a);
 // Snapshot vectors already live in canonical space; do not round-trip through
 // projection merely to save/restore a deformer or pose.
 const drawing=restoring?{...structuredClone(library!.items.find(i=>i.id===library!.activeId)!.drawing),...(next.drawing?.reference?{reference:next.drawing.reference}:{})}:capturesCurrent?a.drawing:next.drawing?transformDrawing(next.drawing,frame,true):a.drawing;
 // Restoring a snapshot can remove a deformer; retain a disabled track's source
 // frame so re-enabling its recording is still possible and JSON remains valid.
 const perspectives=frame.perspectives?.slice()??[];
 if(restoring)for(const track of [...a.deformRecording?.tracks??[],...a.timeline?.bends??[]]){if(!perspectives.some(p=>p.layerId===track.layerId)&&drawing.layers.some(l=>l.id===track.layerId)){const p=a.perspectives?.find(p=>p.layerId===track.layerId);if(p)perspectives.push({...p,enabled:false});}}
 const deformRecording=a.deformRecording?{...a.deformRecording,...(restoring?{enabled:false}:{}),tracks:a.deformRecording.tracks.filter(t=>drawing.layers.some(l=>l.id===t.layerId))}:undefined;
 return {...a,...frame,...(restoring&&a.timeline?{timeline:{...a.timeline,editingBase:true,refinements:a.timeline.refinements?.filter(t=>drawing.curves.some(c=>c.id===t.curveId)),bends:a.timeline.bends?.filter(t=>drawing.layers.some(l=>l.id===t.layerId))}}:{}),...(restoring&&a.placement?{placement:{...a.placement,enabled:false}}:{}),...(deformRecording?{deformRecording}:{}),perspectives:perspectives.length?perspectives:undefined,drawing,drawingSnapshots:library,frames};
}
export function assemblyEditorState(s:State):State {
 const hit=cache.get(s);if(hit)return hit;const a=s.project.assembly;
 const next:State={...s,project:{...s.project,drawing:a?assemblyDrawing(a):undefined,drawingSnapshots:a?assemblySnapshots(a):undefined},
 setDrawing(drawing){const e=rootEditor.getState();e.setAssembly(updateAssemblyDrawing(e.project.assembly??createAssembly(),drawing));},
 setDrawingSnapshotState(next){const e=rootEditor.getState();e.setAssembly(changeAssemblySnapshots(e.project.assembly??createAssembly(),next));}};
 cache.set(s,next);return next;
}
const editor=Object.assign(<T,>(selector:(s:State)=>T)=>rootEditor(s=>selector(assemblyEditorState(s))),{getState:()=>assemblyEditorState(rootEditor.getState())});
const workspace={id:'assembly',editor,session:useDrawing,
 commitDrawing(next:DrawingDocument){const e=editor.getState();if(next===e.project.drawing)return;e.beginEdit();try{e.setDrawing(next);}finally{e.endEdit();}},
 commitDrawingSnapshot(change:(s:DrawingSnapshotState)=>DrawingSnapshotState){const e=editor.getState(),next=change({drawing:e.project.drawing,drawingSnapshots:e.project.drawingSnapshots});e.beginEdit();try{e.setDrawingSnapshotState(next);}finally{e.endEdit();}}};
export const useDrawingWorkspace=()=>workspace;
