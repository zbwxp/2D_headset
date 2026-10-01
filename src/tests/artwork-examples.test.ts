import {readFileSync} from 'node:fs';
import {expect,test,vi} from 'vitest';
import {HAIRLESS_EXAMPLE_NAME,loadHairlessExample,planArtworkImport,sourceForExampleImport} from '../app/artworkExamples';
import {emptyDrawing} from '../domain/drawing/model';
import {saveDrawingSnapshot} from '../domain/drawing/snapshots';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {createEmptyProject} from '../app/emptyProject';
import {createArtworkRig,emptyVectorRecording} from '../domain/vectorRecording/model';
const raw=readFileSync(new URL('../assets/hairless-symmetric-features.json',import.meta.url),'utf8');
test('bundles the actual authored stage without reference pixels or changing the default face',async()=>{
 const base=readFileSync(new URL('../assets/base-face.json',import.meta.url),'utf8'),d=await loadHairlessExample(async()=>raw);expect(d.layers).toHaveLength(12);expect(d.curves).toHaveLength(119);expect(d.fills).toHaveLength(19);expect(d.reference).toBeUndefined();expect(d.layers.some(l=>/刘海|头发|发型|后发/.test(l.name))).toBe(false);expect(d.joins.length).toBeGreaterThan(0);expect(JSON.parse(raw)).toEqual(d);expect(readFileSync(new URL('../assets/base-face.json',import.meta.url),'utf8')).toBe(base);
});
test('imports as a new artwork and preserves an unsaved working copy without overwriting saved artwork',async()=>{
 const art=await loadHairlessExample(async()=>raw),saved=saveDrawingSnapshot({drawing:emptyDrawing()},'Original'),state={...saved,drawing:{...saved.drawing!,mirrorAxisX:.25}},before=JSON.stringify(state),plan=planArtworkImport(state,art,HAIRLESS_EXAMPLE_NAME);
 expect(plan.steps).toHaveLength(2);expect(plan.preservedDraftId).toBeTruthy();expect(plan.state.drawingSnapshots!.items).toHaveLength(3);expect(plan.state.drawingSnapshots!.items[0]).toEqual(saved.drawingSnapshots!.items[0]);expect(plan.state.drawingSnapshots!.items.find(x=>x.id===plan.preservedDraftId)!.drawing.mirrorAxisX).toBe(.25);expect(plan.state.drawing!.curves).toHaveLength(119);expect(JSON.stringify(state)).toBe(before);
 const again=planArtworkImport(plan.state,art,HAIRLESS_EXAMPLE_NAME);expect(again.steps).toHaveLength(1);expect(again.state.drawingSnapshots!.items.at(-1)!.name).toBe(HAIRLESS_EXAMPLE_NAME+' · 2');expect(again.artworkId).not.toBe(plan.artworkId);
});
test('whole import is one undo and preserves unnamed rig ownership on its backup artwork',async()=>{
 const original=useEditor.getState(),mode=useWorkspaceMode.getState().mode;vi.useFakeTimers();try{useWorkspaceMode.getState().setMode('drawing');const source=emptyDrawing(),r=createArtworkRig('$working',source);useEditor.setState({project:{...createEmptyProject(),drawing:source,vectorRecording:{...emptyVectorRecording(),rigs:[r]}},past:[],future:[]});const before=useEditor.getState().project,art=await loadHairlessExample(async()=>raw),plan=planArtworkImport({drawing:sourceForExampleImport(before.drawing,true)},art,HAIRLESS_EXAMPLE_NAME),s=useEditor.getState();s.beginEdit();for(const state of plan.steps)s.setDrawingSnapshotState(state);s.endEdit();expect(useEditor.getState().past).toHaveLength(1);expect(useEditor.getState().project.vectorRecording!.rigs[0].artworkId).toBe(plan.preservedDraftId);expect(useEditor.getState().project.drawingSnapshots!.activeId).toBe(plan.artworkId);s.undo();expect(useEditor.getState().project).toBe(before);s.redo();expect(useEditor.getState().project.drawing!.curves).toHaveLength(119);}finally{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();}
});
