import {afterEach,expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createEmptyProject,isUntouchedEmptyProject} from '../app/emptyProject';
import {parseLandmarks} from '../domain/landmarks/persistence';

const source=readFileSync(new URL('../assets/base-face.json',import.meta.url),'utf8');
let durableJSON:string|undefined;
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
async function startup(){vi.resetModules();durableJSON=undefined;
 vi.doMock('../app/projectStorage',async importOriginal=>{const actual=await importOriginal<typeof import('../app/projectStorage')>();return {...actual,...actual.createProjectStorage({openDatabase:async()=>({read:async()=>durableJSON,write:async value=>{durableJSON=value;},close:()=>{}}),legacyStorage:()=>localStorage})};});
 return import('../app/starterProject');}


test('first visit opens the complete drawing, snapshots and recordings with no empty Undo state',async()=>{
 const boot=await startup(),values=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
 expect(await boot.prepareStarterProject(localStorage,async()=>source)).toBe(true);
 const {useEditor}=await import('../app/store'),p=useEditor.getState().project,original=JSON.parse(source);
 expect(p.drawing!.layers).toHaveLength(18);expect(p.drawing!.curves).toHaveLength(210);expect(p.drawing!.fills).toHaveLength(25);
 expect(p.drawing!.curves.map(c=>c.id)).toEqual(original.drawing.curves.map((c:{id:string})=>c.id));
 expect(p.drawing!.displayIntervals).toEqual(original.drawing.displayIntervals);
 expect(p.drawing!.reference).toEqual(original.drawing.reference);
 expect(p.drawingSnapshots!.items.map(s=>s.name)).toEqual(['正面','微侧13','稍侧12']);
 expect(p.drawingSnapshots!.activeId).toBe(original.drawingSnapshots.activeId);
 expect(p.poseRecording!.poses).toHaveLength(2);expect(useEditor.getState().past).toEqual([]);
 await vi.waitFor(()=>expect(durableJSON).toBeDefined());expect(JSON.parse(durableJSON!).drawing).toEqual(p.drawing);
 expect(values.has('contour.landmarks.v039')).toBe(false); // Full projects now use IndexedDB.
});

test('all existing storage versions, even invalid content, prevent starter replacement/download',async()=>{
 const boot=await startup(),load=vi.fn(async()=>source);
 for(const savedKey of boot.PROJECT_STORAGE_KEYS){
  expect(await boot.prepareStarterProject({getItem:key=>key===savedKey?'existing user data':null},load)).toBe(false);
  expect(boot.getStarterProject()).toBeUndefined();
 }
 expect(load).not.toHaveBeenCalled();
});

test('a returning visitor keeps their edits instead of resetting to the template',async()=>{
 const boot=await startup(),edited=JSON.parse(source);edited.meta.name='My edited face';edited.drawing.nodes[0].position=[.123,.456];
 const saved=JSON.stringify(edited),values=new Map([['contour.landmarks.v039',saved]]);
 vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
 expect(await boot.prepareStarterProject(localStorage,()=>{throw Error('must not download');})).toBe(false);
 const {useEditor}=await import('../app/store');
 expect(useEditor.getState().project.meta.name).toBe('My edited face');
 expect(useEditor.getState().project.drawing!.nodes[0].position).toEqual([.123,.456]);
 await vi.waitFor(()=>expect(durableJSON).toBeDefined());expect(values.get('contour.landmarks.v039')).toBe(saved);
});

test('download/validation failures leave startup uninitialized and can be retried',async()=>{
 const boot=await startup(),storage={getItem:()=>null};
 await expect(boot.prepareStarterProject(storage,async()=>{throw Error('offline');})).rejects.toThrow('offline');
 expect(boot.getStarterProject()).toBeUndefined();
 await expect(boot.prepareStarterProject(storage,async()=>'not JSON')).rejects.toThrow();
 expect(boot.getStarterProject()).toBeUndefined();
 expect(await boot.prepareStarterProject(storage,async()=>source)).toBe(true);
});

test('blocked storage still permits editing the template in memory',async()=>{
 const boot=await startup();
 expect(await boot.prepareStarterProject({getItem:()=>{throw Error('blocked');}},async()=>source)).toBe(true);
 expect(boot.getStarterProject()!.drawing!.curves).toHaveLength(210);
});

test('the old automatic blank upgrades once, keeps a backup and actually reaches the store',async()=>{
 const boot=await startup(),raw=JSON.stringify(parseLandmarks(JSON.stringify(createEmptyProject())));
 const values=new Map([['contour.landmarks.v039',raw]]),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 vi.stubGlobal('localStorage',storage);
 expect(isUntouchedEmptyProject(raw)).toBe(true);
 expect(await boot.prepareStarterProject(storage,async()=>source)).toBe(true);
 expect(values.get(boot.EMPTY_BACKUP_KEY)).toBe(raw);
 const {useEditor}=await import('../app/store');
 expect(useEditor.getState().project.drawing!.curves).toHaveLength(210);
 await vi.waitFor(()=>expect(durableJSON&&JSON.parse(durableJSON).drawing?.curves.length).toBe(210));expect(values.get('contour.landmarks.v039')).toBe(raw);
 boot.finishProjectStartup(storage);
 // A deliberate later New command must remain blank on reload.
 storage.setItem('contour.landmarks.v039',raw);
 const load=vi.fn(async()=>source);expect(await boot.prepareStarterProject(storage,load)).toBe(false);expect(load).not.toHaveBeenCalled();
});

test('empty-looking projects with authored modeling, references, renamed data or hidden artwork are never replaced',async()=>{
 const boot=await startup(),empty=createEmptyProject();
 const variants=[
  {...empty,meta:{...empty.meta,name:'My work'}},
  {...empty,headFrame:{...empty.headFrame!,radiusX:1.1}},
  {...empty,loomisScaffold:{...empty.loomisScaffold!,sideTilt:10}},
  {...empty,views:empty.views.map((v,i)=>i?v:{...v,reference:{name:'Ref',dataUrl:'data:image/png;base64,AAAA',width:100,height:100,opacity:.5,scale:1,offset:[0,0]}})},
  {...empty,drawing:JSON.parse(source).drawing},
 ];
 for(const p of variants){const raw=JSON.stringify(p),load=vi.fn(async()=>source);
  expect(isUntouchedEmptyProject(raw)).toBe(false);
  expect(await boot.prepareStarterProject({getItem:key=>key==='contour.landmarks.v039'?raw:null},load)).toBe(false);expect(load).not.toHaveBeenCalled();
 }
});

test('a failed blank backup leaves the existing blank untouched',async()=>{
 const boot=await startup(),raw=JSON.stringify(createEmptyProject());
 const storage={getItem:(key:string)=>key==='contour.landmarks.v039'?raw:null,setItem:()=>{throw Error('full');}};
 expect(await boot.prepareStarterProject(storage,async()=>source)).toBe(false);expect(boot.getStarterProject()).toBeUndefined();
});
