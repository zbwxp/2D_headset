import type {EvaluatedMaterialStep} from '../../domain/drawing/materialProgram';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {createLayerAffineIntent} from '../../domain/drawing/layerDomainIntent';
import {afterEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch,prepareSnapshotPreview} from '../../app/recordingSnapshotApi';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {emptyDrawing,shapeOf,nodeAt,type Point2,type Cubic} from '../../domain/drawing/model';
import {addLayer,createCurve,moveNode,moveHandle,transform,linkEndpoints} from '../../domain/drawing/commands';
import {upsertDrawingSource,canonicalElementId} from '../../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {neutralBend} from '../../domain/deformation/coons';
import {isLayerControlResponseDomain} from '../../domain/recordingSnapshot/layerDomainControlEdit';
import {hasNonlinearDeformationFor} from '../../domain/drawing/evaluatedDeformation';
import {applyScenePlacement} from '../../domain/recordingScene/tracks';
import {snapshotCurveEditCommand} from '../../ui/vectorRecording/snapshotCurveEditCommand';
import {snapshotStrokeSelectionTransform} from '../../ui/vectorRecording/SnapshotRecordingWorkspace';
import {projectSnapshotTransformTargets} from '../../domain/recordingSnapshot/transformTargets';
import {resolveDrawingCage} from '../../ui/drawing/cageEditorController';
const id=(raw:string)=>canonicalElementId('source',raw),near=(a:Point2,b:Point2)=>a.forEach((n,i)=>expect(n).toBeCloseTo(b[i],8));
const initial=useEditor.getState(),mode=useWorkspaceMode.getState().mode;afterEach(()=>{useEditor.setState(initial,true);useWorkspaceMode.getState().setMode(mode);vi.useRealTimers();});
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
function fixture(relation?:'link'|'shared'|'smooth'){
 let drawing=emptyDrawing();for(const [name,shape] of [['own',line([0,0],[1,1])],['parent',line([0,2],[1,3])],['plain',line([0,0],[-1,-1])]] as [string,Cubic][]){drawing=addLayer(drawing,name);drawing=createCurve(drawing,drawing.layers[0].id,shape,.01,name,name);}
 const layers=Object.fromEntries(drawing.layers.map(layer=>[layer.name,layer.id]));
 if(relation==='shared'){const own=drawing.curves.find(curve=>curve.id==='own')!,plain=drawing.curves.find(curve=>curve.id==='plain')!;plain.nodes[0]=own.nodes[0];}
 else if(relation){drawing=linkEndpoints(drawing,{curveId:'own',end:0},{curveId:'plain',end:0});if(relation==='smooth')drawing.endpointLinks![0].joinBrush={kind:'SMOOTH'};}
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing),source=workspace.snapshots[0],parent=emptyRecordingSnapshot('parent'),view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording');
 const cage={kind:'h-coons' as const,id:'own-cage',layerIds:['own'],restRect:{min:[-1,-1] as Point2,max:[2,3] as Point2},quad:[[-1,-1],[2,-1],[2,3],[-1,3]] as [Point2,Point2,Point2,Point2],bend:neutralBend()};
 if(!relation)cage.bend.handles[1][0][0]+=.18;
 parent.layers=[{kind:'reference',id:'parent-slot',name:'Parent',baseSnapshotId:source.id,baseLayerId:id(layers.parent)}];parent.deformation.layerDomains=[{...cage,id:'parent-cage',layerIds:['parent-slot'],quad:[[-1,-1],[2.2,-.8],[1.7,3.1],[-.9,2.9]] as [Point2,Point2,Point2,Point2]}];
 view.layers=['own','parent','plain'].map(name=>({kind:'reference' as const,id:name,name,baseSnapshotId:name==='parent'?parent.id:source.id,baseLayerId:name==='parent'?'parent-slot':id(layers[name])}));view.deformation.layerDomains=[cage];
 if(!relation)for(const [index,name] of ['own','parent','plain'].entries())view.deformation.layers[name]={placement:{translation:[.2*index,-.1],rotation:13*index,scale:1.2},elementPlacements:{[id(name)]:{translation:[.05,.02],rotation:-7,scale:.9}}};
 side.layers=structuredClone(view.layers);recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots.push(parent,view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {project:{...createEmptyProject(),drawing,recordingSnapshots:workspace},drawing,layers};
}
const evaluate=(project:ReturnType<typeof fixture>['project'])=>evaluateRecordingSnapshot(project.recordingSnapshots,'recording'),apply=(project:ReturnType<typeof fixture>['project'],commands:Parameters<typeof prepareSnapshotPreview>[1]['commands'])=>({...project,recordingSnapshots:prepareSnapshotBatch(project,{recordingId:'recording',commands}).recordingSnapshots});
const sameControls=(actual:ReturnType<typeof evaluate>['drawing'],wanted:typeof actual)=>{for(const node of wanted.nodes)near(actual.nodes.find(n=>n.id===node.id)!.position,node.position);for(const curve of wanted.curves)for(const end of [0,1] as const)near(actual.curves.find(c=>c.id===curve.id)!.handles[end],curve.handles[end]);};

test('one target transaction groups own cage, inherited program and plain controls without a blanket stage rejection',()=>{
 const f=fixture(),before=evaluate(f.project),ids=['own','parent','plain'].map(id),delta={translation:[.2,-.15] as Point2,rotation:17,scale:1.1},wanted=projectSnapshotTransformTargets(before.drawing,transform(before.drawing,ids,p=>applyScenePlacement(delta,p),true,false)),originals=JSON.stringify(f.project.recordingSnapshots.library),prior=JSON.stringify(f.project);
 expect(hasNonlinearDeformationFor(before.drawing,id('parent'))).toBe(true);const preview=prepareSnapshotPreview(f.project,{commands:[{op:'transformShapeElements',curveIds:ids,value:delta}]}),after=apply(f.project,[{op:'transformShapeElements',curveIds:ids,value:delta}]);sameControls(evaluate(after).drawing,wanted);sameControls(evaluate({...f.project,recordingSnapshots:preview.recordingSnapshots}).drawing,wanted);
 const state=evaluate(after).state;expect(state.layerDomains).toHaveLength(1);expect(state.layerDomains![0].postShape!.handles[id('own')]).toBeDefined();expect(state.layers.parent.shape?.handles[id('parent')]).toBeDefined();expect(state.layers.plain.shape?.handles[id('plain')]).toBeDefined();expect(JSON.stringify(after.recordingSnapshots.library)).toBe(originals);expect(JSON.stringify(f.project)).toBe(prior);
 const saved=apply(after,[{op:'saveSelected',layerIds:['own','parent','plain'],warpIds:[]}]),loaded={...saved,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(saved.recordingSnapshots)))};sameControls(evaluate(loaded).drawing,wanted);
 const run=vi.fn(),adapter=snapshotStrokeSelectionTransform(before,before,ids,true,()=>{},run)!;adapter.onCommit(delta);expect(run).toHaveBeenCalledWith([{op:'transformShapeElements',curveIds:ids,value:delta}]);expect(adapter.displayPlacement).toBeUndefined();
});

test.each(['link','shared','smooth'] as const)('%s authority across stages uses one final control owner and reuses it on later A edits',relation=>{
 vi.useFakeTimers();const f=fixture(relation),before=evaluate(f.project),nodeId=before.drawing.curves.find(curve=>curve.id===id('own'))!.nodes[0],wantedPosition:Point2=[.12,.18],wanted=moveNode(before.drawing,nodeId,wantedPosition,true),command=snapshotCurveEditCommand(before,{kind:'node',nodeId,position:wantedPosition});
 const after=apply(f.project,[command]),evaluation=evaluate(after);sameControls(evaluation.drawing,wanted);const stage=evaluation.state.layerDomains!.find(isLayerControlResponseDomain)!;expect(stage.layerIds).toEqual(['own','plain']);expect(stage.postShape!.nodes[nodeId]).toBeDefined();expect(evaluation.state.layers.parent?.shape).toBeUndefined();
 const nextPosition:Point2=[.2,.25],second=apply(after,[snapshotCurveEditCommand(evaluation,{kind:'node',nodeId,position:nextPosition})]),next=evaluate(second);expect(next.state.layerDomains).toHaveLength(2);expect(next.state.layerDomains!.find(isLayerControlResponseDomain)!.id).toBe(stage.id);sameControls(next.drawing,moveNode(evaluation.drawing,nodeId,nextPosition,true));
 const cage=resolveDrawingCage(next.drawing,{ids:[id('own')],layer:'own'},{domains:next.state.layerDomains});expect(cage?.domainOperationId).toBe('own-cage');
 useWorkspaceMode.getState().setMode('recording');useEditor.setState({project:f.project,past:[],future:[]});useEditor.getState().commitRecordingSnapshots(after.recordingSnapshots);vi.runAllTimers();expect(useEditor.getState().past).toEqual([f.project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(f.project);useEditor.getState().redo();sameControls(evaluate(useEditor.getState().project as typeof f.project).drawing,wanted);
});

test('SMOOTH handle targets are projected by Drawing once and preserve unrelated parent controls',()=>{
 const f=fixture('smooth'),before=evaluate(f.project),position:Point2=[.25,.1],wanted=moveHandle(before.drawing,{curveId:id('own'),end:0},position,true),after=apply(f.project,[snapshotCurveEditCommand(before,{kind:'handle',curveId:id('own'),end:0,position})]);sameControls(evaluate(after).drawing,wanted);expect(shapeOf(evaluate(after).drawing,id('parent'))).toEqual(shapeOf(before.drawing,id('parent')));expect(evaluate(after).state.layerDomains!.find(isLayerControlResponseDomain)!.layerIds).toEqual(['own','plain']);
});

test('an actually collapsed local target names its curve and axis and rolls the whole mixed edit back',()=>{
 const f=fixture();f.project.recordingSnapshots.snapshots.find(view=>view.id==='view')!.deformation.layers.plain.placement!.scaleX=0;const before=JSON.stringify(f.project);
 expect(()=>apply(f.project,[{op:'transformShapeElements',curveIds:['own','plain'].map(id),value:{translation:[.2,0],rotation:0,scale:1}}])).toThrow(new RegExp(`(Handle|Node) .*local placement`));expect(JSON.stringify(f.project)).toBe(before);
});

test('locked linked followers reject the shared target before any control stage is authored',()=>{
 const f=fixture('smooth');f.project.recordingSnapshots.library.curves[id('plain')].locked=true;const e=evaluate(f.project),before=JSON.stringify(f.project);
 expect(()=>apply(f.project,[snapshotCurveEditCommand(e,{kind:'handle',curveId:id('own'),end:0,position:[.2,.1]})])).toThrow(/锁定/);expect(JSON.stringify(f.project)).toBe(before);
});


test('mixed targets retain a collapsed input coordinate while editing its feasible remaining axis',()=>{
 const f=fixture(),snapshot=f.project.recordingSnapshots.snapshots.find(view=>view.id==='view')!;snapshot.deformation.layers.plain.placement={translation:[0,0],rotation:0,scale:1,scaleX:0,scaleY:1};delete snapshot.deformation.layers.plain.elementPlacements;
 const before=evaluate(f.project),delta={translation:[0,.2] as Point2,rotation:0,scale:1},wanted=transform(before.drawing,['own','plain'].map(id),p=>applyScenePlacement(delta,p),true,false),after=apply(f.project,[{op:'transformShapeElements',curveIds:['own','plain'].map(id),value:delta}]);sameControls(evaluate(after).drawing,wanted);
 const response=evaluate(after).state.layers.plain.shape!;expect(Object.values(response.nodes).every(p=>p[0]===0)).toBe(true);expect(Object.values(response.handles).flat().every(p=>p[0]===0)).toBe(true);
});


test('control-stage reset/restore is explicit and a later unrelated source member receives identity plus zero residual',()=>{
 const f=fixture('link'),initial=evaluate(f.project),nodeId=initial.drawing.curves.find(curve=>curve.id===id('own'))!.nodes[0],after=apply(f.project,[snapshotCurveEditCommand(initial,{kind:'node',nodeId,position:[.1,.2]})]),saved=apply(after,[{op:'saveSelected',layerIds:['own','plain'],warpIds:[]}]),evaluation=evaluate(saved),stage=evaluation.state.layerDomains!.find(isLayerControlResponseDomain)!;
 if(stage.kind==='h-coons')throw Error('Expected a control response');
 const toggle=(project:typeof f.project,enabled:boolean)=>prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'recording-layer-domain',recordingId:'recording',snapshotId:'view',angle:{x:0,y:0},intent:createLayerAffineIntent(stage.layerIds,stage.matrix,{operationId:stage.id,replace:true,enabled})}).project as typeof f.project;
 const reset=toggle(saved,false);sameControls(evaluate(reset).drawing,initial.drawing);const restored=toggle(reset,true);sameControls(evaluate(restored).drawing,evaluation.drawing);expect(evaluate(restored).state.layerDomains).toHaveLength(2);
 const shape:Cubic=[[.2,.4],[.35,.45],[.7,.55],[.9,.8]],grown=createCurve(f.drawing,f.layers.plain,shape,.01,'New independent member','new'),live={...restored,recordingSnapshots:upsertDrawingSource(restored.recordingSnapshots,'source',grown)},result=evaluate(live),response=result.state.layerDomains!.find(isLayerControlResponseDomain)!;
 shapeOf(result.drawing,id('new')).forEach((p,i)=>near(p,shape[i]));expect(response.postShape?.handles[id('new')]).toBeUndefined();expect(result.state.layerDomains).toHaveLength(2);
});


test('real UI A adapter sends a feasible collapsed plain target to the resolver before any inverse can block it',()=>{
 const f=fixture(),snapshot=f.project.recordingSnapshots.snapshots.find(view=>view.id==='view')!;snapshot.deformation.layers.plain.placement={translation:[0,0],rotation:0,scale:1,scaleX:0,scaleY:1};delete snapshot.deformation.layers.plain.elementPlacements;
 const before=evaluate(f.project),curve=before.drawing.curves.find(curve=>curve.id===id('plain'))!,nodeId=curve.nodes[0],p=nodeAt(before.drawing,{curveId:curve.id,end:0}).position,position:Point2=[p[0],p[1]+.2],command=snapshotCurveEditCommand(before,{kind:'node',nodeId,position});expect('position' in command&&command.position).toEqual(position);
 const after=apply(f.project,[command]);sameControls(evaluate(after).drawing,moveNode(before.drawing,nodeId,position,true));const collapsed=after.recordingSnapshots.snapshots.find(view=>view.id==='view')!,restored={...after,recordingSnapshots:{...after.recordingSnapshots,snapshots:after.recordingSnapshots.snapshots.map(view=>view===collapsed?{...view,deformation:{...view.deformation,layers:{...view.deformation.layers,plain:{...view.deformation.layers.plain,placement:{translation:[0,0] as Point2,rotation:0,scale:1}}}}}:view)}};
 expect(shapeOf(evaluate(restored).drawing,id('plain'))[0][0]).toBe(shapeOf(f.drawing,'plain')[0][0]);
 const noop=prepareSnapshotPreview(after,{commands:[snapshotCurveEditCommand(evaluate(after),{kind:'node',nodeId,position})]});expect(noop.changed).toBe(false);
});


test('mixed A/V preserves a copied reflected material program and honors local object locks',()=>{
 const f=fixture(),snapshot=f.project.recordingSnapshots.snapshots.find(view=>view.id==='view')!,cage=snapshot.deformation.layerDomains![0];if(cage.kind!=='h-coons')throw Error('Missing cage');
 const program:EvaluatedMaterialStep[]=[{kind:'reflected',axisX:0,reverseCurveIds:[],steps:[{kind:'cage',domain:cage}]}];snapshot.deformation.layerDomains=[{id:'reflected-copy',layerIds:['own'],matrix:[1,0,0,1,0,0],materialProgram:program}];
 const before=evaluate(f.project),delta={translation:[.1,.2] as Point2,rotation:0,scale:1},wanted=transform(before.drawing,['own','plain'].map(id),p=>applyScenePlacement(delta,p),true,false),after=apply(f.project,[{op:'transformShapeElements',curveIds:['own','plain'].map(id),value:delta}]);sameControls(evaluate(after).drawing,wanted);
 const domain=evaluate(after).state.layerDomains![0];if(domain.kind==='h-coons')throw Error('Lost copied program');expect(domain.materialProgram).toEqual(program);expect(isLayerControlResponseDomain(domain)).toBe(false);
 const locked=apply(after,[{op:'setObjectLocks',objectIds:[id('plain')],locked:true}]),prior=JSON.stringify(locked);expect(()=>apply(locked,[{op:'transformShapeElements',curveIds:['own','plain'].map(id),value:delta}])).toThrow(/锁定/);expect(JSON.stringify(locked)).toBe(prior);
});
