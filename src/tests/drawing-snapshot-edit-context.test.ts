import {afterEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {useEditor} from '../app/store';
import {useWorkspaceMode} from '../app/workspaceMode';
import {emptyDrawing,shapeOf,type Point2,type DrawingDocument} from '../domain/drawing/model';
import {moveHandle,moveNode,transform,createCurve,deleteObjects,deleteLayers,widthChange} from '../domain/drawing/commands';
import {finalizeGeometryEdit} from '../domain/drawing/geometryEdit';
import {evaluatedAffine,evaluatedAffineSource} from '../domain/drawing/evaluatedAffine';
import {ensureRecordingSnapshots} from '../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,syncRecordingSnapshotSources} from '../domain/recordingSnapshot/sources';
import {captureSnapshotLayerClipboard} from '../domain/recordingSnapshot/referenceClipboard';
import {identityScenePlacement} from '../domain/recordingScene/model';
import {currentDrawingPresentation,drawingSnapshotPresentation} from '../ui/drawing/snapshotPresentation';
import {captureDrawingLayerReferences,prepareDrawingLayerReferencePaste} from '../ui/drawing/layerReferenceClipboard';
import {commitDrawingSnapshotEdit,prepareDrawingSnapshotEdit,commitDrawingCurveSplit} from '../ui/drawing/snapshotEditContext';
import {split} from '../domain/geometry/bezier';

const editor=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(editor,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();});
const bid=(id:string)=>canonicalElementId('B',id);
function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,0]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[.3,.1],[.7,.1]],visible:true,locked:false,width:.01}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}]};
 const other=moveHandle(drawing,{curveId:'curve',end:0},[.3,.6]);
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing,drawingSnapshots:{version:1 as const,activeId:'A',images:[],items:[{id:'A',name:'A',drawing},{id:'B',name:'B',drawing:other}]}});
 const b=drawingSnapshotForArtwork(project.recordingSnapshots,'B')!;
 const clip=captureSnapshotLayerClipboard('test','reference',[{snapshotId:b.id,layerIds:b.layers.map(layer=>layer.id)}]);
 const pasted=prepareDrawingLayerReferencePaste(project,clip,'test');
 return {project:pasted.project,drawing,other,clip};
}
function commit(project:ReturnType<typeof fixture>['project'],next:DrawingDocument){
 vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project,past:[],future:[]});
 commitDrawingSnapshotEdit(useEditor.getState(),next);vi.runAllTimers();return useEditor.getState().project;
}

test('Recording clipboard pastes live into Drawing with stable IDs, no source copy, and one Undo',()=>{
 const f=fixture(),before=f.project,a=drawingSnapshotForArtwork(before.recordingSnapshots!,'A')!,view=currentDrawingPresentation(before);
 expect(view.curves.map(curve=>curve.id)).toEqual(['curve',bid('curve')]);expect(view.layers.map(layer=>layer.id)).toEqual(['layer',bid('layer')]);
 expect(before.drawing).toBe(f.drawing);expect(Object.keys(before.recordingSnapshots!.library.curves)).toHaveLength(2);
 expect(a.parentSnapshotId).toBeUndefined();expect(a.layers[1]).toMatchObject({kind:'reference',id:bid('layer'),baseLayerId:bid('layer')});
 const again=prepareDrawingLayerReferencePaste(before,f.clip,'test');expect(again.changed).toBe(false);expect(again.project).toBe(before);
 const captured=captureDrawingLayerReferences(before,'A',[bid('layer')],'reference','test');expect(captured.sources).toEqual([{snapshotId:a.id,layerIds:[bid('layer')]}]);
 expect(currentDrawingPresentation(before)).toBe(view);
});

test.each(['original','reference'] as const)('Drawing split routes the explicit %s intent through one shared store transaction',kind=>{
 const f=fixture(),before=f.project,id=kind==='original'?'curve':bid('curve'),view=currentDrawingPresentation(before),expected=split(shapeOf(view,id).map(([x,y])=>[x,y,0]),.4).map(curve=>curve.map(([x,y])=>[x,y]));
 vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project:before,past:[],future:[]});
 const plan=commitDrawingCurveSplit(useEditor.getState(),id,.4),after=useEditor.getState().project,actual=currentDrawingPresentation(after);
 expect(plan.ids).toHaveLength(2);for(const [i,child] of plan.ids.entries())expect(shapeOf(actual,child).flat()).toEqual(expected[i].flat().map(value=>expect.closeTo(value,9)));
 expect(useEditor.getState().past).toEqual([before]);expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'B')).toEqual(drawingSnapshotForArtwork(before.recordingSnapshots!,'B'));
 if(kind==='reference'){expect(after.drawing).toBe(before.drawing);expect(after.recordingSnapshots!.library.curves[id]).toEqual(before.recordingSnapshots!.library.curves[id]);expect(plan.diagnostics?.[0].code).toBe('LOCAL_SPLIT_CORRESPONDENCE');}
 else {expect(after.drawing!.curves.map(curve=>curve.id)).toEqual(plan.ids);expect(shapeOf(actual,bid('curve'))).toEqual(shapeOf(view,bid('curve')));}
 useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
});

test.each(['node','handle','affine'] as const)('Drawing %s gesture changes only referenced snapshot state, preserves IDs, and undoes once',kind=>{
 const f=fixture(),before=f.project,view=currentDrawingPresentation(before),id=bid('curve');
 const next=kind==='node'?moveNode(view,bid('a'),[.2,.3]):kind==='handle'?moveHandle(view,{curveId:id,end:0},[.1,.8]):transform(view,[id],p=>[p[0]*1.5+.2,p[1]*.7-.1]);
 const after=commit(before,finalizeGeometryEdit(view,next)),actual=currentDrawingPresentation(after);
 expect(after.drawing).toBe(before.drawing);expect(after.drawingSnapshots).toBe(before.drawingSnapshots);expect(after.recordingSnapshots!.library).toEqual(before.recordingSnapshots!.library);
 expect(shapeOf(actual,id).flat()).toEqual(shapeOf(next,id).flat().map(value=>expect.closeTo(value,10)));expect(actual.curves.map(curve=>curve.id)).toEqual(view.curves.map(curve=>curve.id));expect(actual.nodes.map(node=>node.id)).toEqual(view.nodes.map(node=>node.id));
 expect(drawingSnapshotForArtwork(after.recordingSnapshots!,'B')).toEqual(drawingSnapshotForArtwork(before.recordingSnapshots!,'B'));
 expect(useEditor.getState().past).toEqual([before]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(before);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
});

test('local residual stays live when the upstream source changes',()=>{
 const f=fixture(),view=currentDrawingPresentation(f.project),edited=prepareDrawingSnapshotEdit(f.project,moveHandle(view,{curveId:bid('curve'),end:0},[.3,.9])).project;
 const updated=moveHandle(f.other,{curveId:'curve',end:0},[.3,.8]),live=syncRecordingSnapshotSources({...edited,drawingWorkingCopies:{B:updated}});
 expect(currentDrawingPresentation(live).curves.find(curve=>curve.id===bid('curve'))!.handles[0][1]).toBeCloseTo(1.1);
 expect(live.drawing).toBe(f.drawing);expect(Object.keys(live.recordingSnapshots!.library.curves)).toHaveLength(2);
});

test('original source edits and new pen curves retain normal Drawing semantics alongside references',()=>{
 const f=fixture(),view=currentDrawingPresentation(f.project),next=moveHandle(view,{curveId:'curve',end:0},[.25,.5]);
 const plan=prepareDrawingSnapshotEdit(f.project,next),expected=moveHandle(f.drawing,{curveId:'curve',end:0},[.25,.5]);
 expect(plan.project.drawing).toEqual(expected);expect(plan.sourceDrawing!.curves.map(curve=>curve.id)).toEqual(['curve']);expect(currentDrawingPresentation(plan.project).curves.find(curve=>curve.id===bid('curve'))).toEqual(view.curves.find(curve=>curve.id===bid('curve')));
 const withPen=createCurve(view,'layer',[[0,1],[.3,1],[.7,1],[1,1]],.02,'New','new-curve'),drawn=prepareDrawingSnapshotEdit(f.project,withPen).project;
 expect(drawn.drawing!.curves.map(curve=>curve.id)).toEqual(['curve','new-curve']);expect(currentDrawingPresentation(drawn).curves.some(curve=>curve.id===bid('curve'))).toBe(true);
});

test('mixed original and reference geometry has one Undo and never ingests reference IDs',()=>{
 const f=fixture(),view=currentDrawingPresentation(f.project),next=transform(view,['curve',bid('curve')],p=>[p[0]+.1,p[1]+.2]),after=commit(f.project,next);
 expect(after.drawing!.curves).toHaveLength(1);expect(shapeOf(after.drawing!,'curve')).toEqual(shapeOf(next,'curve'));expect(shapeOf(currentDrawingPresentation(after),bid('curve')).flat()).toEqual(shapeOf(next,bid('curve')).flat().map(value=>expect.closeTo(value,10)));expect(useEditor.getState().past).toEqual([f.project]);
});

test('unsupported reference base appearance fails before mutation or history',()=>{
 const f=fixture(),view=currentDrawingPresentation(f.project);vi.useFakeTimers();useWorkspaceMode.getState().setMode('drawing');useEditor.setState({project:f.project,past:[],future:[]});
 const unsupported=[widthChange(view,[bid('curve')],.04)];
 for(const next of unsupported){expect(()=>commitDrawingSnapshotEdit(useEditor.getState(),next)).toThrow(/Referenced layers/);expect(useEditor.getState().project).toBe(f.project);expect(useEditor.getState().past).toEqual([]);}
});

test('local controls invert layer and stroke placement and preserve original reference-image state',()=>{
 const f=fixture(),workspace={...f.project.recordingSnapshots!,snapshots:f.project.recordingSnapshots!.snapshots.map(snapshot=>snapshot.source?.artworkId==='A'?{...snapshot,deformation:{...snapshot.deformation,layers:{[bid('layer')]:{placement:{...identityScenePlacement(),translation:[.2,.1] as Point2,scaleX:2,scaleY:.5},elementPlacements:{[bid('curve')]:{...identityScenePlacement(),rotation:30}}}}}}:snapshot)},project={...f.project,recordingSnapshots:workspace},view=currentDrawingPresentation(project);
 expect(evaluatedAffine(view,bid('curve'))).toBeDefined();expect(evaluatedAffineSource(view)).toBeDefined();
 const moved=moveHandle(view,{curveId:bid('curve'),end:0},[.6,.7]),plan=prepareDrawingSnapshotEdit(project,moved),actual=currentDrawingPresentation(plan.project);
 expect(actual.curves.find(curve=>curve.id===bid('curve'))!.handles[0][0]).toBeCloseTo(.6);expect(actual.curves.find(curve=>curve.id===bid('curve'))!.handles[0][1]).toBeCloseTo(.7);expect(plan.project.drawing).toBe(project.drawing);
 const sourceLayer=drawingSnapshotForArtwork(workspace,'A')!.layers[0];if(sourceLayer.kind!=='original')throw Error('Expected original');
 const lockedWorkspace={...workspace,snapshots:workspace.snapshots.map(snapshot=>snapshot.source?.artworkId==='A'?{...snapshot,layers:snapshot.layers.map(layer=>layer===sourceLayer?{...sourceLayer,locked:true,visible:false}:layer)}:snapshot)};
 const locked=drawingSnapshotPresentation(lockedWorkspace,'A')!.drawing;expect(locked.layers[0]).toMatchObject({locked:true,visible:false});
});


test('reference curve removal excludes only local membership and layer removal removes only its reference',()=>{
 const f=fixture(),view=currentDrawingPresentation(f.project);
 for(const remove of [deleteObjects(view,[bid('curve')]),deleteLayers(view,[bid('layer')])]){
  const plan=prepareDrawingSnapshotEdit(f.project,remove),a=drawingSnapshotForArtwork(plan.project.recordingSnapshots!,'A')!;
  expect(plan.project.drawing).toBe(f.project.drawing);expect(plan.project.recordingSnapshots!.library).toEqual(f.project.recordingSnapshots!.library);expect(currentDrawingPresentation(plan.project).curves.map(curve=>curve.id)).toEqual(['curve']);
  if(remove.layers.some(layer=>layer.id===bid('layer')))expect(a.layers[1]).toMatchObject({id:bid('layer'),membership:{excludeElementIds:[bid('curve')]}});else expect(a.layers).toHaveLength(1);
 }
});

test('unrelated original edits preserve local relation additions and disabled originals without source contamination',()=>{
 const f=fixture(),drawing={...f.drawing,groups:[{id:'group',name:'Source group',visible:true,locked:false,curveIds:['curve']}]},project=syncRecordingSnapshotSources({...f.project,drawing});
 const workspace=structuredClone(project.recordingSnapshots!),a=drawingSnapshotForArtwork(workspace,'A')!;a.relations.groups!.disable=[canonicalElementId('A','group')];a.relations.groups!.add!.push({id:'local-group',name:'Local group',visible:true,locked:false,curveIds:[canonicalElementId('A','curve')]});
 const edited={...project,recordingSnapshots:workspace},view=currentDrawingPresentation(edited),plan=prepareDrawingSnapshotEdit(edited,moveHandle(view,{curveId:'curve',end:0},[.3,.5]));
 expect(plan.project.drawing!.groups).toEqual(drawing.groups);expect(drawingSnapshotForArtwork(plan.project.recordingSnapshots!,'A')!.relations.groups!.disable).toEqual(a.relations.groups!.disable);
 expect(plan.project.drawing!.groups!.some(group=>group.id==='local-group')).toBe(false);
});

test.each([false,true])('linked reference nodes keep one position when parent/local relation authority is present (%s)',localAuthority=>{
 const f=fixture(),linked:DrawingDocument={...f.other,nodes:[...f.other.nodes,{id:'c',position:[1,0]},{id:'d',position:[2,0]}],curves:[...f.other.curves,{...f.other.curves[0],id:'second',nodes:['c','d'],handles:[[1.3,0],[1.7,0]]}],layers:[...f.other.layers,{id:'second-layer',name:'Second',visible:true,locked:false,items:['second']}],endpointLinks:[{id:'link',a:{curveId:'curve',end:1},b:{curveId:'second',end:0}}]};
 const fresh=syncRecordingSnapshotSources({...f.project,drawingWorkingCopies:{B:linked}}),workspace=structuredClone(fresh.recordingSnapshots!),b=drawingSnapshotForArtwork(workspace,'B')!;
 b.deformation.relationPositions={parentPosition:{sourceLinkIds:[bid('link')],offset:[.2,.1]}};
 const clip=captureSnapshotLayerClipboard('test','reference',[{snapshotId:b.id,layerIds:b.layers.map(layer=>layer.id)}]),plan=prepareDrawingLayerReferencePaste({...fresh,recordingSnapshots:workspace},clip,'test'),project=plan.project;
 if(localAuthority)drawingSnapshotForArtwork(project.recordingSnapshots!,'A')!.deformation.relationPositions={localPosition:{sourceLinkIds:[bid('link')],offset:[.1,.1]}};
 // Mutations above prepare a fixture before its first presentation read.
 const view=currentDrawingPresentation(project),position:[number,number]=[1.6,.5],next=moveNode(view,bid('b'),position),edited=prepareDrawingSnapshotEdit(project,next).project,actual=currentDrawingPresentation(edited);
 expect(actual.nodes.find(node=>node.id===bid('b'))!.position).toEqual(position);expect(actual.nodes.find(node=>node.id===bid('c'))!.position).toEqual(position);expect(edited.drawing).toBe(project.drawing);expect(edited.recordingSnapshots!.library).toEqual(project.recordingSnapshots!.library);
});

test('reference-only edits preserve original curve and node array order',()=>{
 const f=fixture(),drawing=createCurve(f.drawing,'layer',[[0,1],[.3,1],[.7,1],[1,1]],.02,'Second','new-source-curve'),project=syncRecordingSnapshotSources({...f.project,drawing}),view=currentDrawingPresentation(project),next=moveHandle(view,{curveId:bid('curve'),end:0},[.3,.8]);
 const plan=prepareDrawingSnapshotEdit(project,next);expect(plan.project.drawing).toBe(project.drawing);expect(plan.sourceDrawing).toBeUndefined();
});


test('deleting originals cleans locally disabled source relations',()=>{
 const f=fixture(),drawing={...f.drawing,groups:[{id:'group',name:'Source group',visible:true,locked:false,curveIds:['curve']}]},base=syncRecordingSnapshotSources({...f.project,drawing}),workspace=structuredClone(base.recordingSnapshots!),a=drawingSnapshotForArtwork(workspace,'A')!;a.relations.groups!.disable=[canonicalElementId('A','group')];
 const project={...base,recordingSnapshots:workspace},view=currentDrawingPresentation(project),plan=prepareDrawingSnapshotEdit(project,deleteObjects(view,['curve']));
 expect(plan.project.drawing!.curves).toEqual([]);expect(plan.project.drawing!.groups).toEqual([]);expect(currentDrawingPresentation(plan.project).curves.map(curve=>curve.id)).toEqual([bid('curve')]);
});

test('new original geometry in a placed layer stores inverse coordinates once',()=>{
 const f=fixture(),workspace=structuredClone(f.project.recordingSnapshots!),a=drawingSnapshotForArtwork(workspace,'A')!;a.deformation.layers[canonicalElementId('A','layer')]={placement:{...identityScenePlacement(),translation:[.4,.2],scale:2}};
 const project={...f.project,recordingSnapshots:workspace},view=currentDrawingPresentation(project),wanted=createCurve(view,'layer',[[.5,.6],[.8,.6],[1.2,.6],[1.5,.6]],.02,'New','placed-new'),plan=prepareDrawingSnapshotEdit(project,wanted),actual=currentDrawingPresentation(plan.project);
 expect(shapeOf(actual,'placed-new').flat()).toEqual(shapeOf(wanted,'placed-new').flat().map(value=>expect.closeTo(value,10)));expect(plan.project.drawing!.nodes.find(node=>node.id===plan.project.drawing!.curves.find(curve=>curve.id==='placed-new')!.nodes[0])!.position).toEqual([.04999999999999999,.19999999999999998]);
});
