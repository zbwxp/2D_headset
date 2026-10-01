import {createContext,useContext,type ReactNode} from 'react';
import {useEditor as rootEditor} from '../../app/store';
import {useDrawing,createDrawingSession} from './session';
import {editHairDrawing} from '../../domain/hairstyle/strands';
import {defaultHairstyle} from '../../domain/hairstyle/model';
import {createHairStudio} from '../../domain/hairstyle/studio';
import type {DrawingDocument} from '../../domain/drawing/model';
import type {DrawingSnapshotState} from '../../domain/drawing/snapshots';
type State=ReturnType<typeof rootEditor.getState>;
type Editor={<T>(selector:(s:State)=>T):T;getState:()=>State};
// The adapter only routes the three drawing fields/actions used by the shared UI.
// The actual root project's drawing, snapshots and recording are never swapped.
const hairCache=new WeakMap<State,State>();
export function hairEditorState(s:State):State {
 const cached=hairCache.get(s);if(cached)return cached;
 const next:State={...s,project:{...s.project,drawing:s.project.hairstyle?.drawing,drawingSnapshots:s.project.hairstyle?.drawingSnapshots},
  setDrawing(drawing){const e=rootEditor.getState(),h=e.project.hairstyle??defaultHairstyle();e.setHairstyle(h.strandSet?editHairDrawing(h,drawing):{...h,drawing});},
  setDrawingSnapshotState({drawing,drawingSnapshots}){const e=rootEditor.getState(),h=e.project.hairstyle??defaultHairstyle();e.setHairstyle({...h,drawing:drawing??h.drawing,drawingSnapshots});}};
 hairCache.set(s,next);return next;
}
const hairEditor:Editor=Object.assign(<T,>(selector:(s:State)=>T)=>rootEditor(s=>selector(hairEditorState(s))),{getState:()=>hairEditorState(rootEditor.getState())});
export const hairDrawingSession=createDrawingSession();
function workspace(id:'drawing'|'hairstyle'|'hair-studio',editor:Editor,session:typeof useDrawing){
 return {id,editor,session,commitDrawing(next:DrawingDocument){const e=editor.getState();if(next===e.project.drawing)return;e.beginEdit();try{e.setDrawing(next);}finally{e.endEdit();}},
 commitDrawingSnapshot(change:(s:DrawingSnapshotState)=>DrawingSnapshotState){const e=editor.getState(),next=change({drawing:e.project.drawing,drawingSnapshots:e.project.drawingSnapshots});e.beginEdit();try{e.setDrawingSnapshotState(next);}finally{e.endEdit();}}};
}
const drawingWorkspace=workspace('drawing',rootEditor,useDrawing);
export const hairWorkspace=workspace('hairstyle',hairEditor,hairDrawingSession);
const Context=createContext(drawingWorkspace);
export const useDrawingWorkspace=()=>useContext(Context);
export function HairDrawingProvider({children}:{children:ReactNode}){return <Context.Provider value={hairWorkspace}>{children}</Context.Provider>;}

const studioCache=new WeakMap<State,State>();
export function hairStudioEditorState(s:State):State {
 const cached=studioCache.get(s);if(cached)return cached;
 const next:State={...s,project:{...s.project,drawing:s.project.hairstyle?.studio?.drawing,drawingSnapshots:s.project.hairstyle?.studio?.drawingSnapshots},
  setDrawing(drawing){const e=rootEditor.getState(),h=e.project.hairstyle??defaultHairstyle(),studio=h.studio??createHairStudio(h.drawing);e.setHairstyle({...h,studio:{...studio,drawing}});},
  setDrawingSnapshotState({drawing,drawingSnapshots}){const e=rootEditor.getState(),h=e.project.hairstyle??defaultHairstyle(),studio=h.studio??createHairStudio(h.drawing);e.setHairstyle({...h,studio:{...studio,drawing:drawing??studio.drawing,drawingSnapshots}});}};
 studioCache.set(s,next);return next;
}
const studioEditor:Editor=Object.assign(<T,>(selector:(s:State)=>T)=>rootEditor(s=>selector(hairStudioEditorState(s))),{getState:()=>hairStudioEditorState(rootEditor.getState())});
export const hairStudioSession=createDrawingSession();
export const hairStudioWorkspace=workspace('hair-studio',studioEditor,hairStudioSession);
export function HairStudioProvider({children}:{children:ReactNode}){return <Context.Provider value={hairStudioWorkspace}>{children}</Context.Provider>;}
