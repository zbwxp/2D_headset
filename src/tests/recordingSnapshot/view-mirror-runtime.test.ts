import {describe,expect,it} from 'vitest';
import {prepareSnapshotDrawingToolEdit} from '../../app/snapshotDrawingToolEdit';
import {moveHandle} from '../../domain/drawing/commands';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {identityScenePlacement} from '../../domain/recordingScene/model';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot,evaluateSnapshotControlTargetPreview,resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {seedAutomaticExtremeSnapshots} from '../../domain/recordingSnapshot/automaticSnapshotEdits';
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
 it('mirrors current source membership under canonical target identities without restoring absent zero-only members',()=>{
  const f=fixture();f.left.layers[0].membership={excludeElementIds:['right']};
  const actual=resolveSnapshot(f.w,f.right.id,{useDraft:false});expect(actual.drawing.curves.map(curve=>curve.id)).toEqual(['right']);expect(actual.drawing.nodes.map(node=>node.id).sort()).toEqual(['c','d']);expect(actual.drawing.nodes.find(node=>node.id==='c')!.position[0]).toBeCloseTo(.3);
  expect(resolveSnapshot(f.w,f.zero.id).drawing.curves).toHaveLength(2);
 });
 it('uses an explicit live zero V-frame for unpaired groups and keeps their intentional zero-side jump',()=>{
  const f=fixture();f.source.source!.mirrorEditing!.curvePairs=[];f.recording.angleGraph!.viewMirror={zeroSnapshotId:f.zero.id,sourceSnapshotId:f.left.id,targetSnapshotId:f.right.id,unpairedReference:'zero-stroke-frame'};
  const current=evaluateRecordingSnapshot(f.w,f.recording.id,{useDraft:false,diagnostics:'preview'}),zeroPlus=current.angleSurface!.positiveBases!.find(base=>base.snapshotId===f.zero.id)!;
  expect(current.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(-.4);expect(zeroPlus.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(.1);expect(node(f.w,90,'a')[0]).toBeCloseTo(-.3);expect(node(f.w,1,'a')[0]).toBeCloseTo(.1-.4/90);
  const onion=interpolateSnapshotSurfaceOnion(f.recording,current,{startSnapshotId:f.left.id,endSnapshotId:f.right.id},10);for(const frame of onion.frames)expect(frame.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(node(f.w,frame.angle.x,'a')[0]);
  f.zero.deformation.layers.layer.placement!.translation=[.5,0];expect(node(f.w,90,'a')[0]).toBeCloseTo(.1);expect(f.recording.angleGraph!.viewMirror).toEqual({zeroSnapshotId:f.zero.id,sourceSnapshotId:f.left.id,targetSnapshotId:f.right.id,unpairedReference:'zero-stroke-frame'});
 });
 it('defaults existing and newly seeded unpaired mirrors to their live local zero V-frame center',()=>{
  const f=fixture();f.source.source!.mirrorEditing!.curvePairs=[];expect(f.recording.angleGraph!.viewMirror).toBeUndefined();const before=JSON.stringify(f.w);expect(node(f.w,90,'a')[0]).toBeCloseTo(-.3);expect(node(f.w,1,'a')[0]).toBeCloseTo(.1-.4/90);expect(JSON.stringify(f.w)).toBe(before);
  f.w.snapshots=f.w.snapshots.filter(snapshot=>snapshot.id!==f.right.id);f.recording.snapshotIds=[f.zero.id,f.left.id];f.recording.angleGraph=createSnapshotAngleGraph([f.zero,f.left].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));let index=0;seedAutomaticExtremeSnapshots(f.w,f.recording.id,f.left.id,()=>`default-${++index}`);expect(f.recording.angleGraph!.viewMirror!.unpairedReference).toBe('zero-stroke-frame');expect(node(parseRecordingSnapshots(f.w),90,'a')[0]).toBeCloseTo(-.3);
 });
 it('qualifies every automatic zero-yaw pitch support with the same central-zero operator',()=>{
  const f=fixture();f.source.source!.mirrorEditing!.curvePairs=[];f.recording.angleGraph!.viewMirror={zeroSnapshotId:f.zero.id,sourceSnapshotId:f.left.id,targetSnapshotId:f.right.id,unpairedReference:'zero-stroke-frame'};let index=0;for(const view of [f.zero,f.left,f.right])seedAutomaticExtremeSnapshots(f.w,f.recording.id,view.id,()=>`generated-${++index}`);
  const evaluate=(x:number,y:number)=>evaluateRecordingSnapshot(f.w,f.recording.id,{angle:{x,y},useDraft:false,diagnostics:'preview'}),current=evaluate(0,0),graph=f.recording.angleGraph!,top=graph.mesh.vertices.find(vertex=>vertex.angle.x===0&&vertex.angle.y===90)!,rightTop=graph.mesh.vertices.find(vertex=>vertex.angle.x===90&&vertex.angle.y===90)!;
  for(const y of [-90,-45,0,45,90])expect(evaluate(30,y).drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(node(f.w,30,'a')[0]);
  const onion=interpolateSnapshotSurfaceOnion(f.recording,current,{startSnapshotId:top.snapshotId,endSnapshotId:rightTop.snapshotId},10);for(const frame of onion.frames)expect(frame.drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(evaluate(frame.angle.x,frame.angle.y).drawing.nodes.find(node=>node.id==='a')!.position[0]);
  f.w.snapshots.find(view=>view.id===top.snapshotId)!.deformation.layers.layer={placement:{...identityScenePlacement(),translation:[.2,0]}};expect(evaluate(30,90).drawing.nodes.find(node=>node.id==='a')!.position[0]).toBeCloseTo(-1/6);expect(graph.mesh.vertices).toHaveLength(9);
 });
 it('preserves an off-axis zero-width unpaired group without an inverse or a duplicated zero vertex',()=>{
  const f=fixture();f.source.source!.mirrorEditing!.curvePairs=[];f.recording.angleGraph!.viewMirror={zeroSnapshotId:f.zero.id,sourceSnapshotId:f.left.id,targetSnapshotId:f.right.id,unpairedReference:'zero-stroke-frame'};f.zero.deformation.layers.layer.placement={...identityScenePlacement(),translation:[1.3,0],scaleX:0,scaleY:1};
  const current=evaluateRecordingSnapshot(f.w,f.recording.id,{useDraft:false,diagnostics:'preview'}),zeroPlus=current.angleSurface!.positiveBases!.find(base=>base.snapshotId===f.zero.id)!;expect(zeroPlus.drawing.nodes).toEqual(current.drawing.nodes);expect(zeroPlus.drawing.curves.map(curve=>curve.handles)).toEqual(current.drawing.curves.map(curve=>curve.handles));expect(node(f.w,90,'a')[0]).toBeCloseTo(2.6);expect(f.recording.angleGraph!.mesh.vertices.filter(vertex=>vertex.angle.x===0&&vertex.angle.y===0)).toHaveLength(1);
 });
 it('keeps a negative-only line valid and exposes its absent positive sample through existing red coverage',()=>{
  const f=fixture();f.w.library.nodes.e={id:'e',position:[-.4,-.2]};f.w.library.nodes.g={id:'g',position:[.2,-.3]};f.w.library.curves.extra={id:'extra',name:'Extra',nodes:['e','g'],handles:[[-.3,-.1],[.1,-.2]],width:.01,visible:true,locked:false};if(f.source.layers[0].kind!=='original')throw Error('fixture');f.source.layers[0].items.push('extra');f.zero.layers[0].membership={excludeElementIds:['extra']};const before=JSON.stringify(f.w);
  const negative=evaluateRecordingSnapshot(f.w,f.recording.id,{angle:at(-90),useDraft:false,diagnostics:'preview'}),positive=evaluateRecordingSnapshot(f.w,f.recording.id,{angle:at(30),useDraft:false,diagnostics:'preview'});expect(negative.drawing.curves.map(curve=>curve.id)).toContain('extra');expect(positive.drawing.curves.map(curve=>curve.id).sort()).toEqual(['left','right']);expect(positive.angleSurface!.outsideCurves).toEqual(expect.arrayContaining([expect.objectContaining({curveId:'extra',readonly:true,outside:true})]));expect(positive.diagnostics.filter(issue=>issue.code==='INPUT_MIRROR'&&issue.message.includes('Curve extra'))).toHaveLength(1);
  const onion=interpolateSnapshotSurfaceOnion(f.recording,negative,{startSnapshotId:f.left.id,endSnapshotId:f.right.id},10);for(const frame of onion.frames.filter(frame=>frame.angle.x>0)){expect(frame.drawing.curves.map(curve=>curve.id)).not.toContain('extra');expect(frame.centerlines).toEqual(expect.arrayContaining([expect.objectContaining({id:'outside:extra',outside:true})]));}
  expect(resolveSnapshot(f.w,f.right.id,{useDraft:false}).drawing.curves.map(curve=>curve.id)).not.toContain('extra');expect(JSON.stringify(f.w)).toBe(before);
 });
 it('trims only material and routes dependent on omitted curves while preserving available material',()=>{
  const f=fixture();f.w.library.nodes.e={id:'e',position:[-.7,.2]};f.w.library.nodes.g={id:'g',position:[.2,-.3]};f.w.library.curves.extra={id:'extra',name:'Extra',nodes:['e','g'],handles:[[-.3,-.1],[.1,-.2]],width:.01,visible:true,locked:false};f.w.library.fills.dependent={id:'dependent',name:'Dependent',boundary:[{id:'extra',reverse:false},{id:'left',reverse:false}],color:'black',visible:true,locked:false};f.w.library.fills.stable={id:'stable',name:'Stable',boundary:[{id:'left',reverse:false}],color:'black',visible:true,locked:false};if(f.source.layers[0].kind!=='original')throw Error('fixture');f.source.layers[0].items.push('extra','dependent','stable');f.source.relations.endpointLinks={add:[{id:'extra-link',a:{curveId:'extra',end:0},b:{curveId:'left',end:0}}]};f.source.relations.displayIntervals={add:[{id:'dependent-route',anchor:{id:'left',reverse:false},displayRoute:{seed:{segments:[{id:'extra',reverse:true},{id:'left',reverse:false}],closed:false},throughLinkIds:['extra-link']},ranges:[]},{id:'stable-route',anchor:{id:'left',reverse:false},displayRoute:{seed:{segments:[{id:'left',reverse:false}],closed:false},throughLinkIds:[]},ranges:[]}]};f.zero.layers[0].membership={excludeElementIds:['extra']};const before=JSON.stringify(f.w),right=resolveSnapshot(f.w,f.right.id,{useDraft:false});expect(right.drawing.fills.map(fill=>fill.id)).toEqual(['stable']);expect(right.drawing.endpointLinks).toEqual([]);expect(right.drawing.displayIntervals!.map(track=>track.id)).toEqual(['stable-route']);expect(right.drawing.layers.flatMap(layer=>layer.items)).not.toContain('dependent');expect(JSON.stringify(f.w)).toBe(before);
 });
 it('preserves invalid real constraints as atomic failures even alongside missing zero members',()=>{
  const f=fixture(),before=JSON.stringify(f.w),next=structuredClone(f.w);next.snapshots.find(view=>view.id===f.source.id)!.source!.mirrorEditing!.curvePairs.push({id:'conflict',a:'left',b:'right',reverse:true});next.snapshots.find(view=>view.id===f.zero.id)!.layers[0].membership={excludeElementIds:['left']};const project={...createEmptyProject(),recordingSnapshots:f.w};expect(()=>prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-state',workspace:next})).toThrow();expect(JSON.stringify(f.w)).toBe(before);
 });
 it('omits half-missing pairs without self mapping and rejects a missing Recorder zero binding',()=>{
  const f=fixture();f.zero.layers[0].membership={excludeElementIds:['left']};const right=resolveSnapshot(f.w,f.right.id,{useDraft:false});expect(right.drawing.curves).toEqual([]);expect(right.diagnostics.filter(issue=>issue.code==='INPUT_MIRROR').every(issue=>issue.message.includes('positive sample'))).toBe(true);expect(resolveSnapshot(f.w,f.left.id).drawing.curves).toHaveLength(2);
  const g=fixture();g.recording.angleGraph!.viewMirror={zeroSnapshotId:'missing',sourceSnapshotId:g.left.id,targetSnapshotId:g.right.id};expect(()=>parseRecordingSnapshots(g.w)).toThrow(/missing 0°/);
 });
});

for(const x of [0,-90,90])it(`fresh real handle replay retains live mirror and saved bases at yaw ${x}`,()=>{
 const f=fixture();f.recording.angle=at(x);const project={...createEmptyProject(),recordingSnapshots:f.w},before=evaluateRecordingSnapshot(f.w,f.recording.id,{useDraft:true,immutableInputs:true,diagnostics:'preview'}),saved=JSON.stringify(f.w);
 for(const delta of [.03,-.02,.06]){
  const wanted=moveHandle(before.drawing,{curveId:'left',end:0},[before.drawing.curves.find(curve=>curve.id==='left')!.handles[0][0]+delta,.15]),plan=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:f.recording.id,snapshotId:before.snapshotId,angle:at(x),beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry'},validation:'preview'}),next=plan.project.recordingSnapshots!,loaded=parseRecordingSnapshots(next);
  const current=evaluateSnapshotControlTargetPreview(f.w,next,f.recording.id,before);expect(Object.getOwnPropertyDescriptor(current.angleSurface!,'allBases')?.get).toBeTypeOf('function');const full=evaluateRecordingSnapshot(next,f.recording.id,{useDraft:true,immutableInputs:true,diagnostics:'preview'});expect(current.drawing).toEqual(full.drawing);expect(current.paintBatches).toEqual(full.paintBatches);expect(current.diagnostics).toEqual(full.diagnostics);expect(current.drawing.nodes).toEqual(wanted.nodes);expect(current.drawing.curves.map(curve=>curve.id)).toEqual(wanted.curves.map(curve=>curve.id));for(const curve of wanted.curves)for(const end of [0,1] as const)for(const axis of [0,1] as const)expect(current.drawing.curves.find(value=>value.id===curve.id)!.handles[end][axis]).toBeCloseTo(curve.handles[end][axis],12);
  for(const angle of [at(-90),at(-30),at(0),at(30),at(90)])for(const useDraft of [false,true]){
   const cached=evaluateRecordingSnapshot(next,f.recording.id,{angle,useDraft,immutableInputs:true,diagnostics:'preview'}),strict=evaluateRecordingSnapshot(loaded,f.recording.id,{angle,useDraft,diagnostics:'preview'});expect(cached.drawing).toEqual(strict.drawing);
  }
  const onion=interpolateSnapshotSurfaceOnion(next.recordings[0],current,{startSnapshotId:f.left.id,endSnapshotId:f.right.id},5);for(const frame of onion.frames)expect(frame.drawing).toEqual(evaluateRecordingSnapshot(loaded,f.recording.id,{angle:frame.angle,useDraft:true,diagnostics:'preview'}).drawing);
  expect(next.library).toBe(f.w.library);expect(JSON.stringify(f.w)).toBe(saved);
 }
});

it('native real preview preserves separate red coverage and defers exact live inspection bases',()=>{
 const f=fixture();f.w.library.nodes.e={id:'e',position:[-1,-1]};f.w.library.nodes.g={id:'g',position:[1,-1]};f.w.library.curves.reference={id:'reference',name:'Reference',nodes:['e','g'],handles:[[-.5,-1],[.5,-1]],width:.01,visible:true,locked:false};f.source.layers.push({kind:'original',id:'reference-layer',name:'Reference layer',items:['reference'],visible:true,locked:false});f.zero.layers.push({kind:'reference',id:'reference-layer',name:'Reference layer',baseSnapshotId:f.source.id,baseLayerId:'reference-layer'});f.recording.angle=at(-90);
 const before=evaluateRecordingSnapshot(f.w,f.recording.id,{useDraft:true,immutableInputs:true,diagnostics:'preview'});expect(before.angleSurface!.outsideCurves.map(curve=>curve.curveId)).toEqual(['reference']);const project={...createEmptyProject(),recordingSnapshots:f.w},wanted=moveHandle(before.drawing,{curveId:'left',end:0},[.2,.15]),plan=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:f.recording.id,snapshotId:before.snapshotId,angle:at(-90),beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry'},validation:'preview'}),next=plan.project.recordingSnapshots!,fast=evaluateSnapshotControlTargetPreview(f.w,next,f.recording.id,before);
 expect(Object.getOwnPropertyDescriptor(fast.angleSurface!,'allBases')?.get).toBeTypeOf('function');const full=evaluateRecordingSnapshot(next,f.recording.id,{useDraft:true,immutableInputs:true,diagnostics:'preview'});expect(fast).toEqual(full);expect(fast.angleSurface!.allBases).toBe(full.angleSurface!.allBases);expect(fast.angleSurface!.positiveBases).toBe(full.angleSurface!.positiveBases);
 const changedLibrary={...next,library:{...next.library,nodes:{...next.library.nodes,e:{...next.library.nodes.e,position:[-2,-1] as [number,number]}}}},fallback=evaluateSnapshotControlTargetPreview(f.w,changedLibrary,f.recording.id,before);expect(fallback.angleSurface!.outsideCurves[0].cubic[0][0]).toBe(-2);
});
