import {afterEach,expect,test,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import DrawingRoom from '../ui/drawing/DrawingRoom';
import {useDrawing} from '../ui/drawing/session';
import {createEmptyProject} from '../app/emptyProject';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {prepareSnapshotEdit,snapshotEditContext} from '../app/snapshotEditTransaction';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {emptyDrawing,shapeOf,type Cubic,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {createCurve,moveHandle,connect} from '../domain/drawing/commands';
import {createLayerDomainIntent,createLayerAffineIntent,layerSimilarityValue} from '../domain/drawing/layerDomainIntent';
import {applyAffine2D,composeAffine2D,type Affine2D} from '../domain/geometry/affine2d';
import {applyLayerEditIntent,mapLayerEditIntent} from '../domain/drawing/layerEditIntent';
import {derivedUses} from '../domain/drawing/roundedJoin';
import {strokeFor} from '../domain/drawing/strokes';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,syncRecordingSnapshotSources} from '../domain/recordingSnapshot/sources';
import {captureSnapshotLayerClipboard} from '../domain/recordingSnapshot/referenceClipboard';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {createWarpGrid} from '../domain/vectorWarp/model';
import {identityScenePlacement} from '../domain/recordingScene/model';
import {applyScenePlacement,composePlacementSimilarity,placementMatrix} from '../domain/recordingScene/tracks';
import {currentDrawingPresentation} from '../ui/drawing/snapshotPresentation';
import {prepareDrawingLayerReferencePaste} from '../ui/drawing/layerReferenceClipboard';
import {commitDrawingSnapshotEdit,prepareDrawingSnapshotEdit,prepareDrawingLayerDomainEdit} from '../ui/drawing/snapshotEditContext';
import {layerSimilarityIntentForSelection} from '../ui/drawing/layerDomainGesture';

// Server rendering reads Zustand's initial snapshot; use the test's current state.
vi.mock('../app/store',async importOriginal=>{const module=await importOriginal<typeof import('../app/store')>();return {...module,useEditor:Object.assign((selector?:(state:ReturnType<typeof module.useEditor.getState>)=>unknown)=>selector?selector(module.useEditor.getState()):module.useEditor.getState(),module.useEditor)};});
vi.mock('../ui/drawing/session',async importOriginal=>{const module=await importOriginal<typeof import('../ui/drawing/session')>();return {...module,useDrawing:Object.assign((selector?:(state:ReturnType<typeof module.useDrawing.getState>)=>unknown)=>selector?selector(module.useDrawing.getState()):module.useDrawing.getState(),module.useDrawing)};});

const editor=useEditor.getState(),mode=useWorkspaceMode.getState().mode,drawingSession=useDrawing.getState();
afterEach(()=>{useEditor.setState(editor,true);useDrawing.setState(drawingSession,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();});
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

function value<T>(result:VectorResult<T>):T {expect(result.ok,result.ok?'':result.error.message).toBe(true);if(!result.ok)throw Error(result.error.message);return result.value;}
function apiEditor(project:ReturnType<typeof fixture>['project']) {
 vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project,past:[],future:[]});return createVectorEditingApi();
}

test('UI, app transaction and explicit layer API use the same owner-resolving similarity plan',()=>{
 const f=fixture(),similarity=layerSimilarityValue([.25,-.125],0,1.5),intent=createLayerDomainIntent([bid('layer')],similarity),ui=prepareDrawingLayerDomainEdit(f.project,intent),app=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'layer-domain',intent});
 expect(app.project).toEqual(ui.project);expect(app.changed).toBe(true);
 const api=apiEditor(f.project),result=value(api.execute({commands:[{op:'transformLayers',layerIds:[bid('layer')],matrix:placementMatrix(similarity)}]})),after=useEditor.getState().project;
 expect(after).toEqual(ui.project);expect(result.domainIntents).toMatchObject([{kind:intent.kind,scope:intent.scope,domain:intent.domain}]);expect(result.beforeAfter.map(curve=>curve.curveId)).toEqual([bid('curve')]);expect(result.curveIds).toEqual([bid('curve')]);expect(after.drawing).toBe(f.project.drawing);expect(useEditor.getState().past).toEqual([f.project]);
 value(api.undo());expect(useEditor.getState().project).toBe(f.project);value(api.redo());expect(useEditor.getState().project).toBe(after);
});

test('layer API preserves pending source commands and commands after domains in a single candidate and Undo',()=>{
 const f=fixture(),api=apiEditor(f.project),result=value(api.execute({commands:[
  {op:'renameCurve',curveId:'curve',name:'Renamed source'},
  {op:'moveHandle',curveId:'curve',end:0,position:[.3,.8]},
  {op:'transformLayers',layerIds:['layer',bid('layer')],matrix:[2,0,0,2,.2,.3]},
  {op:'createCurve',layerId:'layer',shape:[[0,1],[.3,1],[.7,1],[1,1]],name:'Later curve',ref:'later'},
  {op:'transformLayers',layerIds:[bid('layer')],matrix:[1,0,0,1,.1,-.1]},
  {op:'renameCurve',curveId:'$later',name:'Still editable'},
 ]})),after=useEditor.getState().project,view=currentDrawingPresentation(after),newCurve=after.drawing!.curves.find(curve=>curve.name==='Still editable')!;
 expect(result.created).toHaveLength(1);expect(newCurve).toBeDefined();expect(after.drawing!.curves.find(curve=>curve.id==='curve')!.name).toBe('Renamed source');near(after.drawing!.curves.find(curve=>curve.id==='curve')!.handles[0],[.8,1.9]);
 expect(after.drawing!.curves.some(curve=>curve.id===bid('curve'))).toBe(false);near(shapeOf(view,bid('curve'))[0],[.3,.2]);expect(local(after).shape).toBeUndefined();expect(useEditor.getState().past).toEqual([f.project]);
});

test('API layer domains remain live for later source members without creating new direct corrections',()=>{
 const f=fixture(),view=currentDrawingPresentation(f.project),direct=prepareDrawingSnapshotEdit(f.project,moveHandle(view,{curveId:bid('curve'),end:0},[.3,.9])).project,api=apiEditor(direct),similarity=layerSimilarityValue([.2,.3],24,1.4);
 value(api.execute({commands:[{op:'transformLayers',layerIds:[bid('layer')],matrix:placementMatrix(similarity)}]}));const after=useEditor.getState().project,shape:Cubic=[[0,1],[.3,1],[.7,1],[1,1]],live=syncRecordingSnapshotSources({...after,drawingWorkingCopies:{B:createCurve(f.other,'layer',shape,.01,'New','new')}});
 shapeOf(currentDrawingPresentation(live),bid('new')).forEach((point,i)=>near(point,applyScenePlacement(similarity,shape[i])));expect(local(live).shape).toEqual(local(direct).shape);
});

test('API domain dry-runs return visible changes without mutation and later failed commands roll back the whole batch',()=>{
 const f=fixture(),api=apiEditor(f.project),command={op:'transformLayers' as const,layerIds:[bid('layer')],matrix:[1,0,0,1,.4,.2] as [number,number,number,number,number,number]},result=value(api.execute({commands:[command],dryRun:true}));
 expect(result).toMatchObject({changed:true,applied:false,dryRun:true});expect(result.beforeAfter[0].curveId).toBe(bid('curve'));expect(useEditor.getState().project).toBe(f.project);expect(useEditor.getState().past).toEqual([]);
 const failed=api.execute({commands:[{op:'renameCurve',curveId:'curve',name:'Discard this'},command,{op:'moveHandle',curveId:'missing',end:0,position:[0,0]}]});
 expect(failed).toMatchObject({ok:false,error:{code:'NOT_FOUND',commandIndex:2}});expect(useEditor.getState().project).toBe(f.project);expect(useEditor.getState().past).toEqual([]);
});

test.each(([[2,0,0,1,0,0],[-1,0,0,1,0,0],[0,0,0,1,0,0],[0,0,0,0,.2,.3],[1,.3,.7,1,.2,.1]] as Affine2D[]).map(matrix=>({matrix})))('referenced API affine $matrix persists exact parameters and restores its retained input',({matrix})=>{
 const f=fixture(),api=apiEditor(f.project),before=currentDrawingPresentation(f.project),result=value(api.execute({commands:[{op:'transformLayers',layerIds:[bid('layer')],matrix}]})),after=useEditor.getState().project,view=currentDrawingPresentation(after),domainId=result.domainIntents![0].operationId;
 expect(after.drawing).toBe(f.project.drawing);expect(after.recordingSnapshots!.library).toEqual(f.project.recordingSnapshots!.library);expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!.deformation.layerDomains).toEqual([{id:domainId,layerIds:[bid('layer')],matrix}]);
 shapeOf(view,bid('curve')).forEach((point,i)=>near(point,applyAffine2D(matrix,shapeOf(before,bid('curve'))[i])));expect(useEditor.getState().past).toEqual([f.project]);
 const shape:Cubic=[[0,1],[.3,1],[.7,1],[1,1]],live=syncRecordingSnapshotSources({...after,drawingWorkingCopies:{B:createCurve(f.other,'layer',shape,.01,'New','new')}});shapeOf(currentDrawingPresentation(live),bid('new')).forEach((point,i)=>near(point,applyAffine2D(matrix,shape[i])));
 value(api.execute({commands:[{op:'setLayerDomain',domainId,enabled:false}]}));const restored=currentDrawingPresentation(useEditor.getState().project);shapeOf(restored,bid('curve')).forEach((point,i)=>near(point,shapeOf(before,bid('curve'))[i]));
 value(api.execute({commands:[{op:'setLayerDomain',domainId,enabled:true,matrix:[1,0,0,1,.7,.3]}]}));const changed=useEditor.getState().project;expect(drawingSnapshotForArtwork(changed.recordingSnapshots!,'A')!.deformation.layerDomains).toHaveLength(1);shapeOf(currentDrawingPresentation(changed),bid('curve')).forEach((point,i)=>near(point,applyAffine2D([1,0,0,1,.7,.3],shapeOf(before,bid('curve'))[i])));
});

test('ordered affine and later similarity domains preserve composition, live source edits and JSON roundtrip',()=>{
 const f=fixture(),api=apiEditor(f.project),a:Affine2D=[2,.3,.4,-1,.2,.1],b:Affine2D=[0,1,-1,0,.4,.2],c:Affine2D=[1,0,0,1,.3,.4];
 value(api.execute({commands:[{op:'transformLayers',layerIds:[bid('layer')],matrix:a},{op:'transformLayers',layerIds:[bid('layer')],matrix:b},{op:'transformLayers',layerIds:[bid('layer')],matrix:c}]}));const after=useEditor.getState().project,domains=drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!.deformation.layerDomains!;
 expect(JSON.stringify(domains.map(domain=>domain.matrix))).toBe(JSON.stringify([a,b,c]));expect(new Set(domains.map(domain=>domain.id)).size).toBe(3);const matrix=composeAffine2D(c,composeAffine2D(b,a)),before=currentDrawingPresentation(f.project);
 shapeOf(currentDrawingPresentation(after),bid('curve')).forEach((point,i)=>near(point,applyAffine2D(matrix,shapeOf(before,bid('curve'))[i])));
 const reloaded={...after,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(after.recordingSnapshots)))};expect(currentDrawingPresentation(reloaded).curves).toEqual(currentDrawingPresentation(after).curves);
});

test('Drawing control edits inverse-map the full affine chain and singular controls refuse until reset',()=>{
 const f=fixture(),matrix:Affine2D=[1,.3,.5,-1,.2,.4],plan=prepareDrawingLayerDomainEdit(f.project,createLayerAffineIntent([bid('layer')],matrix)),wanted=moveHandle(plan.drawing,{curveId:bid('curve'),end:0},[.6,.8]),edited=prepareDrawingSnapshotEdit(plan.project,wanted).project;
 near(currentDrawingPresentation(edited).curves.find(curve=>curve.id===bid('curve'))!.handles[0],[.6,.8]);expect(Object.keys(local(edited).shape!.handles)).toEqual([bid('curve')]);
 const zero=prepareDrawingLayerDomainEdit(edited,createLayerAffineIntent([bid('layer')],[0,0,0,1,0,0]));expect(()=>prepareDrawingSnapshotEdit(zero.project,moveHandle(zero.drawing,{curveId:bid('curve'),end:0},[.2,.8]))).toThrow(/Restore or disable/);
 const id=drawingSnapshotForArtwork(zero.project.recordingSnapshots!,'A')!.deformation.layerDomains!.at(-1)!.id,restored=prepareDrawingLayerDomainEdit(zero.project,createLayerAffineIntent([bid('layer')],[0,0,0,1,0,0],{operationId:id,replace:true,enabled:false}));near(restored.drawing.curves.find(curve=>curve.id===bid('curve'))!.handles[0],[.6,.8]);
});

test('common app domain entry enforces original ownership and a limited host cannot silently discard reference state',()=>{
 const f=fixture(),similarity=layerSimilarityValue([.2,.3]),intent=createLayerDomainIntent([bid('layer')],similarity);
 expect(prepareSnapshotEdit(snapshotEditContext(f.project,false),{kind:'layer-domain',intent}).project.drawing).toBe(f.project.drawing);
 expect(()=>prepareSnapshotEdit(snapshotEditContext(f.project,false),{kind:'layer-domain',intent:createLayerDomainIntent(['layer'],similarity)})).toThrow(/Drawing-owned original/);
 const commitDrawing=vi.fn(),api=createVectorEditingApi({getState:()=>({project:f.project,past:[],future:[]}),getMode:()=> 'drawing',commitDrawing,undo(){},redo(){}}),result=api.execute({commands:[{op:'transformLayers',layerIds:[bid('layer')],matrix:placementMatrix(similarity)}]});
 expect(result).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});expect(commitDrawing).not.toHaveBeenCalled();
});

test('source layer API retains normal endpoint-link behavior and only moves the linked boundary controls',()=>{
 const f=fixture(),drawing:DrawingDocument={...f.drawing,nodes:[...f.drawing.nodes,{id:'c',position:[1,0]},{id:'d',position:[2,0]}],curves:[...f.drawing.curves,{...f.drawing.curves[0],id:'second',nodes:['c','d'],handles:[[1.3,0],[1.7,0]]}],layers:[...f.drawing.layers,{id:'second-layer',name:'Second',visible:true,locked:false,items:['second']}],endpointLinks:[{id:'link',a:{curveId:'curve',end:1},b:{curveId:'second',end:0}}]},project=syncRecordingSnapshotSources({...f.project,drawing}),api=apiEditor(project),command={op:'transformLayers' as const,layerIds:['layer'],matrix:[1,0,0,1,.2,.3] as [number,number,number,number,number,number]};
 value(api.execute({commands:[command]}));const after=useEditor.getState().project.drawing!;
 near(shapeOf(after,'second')[0],[1.2,.3]);near(shapeOf(after,'second')[1],[1.5,.3]);near(shapeOf(after,'second')[2],[1.7,0]);near(shapeOf(after,'second')[3],[2,0]);
});

test('a referenced layer domain does not erase preceding explicit mirror intentions in the same API batch',()=>{
 const f=fixture(),drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[-1,0]},{id:'b',position:[-.5,0]},{id:'c',position:[1,0]},{id:'d',position:[.5,0]}],curves:[{...f.drawing.curves[0],id:'left',nodes:['a','b'],handles:[[-.9,.2],[-.6,.2]]},{...f.drawing.curves[0],id:'right',nodes:['c','d'],handles:[[.9,.2],[.6,.2]]}],layers:[{id:'layer',name:'Pair',visible:true,locked:false,items:['left','right']}],mirrorEditing:{enabled:true,curvePairs:[{id:'pair',a:'left',b:'right',reverse:false}]}},project=syncRecordingSnapshotSources({...f.project,drawing}),api=apiEditor(project);
 value(api.execute({commands:[{op:'moveNode',nodeId:'a',position:[-1.3,.1]},{op:'transformLayers',layerIds:[bid('layer')],matrix:[1,0,0,1,.2,.3]},{op:'moveNode',nodeId:'c',position:[1.4,.1]}]}));
 const after=useEditor.getState().project.drawing!;near(after.nodes.find(node=>node.id==='a')!.position,[-1.3,.1]);near(after.nodes.find(node=>node.id==='c')!.position,[1.4,.1]);expect(useEditor.getState().past).toEqual([project]);
});

test('the actual Drawing property panel exposes zero-capable dimensions and reset/restore of the saved operation',()=>{
 const f=fixture(),intent=createLayerAffineIntent([bid('layer')],[0,0,0,1,0,0],{operationId:'zero'}),plan=prepareDrawingLayerDomainEdit(f.project,intent);
 apiEditor(plan.project);useDrawing.setState({selection:{ids:[bid('curve')],layers:[bid('layer')],layer:bid('layer')},layerId:bid('layer'),tool:'select'});
 const html=renderToStaticMarkup(createElement(DrawingRoom));expect(html).toContain('data-testid="drawing-layer-domain-controls"');expect(html).toContain('data-domain-id="zero"');expect(html).toContain('min="-1000"');expect(html).toContain('重置变换');
 const restored=prepareDrawingLayerDomainEdit(plan.project,createLayerAffineIntent([bid('layer')],intent.domain.matrix,{operationId:'zero',replace:true,enabled:false}));useEditor.setState({project:restored.project});expect(renderToStaticMarkup(createElement(DrawingRoom))).toContain('恢复变换');
});

test('replacing an earlier domain refuses a newly separated true linked endpoint atomically',()=>{
 const f=fixture(),other:DrawingDocument={...f.other,nodes:[...f.other.nodes,{id:'c',position:[1,0]},{id:'d',position:[2,0]}],curves:[...f.other.curves,{...f.other.curves[0],id:'second',nodes:['c','d'],handles:[[1.3,0],[1.7,0]]}],layers:[...f.other.layers,{id:'second-layer',name:'Second',visible:true,locked:false,items:['second']}],endpointLinks:[{id:'link',a:{curveId:'curve',end:1},b:{curveId:'second',end:0}}]},project=fixture(other).project,snapshot=drawingSnapshotForArtwork(project.recordingSnapshots!,'A')!;
 snapshot.deformation.layerDomains=[{id:'first',layerIds:[bid('layer'),bid('second-layer')],matrix:[1,0,0,1,0,0]},{id:'later',layerIds:[bid('layer')],matrix:[2,0,0,1,-1,0]}];const before=JSON.stringify(project);
 expect(()=>prepareDrawingLayerDomainEdit(project,createLayerAffineIntent([bid('layer'),bid('second-layer')],[1,0,0,1,.5,0],{operationId:'first',replace:true}))).toThrow(/linked|relation/i);expect(JSON.stringify(project)).toBe(before);
});
