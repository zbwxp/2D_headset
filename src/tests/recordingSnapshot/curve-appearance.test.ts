import {afterEach,describe,expect,it} from 'vitest';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createEmptyProject} from '../../app/emptyProject';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {prepareDrawingSnapshotEdit,prepareDrawingCurveSplit} from '../../app/drawingSnapshotEdit';
import {currentDrawingPresentation,drawingSnapshotPresentation} from '../../app/drawingSnapshotPresentation';
import {emptyDrawing,nodeAt,shapeOf,type DrawingDocument} from '../../domain/drawing/model';
import {connect,createPenCurve,linkEndpoints,widthChange} from '../../domain/drawing/commands';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {drawingSnapshotForArtwork,canonicalElementId} from '../../domain/recordingSnapshot/sources';
import {captureSnapshotLayerClipboard} from '../../domain/recordingSnapshot/referenceClipboard';
import {prepareDrawingLayerReferencePaste} from '../../ui/drawing/layerReferenceClipboard';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {prepareIndependentSnapshotLayers} from '../../domain/recordingSnapshot/independentCopy';
import {emptyRecordingSnapshot} from '../../domain/recordingSnapshot/model';
import {createSnapshotRelationAuthoringIntent} from '../../domain/recordingSnapshot/relationAuthoringIntent';
import {snapshotCurveAppearanceDifference,mergeSnapshotCurveAppearance,validateSnapshotCurveAppearance} from '../../domain/recordingSnapshot/curveAppearance';
import {prepareSnapshotLocalDrawingEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {createEndpointPairOnionInkCache} from '../../ui/vectorRecording/endpointOnionInk';
const bid=(id:string)=>canonicalElementId('B',id),originalState=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(originalState,true);useWorkspaceMode.setState({mode:originalMode});});
function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[-1,0]},{id:'b',position:[0,0]}],curves:[{id:'curve',name:'A',nodes:['a','b'],handles:[[-.7,0],[-.3,0]],visible:true,locked:false,width:.008}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}]};
 const other:DrawingDocument={...drawing,nodes:[{id:'a',position:[.2,.2]},{id:'b',position:[1.2,.2]}],curves:[{...drawing.curves[0],name:'B',profile:'EYELID',profileReverse:true,strokeName:'Mouth',inkEnds:[{taper:.03,extension:.01},{taperWidthScale:20,interior:true}],handles:[[.5,.2],[.9,.2]]}]};
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing,drawingSnapshots:{version:1,activeId:'A',images:[],items:[{id:'A',name:'A',drawing},{id:'B',name:'B',drawing:other}]}}),source=drawingSnapshotForArtwork(project.recordingSnapshots,'B')!;
 project.recordingSnapshots={...project.recordingSnapshots,recordings:[],activeRecordingId:undefined};
 const pasted=prepareDrawingLayerReferencePaste(project,captureSnapshotLayerClipboard('test','reference',[{snapshotId:source.id,layerIds:source.layers.map(layer=>layer.id)}]),'test').project;
 return prepareDrawingSnapshotEdit(pasted,createPenCurve(currentDrawingPresentation(pasted),bid('layer'),[[0,1],[.3,1],[.7,1],[1,1]],.02,'pen')).project;
}
const fixed={curveId:bid('curve'),end:1 as const},moving={curveId:'pen',end:0 as const};
const joined=(project:ReturnType<typeof fixture>,mode:'POSITION'|'SMOOTH'|'CUSP'='POSITION',reverse=false)=>{const before=currentDrawingPresentation(project),wanted=connect(before,reverse?moving:fixed,reverse?fixed:moving,mode),plan=prepareDrawingSnapshotEdit(project,wanted);return {wanted,plan,after:plan.project};};
const expectDrawing=(actual:DrawingDocument,wanted:DrawingDocument)=>{for(const curve of wanted.curves){expect(actual.curves.find(value=>value.id===curve.id)?.nodes).toEqual(curve.nodes);expect(snapshotCurveAppearanceDifference(actual.curves.find(value=>value.id===curve.id)!,curve)).toBeUndefined();expect(shapeOf(actual,curve.id).flat()).toEqual(shapeOf(wanted,curve.id).flat().map(value=>expect.closeTo(value,8)));}};

describe('Snapshot-local curve appearance through ordinary Drawing commands',()=>{
 it.each(['POSITION','SMOOTH','CUSP'] as const)('keeps ordinary %s bind style and shared topology local in one Undo',mode=>{
  const before=fixture(),saved=JSON.stringify(before),{wanted,plan,after}=joined(before,mode),actual=currentDrawingPresentation(after),snapshot=drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!;
  expectDrawing(actual,wanted);expect(nodeAt(actual,fixed).id).toBe(nodeAt(actual,moving).id);expect(actual.endpointLinks??[]).toEqual([]);expect(after.drawing).toBe(before.drawing);expect(after.drawingSnapshots).toEqual(before.drawingSnapshots);
  for(const [id,curve] of Object.entries(before.recordingSnapshots!.library.curves))if(id!=='pen')expect(after.recordingSnapshots!.library.curves[id]).toEqual(curve);
  expect(snapshot.deformation.layers[bid('layer')].curveAppearance?.[bid('curve')]).toEqual({inkEnds:{end:{taper:0,extension:0,taperWidthScale:null,interior:null}}});
  expect(snapshot.deformation.layers[bid('layer')].curveAppearance?.pen).toMatchObject({width:.008,profile:'EYELID',profileReverse:true,strokeName:'Mouth'});
  expect(JSON.stringify(before)).toBe(saved);useWorkspaceMode.setState({mode:'drawing'});useEditor.setState({project:before,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([before]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
  const reload={...after,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(after.recordingSnapshots)))};expectDrawing(currentDrawingPresentation(reload),wanted);
 });
 it('keeps unchanged source style and the opposite ink end live after joining',()=>{
  const {after}=joined(fixture()),w=after.recordingSnapshots!,curve=w.library.curves[bid('curve')];curve.width=.04;curve.inkEnds![0]={taper:.07,extension:.02};curve.inkEnds![1]={taper:.09,extension:.05,taperWidthScale:9};
  const actual=currentDrawingPresentation(after),got=actual.curves.find(value=>value.id===bid('curve'))!;expect(got.width).toBe(.04);expect(got.inkEnds).toEqual([{taper:.07,extension:.02},{taper:0,extension:0}]);
  const snapshot=drawingSnapshotForArtwork(w,'A')!,child=emptyRecordingSnapshot('child');child.layers=[{kind:'reference',id:'child-layer',name:'Child',baseSnapshotId:snapshot.id,baseLayerId:bid('layer')}];w.snapshots.push(child);
  expect(resolveSnapshot(w,child.id).drawing.curves.find(value=>value.id===bid('curve'))!.inkEnds).toEqual(got.inkEnds);
  const copy=prepareIndependentSnapshotLayers(w,snapshot,[bid('layer')],()=> 'fresh-copy'),copyDrawing=resolveSnapshot({...w,library:copy.library,snapshots:[...w.snapshots,copy.snapshot]},copy.snapshot.id).drawing;
  expect(copyDrawing.curves.find(value=>value.id===copy.idMap[bid('curve')])!.inkEnds).toEqual(got.inkEnds);expect(copyDrawing.curves.find(value=>value.id===copy.idMap.pen)!.width).toBe(.008);
  const reloaded=currentDrawingPresentation({...after,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(w)))});expect(createEndpointPairOnionInkCache().resolve(actual).curves).toEqual(createEndpointPairOnionInkCache().resolve(reloaded).curves);
 });
 it('keeps an inherited canonical node when the locally owned endpoint is clicked first',()=>{
  const before=fixture(),{after,wanted}=joined(before,'POSITION',true),actual=currentDrawingPresentation(after);
  expect(nodeAt(actual,fixed).id).toBe(nodeAt(currentDrawingPresentation(before),fixed).id);expect(nodeAt(actual,moving).id).toBe(nodeAt(actual,fixed).id);expect(nodeAt(actual,fixed).position).toEqual(nodeAt(wanted,fixed).position);
  expect(after.recordingSnapshots!.library.curves[bid('curve')]).toEqual(before.recordingSnapshots!.library.curves[bid('curve')]);expect(actual.curves.find(value=>value.id===bid('curve'))!.profile).toBeUndefined();expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!.deformation.layers[bid('layer')].curveAppearance?.[bid('curve')].profile).toBeNull();
 });
 it('lets reference width edits use the same sparse local authority and diagnoses unsupported fields atomically',()=>{
  const before=fixture(),drawing=currentDrawingPresentation(before),after=prepareDrawingSnapshotEdit(before,widthChange(drawing,[bid('curve')],.03)).project;expect(currentDrawingPresentation(after).curves.find(value=>value.id===bid('curve'))!.width).toBe(.03);expect(after.recordingSnapshots!.library).toEqual(before.recordingSnapshots!.library);
  const wanted=connect(drawing,fixed,moving,'POSITION');wanted.curves.find(value=>value.id===bid('curve'))!.locked=true;expect(()=>prepareDrawingSnapshotEdit(before,wanted)).toThrow(/unsupported local fields: locked/);expect(currentDrawingPresentation(before)).toEqual(drawing);
 });
 it('preserves saved, inherited and draft appearance fields without duplicating untouched properties',()=>{
  const before=fixture(),w=before.recordingSnapshots!,snapshot=drawingSnapshotForArtwork(w,'A')!;snapshot.deformation.layers[bid('layer')]={curveAppearance:{[bid('curve')]:{width:.025,inkEnds:{start:{taper:.1}}}}};snapshot.draft={angle:snapshot.angle,deformation:{warps:[],bindings:[],layers:{[bid('layer')]:{curveAppearance:{[bid('curve')]:{profile:null}}}},relationPositions:{}},channels:[]};
  const saved=structuredClone(snapshot.deformation),current=resolveSnapshot(w,snapshot.id).drawing,target=connect(current,fixed,moving,'POSITION'),next=prepareSnapshotLocalDrawingEdit(w,{snapshotId:snapshot.id,state:'active-draft',beforeDrawing:current,drawing:target}).workspace;
  expect(next.snapshots.find(value=>value.id===snapshot.id)!.deformation).toEqual(saved);expectDrawing(resolveSnapshot(next,snapshot.id).drawing,target);expect(resolveSnapshot(next,snapshot.id,{useDraft:false}).drawing.curves.find(value=>value.id===bid('curve'))!.profile).toBe('EYELID');
 });
 it('remaps sparse outer ink on a later ordinary split without copying it onto the new seam',()=>{
  const {after}=joined(fixture()),plan=prepareDrawingCurveSplit(after,bid('curve'),.4),snapshot=drawingSnapshotForArtwork(plan.project.recordingSnapshots!,'A')!,map=snapshot.deformation.layers[bid('layer')].curveAppearance!,drawing=currentDrawingPresentation(plan.project);
  expect(map[plan.ids[0]].inkEnds).toEqual({});expect(map[plan.ids[1]].inkEnds).toEqual({end:{taper:0,extension:0,taperWidthScale:null,interior:null}});expect(drawing.curves.find(value=>value.id===plan.ids[0])!.inkEnds?.[1]).toEqual({});expect(drawing.curves.find(value=>value.id===plan.ids[1])!.inkEnds?.[1]).toEqual({taper:0,extension:0});
 });
 it('keeps connected source follower ink local for explicit mixed-layer relation commands',()=>{
  const before=fixture(),drawing=currentDrawingPresentation(before),next=linkEndpoints(drawing,{curveId:'curve',end:1},fixed),view=drawingSnapshotPresentation(before.recordingSnapshots!,'A')!,intent=createSnapshotRelationAuthoringIntent(view.snapshotId,drawing,next),after=prepareDrawingSnapshotEdit(before,next,intent).project;
  expectDrawing(currentDrawingPresentation(after),next);expect(after.drawing).toBe(before.drawing);expect(after.recordingSnapshots!.library).toEqual(before.recordingSnapshots!.library);expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!.deformation.layers[canonicalElementId('A','layer')].curveAppearance).toBeDefined();
 });
 it('rejects malformed values and preserves explicit optional clears across state merge',()=>{
  for(const patch of [{curve:{width:null}},{curve:{width:2}},{curve:{nodes:['a','b']}},{curve:{inkEnds:{start:{taper:-1}}}},{curve:{inkEnds:{end:{unknown:1}}}}])expect(()=>validateSnapshotCurveAppearance(patch)).toThrow(/appearance override/);
  expect(mergeSnapshotCurveAppearance({curve:{width:.02,profile:'EYELID',inkEnds:{start:{taper:.04}}}},{curve:{profile:null,inkEnds:{end:{extension:0}}}})).toEqual({curve:{width:.02,profile:null,inkEnds:{start:{taper:.04},end:{extension:0}}}});
 });
});

const browserFixture=process.env.SNAPSHOT_CURVE_APPEARANCE_FIXTURE??new URL('../../../artifacts/triangulated-recorder-qa/v63-reference-relation-browser-save.json',import.meta.url).pathname;
it.skipIf(!existsSync(browserFixture))('replays real saved Drawing mouth P1 → new curve P1 bind with every original source item unchanged',()=>{
 const project=parseLandmarks(readFileSync(browserFixture,'utf8')),before=currentDrawingPresentation(project),curveId='e5ef90fc-3189-428f-98e6-5b92723e420f',mouthId=canonicalElementId('1818859f-0eca-4acb-ad48-4e27b439df68','823d4140-276a-40a6-b633-f700d90b4b48'),a={curveId:mouthId,end:0 as const},b={curveId,end:0 as const};
 expect(before.curves.find(curve=>curve.id===curveId)?.width).toBe(.008);expect(before.curves.find(curve=>curve.id===mouthId)?.width).toBe(.008);
 const wanted=connect(before,a,b,'POSITION'),plan=prepareDrawingSnapshotEdit(project,wanted),after=plan.project,actual=currentDrawingPresentation(after);expectDrawing(actual,wanted);expect(nodeAt(actual,a).id).toBe(nodeAt(actual,b).id);
 expect(after.drawing).toBe(project.drawing);expect(after.drawingSnapshots).toEqual(project.drawingSnapshots);expect(after.drawingWorkingCopies).toEqual(project.drawingWorkingCopies);
 for(const source of project.recordingSnapshots!.snapshots.filter(snapshot=>snapshot.source?.artworkId!==project.drawingSnapshots!.activeId))expect(after.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id===source.id)).toEqual(source);
 for(const kind of ['nodes','curves','fills','offsets'] as const)for(const [id,value] of Object.entries(project.recordingSnapshots!.library[kind]))if(kind!=='curves'||id!==curveId)expect(after.recordingSnapshots!.library[kind][id]).toEqual(value);
 const reload=parseLandmarks(JSON.stringify(after));expectDrawing(currentDrawingPresentation(reload),wanted);useWorkspaceMode.setState({mode:'drawing'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
 if(process.env.SNAPSHOT_CURVE_APPEARANCE_OUTPUT)writeFileSync(process.env.SNAPSHOT_CURVE_APPEARANCE_OUTPUT,JSON.stringify(after));
},120000);
