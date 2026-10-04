import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {identityScenePlacement} from '../../domain/recordingScene/model';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot,resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {interpolateSnapshotSurfaceOnion} from '../../ui/vectorRecording/surfaceOnion';

const at=(x:number)=>({x,y:0});
function fixture(){
 const w=emptyRecordingSnapshotWorkspace();
 w.library.nodes={a:{id:'a',position:[-.7,.2]},b:{id:'b',position:[-.2,.3]},c:{id:'c',position:[.4,.5]},d:{id:'d',position:[.9,.6]}};
 w.library.curves={left:{id:'left',name:'Left',nodes:['a','b'],handles:[[-.6,.1],[-.3,.4]],visible:true,locked:false,width:.01},right:{id:'right',name:'Right',nodes:['c','d'],handles:[[.5,.4],[.8,.7]],visible:true,locked:false,width:.01}};
 const source=emptyRecordingSnapshot('source','Source','drawing');source.layers=[{kind:'original',id:'layer',name:'Layer',items:['left','right'],visible:true,locked:false}];source.source={artworkId:'asset',originIds:{},mirrorAxisX:0,mirrorEditing:{enabled:false,curvePairs:[{id:'pair',a:'left',b:'right',reverse:false}]}};
 const zero=emptyRecordingSnapshot('zero','Zero','view',at(0)),left=emptyRecordingSnapshot('left-view','Left','view',at(-90)),right=emptyRecordingSnapshot('right-view','Right','view',at(90));
 for(const view of [zero,left]){view.parentSnapshotId=source.id;view.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:source.id,baseLayerId:'layer'}];}
 zero.deformation.layers.layer={placement:{...identityScenePlacement(),translation:[.3,0]}};left.deformation.layers.layer={placement:{...identityScenePlacement(),translation:[.7,0]}};
 right.parentSnapshotId=left.id;right.parentLayers={};right.inputMirror={axisX:123,curvePairs:[]};right.layers=[{kind:'reference',id:'layer',name:'Layer',baseSnapshotId:left.id,baseLayerId:'layer'}];
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=[zero.id,left.id,right.id];recording.activeSnapshotId=zero.id;recording.angle=at(0);recording.angleGraph=createSnapshotAngleGraph([zero,left,right].map(view=>({snapshotId:view.id,angle:view.angle})));
 w.snapshots=[source,zero,left,right];w.recordings=[recording];w.activeRecordingId=recording.id;return {w,source,zero,left,right,recording};
}
const node=(w:RecordingSnapshotWorkspace,x:number,id='c',useDraft=false)=>evaluateRecordingSnapshot(w,'recording',{angle:at(x),useDraft,diagnostics:'preview'}).drawing.nodes.find(node=>node.id===id)!.position;
describe('Recorder local-zero View mirror runtime',()=>{
 it('anchors paired deltas to the evaluated zero and applies positive local overrides once',()=>{
  const f=fixture(),before=JSON.stringify(f.w);expect(node(f.w,90)[0]).toBeCloseTo(.3);expect(node(f.w,90)[1]).toBeCloseTo(.5);expect(JSON.stringify(f.w)).toBe(before);
  f.right.deformation.layers.layer={placement:{...identityScenePlacement(),translation:[.1,.2]}};expect(node(f.w,90)).toEqual(expect.arrayContaining([expect.closeTo(.4),expect.closeTo(.7)]));
  f.zero.deformation.layers.layer.placement!.translation=[.5,0];expect(node(f.w,90)[0]).toBeCloseTo(.8);
  f.left.deformation.layers.layer.placement!.translation=[.8,0];expect(node(f.w,90)[0]).toBeCloseTo(.7);
  expect(f.right.parentSnapshotId).toBe(f.left.id);expect(f.recording.angleGraph!.mesh.vertices.filter(vertex=>vertex.angle.x===0&&vertex.angle.y===0)).toHaveLength(1);
 });
 it('keeps current zero draft live in main sampling and the complete onion without saving it',()=>{
  const f=fixture();f.zero.draft={angle:at(0),deformation:{...structuredClone(f.zero.deformation),layers:{layer:{placement:{...identityScenePlacement(),translation:[.6,0]}}}},channels:[]};const before=JSON.stringify(f.w);
  expect(node(f.w,90,'c',false)[0]).toBeCloseTo(.3);expect(node(f.w,90,'c',true)[0]).toBeCloseTo(.9);
  const current=evaluateRecordingSnapshot(f.w,f.recording.id,{useDraft:true,diagnostics:'preview'}),onion=interpolateSnapshotSurfaceOnion(f.recording,current,{startSnapshotId:f.zero.id,endSnapshotId:f.right.id},10);
  for(const frame of onion.frames)expect(frame.drawing.nodes.find(node=>node.id==='c')!.position[0]).toBeCloseTo(node(f.w,frame.angle.x,'c',true)[0]);
  expect(JSON.stringify(f.w)).toBe(before);expect(f.recording.tracks).toEqual([]);
 });
 it('uses only the currently authored draft, including minus90, and caches source and zero revisions separately',()=>{
  const f=fixture();f.left.draft={angle:at(-90),deformation:{...structuredClone(f.left.deformation),layers:{layer:{placement:{...identityScenePlacement(),translation:[.9,0]}}}},channels:[]};
  expect(node(f.w,90,'c',true)[0]).toBeCloseTo(.3);f.recording.angle=at(-90);expect(node(f.w,90,'c',true)[0]).toBeCloseTo(.1);expect(node(f.w,90,'c',false)[0]).toBeCloseTo(.3);
  const initial=resolveSnapshot(f.w,f.right.id,{useDraft:false}),again=resolveSnapshot(f.w,f.right.id,{useDraft:false});expect(again).toBe(initial);
  f.zero.deformation.layers.layer.placement!.translation=[.4,0];expect(resolveSnapshot(f.w,f.right.id,{useDraft:false})).not.toBe(initial);expect(node(f.w,90)[0]).toBeCloseTo(.5);
 });
 it('persists only Recorder expression references and restores the complete relation through Undo/Redo',async()=>{
  const f=fixture(),before=JSON.stringify(f.w),next=structuredClone(f.w);applySnapshotCommand(next,{op:'setViewMirror',relation:{zeroSnapshotId:f.zero.id,sourceSnapshotId:f.left.id,targetSnapshotId:f.right.id}});
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(next)));expect(loaded).toEqual(next);expect(node(loaded,90)[0]).toBeCloseTo(.3);expect(JSON.stringify(f.w)).toBe(before);
  const project={...createEmptyProject(),recordingSnapshots:f.w},plan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-state',workspace:next}),{useEditor}=await import('../../app/store'),previous=useEditor.getState();
  try{useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);}finally{useEditor.setState(previous,true);}
 });
 it('rejects missing zero identities and a missing Recorder zero binding instead of manufacturing geometry',()=>{
  const f=fixture();f.zero.layers[0].membership={excludeElementIds:['left']};expect(()=>node(f.w,90)).toThrow(/zero-view baseline/);
  const g=fixture();g.recording.angleGraph!.viewMirror={zeroSnapshotId:'missing',sourceSnapshotId:g.left.id,targetSnapshotId:g.right.id};expect(()=>parseRecordingSnapshots(g.w)).toThrow(/missing 0°/);
 });
});
