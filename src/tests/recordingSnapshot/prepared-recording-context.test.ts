import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import fullFace from '../../assets/hairless-symmetric-two-face-mirror.json';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotPreview} from '../../app/recordingSnapshotApi';
import {prepareSnapshotDrawingToolEdit} from '../../app/snapshotDrawingToolEdit';
import {snapshotEditContext} from '../../app/snapshotEditTransaction';
import {moveNode} from '../../domain/drawing/commands';
import {dragNode} from '../../domain/drawing/nodeDrag';
import {applyMirrorEditing} from '../../domain/drawing/mirrorEditing';
import {drawingReadContextStats,preparedDrawingReadContext} from '../../domain/drawing/readContext';
import {parseDrawing,shapeOf,type DrawingDocument} from '../../domain/drawing/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import {evaluateRecordingSnapshot,resolveRecordingSnapshotBasis,type SnapshotEvaluation} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type Angle,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {prepareRecordingContext} from '../../domain/recordingSnapshot/preparedRecordingContext';
import {upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import * as triangulation from '../../domain/recordingSnapshot/triangulation';
import * as snapshotValidation from '../../domain/recordingSnapshot/validation';
import * as simplexPrograms from '../../domain/recordingSnapshot/preparedSimplexPrograms';
import {getSnapshotSimplexSamplingStats} from '../../domain/recordingSnapshot/simplexGeometry';
import {interpolateSnapshotSurfaceOnion} from '../../ui/vectorRecording/surfaceOnion';

const at=(x:number,y=0):Angle=>({x,y});
const options={immutableInputs:true,useDraft:true,diagnostics:'preview'} as const;
function freeze<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}
 return value;
}

/** Public synthetic version of the response-only / flat-handle fallback fixture.
 * Each parent owns a separate curve so parent-cache pressure cannot be hidden
 * by resolving one shared parent under many aliases. */
function fixture(parentCount=1,triangle=false) {
 const workspace=emptyRecordingSnapshotWorkspace(),parents=[];
 for(let index=0;index<parentCount;index++){
  const suffix=index?String(index):'',a=`a${suffix}`,b=`b${suffix}`,curve=`curve${suffix}`,layer=`layer${suffix}`;
  workspace.library.nodes[a]={id:a,position:[0,index*2]};workspace.library.nodes[b]={id:b,position:[1,index*2+1]};
  workspace.library.curves[curve]={id:curve,name:curve,nodes:[a,b],handles:[[.25,index*2+.5],[.75,index*2+.5]],visible:true,locked:false,width:.01};
  const parent=emptyRecordingSnapshot(`source${suffix}`,`Source ${index}`,'drawing');
  parent.layers=[{kind:'original',id:layer,name:layer,items:[curve],visible:true,locked:false}];parents.push(parent);
 }
 const zero=emptyRecordingSnapshot('zero','Zero'),side=emptyRecordingSnapshot('side','Side','view',at(90)),up=emptyRecordingSnapshot('up','Up','view',at(0,90));
 const views=triangle?[zero,side,up]:[zero,side];
 for(const view of views)view.layers=parents.map(parent=>({kind:'reference',id:parent.layers[0].id,name:parent.name,baseSnapshotId:parent.id,baseLayerId:parent.layers[0].id}));
 side.deformation.layers.layer={shape:{nodes:{a:[1,.5],b:[.5,1]},handles:{curve:[[0,0],[0,0]]}}};
 if(triangle)up.deformation.layers.layer={shape:{nodes:{a:[.4,1],b:[.8,.3]},handles:{curve:[[.1,.2],[-.1,.2]]}}};
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=views.map(view=>view.id);recording.activeSnapshotId='zero';recording.angle=at(60);recording.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));
 workspace.snapshots=[...parents,...views];workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {workspace,parents,zero,side,up,recording,project:{...createEmptyProject(),recordingSnapshots:workspace}};
}

const controls=(drawing:DrawingDocument)=>({nodes:drawing.nodes,curves:drawing.curves.map(curve=>({id:curve.id,nodes:curve.nodes,handles:curve.handles}))});
function expectControls(actual:DrawingDocument,expected:DrawingDocument,digits=10) {
 expect(actual.curves.map(curve=>curve.id)).toEqual(expected.curves.map(curve=>curve.id));
 for(const curve of expected.curves)for(const [i,point] of shapeOf(expected,curve.id).entries())for(const axis of [0,1])expect(shapeOf(actual,curve.id)[i][axis]).toBeCloseTo(point[axis],digits);
}
function expectColdEquivalent(actual:SnapshotEvaluation,workspace:RecordingSnapshotWorkspace,angle=actual.angle,useDraft=true) {
 // A fresh external parse path is the oracle: it cannot inherit identity caches
 // from the warmed context whose invalidation is being tested.
 const cold=evaluateRecordingSnapshot(structuredClone(workspace),'recording',{angle,useDraft,diagnostics:'preview'});
 expect(actual.drawing).toEqual(cold.drawing);expect(actual.angleSurface?.outsideCurves).toEqual(cold.angleSurface?.outsideCurves);
}
const preparation=(context:ReturnType<typeof prepareRecordingContext>)=>{
 const c=context.counters;return {validation:c.validation,dependencyIndex:c.dependencyIndex,snapshotInput:c.snapshotInput,snapshotState:c.snapshotState,ownGeometry:c.ownGeometry,basis:c.basis,coverageStructure:c.coverageStructure};
};
/** Counts actual numeric execution, including solver replay outside the context
 * counters. Vertex samples do not run the control scalar loops. */
function observeControlSamples(){
 const prepare=simplexPrograms.preparedSnapshotSimplexProgram,counts={samples:0,scalars:0};
 const spy=vi.spyOn(simplexPrograms,'preparedSnapshotSimplexProgram').mockImplementation((...args)=>{
  const program=prepare(...args);
  return {sample(weights,response){
   if(args[0].length>1)counts.samples++;
   let measured=response;
   if(response){const scalar=response;measured=Object.assign((...args:Parameters<typeof scalar>)=>{counts.scalars++;return scalar(args[0],args[1],args[2],args[3]);},scalar) as typeof scalar;}
   return program.sample(weights,measured);
  }};
 });
 return {counts,restore:()=>spy.mockRestore()};
}

describe('prepared Recording context through the production sampling entrypoints',()=>{
 it('validates and prepares shared parents once per effective revision',()=>{
  const f=freeze(fixture(1,true)),context=prepareRecordingContext(f.workspace,options);
  const first=evaluateRecordingSnapshot(f.workspace,'recording',{...options,angle:at(20,30)}),warm=preparation(context);
  expect(warm.validation).toBe(1);expect(warm.dependencyIndex).toBe(1);
  expect(warm.snapshotInput).toBe(4);expect(warm.snapshotState).toBe(4);expect(warm.ownGeometry).toBe(4);expect(warm.basis).toBe(3);expect(warm.coverageStructure).toBeLessThanOrEqual(1);
  for(const id of f.recording.snapshotIds)expect(resolveRecordingSnapshotBasis(f.workspace,f.recording,id,options).drawing).toBe(first.angleSurface!.allBases.find(basis=>basis.snapshotId===id)!.drawing);
  expect(preparation(context)).toEqual(warm);expectColdEquivalent(first,f.workspace);
 });

 it('scrubs unique 2-D angles without rebuilding unchanged native bases or structural coverage',()=>{
  const f=freeze(fixture(1,true)),context=prepareRecordingContext(f.workspace,options);
  context.sample('recording',{angle:at(15,20)});const warm=preparation(context);
  const requests=Array.from({length:41},(_,i)=>({angle:at(1+i,45-i/2)}));
  const frames=context.sampleMany('recording',requests);
  expect(frames).toHaveLength(41);expect(preparation(context)).toEqual(warm);
  for(const i of [0,20,40])expectColdEquivalent(frames[i],f.workspace,requests[i].angle);
 });

 it('retains the same frozen bases beyond the former 24-parent and 32-frame cache limits',()=>{
  const f=freeze(fixture(27)),context=prepareRecordingContext(f.workspace,options),first=context.sample('recording',{angle:at(60)}),warm=preparation(context);
  expect(warm.snapshotInput).toBe(29);expect(warm.ownGeometry).toBe(29);expect(warm.basis).toBe(2);
  for(let x=1;x<=40;x++)evaluateRecordingSnapshot(f.workspace,'recording',{...options,angle:at(x)});
  const returned=context.sample('recording',{angle:at(60)});
  expect(preparation(context)).toEqual(warm);expect(returned.drawing).toEqual(first.drawing);
  for(const base of first.angleSurface!.allBases)expect(returned.angleSurface!.allBases.find(value=>value.snapshotId===base.snapshotId)).toBe(base);
  expectColdEquivalent(returned,f.workspace);
 });

 it('shares preparation across main, 9/18-step onion sweeps, and exact inverse replay',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),main=context.sample('recording'),warm=preparation(context),bytes=JSON.stringify(main.drawing);
  for(const step of [10,5] as const){
   const onion=interpolateSnapshotSurfaceOnion(f.recording,main,{startSnapshotId:'zero',endSnapshotId:'side'},step);
   expect(onion.frames).toHaveLength(step===10?10:19);
   for(const frame of onion.frames)expectControls(frame.drawing,context.sample('recording',{angle:frame.angle}).drawing);
  }
  expect(preparation(context)).toEqual(warm);
  const node=main.drawing.nodes.find(value=>value.id==='a')!,target=moveNode(main.drawing,'a',[node.position[0]+.08,node.position[1]-.04],true);
  const edit=prepareSnapshotDrawingToolEdit(snapshotEditContext(f.project,false),{recordingId:'recording',snapshotId:main.snapshotId,angle:f.recording.angle,beforeDrawing:main.drawing,drawing:target,intent:{kind:'geometry'},validation:'preview'});
  const candidate=context.fork(edit.project.recordingSnapshots!);expectControls(candidate.sample('recording').drawing,target);
  const after=interpolateSnapshotSurfaceOnion(edit.project.recordingSnapshots!.recordings[0],candidate.sample('recording'),{startSnapshotId:'side',endSnapshotId:'zero'},5);
  for(const frame of [after.frames[3],after.frames[9],after.frames[15]])expectControls(frame.drawing,candidate.sample('recording',{angle:frame.angle}).drawing);
  expect(JSON.stringify(main.drawing)).toBe(bytes);expectControls(context.sample('recording').drawing,main.drawing);
  expectColdEquivalent(candidate.sample('recording'),edit.project.recordingSnapshots!);
 });

 it('rebuilds zero native bases for independent response-only pointer targets',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),warm=preparation(context);
  for(const delta of [.03,-.06,.1]){
   const node=before.drawing.nodes.find(value=>value.id==='a')!,position:[number,number]=[node.position[0]+delta,node.position[1]-delta/2];
   const preview=prepareSnapshotPreview(f.project,{commands:[{op:'moveShapeNode',layerId:'layer',nodeId:'a',position}]});
   const fork=context.fork(preview.recordingSnapshots),result=fork.sample('recording');
   expectControls(result.drawing,moveNode(before.drawing,'a',position,true));
   expect(fork.counters.ownGeometry).toBe(0);expect(fork.counters.basis).toBe(0);expect(fork.counters.coverageStructure).toBe(0);
   expectColdEquivalent(result,preview.recordingSnapshots);
  }
  expect(preparation(context)).toEqual(warm);
 });

 it('keeps a native command fallback in the same validated dependency session',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),handle=before.drawing.curves[0].handles[0];
  const validation=vi.spyOn(snapshotValidation,'validateSnapshotGraph');
  try{
   const preview=prepareSnapshotPreview(f.project,{commands:[{op:'moveShapeHandle',layerId:'layer',curveId:'curve',end:0,position:[handle[0]+.04,handle[1]]}]}),fork=context.fork(preview.recordingSnapshots),actual=fork.sample('recording');
   expect(preview.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='side')!.draft).toBeDefined();
   expect(actual.drawing.curves[0].handles[0][0]).toBeCloseTo(handle[0]+.04,10);
   expect(actual.drawing.curves[0].handles[0][1]).toBeCloseTo(handle[1],10);
   expect(validation).not.toHaveBeenCalled();
  }finally{validation.mockRestore();}
 });

 it('samples exactly the pre-response and verified candidate controls for a coupled fallback',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),node=before.drawing.nodes.find(value=>value.id==='a')!;
  const wanted=dragNode(before.drawing,'a',[node.position[0]+.081,node.position[1]-.043],.4),observed=observeControlSamples(),bytes=JSON.stringify(f.project);
  try{
   const edit=prepareSnapshotDrawingToolEdit(snapshotEditContext(f.project,false),{recordingId:'recording',snapshotId:before.snapshotId,angle:f.recording.angle,beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry'},validation:'preview'});
   expect(edit.project.recordingSnapshots!.snapshots.find(value=>value.id==='side')!.draft).toBeDefined();
   expectControls(context.fork(edit.project.recordingSnapshots!).sample('recording').drawing,wanted,7);
   expect(observed.counts.samples).toBe(2);expect(observed.counts.scalars).toBe(16);
   expect(JSON.stringify(f.project)).toBe(bytes);
  }finally{observed.restore();}
 });

 it('retains the complete candidate coverage and diagnostics after response-only replay',()=>{
  const f=fixture(2);f.side.layers[1]={...f.side.layers[1],membership:{excludeElementIds:['curve1']}};freeze(f);
  const context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),node=before.drawing.nodes.find(value=>value.id==='a')!,wanted=moveNode(before.drawing,'a',[node.position[0]+.077,node.position[1]-.031],true),observed=observeControlSamples(),samplingBefore=getSnapshotSimplexSamplingStats();
  try{
   expect(before.angleSurface!.outsideCurves).toHaveLength(1);
   const result=context.prepareSurfaceTargetEdit('recording',before,wanted,{angle:f.recording.angle,frameId:'coverage-replay'}),workspace={...f.workspace,recordings:[{...f.recording,angleGraph:result.graph}]};
   const actual=context.fork(workspace).sample('recording');expectControls(actual.drawing,wanted);
   expect(observed.counts.samples).toBe(0);expect(getSnapshotSimplexSamplingStats().revisionSamples-samplingBefore.revisionSamples).toBe(1);expect(actual.angleSurface!.outsideCurves).toEqual(before.angleSurface!.outsideCurves);
   const cold=evaluateRecordingSnapshot(structuredClone(workspace),'recording',{useDraft:true,diagnostics:'preview'});
   expect(actual.drawing).toEqual(cold.drawing);expect(actual.angleSurface!.outsideCurves).toEqual(cold.angleSurface!.outsideCurves);
   expect(actual.angleSurface!.nodeAuthorities).toEqual(cold.angleSurface!.nodeAuthorities);expect(actual.diagnostics).toEqual(cold.diagnostics);expect(actual.paintBatches).toEqual(cold.paintBatches);
  }finally{observed.restore();}
 });

 it('keeps property-only preview controls and native geometry while changing terminal material',()=>{
  const f=fixture();
  for(const [index,view] of [f.zero,f.side].entries())view.relations.displayIntervals={add:[{id:'interval',anchor:{id:'curve',reverse:false},scope:'CURVE',ranges:[{id:'gap',mode:'HIDE',start:.3,end:index?.9:.3}]}]};
  f.recording.angle=at(30);freeze(f);
  const context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),warm=preparation(context);
  const preview=prepareSnapshotPreview(f.project,{commands:[{op:'changeInterval',layerId:'layer',sourceTrackId:'interval',rangeId:'gap',end:.3}]}),fork=context.fork(preview.recordingSnapshots),actual=fork.sample('recording');
  expect(actual.drawing.displayIntervals![0].ranges[0].end).toBeCloseTo(.3,12);expect(controls(actual.drawing)).toEqual(controls(before.drawing));
  expect(fork.counters.ownGeometry).toBe(0);expect(fork.counters.basis).toBe(0);expect(fork.counters.coverageStructure).toBe(0);
  expect(fork.counters.surfaceSample).toBe(0);
  expect(preparation(context)).toEqual(warm);
  expectColdEquivalent(actual,preview.recordingSnapshots);
 });

 it('does not request terminal material or paint products for full-curve onion sampling',()=>{
  const f=freeze(fixture()),context=prepareRecordingContext(f.workspace,options),current=context.sample('recording'),before={...context.counters};
  // This executes the structural restriction itself, not the public cache
  // adapter. It catches an onion-only preparation path omitted from counters.
  const restrict=vi.spyOn(triangulation,'restrictSnapshotCoverage');
  try{
   for(const step of [10,5] as const){
    const onion=interpolateSnapshotSurfaceOnion(f.recording,current,{startSnapshotId:'zero',endSnapshotId:'side'},step);
    expect(onion.frames.every(frame=>frame.paintBatches.length===0)).toBe(true);
   }
   expect(context.counters.material).toBe(before.material);expect(context.counters.paint).toBe(before.paint);
   expect(context.counters.coverageStructure).toBe(before.coverageStructure);expect(context.counters.ownGeometry).toBe(before.ownGeometry);expect(restrict).not.toHaveBeenCalled();
  }finally{restrict.mockRestore();}
 });

 it('keeps the fixed zero basis and untouched source through a side fallback candidate',()=>{
  const f=fixture(),child=emptyRecordingSnapshot('side-child','Side child');child.parentSnapshotId='side';child.layers=[{kind:'reference',id:'child-layer',name:'Child',baseSnapshotId:'side',baseLayerId:'layer'}];f.workspace.snapshots.push(child);freeze(f);
  const context=prepareRecordingContext(f.workspace,options),before=context.sample('recording'),zero=context.resolveBasis('recording','zero'),source=context.resolveSnapshot('source'),priorChild=context.resolveSnapshot('side-child');
  const node=before.drawing.nodes.find(value=>value.id==='a')!,target=dragNode(before.drawing,'a',[node.position[0]+.08,node.position[1]-.04],.4);
  const edit=prepareSnapshotDrawingToolEdit(snapshotEditContext(f.project,false),{recordingId:'recording',snapshotId:before.snapshotId,angle:f.recording.angle,beforeDrawing:before.drawing,drawing:target,intent:{kind:'geometry'},validation:'preview'}),fork=context.fork(edit.project.recordingSnapshots!);
  expect(edit.project.recordingSnapshots!.snapshots.find(value=>value.id==='side')!.draft).toBeDefined();
  expectControls(fork.sample('recording').drawing,target,7);
  expect(fork.resolveBasis('recording','zero')).toBe(zero);expect(fork.resolveSnapshot('source')).toBe(source);
  expect(fork.counters.bySnapshot.zero?.ownGeometry??0).toBe(0);expect(fork.counters.bySnapshot.source?.ownGeometry??0).toBe(0);
  expect(fork.resolveSnapshot('side-child').drawing).not.toEqual(priorChild.drawing);
  // App replay may already have produced the candidate's native basis; the
  // returned fork must reuse that product rather than manufacture another miss.
  expect(fork.counters.bySnapshot.side?.ownGeometry??0).toBeLessThanOrEqual(1);expect(fork.counters.bySnapshot['side-child']?.ownGeometry??0).toBeLessThanOrEqual(1);
  expect(fork.sample('recording',{angle:at(0)}).drawing).toEqual(zero.drawing);expectColdEquivalent(fork.sample('recording'),edit.project.recordingSnapshots!);
 });

 it('shares the nine-view preparation on the bundled 121-curve complete eyes-and-ears drawing',()=>{
  const drawing=parseDrawing(fullFace);expect(drawing.curves).toHaveLength(121);
  const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'complete-face',drawing),source=workspace.snapshots[0];
  const views=[-90,0,90].flatMap(x=>[-90,0,90].map(y=>{
   const view=emptyRecordingSnapshot(`view:${x}:${y}`,`View ${x}/${y}`,'view',at(x,y));
   view.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));
   view.deformation.layers=Object.fromEntries(view.layers.map(layer=>[layer.id,{placement:{translation:[x/300,y/300],rotation:0,scale:1}}]));return view;
  }));
  const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=views.map(view=>view.id);recording.activeSnapshotId='view:0:0';recording.angle=at(-60);recording.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));
  workspace.snapshots.push(...views);workspace.recordings=[recording];workspace.activeRecordingId='recording';freeze(workspace);
  const context=prepareRecordingContext(workspace,options),current=context.sample('recording');
  // This edge has two numeric supports; structural membership alone must not
  // force numerical preparation of all nine real views.
  expect(context.counters.ownGeometry).toBe(3);expect(context.counters.basis).toBe(2);expect(current.drawing.curves).toHaveLength(121);
  const samples=context.sampleMany('recording',[{angle:at(-31,22)},{angle:at(37,-19)},{angle:at(0,45)}]);
  for(const sample of samples)expectColdEquivalent(sample,workspace);
  const onion=interpolateSnapshotSurfaceOnion(recording,current,{startSnapshotId:'view:-90:0',endSnapshotId:'view:90:0'},5);
  expect(onion.frames).toHaveLength(37);expect(onion.frames.every(frame=>frame.drawing.curves.length===121)).toBe(true);
  for(const view of views)context.resolveBasis('recording',view.id);const warm=preparation(context);
  expect(warm.ownGeometry).toBe(10);expect(warm.basis).toBe(9);expect(warm.coverageStructure).toBeLessThanOrEqual(1);
  const reads=drawingReadContextStats();
  const fresh=context.sampleMany('recording',[{angle:at(-43,12)},{angle:at(21,-27)},{angle:at(0,37)}]);
  const completed=drawingReadContextStats();
  // Hundreds of stroke consumers share one plan per transient document, with
  // no per-query content signature. The scope cannot mark editable buffers as
  // permanently immutable merely because a renderer read them once.
  expect(completed.strokeKeys-reads.strokeKeys).toBe(0);
  expect(completed.strokeBuilds-reads.strokeBuilds).toBe(0);
  expect(completed.topologyKeys-reads.topologyKeys).toBe(completed.contexts-reads.contexts);
  expect(completed.contexts-reads.contexts).toBeLessThan(40);
  expect(fresh.every(value=>preparedDrawingReadContext(value.drawing)===undefined)).toBe(true);
  interpolateSnapshotSurfaceOnion(recording,current,{startSnapshotId:'view:-90:0',endSnapshotId:'view:90:0'},10);expect(preparation(context)).toEqual(warm);
 },30000);
});

// Local opt-in only. The private source and its geometry never enter the repo.
const privateFixture=process.env.CONTOUR_MINCHANGE_PRIVATE_FIXTURE;
it.skipIf(!privateFixture)('private 124 fallback samples 718 scalars exactly twice and preserves its frozen source',()=>{
 const raw=readFileSync(privateFixture!,'utf8'),hash=createHash('sha256').update(raw).digest('hex'),project=freeze(parseLandmarks(raw)),workspace=project.recordingSnapshots!,recording=workspace.recordings.find(value=>value.id===workspace.activeRecordingId)!,context=prepareRecordingContext(workspace,options),before=context.sample(recording.id);
 expect(recording.angle).toEqual(at(-60));
 const curve=before.drawing.curves.find(value=>value.name==='左片·外侧下颌')!,node=before.drawing.nodes.find(value=>value.id===curve.nodes[0])!,position:[number,number]=[node.position[0]+.021,node.position[1]],wanted=applyMirrorEditing(before.drawing,dragNode(before.drawing,node.id,position,.4),{nodes:[{nodeId:node.id,position}]}),bytes=JSON.stringify(project),observed=observeControlSamples();
 try{
  const edit=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:recording.id,snapshotId:before.snapshotId,angle:recording.angle,beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry'},validation:'preview'}),actual=context.fork(edit.project.recordingSnapshots!).sample(recording.id);
  expectControls(actual.drawing,wanted,7);expect(observed.counts).toEqual({samples:2,scalars:1436});
  expect(JSON.stringify(project)).toBe(bytes);expect(createHash('sha256').update(readFileSync(privateFixture!)).digest('hex')).toBe(hash);
 }finally{observed.restore();}
},30000);
