import {afterEach,expect,test} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {prepareDrawingSnapshotEdit} from '../app/drawingSnapshotEdit';
import {currentDrawingPresentation,drawingSnapshotPresentation} from '../app/drawingSnapshotPresentation';
import {prepareDrawingLayerReferencePaste} from '../ui/drawing/layerReferenceClipboard';
import {emptyDrawing,shapeOf,nodeAt,type DrawingDocument} from '../domain/drawing/model';
import {createPenCurve,linkEndpoints,moveNode,widthChange} from '../domain/drawing/commands';
import {addDisplayInterval} from '../domain/drawing/displayIntervals';
import {adoptDisplayRoute} from '../domain/drawing/displayRouteAuthoring';
import {createDisplayRouteField} from '../domain/drawing/displayRoutes';
import {setEndpointLinkBrush} from '../domain/drawing/endpointRelationAuthoring';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork} from '../domain/recordingSnapshot/sources';
import {captureSnapshotLayerClipboard} from '../domain/recordingSnapshot/referenceClipboard';
import {parseRecordingSnapshots} from '../domain/recordingSnapshot/persistence';
import {createSnapshotRelationAuthoringIntent} from '../domain/recordingSnapshot/relationAuthoringIntent';
import {createVectorEditingApi,type VectorCommand} from '../app/vectorEditingApi';
const editor=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(editor,true);useWorkspaceMode.getState().setMode(mode);});
const bid=(id:string)=>canonicalElementId('B',id),a={curveId:'curve',end:1 as const},b={curveId:bid('curve'),end:0 as const};
function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[-1,0]},{id:'b',position:[0,0]}],curves:[{id:'curve',name:'A',nodes:['a','b'],handles:[[-.7,0],[-.3,0]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}]};
 const other:DrawingDocument={...drawing,nodes:[{id:'a',position:[.2,.2]},{id:'b',position:[1.2,.2]}],curves:[{...drawing.curves[0],name:'B',handles:[[.5,.2],[.9,.2]]}]};
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing,drawingSnapshots:{version:1,activeId:'A',images:[],items:[{id:'A',name:'A',drawing},{id:'B',name:'B',drawing:other}]}}),source=drawingSnapshotForArtwork(project.recordingSnapshots,'B')!;
 project.recordingSnapshots={...project.recordingSnapshots,recordings:[],activeRecordingId:undefined};
 return prepareDrawingLayerReferencePaste(project,captureSnapshotLayerClipboard('test','reference',[{snapshotId:source.id,layerIds:source.layers.map(layer=>layer.id)}]),'test').project;
}
function relation(project:ReturnType<typeof fixture>,operation:(drawing:DrawingDocument)=>DrawingDocument){
 const before=currentDrawingPresentation(project),next=operation(before),view=drawingSnapshotPresentation(project.recordingSnapshots!,'A')!,intent=createSnapshotRelationAuthoringIntent(view.snapshotId,before,next)!;
 return prepareDrawingSnapshotEdit(project,next,intent);
}
function sameGeometry(actual:DrawingDocument,wanted:DrawingDocument){for(const curve of wanted.curves)expect(shapeOf(actual,curve.id).flat()).toEqual(shapeOf(wanted,curve.id).flat().map(value=>expect.closeTo(value,8)));}
test.each(['reference','original'] as const)('Drawing Pen uses the %s layer owner without a Recorder',owner=>{
 const before=fixture(),view=currentDrawingPresentation(before),layer=owner==='reference'?bid('layer'):'layer',target=createPenCurve(view,layer,[[0,1],[.3,1],[.7,1],[1,1]],.01,'new-pen'),plan=prepareDrawingSnapshotEdit(before,target),after=plan.project,actual=currentDrawingPresentation(after);
 expect(before.recordingSnapshots!.recordings).toEqual([]);sameGeometry(actual,target);expect(after.recordingSnapshots!.recordings).toEqual([]);
 const source=drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!;
 if(owner==='reference'){expect(after.drawing).toBe(before.drawing);expect(after.recordingSnapshots!.library.curves['new-pen']).toBeDefined();expect(source.layers.find(layer=>layer.id===bid('layer'))).toMatchObject({membership:{addElementIds:['new-pen']}});expect(source.source!.originIds).not.toHaveProperty('new-pen');}
 else {expect(after.drawing!.curves.some(curve=>curve.id==='new-pen')).toBe(true);expect(after.recordingSnapshots!.library.curves[canonicalElementId('A','new-pen')]).toBeDefined();}
 expect(after.recordingSnapshots!.library.curves[bid('curve')]).toEqual(before.recordingSnapshots!.library.curves[bid('curve')]);
 expect(()=>parseRecordingSnapshots(JSON.parse(JSON.stringify(after.recordingSnapshots)))).not.toThrow();
});
test.each([false,true])('mixed Drawing EndpointLink keeps its source follower local (%s)',reverse=>{
 const before=fixture(),view=currentDrawingPresentation(before),target=linkEndpoints(view,reverse?b:a,reverse?a:b,true),plan=relation(before,()=>target),after=plan.project,actual=currentDrawingPresentation(after),snapshot=drawingSnapshotForArtwork(after.recordingSnapshots!,'A')!;
 sameGeometry(actual,target);expect(after.drawing).toBe(before.drawing);expect(after.recordingSnapshots!.library).toEqual(before.recordingSnapshots!.library);expect(Object.values(snapshot.deformation.relationPositions)).toHaveLength(1);expect(snapshot.relations.endpointLinks?.add).toHaveLength(1);
 expect(nodeAt(actual,a).id).not.toBe(nodeAt(actual,b).id);expect(nodeAt(actual,a).position).toEqual(nodeAt(actual,b).position);
 useWorkspaceMode.setState({mode:'drawing'});useEditor.setState({project:before,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([before]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
});
test('source interval baseline survives a local mixed route, brush edits and JSON reload',()=>{
 let project=fixture();project=relation(project,d=>addDisplayInterval(d,a.curveId)).project;
 const originalDrawing=structuredClone(project.drawing),snapshot=drawingSnapshotForArtwork(project.recordingSnapshots!,'A')!,baseline=structuredClone(snapshot.relations.displayIntervals!.add),library=structuredClone(project.recordingSnapshots!.library);
 project=relation(project,d=>linkEndpoints(d,b,a,true)).project;
 let target!:DrawingDocument;project=relation(project,d=>target=adoptDisplayRoute(d,d.displayIntervals![0].id,d.endpointLinks![0].id).document).project;sameGeometry(currentDrawingPresentation(project),target);
 for(const brush of [{kind:'SMOOTH' as const},{kind:'ARC' as const,trimDistance:.04}])project=relation(project,d=>setEndpointLinkBrush(d,d.endpointLinks![0].id,brush)).project;
 const after=drawingSnapshotForArtwork(project.recordingSnapshots!,'A')!;expect(after.relations.displayIntervals!.add).toEqual(baseline);expect(after.relations.displayIntervals!.update?.[0].displayRoute).toBeDefined();expect(project.drawing).toEqual(originalDrawing);expect(project.recordingSnapshots!.library).toEqual(library);
 const loaded={...project,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(project.recordingSnapshots)))};expect(currentDrawingPresentation(loaded).displayIntervals?.[0].displayRoute).toBeDefined();sameGeometry(currentDrawingPresentation(loaded),currentDrawingPresentation(project));
 const beforeMove=currentDrawingPresentation(loaded),beforeTrack=beforeMove.displayIntervals![0],material=createDisplayRouteField(beforeMove,beforeTrack.displayRoute!).materialAt(beforeTrack.ranges[0].start)!,moved=moveNode(beforeMove,'b',[.4,.3]),sourceEdited=prepareDrawingSnapshotEdit(loaded,moved).project,afterMove=currentDrawingPresentation(sourceEdited),afterTrack=afterMove.displayIntervals![0];sameGeometry(afterMove,moved);expect(sourceEdited.drawing!.displayIntervals?.[0].displayRoute).toBeUndefined();expect(afterTrack.displayRoute).toBeDefined();
 const actualMaterial=createDisplayRouteField(afterMove,afterTrack.displayRoute!).materialAt(afterTrack.ranges[0].start)!;expect(actualMaterial.kind).toBe(material.kind);if(actualMaterial.kind==='curve'&&material.kind==='curve'){expect(actualMaterial.curveId).toBe(material.curveId);expect(actualMaterial.t).toBeCloseTo(material.t,7);}
});
test('direct source node edits keep original-source behavior; unmarked local relations and unsupported base appearance still reject',()=>{
 const before=fixture(),view=currentDrawingPresentation(before),direct=moveNode(view,'b',[.3,.1]),after=prepareDrawingSnapshotEdit(before,direct).project;
 expect(after.drawing!.nodes.find(node=>node.id==='b')!.position).toEqual([.3,.1]);expect(after.recordingSnapshots!.library.curves[bid('curve')]).toEqual(before.recordingSnapshots!.library.curves[bid('curve')]);
 expect(()=>prepareDrawingSnapshotEdit(before,linkEndpoints(view,b,a,true))).toThrow();expect(()=>prepareDrawingSnapshotEdit(before,widthChange(view,[bid('curve')],.03))).toThrow(/Referenced layers/);
});
test('a later direct original edit preserves its mixed local EndpointLink and one position authority',()=>{
 const project=relation(fixture(),drawing=>linkEndpoints(drawing,b,a,true)).project,before=currentDrawingPresentation(project),target=moveNode(before,'b',[.4,.3]),sourceBefore=project.drawing!.nodes.find(node=>node.id==='b')!.position,saved=JSON.stringify(project);
 const result=prepareDrawingSnapshotEdit(project,target).project,actual=currentDrawingPresentation(result),snapshot=drawingSnapshotForArtwork(result.recordingSnapshots!,'A')!;
 expect(JSON.stringify(project)).toBe(saved);sameGeometry(actual,target);expect(result.drawing!.nodes.find(node=>node.id==='b')!.position).not.toEqual(sourceBefore);expect(result.recordingSnapshots!.library.curves[bid('curve')]).toEqual(project.recordingSnapshots!.library.curves[bid('curve')]);expect(Object.keys(snapshot.deformation.relationPositions)).toHaveLength(1);
});
function apiFor(project:ReturnType<typeof fixture>){useWorkspaceMode.setState({mode:'drawing'});useEditor.setState({project,past:[],future:[]});return createVectorEditingApi({getState:useEditor.getState,getMode:()=> 'drawing',commitDrawing:drawing=>useEditor.getState().setDrawing(drawing),commitSnapshotEditPlan:plan=>useEditor.getState().commitPreparedSnapshotEdit(plan),undo:()=>useEditor.getState().undo(),redo:()=>useEditor.getState().redo()});}
test('API source edit, local link and source edit retain their per-command owners in one Undo',()=>{
 const before=fixture(),api=apiFor(before),commands:VectorCommand[]=[{op:'moveNode',nodeId:'a',position:[-1.3,.1]},{op:'linkEndpoints',a:b,b:a,ref:'localLink'},{op:'moveNode',nodeId:'b',position:[.3,.1]}],dry=api.execute({commands,dryRun:true});
 expect(dry.ok,dry.ok?'':dry.error.message).toBe(true);expect(useEditor.getState().project).toBe(before);expect(useEditor.getState().past).toEqual([]);
 const result=api.execute({commands});expect(result.ok,result.ok?'':result.error.message).toBe(true);const after=useEditor.getState().project,view=currentDrawingPresentation(after);
 expect(after.drawing!.nodes.find(node=>node.id==='a')!.position).toEqual([-1.3,.1]);expect(after.drawing!.nodes.find(node=>node.id==='b')!.position).toEqual([.3,.1]);expect(after.drawing!.endpointLinks??[]).toEqual([]);expect(nodeAt(view,a).position).toEqual(nodeAt(view,b).position);expect(after.recordingSnapshots!.library.curves[bid('curve')]).toEqual(before.recordingSnapshots!.library.curves[bid('curve')]);expect(useEditor.getState().past).toEqual([before]);
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
});
test('API reference creation uses the presentation and a later failing mixed batch writes nothing',()=>{
 const before=fixture(),api=apiFor(before),created=api.execute({commands:[{op:'createCurve',layerId:bid('layer'),shape:[[0,1],[.3,1],[.7,1],[1,1]],width:.01,ref:'local'}]});expect(created.ok,created.ok?'':created.error.message).toBe(true);
 const saved=useEditor.getState().project;expect(saved.drawing).toBe(before.drawing);expect(currentDrawingPresentation(saved).curves).toHaveLength(3);const past=useEditor.getState().past;
 const failure=api.execute({commands:[{op:'moveNode',nodeId:'a',position:[-1.5,.2]},{op:'linkEndpoints',a:b,b:a},{op:'moveNode',nodeId:'missing',position:[0,0]}]});expect(failure.ok).toBe(false);expect(useEditor.getState().project).toBe(saved);expect(useEditor.getState().past).toBe(past);
});
