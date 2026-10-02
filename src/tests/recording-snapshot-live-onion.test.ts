import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import {emptyDrawing,type Point2} from '../domain/drawing/model';
import {evaluateRecordingSnapshot} from '../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace,type SnapshotPoseTrack} from '../domain/recordingSnapshot/model';
import {snapshotAuthoredKeyCount} from '../domain/recordingSnapshot/tracks';
import {validateRecordingSnapshotWorkspace} from '../domain/recordingSnapshot/validation';
import {emptyRecordingScene,instanceObjectId,type SceneShapeTrack} from '../domain/recordingScene/model';
import {evaluateScene} from '../domain/recordingScene/evaluation';
import SceneOnionSkin from '../ui/vectorRecording/SceneOnionSkin';
import {DEFAULT_SCENE_ONION_SETTINGS,createSceneOnionSweepQueue,createSnapshotOnionInspectionCache,evaluateSceneOnionFrame,markSceneOnionHighlights,prioritizeSceneOnionAngles,sampleSceneOnionAngles,sceneOnionInspectionSignature,sceneOnionRangeFromViews,sceneOnionSweepAnchor,snapshotOnionInspectionSignature,type SceneOnionFrame} from '../ui/vectorRecording/angleInspection';

const at=(x:number,y=0)=>({x,y});
function fixture(side=90){
 const workspace=emptyRecordingSnapshotWorkspace();
 workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,0]}};
 workspace.library.curves={curve:{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.25,0],[.75,0]],width:.02,visible:true,locked:false}};
 const zero=emptyRecordingSnapshot('zero','Front','view'),end=emptyRecordingSnapshot('side','Side','view',at(side));
 for(const snapshot of [zero,end])snapshot.layers=[{kind:'original',id:'layer',name:'Outline',items:['curve'],visible:true,locked:false}];
 const recording=emptySnapshotRecording('recording');recording.angle=at(side);recording.snapshotIds=['zero','side'];recording.activeSnapshotId='side';
 recording.tracks=[{id:'shape',channel:'shape',targetId:'layer',interpolation:'independent',keys:[{id:'front-shape',angle:at(0),value:{nodes:{},handles:{}}},{id:'side-shape',angle:at(side),value:{nodes:{a:[.9,0]},handles:{curve:[[0,.3],[0,0]]}}}],draft:{angle:at(side),value:{nodes:{a:[2.7,0]},handles:{curve:[[0,.9],[0,0]]}}}}];
 zero.authored=[{trackId:'shape',keyId:'front-shape'}];end.authored=[{trackId:'shape',keyId:'side-shape'}];
 workspace.snapshots=[zero,end];workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {workspace,recording};
}
function sweep(workspace:RecordingSnapshotWorkspace,current=at(90),min=0,max=90){
 const clone=JSON.parse(snapshotOnionInspectionSignature(workspace,'recording',current)) as RecordingSnapshotWorkspace;
 const settings={...DEFAULT_SCENE_ONION_SETTINGS,enabled:true,min,max};
 const frames=sampleSceneOnionAngles(current,settings,true).map(angle=>{const e=evaluateRecordingSnapshot(clone,'recording',{angle,useDraft:false,diagnostics:'preview'});return {angle:e.angle,drawing:e.drawing,paintBatches:e.paintBatches};});
 return {clone,frames:markSceneOnionHighlights(frames,settings)};
}

test('unsaved endpoint nodes and handles drive the full interpolated sweep without saving keys or changing input',()=>{
 const {workspace,recording}=fixture(),before=JSON.stringify(workspace),keyCount=snapshotAuthoredKeyCount(recording),{clone,frames}=sweep(workspace);
 const thirty=frames.find(f=>f.angle.x===30)!,sixty=frames.find(f=>f.angle.x===60)!;
 expect(thirty.drawing.nodes.find(n=>n.id==='a')!.position[0]).toBeCloseTo(.9);
 expect(sixty.drawing.nodes.find(n=>n.id==='a')!.position[0]).toBeCloseTo(1.8);
 expect(thirty.drawing.curves[0].handles[0][1]).toBeCloseTo(.3);
 expect(sixty.drawing.curves[0].handles[0][1]).toBeCloseTo(.6);
 expect(thirty.highlight).toBe('30');expect(sixty.highlight).toBe('60');
 expect(clone.recordings[0].tracks[0].keys.map(k=>k.id)).toEqual(['front-shape','side-shape']);
 expect(clone.recordings[0].tracks[0].draft).toBeUndefined();
 expect(()=>validateRecordingSnapshotWorkspace(clone)).not.toThrow();
 expect(JSON.stringify(workspace)).toBe(before);expect(snapshotAuthoredKeyCount(recording)).toBe(keyCount);
 expect(evaluateRecordingSnapshot(workspace,'recording',{angle:at(30),useDraft:false,diagnostics:'preview'}).drawing.nodes.find(n=>n.id==='a')!.position[0]).toBeCloseTo(.3);
});

test('negative endpoint sweeps use the live pose and distinct -30/-60 guide samples',()=>{
 const {workspace}=fixture(-90),before=JSON.stringify(workspace),{frames}=sweep(workspace,at(-90),-90,0);
 expect(frames.find(f=>f.highlight==='30')).toMatchObject({angle:at(-30),highlightAngle:-30});
 expect(frames.find(f=>f.highlight==='60')).toMatchObject({angle:at(-60),highlightAngle:-60});
 expect(frames.find(f=>f.angle.x===-30)!.drawing.nodes.find(n=>n.id==='a')!.position[0]).toBeCloseTo(.9);
 expect(JSON.stringify(workspace)).toBe(before);
});

test('cache ignores cursor selection and unrelated drafts but includes every current draft value and canonical geometry',()=>{
 const {workspace,recording}=fixture();delete recording.tracks[0].draft;
 const signature=snapshotOnionInspectionSignature(workspace,recording.id,at(30));
 recording.angle=at(60);recording.activeSnapshotId='zero';
 expect(snapshotOnionInspectionSignature(workspace,recording.id,at(60))).toBe(signature);
 recording.tracks[0].draft={angle:at(90),value:{nodes:{a:[4,0]},handles:{}}};
 expect(snapshotOnionInspectionSignature(workspace,recording.id,at(60))).toBe(signature);
 const live=snapshotOnionInspectionSignature(workspace,recording.id,at(90));expect(live).not.toBe(signature);
 const shape=recording.tracks[0] as Extract<SnapshotPoseTrack,{channel:'shape'}>;shape.draft!.value.handles.curve=[[1,2],[0,0]];
 expect(snapshotOnionInspectionSignature(workspace,recording.id,at(90))).not.toBe(live);
 workspace.library.nodes.a.position=[.1,0];expect(snapshotOnionInspectionSignature(workspace,recording.id,at(60))).not.toBe(signature);
});

test('inspection at an unsaved angle adds a temporary sample only to the detached evaluator',()=>{
 const {workspace,recording}=fixture();recording.tracks[0].draft!.angle=at(45);const before=JSON.stringify(workspace),{clone}=sweep(workspace,at(45));
 expect(clone.recordings[0].tracks[0].keys).toHaveLength(3);expect(recording.tracks[0].keys).toHaveLength(2);
 expect(workspace.snapshots.map(s=>s.authored)).toEqual([[{trackId:'shape',keyId:'front-shape'}],[{trackId:'shape',keyId:'side-shape'}]]);
 expect(JSON.stringify(workspace)).toBe(before);
});

test('5/10 degree single-axis sweeps select nearest guide samples and infer the endpoint range',()=>{
 const {workspace}=fixture(-90);expect(sceneOnionRangeFromViews(workspace.snapshots)).toEqual({min:-90,max:0});
 expect(sceneOnionRangeFromViews([{angle:at(15,0)},{angle:at(15,90)}],'y')).toEqual({min:0,max:90});
 for(const step of [5,10] as const){
  const settings={...DEFAULT_SCENE_ONION_SETTINGS,axis:'y' as const,min:2,max:90,step},angles=sampleSceneOnionAngles(at(17,90),settings,true);
  const frames=markSceneOnionHighlights(angles.map(angle=>({angle,drawing:emptyDrawing(),paintBatches:[]})),settings);
  expect(frames.every(f=>f.angle.x===17)).toBe(true);expect(frames.filter(f=>f.highlight)).toHaveLength(2);
  expect(frames.find(f=>f.highlight==='30')!.angle.y).toBe(32);expect(frames.find(f=>f.highlight==='60')!.angle.y).toBe(62);
 }
});

test('colored guides use the actual ink only, keep active pose separate, and never add picking or fill paths',()=>{
 const {workspace}=fixture(),{frames}=sweep(workspace),screen=([x,y]:Point2):Point2=>[x*100,y*100];
 const svg=renderToStaticMarkup(createElement('svg',null,createElement(SceneOnionSkin,{frames,angle:at(90),opacity:.16,screen,unit:100})));
 expect(svg).toMatch(/data-highlight-angle="30"[^>]*opacity="0.65"/);expect(svg).toMatch(/data-highlight-angle="60"[^>]*opacity="0.65"/);expect(svg).toContain('data-highlight-angle="30"');expect(svg).toContain('data-highlight-angle="60"');expect(svg).toContain('vr-onion-guide-30');expect(svg).toContain('vr-onion-guide-60');
 expect(svg).not.toContain('<feFlood');expect(svg).toContain('data-testid="drawing-ink"');expect(svg).not.toContain('data-angle-x="90"');expect(svg).not.toMatch(/data-testid="drawing-(?:fill|hit|arc-hit|offset-hit|fill-hit)"/);
});

test('legacy canvas live inspection interpolates current edits while leaving saved-only evaluation available',()=>{
 const drawing={...emptyDrawing(),nodes:[{id:'a',position:[0,0] as Point2},{id:'b',position:[1,0] as Point2}],curves:[{id:'curve',name:'Curve',nodes:['a','b'] as [string,string],handles:[[.25,0],[.75,0]] as [Point2,Point2],width:.02,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',items:['curve'],visible:true,locked:false}]};
 const shape:SceneShapeTrack={id:'shape',instanceId:'instance',keys:[{id:'zero',angle:at(0),value:{nodes:{},handles:{}}},{id:'side',angle:at(90),value:{nodes:{a:[.9,0]},handles:{}}}],draft:{angle:at(90),value:{nodes:{a:[2.7,0]},handles:{}}}};
 const scene={...emptyRecordingScene('scene'),angle:at(90),instances:[{id:'instance',artworkId:'source',name:'Source'}],shapeTracks:[shape]},before=JSON.stringify([scene,drawing]);
 const inspection=JSON.parse(sceneOnionInspectionSignature(scene)),frame:SceneOnionFrame=evaluateSceneOnionFrame(inspection,()=>drawing,at(30));
 expect(frame.drawing.nodes.find(n=>n.id===instanceObjectId('instance','a'))!.position[0]).toBeCloseTo(.9);
 expect(evaluateScene(scene,()=>drawing,{angle:at(30),useDraft:false,diagnostics:'preview'}).drawing.nodes.find(n=>n.id===instanceObjectId('instance','a'))!.position[0]).toBeCloseTo(.3);
 expect(JSON.stringify([scene,drawing])).toBe(before);
});


test('yaw inspection keeps Y at zero despite a slightly pitched cursor; explicit pitch holds current X',()=>{
 const settings={...DEFAULT_SCENE_ONION_SETTINGS,axis:'x' as const,min:-90,max:0},cursor=at(-90,.4);
 const samples=sampleSceneOnionAngles(sceneOnionSweepAnchor(cursor,'x'),settings,true);
 expect(samples).toHaveLength(10);expect(samples.every(angle=>angle.y===0)).toBe(true);
 expect(samples.map(angle=>angle.x)).toEqual([-90,-80,-70,-60,-50,-40,-30,-20,-10,0]);
 expect(sceneOnionSweepAnchor(at(17,.4),'y')).toEqual(at(17,0));
});


test('continuous drag input cannot starve sweeps, newest preview runs next, and cancelled callbacks cannot publish',()=>{
 vi.useFakeTimers();
 try{
  const published:{request:number;frames:number[]}[]=[];
  const queue=createSceneOnionSweepQueue<number,number>(()=>4,(request,index)=>request*10+index,(request,frames)=>published.push({request,frames}),24);
  queue.update(1);vi.advanceTimersByTime(10);queue.update(2);vi.advanceTimersByTime(10);queue.update(3);vi.advanceTimersByTime(4);
  expect(published).toEqual([]);queue.update(4);vi.advanceTimersByTime(8);
  expect(published).toEqual([{request:3,frames:[30,31,32,33]}]);
  queue.update(5);vi.advanceTimersByTime(30);
  expect(published.at(-1)).toEqual({request:5,frames:[50,51,52,53]});
  queue.update(6);queue.cancel();vi.runAllTimers();expect(published).toHaveLength(2);
  queue.update(7);vi.runAllTimers();expect(published.at(-1)!.request).toBe(7);
 }finally{vi.useRealTimers();}
});


test('interactive inspection cache reuses static sources and unchanged channels while invalidating live edits',()=>{
 const {workspace,recording}=fixture(),cache=createSnapshotOnionInspectionCache(),first=cache.get(workspace,recording.id,recording.angle);
 expect(cache.get({...workspace,recordings:[{...recording,activeSnapshotId:'zero'}]},recording.id,recording.angle)).toBe(first);
 const shape=recording.tracks[0] as Extract<SnapshotPoseTrack,{channel:'shape'}>,nextTrack={...shape,draft:{angle:recording.angle,value:{nodes:{a:[4.5,0] as Point2},handles:{}}}};
 const next={...workspace,recordings:[{...recording,tracks:[nextTrack]}]},live=cache.get(next,recording.id,recording.angle);
 expect(live).not.toBe(first);expect(live.library).toBe(first.library);expect(live.snapshots).toBe(first.snapshots);
 expect(evaluateRecordingSnapshot(live,recording.id,{angle:at(30),useDraft:false,diagnostics:'preview'}).drawing.nodes.find(n=>n.id==='a')!.position[0]).toBeCloseTo(1.5);
 const sourceChanged={...next,library:{...next.library,nodes:{...next.library.nodes,a:{id:'a',position:[.2,0] as Point2}}}},changed=cache.get(sourceChanged,recording.id,recording.angle);
 expect(changed.library).not.toBe(first.library);expect(changed.library.nodes.a.position).toEqual([.2,0]);expect(workspace.library.nodes.a.position).toEqual([0,0]);
});

test('onion preparation excludes unrelated snapshots, reference images and recovery archive',()=>{
 const {workspace,recording}=fixture(),unused=emptyRecordingSnapshot('unused','Unused','drawing');unused.layers=[{kind:'original',id:'unused-layer',name:'Unused',items:['unused-curve'],visible:true,locked:false}];
 workspace.snapshots.push(unused);workspace.library.curves['unused-curve']={...workspace.library.curves.curve,id:'unused-curve'};
 workspace.legacyArchive={format:'landmark-project-json',migrationVersion:2,projectJSON:'unrelated archived document'};
 workspace.snapshots[0].source={artworkId:'artwork',originIds:{},reference:{dataUrl:'data:image/png;base64,unrelated',opacity:1} as any};
 const before=JSON.stringify(workspace),inspection=createSnapshotOnionInspectionCache().get(workspace,recording.id,recording.angle);
 expect(inspection.snapshots.map(s=>s.id)).toEqual(['zero','side']);expect(inspection.library.curves['unused-curve']).toBeUndefined();expect(inspection.snapshots[0].source?.reference).toBeUndefined();expect(inspection.legacyArchive).toBeUndefined();
 expect(JSON.stringify(workspace)).toBe(before);
});


test('guide poses publish before the entire expensive sweep finishes',()=>{
 const settings={...DEFAULT_SCENE_ONION_SETTINGS,min:-90,max:0},angles=prioritizeSceneOnionAngles(sampleSceneOnionAngles(at(0),settings,true),settings);
 expect(angles.slice(0,2)).toEqual([at(-30),at(-60)]);expect(angles).toHaveLength(10);
 vi.useFakeTimers();try{
  const progress:number[]=[],completed:number[]=[];
  const queue=createSceneOnionSweepQueue<number,number>(()=>10,(_,index)=>index,()=>completed.push(1),12,(_,frame)=>progress.push(frame));
  queue.update(1);vi.advanceTimersByTime(12);expect(progress).toEqual([0]);expect(completed).toEqual([]);
  vi.runAllTimers();expect(progress).toHaveLength(10);expect(completed).toEqual([1]);
 }finally{vi.useRealTimers();}
});
