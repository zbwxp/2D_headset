import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {createArtworkCleanupBackupStorage,type ArtworkCleanupBackup,type ArtworkCleanupBackupDatabase} from '../app/artworkCleanupBackups';
import {applyArtworkCleanupPlan,restoreArtworkCleanupProject} from '../app/artworkCleanupActions';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {snapshotDrawing} from '../domain/drawing/snapshots';
import {evaluateRecordingScene} from '../app/recordingSceneApi';
import {planArtworkCleanup,ORIGINAL_ARTWORK_IDS,RECORDING_SIDE_LAYER_ID} from '../app/artworkCleanup';
import type {LandmarkProject} from '../domain/landmarks/model';
import {parseDrawing} from '../domain/drawing/model';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import PaintScene from '../ui/drawing/PaintScene';

const original=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;
const raw=readFileSync(new URL('../assets/three-piece-scene-example.json',import.meta.url),'utf8');
const baseRaw=readFileSync(new URL('../assets/base-face.json',import.meta.url),'utf8');
const independentRedRaw=readFileSync(new URL('../assets/recording-side-part.json',import.meta.url),'utf8');
const project=()=>parseLandmarks(raw);
function fiveSourceFixture(){
 const base=parseLandmarks(baseRaw),current=project(),library=current.drawingSnapshots!,scene=current.recordingScenes!.scenes[0],redInstance=scene.instances.find(i=>i.layerIds?.includes(RECORDING_SIDE_LAYER_ID))!,red=parseDrawing(JSON.parse(independentRedRaw));
 // Reconstruct the earlier independent eight-curve source. The bundled example
 // now already contains the merged side source and nine neutral member tracks.
 library.items=library.items.map(item=>item.id===redInstance.artworkId?{id:item.id,name:'Old independent red source',drawing:red}:item);if(library.activeId===redInstance.artworkId)current.drawing=red;scene.visibilityTracks=[];
 const {sourceSignature,sourceStructureSignature,sourceIntervalFrames,...originalInstance}=redInstance;void sourceSignature;void sourceStructureSignature;void sourceIntervalFrames;scene.instances=scene.instances.map(i=>i===redInstance?originalInstance:i);
 const front=library.items[0],extra={...structuredClone(front),id:'obsolete-unique',name:'Old test · 3',drawing:{...front.drawing,curves:front.drawing.curves.map((c,i)=>i?c:{...c,name:'Unique old test source'})}};
 return {...current,drawingSnapshots:{...library,items:[...base.drawingSnapshots!.items,...library.items,{...structuredClone(front),id:'duplicate-front',name:'Entirely different display name'},extra],images:[...base.drawingSnapshots!.images,...library.images]}};
}
function render(project:LandmarkProject,x:number){
 const result=evaluateRecordingScene(project,{angle:{x,y:0}});
 const html=renderToStaticMarkup(createElement(PaintScene,{d:result.drawing,paintBatches:result.paintBatches,screen:point=>point,unit:100,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:()=>{},paintDown:()=>{},arcDown:()=>{}}));
 return {result,html};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
function memoryBackups(){
 const records=new Map<string,ArtworkCleanupBackup>();let serial=0;
 const database:ArtworkCleanupBackupDatabase={
  write:vi.fn(async entry=>{if(records.has(entry.id))throw Error('Duplicate backup');records.set(entry.id,structuredClone(entry));}),
  read:vi.fn(async id=>{const entry=records.get(id);return entry&&structuredClone(entry);}),
  list:vi.fn(async()=>[...records.values()].map(entry=>structuredClone(entry))),close:vi.fn(),
 };
 const create=()=>createArtworkCleanupBackupStorage({openDatabase:async()=>database,now:()=>++serial,createId:()=>`recovery-${++serial}`});
 return {records,database,create};
}
beforeEach(()=>{vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');});
afterEach(()=>{vi.runAllTimers();useEditor.setState(original,true);useWorkspaceMode.getState().setMode(originalMode);vi.useRealTimers();});

test('recovery survives a fresh service and a project reload with inactive working copies and authored scene keys',async()=>{
 const input=project(),sourceId=input.drawingSnapshots!.items.find(a=>a.id!==input.drawingSnapshots!.activeId)!.id,source=snapshotDrawing(input.drawingSnapshots!,sourceId);
 useEditor.getState().load({...input,drawingWorkingCopies:{[sourceId]:{...source,curves:source.curves.map((c,i)=>i?c:{...c,name:'Unsaved source label'})}}});
 const before=useEditor.getState().project,serialized=JSON.stringify(before),backups=memoryBackups(),first=backups.create();
 const metadata=await first.createArtworkCleanupBackup(before,'cleanup');expect(metadata.artworkCount).toBe(2);expect(metadata).not.toHaveProperty('serialized');
 // A new service object represents reopening the app; the database outlives it.
 const reopened=backups.create();expect(await reopened.listArtworkCleanupBackups()).toEqual([metadata]);const stored=await reopened.readArtworkCleanupBackup(metadata.id);expect(stored?.serialized).toBe(serialized);
 useEditor.getState().load(parseLandmarks(stored!.serialized));const restored=useEditor.getState().project;
 expect(restored.drawingSnapshots).toEqual(before.drawingSnapshots);expect(restored.drawingWorkingCopies).toEqual(before.drawingWorkingCopies);expect(restored.recordingScenes).toEqual(before.recordingScenes);
 for(const x of [0,45,90])expect(evaluateRecordingScene(restored,{angle:{x,y:0}}).drawing).toEqual(evaluateRecordingScene(before,{angle:{x,y:0}}).drawing);
},15000);

test('a pre-restore backup retains later edits separately and preserves exact bytes before an asynchronous write',async()=>{
 const backups=memoryBackups(),service=backups.create(),before=project(),first=await service.createArtworkCleanupBackup(before,'cleanup'),later=structuredClone(before);
 later.meta.name='New work after cleanup';later.drawing!.curves[0].name='Edited after cleanup';const captured=JSON.stringify(later),pending=service.createArtworkCleanupBackup(later,'before-restore');
 later.drawing!.curves[0].name='Even later in-memory edit';const second=await pending;expect(second.id).not.toBe(first.id);
 expect((await service.readArtworkCleanupBackup(second.id))!.serialized).toBe(captured);expect((await service.readArtworkCleanupBackup(first.id))!.serialized).toBe(JSON.stringify(before));expect(await service.listArtworkCleanupBackups()).toHaveLength(2);
});

test('quota or failed read-back verification rejects a backup and keeps existing recovery records',async()=>{
 const backups=memoryBackups(),service=backups.create(),before=project(),first=await service.createArtworkCleanupBackup(before,'cleanup'),bytes=backups.records.get(first.id)!.serialized;
 vi.mocked(backups.database.write).mockRejectedValueOnce(new DOMException('full','QuotaExceededError'));await expect(service.createArtworkCleanupBackup(before,'cleanup')).rejects.toThrow('storage is full');expect(backups.records.get(first.id)!.serialized).toBe(bytes);
 vi.mocked(backups.database.read).mockImplementationOnce(async id=>({...backups.records.get(id)!,serialized:'{}'}));await expect(service.createArtworkCleanupBackup(before,'cleanup')).rejects.toThrow('verification failed');expect(backups.records.get(first.id)!.serialized).toBe(bytes);
});

test('a cleanup commit rejects a stale preview and is a single source-only Undo step',()=>{
 useEditor.getState().load(project());useEditor.setState({past:[],future:[]});const before=useEditor.getState().project,next={...before,drawingSnapshots:{...before.drawingSnapshots!,items:before.drawingSnapshots!.items.map((a,i)=>i?{...a,name:a.name+' label'}:a)}};
 const newer={...before,drawingWorkingCopies:{[before.drawingSnapshots!.activeId!]:{...before.drawing!,mirrorAxisX:.777}}};useEditor.setState({project:newer});expect(()=>useEditor.getState().commitArtworkCleanup(before,next)).toThrow('变更');expect(useEditor.getState().project).toBe(newer);expect(useEditor.getState().past).toEqual([]);
 useEditor.setState({project:before});useWorkspaceMode.getState().setMode('recording');expect(()=>useEditor.getState().commitArtworkCleanup(before,next)).toThrow();expect(useEditor.getState().project).toBe(before);
 useWorkspaceMode.getState().setMode('drawing');useEditor.getState().commitArtworkCleanup(before,next);expect(useEditor.getState().project).toBe(next);expect(useEditor.getState().past).toEqual([before]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(next);
});

test('the actual cleanup action does not commit while backup is pending or after a newer edit',async()=>{
 const expected=project(),next={...expected,drawingWorkingCopies:{}},newer={...expected,meta:{...expected.meta,name:'A newer edit'}},gate=deferred<Awaited<ReturnType<ReturnType<typeof createArtworkCleanupBackupStorage>['createArtworkCleanupBackup']>>>();
 let current=expected;const commit=vi.fn(),restore=vi.fn(),create=vi.fn(()=>gate.promise),host={getProject:()=>current,commit,restore};
 const pending=applyArtworkCleanupPlan(host,expected,next,{create,read:vi.fn()});expect(create).toHaveBeenCalledWith(expected,'cleanup');expect(commit).not.toHaveBeenCalled();current=newer;
 gate.resolve({id:'pending',createdAt:1,reason:'cleanup',projectName:expected.meta.name,artworkCount:2});await expect(pending).rejects.toThrow('变化');expect(commit).not.toHaveBeenCalled();expect(current).toBe(newer);
});

test.each(['read','backup'] as const)('the actual restore action rejects edits arriving during %s without overwriting current work',async phase=>{
 const expected=project(),newer={...expected,meta:{...expected.meta,name:'Edited during restore'}},entry:ArtworkCleanupBackup={id:'old',createdAt:1,reason:'cleanup',projectName:'Old',artworkCount:2,serialized:raw};
 const readGate=deferred<ArtworkCleanupBackup>(),backupGate=deferred<Omit<ArtworkCleanupBackup,'serialized'>>();let current=expected;const restore=vi.fn(),commit=vi.fn();
 const read=vi.fn(()=>phase==='read'?readGate.promise:Promise.resolve(entry)),create=vi.fn(()=>backupGate.promise),pending=restoreArtworkCleanupProject({getProject:()=>current,restore,commit},'old',{read,create});
 if(phase==='read'){current=newer;readGate.resolve(entry);}else{await Promise.resolve();expect(create).toHaveBeenCalledWith(expected,'before-restore');current=newer;backupGate.resolve({id:'current',createdAt:2,reason:'before-restore',projectName:expected.meta.name,artworkCount:2});}
 await expect(pending).rejects.toThrow('变化');expect(restore).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();expect(current).toBe(newer);if(phase==='read')expect(create).not.toHaveBeenCalled();
});

test('a successful actual restore first preserves the complete current project as another durable backup',async()=>{
 const memory=memoryBackups(),storage=memory.create(),old=project(),saved=await storage.createArtworkCleanupBackup(old,'cleanup'),newer={...old,meta:{...old.meta,name:'Later distinct project'}};let current=newer;
 const host={getProject:()=>current,commit:vi.fn(),restore:vi.fn(value=>{expect([...memory.records.values()].some(entry=>entry.reason==='before-restore'&&entry.serialized===JSON.stringify(newer))).toBe(true);current=value;})};
 await restoreArtworkCleanupProject(host,saved.id,{create:storage.createArtworkCleanupBackup,read:storage.readArtworkCleanupBackup});expect(host.restore).toHaveBeenCalledTimes(1);expect(current.drawingSnapshots).toEqual(old.drawingSnapshots);expect(current.recordingScenes).toEqual(old.recordingScenes);expect(memory.records.size).toBe(2);
});

test('the approved arrangement keeps exactly five sources and the original three byte-for-byte, without changing its input',()=>{
 const before=fiveSourceFixture(),bytes=JSON.stringify(before),plan=planArtworkCleanup(before),after=plan.project;
 expect(after.drawingSnapshots!.items).toHaveLength(5);for(const id of ORIGINAL_ARTWORK_IDS)expect(after.drawingSnapshots!.items.find(a=>a.id===id)).toEqual(before.drawingSnapshots!.items.find(a=>a.id===id));
 expect(plan.removed.some(a=>a.id==='obsolete-unique')).toBe(true);expect(plan.removed.some(a=>a.id==='duplicate-front')).toBe(true);expect(after.drawingSnapshots!.items.filter(a=>a.drawing.layers.some(l=>l.id===RECORDING_SIDE_LAYER_ID))).toHaveLength(1);
 expect(after.recordingScenes!.scenes).toHaveLength(before.recordingScenes!.scenes.length);expect(after.recordingScenes!.scenes[0].warps).toEqual(before.recordingScenes!.scenes[0].warps);expect(after.recordingScenes!.scenes[0].bindings).toEqual(before.recordingScenes!.scenes[0].bindings);
 expect(JSON.stringify(before)).toBe(bytes);expect(()=>parseLandmarks(JSON.stringify(after))).not.toThrow();const again=planArtworkCleanup(after);expect(again.changed).toBe(false);expect(again.project).toBe(after);
});

test.each([0,45,90])('merging the red layer into the sole 90-degree source preserves actual PaintScene at %s degrees',x=>{
 const before=fiveSourceFixture(),plan=planArtworkCleanup(before),old=render(before,x),now=render(plan.project,x);
 expect(now.result.diagnostics).toEqual([]);expect(now.result.intervalTransportErrors).toEqual([]);expect(now.result.drawing.curves).toEqual(old.result.drawing.curves);expect(now.result.drawing.fills).toEqual(old.result.drawing.fills);expect(now.result.drawing.displayIntervals).toEqual(old.result.drawing.displayIntervals);
 expect(now.result.paintBatches.map(b=>[b.layerId,b.owner??null,b.item.id])).toEqual(old.result.paintBatches.map(b=>[b.layerId,b.owner??null,b.item.id]));expect(now.html).toBe(old.html);
});

test('an unscoped red instance remains restricted to its original layer after its source gains the full side drawing',()=>{
 const before=fiveSourceFixture(),scene=before.recordingScenes!.scenes[0],red=scene.instances.find(i=>i.layerIds?.includes(RECORDING_SIDE_LAYER_ID))!;delete red.layerIds;
 const plan=planArtworkCleanup(before),after=plan.project,instance=after.recordingScenes!.scenes[0].instances.find(i=>i.id===red.id)!;expect(instance.layerIds,JSON.stringify({mappings:plan.mappings,before:red,after:instance})).toEqual([RECORDING_SIDE_LAYER_ID]);expect(render(after,90).result.drawing.curves).toHaveLength(render(before,90).result.drawing.curves.length);
});

test('missing original artwork identity fails safely even when another asset has its display name',()=>{
 const before=fiveSourceFixture(),missing=ORIGINAL_ARTWORK_IDS[1];before.drawingSnapshots!.items=before.drawingSnapshots!.items.filter(a=>a.id!==missing);before.drawingSnapshots!.items[0].name='微侧13';const bytes=JSON.stringify(before);
 expect(()=>planArtworkCleanup(before)).toThrow('缺失');expect(JSON.stringify(before)).toBe(bytes);
});

test('the actual five-source cleanup is one Undo and its complete pre-cleanup library can be restored after reload',async()=>{
 const input=fiveSourceFixture(),old=input.drawingSnapshots.items.find(a=>a.id==='obsolete-unique')!;input.drawingWorkingCopies={...input.drawingWorkingCopies,[old.id]:{...old.drawing,curves:old.drawing.curves.map((c,i)=>i?c:{...c,name:'Unsaved work included in recovery'})}};
 useEditor.getState().load(input);useEditor.setState({past:[],future:[]});const before=useEditor.getState().project,plan=planArtworkCleanup(before),memory=memoryBackups(),storage=memory.create();
 const host={getProject:()=>useEditor.getState().project,commit:(expected:LandmarkProject,next:LandmarkProject)=>useEditor.getState().commitArtworkCleanup(expected,next),restore:(value:LandmarkProject)=>useEditor.getState().load(value)};
 await applyArtworkCleanupPlan(host,before,plan.project,{create:storage.createArtworkCleanupBackup,read:storage.readArtworkCleanupBackup});const after=useEditor.getState().project;
 expect(after.drawingSnapshots!.items).toHaveLength(5);expect(useEditor.getState().past).toEqual([before]);expect(memory.records.size).toBe(1);useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
 useEditor.getState().load(parseLandmarks(JSON.stringify(after)));const freshStorage=memory.create(),backup=(await freshStorage.listArtworkCleanupBackups())[0];await restoreArtworkCleanupProject(host,backup.id,{create:freshStorage.createArtworkCleanupBackup,read:freshStorage.readArtworkCleanupBackup});const restored=useEditor.getState().project;
 expect(restored.drawingSnapshots).toEqual(before.drawingSnapshots);expect(restored.drawingWorkingCopies).toEqual(before.drawingWorkingCopies);expect(restored.recordingScenes).toEqual(before.recordingScenes);expect(memory.records.size).toBe(2);expect([...memory.records.values()].find(b=>b.reason==='before-restore')!.artworkCount).toBe(5);
},15000);
