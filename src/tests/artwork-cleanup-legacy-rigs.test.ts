import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {planArtworkCleanup} from '../app/artworkCleanup';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {parseDrawing} from '../domain/drawing/model';
import {createArtworkRig,emptyVectorRecording} from '../domain/vectorRecording/model';
import {parseVectorRecording} from '../domain/vectorRecording/persistence';

const initial=useEditor.getState(),initialMode=useWorkspaceMode.getState().mode;
const asset=(name:string)=>readFileSync(new URL(`../assets/${name}.json`,import.meta.url),'utf8');
function oldLibrary(){
 const project=parseLandmarks(asset('base-face')),front=parseDrawing(JSON.parse(asset('hairless-symmetric-two-face-mirror'))),side=parseDrawing(JSON.parse(asset('right90-reference')));
 project.drawingSnapshots!.items.push(...['front-1','front-2'].map(id=>({id,name:id,drawing:structuredClone(front)})),...['side-1','side-2'].map(id=>({id,name:id,drawing:structuredClone(side)})));
 project.vectorRecording={...emptyVectorRecording(),rigs:['front-1','front-2','side-1','side-2'].map(id=>createArtworkRig(id))};
 return project;
}
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');});
afterEach(()=>{vi.runAllTimers();useEditor.setState(initial,true);useWorkspaceMode.getState().setMode(initialMode);vi.useRealTimers();});

test('old duplicate reference rigs clean up through the default store without duplicate artwork ownership',()=>{
 const input=oldLibrary();expect(()=>parseVectorRecording(input.vectorRecording)).not.toThrow();
 useEditor.getState().load(input);useEditor.getState().endEdit();useEditor.setState({past:[],future:[]});
 const before=useEditor.getState().project,bytes=JSON.stringify(before),plan=planArtworkCleanup(before),next=plan.project;
 expect(next.drawingSnapshots!.items).toHaveLength(5);expect(next.vectorRecording!.rigs).toHaveLength(2);
 const retained=new Set(next.drawingSnapshots!.items.map(item=>item.id));
 for(const rig of next.vectorRecording!.rigs){expect(retained.has(rig.artworkId)).toBe(true);const own=before.vectorRecording!.rigs.find(old=>old.artworkId===rig.artworkId)!;expect(rig.id).toBe(own.id);expect(rig.keys).toBe(own.keys);expect(rig.deformers).toBe(own.deformers);}
 expect(new Set(next.vectorRecording!.rigs.map(rig=>rig.artworkId)).size).toBe(2);expect(plan.archivedRigIds).toHaveLength(2);
 expect(plan.archivedScenes).toHaveLength(2);expect(next.recordingScenes!.scenes.every(scene=>!scene.legacy||!plan.archivedRigIds.includes(scene.legacy.rigId))).toBe(true);
 expect(()=>parseVectorRecording(next.vectorRecording)).not.toThrow();expect(()=>parseLandmarks(JSON.stringify(next))).not.toThrow();expect(JSON.stringify(before)).toBe(bytes);
 useEditor.getState().commitArtworkCleanup(before,next);expect(useEditor.getState().project).toBe(next);expect(useEditor.getState().past).toEqual([before]);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(next);
 useEditor.getState().load(parseLandmarks(JSON.stringify(next)));expect(useEditor.getState().project.vectorRecording).toEqual(next.vectorRecording);
 expect(planArtworkCleanup(useEditor.getState().project).changed).toBe(false);
});

test('a retained source rig wins over an earlier duplicate rig even when their authored keys differ',()=>{
 const input=oldLibrary(),rigs=input.vectorRecording!.rigs;
 rigs[0].keys[0].visibility['independent-old-flag']=false;
 useEditor.getState().load(input);useEditor.getState().endEdit();const before=useEditor.getState().project;
 // Prefer front-2 by making its migrated scene active. The first rig must not
 // win merely because it occurred earlier in the legacy array.
 const target=before.recordingScenes!.scenes.find(scene=>scene.instances.some(i=>i.artworkId==='front-2'))!;
 const current={...before,recordingScenes:{...before.recordingScenes!,activeSceneId:target.id}},plan=planArtworkCleanup(current);
 const retained=plan.project.vectorRecording!.rigs.find(rig=>rig.artworkId==='front-2')!;
 expect(retained.id).toBe(rigs[1].id);expect(plan.archivedRigIds).toContain(rigs[0].id);expect(plan.archivedScenes.some(scene=>scene.id===target.id)).toBe(false);
 expect(JSON.stringify(current.vectorRecording)).toBe(JSON.stringify(before.vectorRecording));
});

test('invalid legacy payload is rejected by the planner before a cleanup preview can be committed',()=>{
 const input=oldLibrary();input.vectorRecording!.rigs[0].keys=[];
 // The kept front source is front-2; make the invalid payload belong to it.
 input.vectorRecording!.rigs[1].keys=[];
 expect(()=>planArtworkCleanup(input)).toThrow('矢量录制数据无效');
});

test('the rejected v20 collision leaves project, history and source bytes untouched',()=>{
 useEditor.getState().load(oldLibrary());useEditor.getState().endEdit();useEditor.setState({past:[],future:[]});
 const before=useEditor.getState().project,bytes=JSON.stringify(before),plan=planArtworkCleanup(before),valid=plan.project.vectorRecording!;
 // The v20 failure occurs before beginEdit: emulate its many-to-one output
 // while exercising the same production validator and store action.
 const collision={...plan.project,vectorRecording:{...valid,rigs:[...valid.rigs,{...before.vectorRecording!.rigs.find(r=>r.id!==valid.rigs[0].id)!,artworkId:valid.rigs[0].artworkId}]}};
 expect(()=>useEditor.getState().commitArtworkCleanup(before,collision)).toThrow('矢量录制数据无效');
 expect(useEditor.getState().project).toBe(before);expect(JSON.stringify(useEditor.getState().project)).toBe(bytes);
 expect(useEditor.getState().past).toEqual([]);expect(useEditor.getState().future).toEqual([]);
});
