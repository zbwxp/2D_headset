import {afterEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {emptyDrawing,shapeOf,type Cubic,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {createCurve,moveHandle,connect} from '../domain/drawing/commands';
import {createLayerDomainIntent,layerSimilarityValue} from '../domain/drawing/layerDomainIntent';
import {applyLayerEditIntent,mapLayerEditIntent} from '../domain/drawing/layerEditIntent';
import {derivedUses} from '../domain/drawing/roundedJoin';
import {strokeFor} from '../domain/drawing/strokes';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,syncRecordingSnapshotSources} from '../domain/recordingSnapshot/sources';
import {captureSnapshotLayerClipboard} from '../domain/recordingSnapshot/referenceClipboard';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {createWarpGrid} from '../domain/vectorWarp/model';
import {identityScenePlacement} from '../domain/recordingScene/model';
import {applyScenePlacement,composePlacementSimilarity} from '../domain/recordingScene/tracks';
import {currentDrawingPresentation} from '../ui/drawing/snapshotPresentation';
import {prepareDrawingLayerReferencePaste} from '../ui/drawing/layerReferenceClipboard';
import {commitDrawingSnapshotEdit,prepareDrawingSnapshotEdit,prepareDrawingLayerDomainEdit} from '../ui/drawing/snapshotEditContext';
import {layerSimilarityIntentForSelection} from '../ui/drawing/layerDomainGesture';

const editor=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(editor,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();});
const bid=(id:string)=>canonicalElementId('B',id);
const near=(a:Point2,b:Point2)=>a.forEach((value,i)=>expect(value).toBeCloseTo(b[i],9));
function fixture(other?:DrawingDocument){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.3,.1],[.7,.1]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}]};
 other??=moveHandle(drawing,{curveId:'curve',end:0},[.3,.6]);
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing,drawingSnapshots:{version:1 as const,activeId:'A',images:[],items:[{id:'A',name:'A',drawing},{id:'B',name:'B',drawing:other}]}}),b=drawingSnapshotForArtwork(project.recordingSnapshots,'B')!;
 const clip=captureSnapshotLayerClipboard('test','reference',[{snapshotId:b.id,layerIds:b.layers.map(layer=>layer.id)}]);
 return {project:prepareDrawingLayerReferencePaste(project,clip,'test').project,drawing,other};
}
const local=(project:ReturnType<typeof fixture>['project'])=>drawingSnapshotForArtwork(project.recordingSnapshots!,'A')!.deformation.layers[bid('layer')];

test('only explicit complete layer selection carries a domain, not coincident all-curves or control selection',()=>{
 const {project}=fixture(),drawing=currentDrawingPresentation(project),value=layerSimilarityValue([.2,.3]),ids=[bid('curve')];
 expect(layerSimilarityIntentForSelection(drawing,{ids},value)).toBeUndefined();
 expect(layerSimilarityIntentForSelection(drawing,{ids,layer:bid('layer'),node:bid('a')},value)).toBeUndefined();
 expect(layerSimilarityIntentForSelection(drawing,{ids:[],layer:bid('layer')},value)).toBeUndefined();
 const intent=layerSimilarityIntentForSelection(drawing,{ids,layer:bid('layer')},value)!;
 expect(intent.scope).toEqual({kind:'layers',layerIds:[bid('layer')]});expect(intent.domain.value).toEqual(value);
 expect(mapLayerEditIntent(intent,id=>'mapped:'+id).kind).toBe('layer-domain');
 expect(()=>createLayerDomainIntent([bid('layer')],{...value,scaleX:2})).toThrow(/positive similarity/);
});

test('direct handle offsets stay sparse and later source curves inherit layer similarity plus Warp with zero new response',()=>{
 const f=fixture(),view=currentDrawingPresentation(f.project),direct=prepareDrawingSnapshotEdit(f.project,moveHandle(view,{curveId:bid('curve'),end:0},[.3,.9])).project;
 const workspace=structuredClone(direct.recordingSnapshots!),a=drawingSnapshotForArtwork(workspace,'A')!,restGrid=createWarpGrid({min:[-1,-1],max:[2,2]},1,1),grid=structuredClone(restGrid);
 for(const node of grid.nodes)for(const field of ['position','handleU','handleV'] as const){node[field][0]+=.2;node[field][1]+=.3;}
 a.deformation.warps=[{id:'warp',name:'Warp',restGrid,grid}];a.deformation.bindings=[{layerId:bid('layer'),warpId:'warp'}];
 const before={...direct,recordingSnapshots:workspace},savedShape=structuredClone(local(before).shape),value=layerSimilarityValue([.4,-.1],30,1.7,[.2,.3]),intent=createLayerDomainIntent([bid('layer')],value),plan=prepareDrawingLayerDomainEdit(before,intent);
 expect(plan.project.drawing).toBe(before.drawing);expect(plan.project.recordingSnapshots!.library).toEqual(before.recordingSnapshots!.library);expect(local(plan.project).shape).toEqual(savedShape);
 const newShape:Cubic=[[0,1],[.3,1],[.7,1],[1,1]],updated=createCurve(f.other,'layer',newShape,.02,'New','new'),live=syncRecordingSnapshotSources({...plan.project,drawingWorkingCopies:{B:updated}}),actual=currentDrawingPresentation(live);
 shapeOf(actual,bid('new')).forEach((point,i)=>near(point,applyScenePlacement(value,[newShape[i][0]+.2,newShape[i][1]+.3])));
 expect(local(live).shape).toEqual(savedShape);expect(Object.keys(local(live).shape!.handles)).toEqual([bid('curve')]);
 const reloaded={...live,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(live.recordingSnapshots)))};
 shapeOf(currentDrawingPresentation(reloaded),bid('new')).forEach((point,i)=>near(point,shapeOf(actual,bid('new'))[i]));
});

test('mixed whole-layer transform changes original geometry and referenced placement in one Undo',()=>{
 const f=fixture(),before=f.project,view=currentDrawingPresentation(before),value=layerSimilarityValue([.4,.2],24,1.3,[.5,.5]),intent=createLayerDomainIntent(['layer',bid('layer')],value),plan=prepareDrawingLayerDomainEdit(before,intent);
 shapeOf(plan.project.drawing!,'curve').forEach((point,i)=>near(point,shapeOf(applyLayerEditIntent(f.drawing,createLayerDomainIntent(['layer'],value)).document,'curve')[i]));
 expect(local(plan.project).shape).toBeUndefined();expect(local(plan.project).placement).toEqual(value);
 for(const id of ['curve',bid('curve')])shapeOf(plan.drawing,id).forEach((point,i)=>near(point,applyScenePlacement(value,shapeOf(view,id)[i])));
 vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project:before,past:[],future:[]});
 commitDrawingSnapshotEdit(useEditor.getState(),plan.drawing,intent);vi.runAllTimers();const after=useEditor.getState().project;
 expect(useEditor.getState().past).toEqual([before]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
 expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'B')).toEqual(drawingSnapshotForArtwork(before.recordingSnapshots!,'B'));
});

test.each([0,.5])('similarity composes after existing local axes (X=%s), keeping source, element placement and shape data',scaleX=>{
 const f=fixture(),workspace=structuredClone(f.project.recordingSnapshots!),a=drawingSnapshotForArtwork(workspace,'A')!,base={...identityScenePlacement(),translation:[.2,.1] as Point2,rotation:27,scaleX,scaleY:2};
 a.deformation.layers[bid('layer')]={placement:base,elementPlacements:{[bid('curve')]:{...identityScenePlacement(),rotation:19}},shape:{nodes:{[bid('a')]:[.1,.1]},handles:{}}};
 const project={...f.project,recordingSnapshots:workspace},before=currentDrawingPresentation(project),value=layerSimilarityValue([.3,.2],-18,1.4,[.1,.5]),plan=prepareDrawingLayerDomainEdit(project,createLayerDomainIntent([bid('layer')],value));
 expect(local(plan.project)).toEqual({...local(project),placement:composePlacementSimilarity(base,value)});expect(local(plan.project).placement!.scaleX).toBe(scaleX*1.4);
 shapeOf(plan.drawing,bid('curve')).forEach((point,i)=>near(point,applyScenePlacement(value,shapeOf(before,bid('curve'))[i])));expect(plan.project.recordingSnapshots!.library).toEqual(project.recordingSnapshots!.library);
});

test.each(['SMOOTH','ARC'] as const)('existing %s relations and evaluated material follow the shared placement evaluator',kind=>{
 let other=fixture().other;other=createCurve(other,'layer',[[1,0],[1.3,0],[1,1],[1,1.3]],.01,'Second','second');other=connect(other,{curveId:'curve',end:1},{curveId:'second',end:0},kind,.1);
 const f=fixture(other),workspace=structuredClone(f.project.recordingSnapshots!),a=drawingSnapshotForArtwork(workspace,'A')!;a.deformation.layers[bid('layer')]={placement:{...identityScenePlacement(),rotation:12,scaleX:.5,scaleY:1.8}};
 const project={...f.project,recordingSnapshots:workspace},before=currentDrawingPresentation(project),path=strokeFor(before,bid('curve')),geometry=derivedUses(before,path.segments),value=layerSimilarityValue([.2,.3],23,1.6),plan=prepareDrawingLayerDomainEdit(project,createLayerDomainIntent([bid('layer')],value)),after=derivedUses(plan.drawing,path.segments);
 expect(after.shapes.length).toBe(geometry.shapes.length);after.shapes.forEach((shape,i)=>shape.forEach((point,j)=>near(point,applyScenePlacement(value,geometry.shapes[i][j]))));expect(local(plan.project).shape).toBeUndefined();
 expect(plan.project.recordingSnapshots!.library).toEqual(project.recordingSnapshots!.library);
});

test('linked reference layers transform coherently; partial domains reject atomically',()=>{
 const f=fixture(),other:DrawingDocument={...f.other,nodes:[...f.other.nodes,{id:'c',position:[1,0]},{id:'d',position:[2,0]}],curves:[...f.other.curves,{...f.other.curves[0],id:'second',nodes:['c','d'],handles:[[1.3,0],[1.7,0]]}],layers:[...f.other.layers,{id:'second-layer',name:'Second',visible:true,locked:false,items:['second']}],endpointLinks:[{id:'link',a:{curveId:'curve',end:1},b:{curveId:'second',end:0}}]},base=fixture(other).project,value=layerSimilarityValue([.2,.3],20,1.1),json=JSON.stringify(base);
 expect(()=>prepareDrawingLayerDomainEdit(base,createLayerDomainIntent([bid('layer')],value))).toThrow(/every linked referenced layer/);expect(JSON.stringify(base)).toBe(json);
 const plan=prepareDrawingLayerDomainEdit(base,createLayerDomainIntent([bid('layer'),bid('second-layer')],value));
 near(plan.drawing.nodes.find(node=>node.id===bid('b'))!.position,plan.drawing.nodes.find(node=>node.id===bid('c'))!.position);
 expect(local(plan.project).shape).toBeUndefined();
});

test('a subsequent direct handle edit remains one element and inverse-maps through the retained layer domain',()=>{
 const f=fixture(),value=layerSimilarityValue([.2,.3],20,1.5),first=prepareDrawingLayerDomainEdit(f.project,createLayerDomainIntent([bid('layer')],value)),wanted=moveHandle(first.drawing,{curveId:bid('curve'),end:0},[.7,.8]),edited=prepareDrawingSnapshotEdit(first.project,wanted).project;
 near(currentDrawingPresentation(edited).curves.find(curve=>curve.id===bid('curve'))!.handles[0],[.7,.8]);expect(local(edited).placement).toEqual(local(first.project).placement);expect(Object.keys(local(edited).shape!.handles)).toEqual([bid('curve')]);
 const shape:Cubic=[[0,1],[.3,1],[.7,1],[1,1]],live=syncRecordingSnapshotSources({...edited,drawingWorkingCopies:{B:createCurve(f.other,'layer',shape,.01,'New','new')}});
 shapeOf(currentDrawingPresentation(live),bid('new')).forEach((point,i)=>near(point,applyScenePlacement(value,shape[i])));
});

test('an empty referenced layer retains its domain for its first member and a zero-delta intent adds no Undo',()=>{
 const f=fixture({...emptyDrawing(),layers:[{id:'layer',name:'Empty',visible:true,locked:false,items:[]}]}),value=layerSimilarityValue([.3,.2],15,1.4),plan=prepareDrawingLayerDomainEdit(f.project,createLayerDomainIntent([bid('layer')],value));
 expect(local(plan.project).placement).toEqual(value);expect(local(plan.project).shape).toBeUndefined();
 const shape:Cubic=[[0,1],[.3,1],[.7,1],[1,1]],live=syncRecordingSnapshotSources({...plan.project,drawingWorkingCopies:{B:createCurve(f.other,'layer',shape,.01,'First','first')}});
 shapeOf(currentDrawingPresentation(live),bid('first')).forEach((point,i)=>near(point,applyScenePlacement(value,shape[i])));
 expect(prepareDrawingLayerDomainEdit(live,createLayerDomainIntent([bid('layer')],identityScenePlacement())).project).toBe(live);
});

test('mismatched domain previews fail atomically before store history changes',()=>{
 const f=fixture(),intent=createLayerDomainIntent([bid('layer')],layerSimilarityValue([.2,.3]));
 vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project:f.project,past:[],future:[]});
 expect(()=>commitDrawingSnapshotEdit(useEditor.getState(),currentDrawingPresentation(f.project),intent)).toThrow(/no longer agree/);expect(useEditor.getState().project).toBe(f.project);expect(useEditor.getState().past).toEqual([]);
});
