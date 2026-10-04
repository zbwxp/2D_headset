import {expect,test} from 'vitest';
import {addLayer,createCurve,connect,moveNode,moveHandle,unbind} from '../../domain/drawing/commands';
import {emptyDrawing,shapeOf,nodeAt,type DrawingDocument,type Cubic,type Point2} from '../../domain/drawing/model';
import {neutralBend} from '../../domain/deformation/coons';
import {createCurveSplitIntent,applyCurveSplitIntent,mapCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {evaluatedMaterialProgram,evaluatedMaterialSource} from '../../domain/drawing/evaluatedDeformation';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {upsertDrawingSource,canonicalElementId} from '../../domain/recordingSnapshot/sources';
import {prepareSnapshotLocalDrawingEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {prepareSnapshotCurveSplit,finishSnapshotCurveSplit} from '../../domain/recordingSnapshot/topologyEdits';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {createEmptyProject} from '../../app/emptyProject';
import {useEditor} from '../../app/store';
const id=(raw:string)=>canonicalElementId('source',raw);
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+(b[0]-a[0])*2/3,a[1]+(b[1]-a[1])*2/3],b];
const close=(a:Point2,b:Point2)=>a.forEach((value,i)=>expect(value).toBeCloseTo(b[i],9));
const sameGeometry=(actual:DrawingDocument,wanted:DrawingDocument)=>{for(const curve of wanted.curves){expect(actual.curves.find(value=>value.id===curve.id)!.nodes).toEqual(curve.nodes);shapeOf(actual,curve.id).forEach((point,i)=>close(point,shapeOf(wanted,curve.id)[i]));}};
function fixture(){
 let sourceDrawing=addLayer(emptyDrawing(),'Layer');const layer=sourceDrawing.layers[0].id;sourceDrawing=createCurve(sourceDrawing,layer,line([-.8,0],[-.1,0]),.01,'A','a');sourceDrawing=createCurve(sourceDrawing,layer,line([.2,.2],[.7,.8]),.01,'B','b');
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',sourceDrawing),source=workspace.snapshots[0],view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording'),bend=neutralBend();bend.handles[1][0][0]=1.2;
 view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:id(layer)}];side.layers=structuredClone(view.layers);view.deformation.layerDomains=[{kind:'h-coons',id:'cage',layerIds:['slot'],restRect:{min:[-1,-1],max:[1,1]},quad:[[-1,-1],[.9,-.8],[.5,1],[-.9,.8]],bend}];
 recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots.push(view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;const child=emptyRecordingSnapshot('child');child.layers=[{kind:'reference',id:'child-slot',name:'Child',baseSnapshotId:'view',baseLayerId:'slot'}];workspace.snapshots.push(child);return {workspace,sourceDrawing,layer,domain:view.deformation.layerDomains[0]};
}
const edit=(workspace:ReturnType<typeof fixture>['workspace'],drawing:DrawingDocument)=>prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:'child',state:'saved',beforeDrawing:resolveSnapshot(workspace,'child').drawing,drawing}).workspace;


const child=(workspace:ReturnType<typeof fixture>['workspace'])=>resolveSnapshot(workspace,'child').drawing;

import {createSnapshotNodeUnbindIntent} from '../../domain/recordingSnapshot/nodeForks';
import type {Endpoint} from '../../domain/drawing/model';
const fixed={curveId:id('a'),end:1 as const},moving={curveId:id('b'),end:0 as const};
function bound(kind:'source'|'alias',corrected=false){
 const f=fixture();if(kind==='source'){f.sourceDrawing=connect(f.sourceDrawing,{curveId:'a',end:1},{curveId:'b',end:0},'CUSP');f.workspace=upsertDrawingSource(f.workspace,'source',f.sourceDrawing);}
 if(corrected){const parent=f.workspace.snapshots.find(snapshot=>snapshot.id==='view')!,node=nodeAt(resolveSnapshot(f.workspace,'view').drawing,moving).id;parent.deformation.layerDomains![0].postShape={nodes:{[node]:[.03,.05]},handles:{[id('b')]:[[.04,.02],[0,0]]}};}
 if(kind==='alias')f.workspace=edit(f.workspace,connect(child(f.workspace),fixed,moving,'CUSP'));return f;
}
function detach(workspace:ReturnType<typeof fixture>['workspace'],endpoint:Endpoint=moving){const beforeDrawing=child(workspace),drawing=unbind(beforeDrawing,endpoint),nodeUnbind=createSnapshotNodeUnbindIntent('child',beforeDrawing,drawing,endpoint)!;return {...prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:'child',state:'saved',beforeDrawing,drawing,nodeUnbind}),wanted:drawing,nodeUnbind};}
for(const kind of ['source','alias'] as const)for(const corrected of [false,true])test(`inherited cage unbind preserves ${kind} controls and material corrections=${corrected}`,()=>{
 const f=bound(kind,corrected),source=JSON.stringify(f.workspace),result=detach(f.workspace),actual=child(result.workspace),snapshot=result.workspace.snapshots.find(snapshot=>snapshot.id==='child')!;sameGeometry(actual,result.wanted);expect(nodeAt(actual,moving).id).toBe(result.nodeUnbind.nodeId);expect(nodeAt(actual,moving).id).not.toBe(nodeAt(actual,fixed).id);expect(snapshot.nodeForks).toEqual({[result.nodeUnbind.nodeId]:moving});expect(result.workspace.library).toEqual(f.workspace.library);expect(result.workspace.library.nodes[result.nodeUnbind.nodeId]).toBeUndefined();expect(result.workspace.snapshots.find(snapshot=>snapshot.id==='view')).toEqual(f.workspace.snapshots.find(snapshot=>snapshot.id==='view'));expect(JSON.stringify(f.workspace)).toBe(source);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(result.workspace)))),result.wanted);
});

test('inherited cage fork takes an independent A edit and follows its live source endpoint',()=>{
 const f=bound('alias',true),result=detach(f.workspace),before=child(result.workspace),node=nodeAt(before,moving),wanted=moveNode(before,node.id,[node.position[0]+.07,node.position[1]-.06]),workspace=edit(result.workspace,wanted);sameGeometry(child(workspace),wanted);close(nodeAt(child(workspace),fixed).position,nodeAt(before,fixed).position);expect(workspace.library).toEqual(f.workspace.library);
 const sourceNode=f.sourceDrawing.curves.find(curve=>curve.id==='b')!.nodes[0],point=f.sourceDrawing.nodes.find(node=>node.id===sourceNode)!.position,updated=upsertDrawingSource(workspace,'source',moveNode(f.sourceDrawing,sourceNode,[point[0]+.1,point[1]+.05])),actual=child(updated);expect(nodeAt(actual,moving).position).not.toEqual(nodeAt(wanted,moving).position);expect(nodeAt(actual,moving).id).toBe(node.id);close(nodeAt(actual,fixed).position,nodeAt(wanted,fixed).position);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(updated)))),actual);
});

test('inherited cage rebind and repeated unbind keep one live fork endpoint authority',()=>{
 const first=detach(bound('alias',true).workspace),before=child(first.workspace),rebound=edit(first.workspace,connect(before,fixed,moving,'POSITION')),second=detach(rebound),snapshot=second.workspace.snapshots.find(snapshot=>snapshot.id==='child')!;sameGeometry(child(second.workspace),second.wanted);expect(Object.values(snapshot.nodeForks!).filter(fork=>fork.bind!==false)).toHaveLength(1);expect(nodeAt(child(second.workspace),moving).id).not.toBe(first.nodeUnbind.nodeId);
});

test('inherited cage local P can share a fork without another canonical node record',()=>{
 const f=bound('alias'),result=detach(f.workspace),before=child(result.workspace),start=nodeAt(before,moving).position,created=createCurve(before,'child-slot',line(start,[.5,.7]),.01,'P','p'),wanted=connect(created,moving,{curveId:'p',end:0},'POSITION'),workspace=edit(result.workspace,wanted);sameGeometry(child(workspace),wanted);expect(workspace.library.nodes[result.nodeUnbind.nodeId]).toBeUndefined();expect(workspace.library.curves.p.nodes[0]).toBe(result.nodeUnbind.nodeId);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)))),wanted);
});

test('Drawing host unbind and A edit preserve source/material and each commit has one Undo',async()=>{
 const {prepareDrawingSnapshotEdit}=await import('../../app/drawingSnapshotEdit'),{currentDrawingPresentation}=await import('../../ui/drawing/snapshotPresentation'),{drawingSnapshotForArtwork}=await import('../../domain/recordingSnapshot/sources'),{useWorkspaceMode}=await import('../../app/workspaceMode'),{createVectorEditingApi}=await import('../../app/vectorEditingApi'),{displayField,displayPath}=await import('../../domain/drawing/displayIntervals');
 const f=bound('source',true),blank=emptyDrawing(),workspace=upsertDrawingSource(f.workspace,'author',blank),author=drawingSnapshotForArtwork(workspace,'author')!;author.layers=[{kind:'reference',id:'author-slot',name:'Inherited',baseSnapshotId:'view',baseLayerId:'slot'}];const project={...createEmptyProject(),drawing:blank,drawingSnapshots:{version:1 as const,activeId:'author',items:[{id:'author',name:'Author',drawing:blank}],images:[]},recordingSnapshots:workspace},before=currentDrawingPresentation(project),wanted=unbind(before,moving),intent=createSnapshotNodeUnbindIntent(author.id,before,wanted,moving)!,plan=prepareDrawingSnapshotEdit(project,wanted,intent),actual=currentDrawingPresentation(plan.project);sameGeometry(actual,wanted);expect(plan.project.recordingSnapshots!.library).toEqual(workspace.library);expect(plan.project.drawing).toBe(blank);expect(plan.project.drawingSnapshots).toEqual(project.drawingSnapshots);
 const loaded=currentDrawingPresentation({...plan.project,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(plan.project.recordingSnapshots)))}),field=displayField(actual,displayPath(actual,moving.curveId)),roundtrip=displayField(loaded,displayPath(loaded,moving.curveId));for(const t of [0,.2,.6,1])close(field.at(t).p,roundtrip.at(t).p);expect(actual.curves.map(curve=>curve.width)).toEqual(before.curves.map(curve=>curve.width));
 const previous=useEditor.getState(),mode=useWorkspaceMode.getState().mode;try{useWorkspaceMode.setState({mode:'drawing'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);const node=nodeAt(actual,moving),position:Point2=[node.position[0]+.05,node.position[1]+.06],moved=createVectorEditingApi().execute({commands:[{op:'moveNode',nodeId:intent.nodeId,position}]});expect(moved.ok,moved.ok?'':moved.error.message).toBe(true);close(nodeAt(currentDrawingPresentation(useEditor.getState().project),moving).position,position);close(nodeAt(currentDrawingPresentation(useEditor.getState().project),fixed).position,nodeAt(actual,fixed).position);expect(useEditor.getState().past).toEqual([project,plan.project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(plan.project);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);}finally{useEditor.setState(previous,true);useWorkspaceMode.setState({mode});}
});

test.each(['SMOOTH','ARC'] as const)('inherited cage unbind preserves controls while retiring the %s connection',join=>{
 const f=fixture();f.workspace=upsertDrawingSource(f.workspace,'source',connect(f.sourceDrawing,{curveId:'a',end:1},{curveId:'b',end:0},join));const before=child(f.workspace),result=detach(f.workspace),actual=child(result.workspace);sameGeometry(actual,result.wanted);expect(actual.joins).toEqual(result.wanted.joins);expect(actual.joins).toHaveLength(0);expect(shapeOf(actual,moving.curveId)).toEqual(shapeOf(before,moving.curveId).map(p=>p.map(v=>expect.closeTo(v,8))));expect(result.workspace.library).toEqual(f.workspace.library);
});

test('inherited cage unbind of the alias authority keeps both branches on canonical material nodes',async()=>{
 const {evaluatedMaterialSource}=await import('../../domain/drawing/evaluatedDeformation'),f=bound('alias',true),before=child(f.workspace),result=detach(f.workspace,fixed),actual=child(result.workspace),material=evaluatedMaterialSource(actual),original=f.workspace.library.curves[fixed.curveId].nodes[1];sameGeometry(actual,result.wanted);expect(nodeAt(actual,moving).id).toBe(nodeAt(before,moving).id);expect(result.workspace.snapshots.find(snapshot=>snapshot.id==='child')!.nodeAliases).toBeDefined();close(nodeAt(material,moving).position,f.workspace.library.nodes[original].position);close(nodeAt(material,fixed).position,f.workspace.library.nodes[original].position);expect(result.workspace.library).toEqual(f.workspace.library);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(result.workspace)))),result.wanted);
});

test.each([false,true])('inherited cage fork preserves ordered material with reflection=%s',reflected=>{
 const f=bound('source',true),parent=f.workspace.snapshots.find(snapshot=>snapshot.id==='view')!;
 f.sourceDrawing.displayIntervals=[{id:'ink',scope:'CURVE',anchor:{id:'b',reverse:false},ranges:[{id:'range',start:.17,end:.83}]}];f.workspace=upsertDrawingSource(f.workspace,'source',f.sourceDrawing);
 const view=f.workspace.snapshots.find(snapshot=>snapshot.id==='view')!;view.deformation.layerDomains!.unshift({id:'prior-affine',layerIds:['slot'],matrix:[1,.1,.2,.9,.03,-.02]});view.deformation.layerDomains!.push({...structuredClone(parent.deformation.layerDomains![0]),id:'second-cage'});
 if(reflected){const mirror=emptyRecordingSnapshot('mirror');mirror.parentSnapshotId='view';mirror.inputMirror={axisX:.19,curvePairs:[]};mirror.layers=[{kind:'reference',id:'slot',name:'Reflected',baseSnapshotId:'view',baseLayerId:'slot'}];f.workspace.snapshots.push(mirror);const local=f.workspace.snapshots.find(snapshot=>snapshot.id==='child')!;if(local.layers[0].kind!=='reference')throw Error('fixture');local.layers[0].baseSnapshotId='mirror';}
 const before=child(f.workspace),result=detach(f.workspace),actual=child(result.workspace),loaded=child(parseRecordingSnapshots(JSON.parse(JSON.stringify(result.workspace))));sameGeometry(actual,result.wanted);sameGeometry(loaded,result.wanted);
 const track=actual.displayIntervals!.find(track=>track.id===id('ink'))!,path={segments:[track.anchor],closed:false},field=displayField(actual,path),prior=displayField(before,path),roundtrip=displayField(loaded,path);
 for(const t of [0,.17,.4,.83,1]){close(field.at(t).p,prior.at(t).p);close(roundtrip.at(t).p,field.at(t).p);}expect(track.ranges.map(range=>range.id)).toEqual([id('range')]);expect(evaluatedMaterialProgram(actual,moving.curveId)!.length).toBeGreaterThan(0);expect(evaluatedMaterialSource(actual).curves.find(curve=>curve.id===moving.curveId)!.nodes[0]).toBe(result.nodeUnbind.nodeId);expect(result.workspace.library).toEqual(f.workspace.library);
});

test.each([false,true])('inherited fitted split fork retains live siblings with hidden=%s',hidden=>{
 const f=bound('source',true);let serial=0;const raw=createCurveSplitIntent(f.sourceDrawing,'b',.371,{allocateId:()=>`fork-split-${++serial}`}),intent=mapCurveSplitIntent(raw,id),sourceId=f.workspace.snapshots[0].id,plan=prepareSnapshotCurveSplit(f.workspace,sourceId,intent),source=applyCurveSplitIntent(f.sourceDrawing,raw).document,candidate=upsertDrawingSource(f.workspace,'source',source,'Drawing source',{splitRetiredIds:new Set([intent.curveId])});f.workspace=finishSnapshotCurveSplit(plan,candidate);
 const [left,right]=intent.childCurveIds,local=f.workspace.snapshots.find(snapshot=>snapshot.id==='child')!;if(hidden){if(local.layers[0].kind!=='reference')throw Error('fixture');local.layers[0].membership={excludeElementIds:[right]};}
 const endpoint={curveId:left,end:0 as const},result=detach(f.workspace,endpoint),actual=child(result.workspace);sameGeometry(actual,result.wanted);expect(actual.curves.some(curve=>curve.id===right)).toBe(!hidden);expect(result.workspace.snapshots.find(snapshot=>snapshot.id==='child')!.nodeForks![result.nodeUnbind.nodeId]).toEqual(endpoint);expect(result.workspace.library).toEqual(f.workspace.library);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(result.workspace)))),actual);
 const rightCurve=source.curves.find(curve=>curve.id===raw.childCurveIds[1])!,changed=upsertDrawingSource(result.workspace,'source',moveHandle(source,{curveId:rightCurve.id,end:1},[rightCurve.handles[1][0]+.13,rightCurve.handles[1][1]-.07])),live=child(changed);expect(shapeOf(live,left)).not.toEqual(shapeOf(actual,left));expect(live.curves.some(curve=>curve.id===right)).toBe(!hidden);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(changed)))),live);
});
