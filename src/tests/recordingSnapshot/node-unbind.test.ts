import {afterEach,describe,expect,it} from 'vitest';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import {currentDrawingPresentation,drawingSnapshotPresentation} from '../../app/drawingSnapshotPresentation';
import {prepareDrawingSnapshotEdit} from '../../app/drawingSnapshotEdit';
import {createVectorEditingApi} from '../../app/vectorEditingApi';
import {emptyDrawing,nodeAt,shapeOf,type DrawingDocument,type Point2,type Cubic,type Endpoint} from '../../domain/drawing/model';
import {createCurve,connect,unbind,moveNode,deleteObjects} from '../../domain/drawing/commands';
import {createCurveSplitIntent,applyCurveSplitIntent,mapCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {resolveSnapshot,evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {pruneSnapshotResponseDependencies} from '../../domain/recordingSnapshot/responseExpressionTransactions';
import {allSnapshotIds} from '../../domain/recordingSnapshot/commands';
import {prepareSnapshotLocalDrawingEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {createSnapshotNodeUnbindIntent,validateSnapshotNodeForks} from '../../domain/recordingSnapshot/nodeForks';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {prepareIndependentSnapshotLayers} from '../../domain/recordingSnapshot/independentCopy';
import {prepareSnapshotCurveSplit,finishSnapshotCurveSplit,splitSnapshotLocalCurve} from '../../domain/recordingSnapshot/topologyEdits';
import {removeDeletedSourceReferences} from '../../domain/recordingSnapshot/sourceDeletion';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
const cid=(id:string)=>canonicalElementId('source',id),line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
const fixed={curveId:cid('left'),end:1 as const},moving={curveId:cid('right'),end:0 as const};
const initial=useEditor.getState(),mode=useWorkspaceMode.getState().mode;afterEach(()=>{useEditor.setState(initial,true);useWorkspaceMode.setState({mode});});
function fixture(kind:'alias'|'source'){
 let drawing:DrawingDocument={...emptyDrawing(),layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:[]}]};for(const [id,a,b] of [['left',[0,0],[1,0]],['right',[2,.5],[3,.5]]] as Array<[string,Point2,Point2]>)drawing=createCurve(drawing,'layer',line(a,b),.01,id,id);
 if(kind==='source')drawing=connect(drawing,{curveId:'left',end:1},{curveId:'right',end:0},'CUSP');drawing.displayIntervals=[{id:'ink',scope:'CURVE',anchor:{id:'right',reverse:false},ranges:[{id:'range',start:.1,end:.8}]}];
 let w=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing);const source=w.snapshots[0],view=emptyRecordingSnapshot('view');view.parentSnapshotId=source.id;view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:cid('layer')}];w.snapshots.push(view);
 if(kind==='alias'){const beforeDrawing=resolveSnapshot(w,view.id).drawing;w=prepareSnapshotLocalDrawingEdit(w,{snapshotId:view.id,state:'saved',beforeDrawing,drawing:connect(beforeDrawing,fixed,moving,'CUSP')}).workspace;}
 return {w,source,drawing};
}
function detach(w:ReturnType<typeof fixture>['w'],endpoint:Endpoint=moving){const beforeDrawing=resolveSnapshot(w,'view').drawing,drawing=unbind(beforeDrawing,endpoint),nodeUnbind=createSnapshotNodeUnbindIntent('view',beforeDrawing,drawing,endpoint)!;return {...prepareSnapshotLocalDrawingEdit(w,{snapshotId:'view',state:'saved',beforeDrawing,drawing,nodeUnbind}),wanted:drawing,nodeUnbind};}
function expectDrawing(actual:DrawingDocument,wanted:DrawingDocument){expect(actual.nodes.map(node=>node.id).sort()).toEqual(wanted.nodes.map(node=>node.id).sort());for(const curve of wanted.curves){expect(actual.curves.find(value=>value.id===curve.id)?.nodes).toEqual(curve.nodes);expect(shapeOf(actual,curve.id).flat()).toEqual(shapeOf(wanted,curve.id).flat().map(value=>expect.closeTo(value,8)));}expect(actual.joins).toEqual(wanted.joins);expect(actual.displayIntervals?.map(track=>[track.id,track.ranges.map(range=>range.id)])).toEqual(wanted.displayIntervals?.map(track=>[track.id,track.ranges.map(range=>range.id)]));}
describe('explicit Snapshot-local endpoint unbind',()=>{
 it.each(['alias','source'] as const)('detaches one inherited %s endpoint using Drawing’s new identity and leaves every source unchanged',kind=>{
  const {w,source}=fixture(kind),before=JSON.stringify(w),result=detach(w),actual=resolveSnapshot(result.workspace,'view').drawing,snapshot=result.workspace.snapshots.find(value=>value.id==='view')!;
  expectDrawing(actual,result.wanted);expect(nodeAt(actual,moving).id).toBe(result.nodeUnbind.nodeId);expect(nodeAt(actual,moving).id).not.toBe(nodeAt(actual,fixed).id);expect(snapshot.nodeForks).toEqual({[result.nodeUnbind.nodeId]:moving});expect(snapshot.nodeAliases).toBeUndefined();expect(result.workspace.library).toEqual(w.library);expect(result.workspace.snapshots.find(value=>value.id===source.id)).toEqual(source);expect(JSON.stringify(w)).toBe(before);expectDrawing(resolveSnapshot(parseRecordingSnapshots(JSON.parse(JSON.stringify(result.workspace))),'view').drawing,result.wanted);
 });
 it.each(['alias','source'] as const)('retains current shape then follows the %s source endpoint independently of local edits',kind=>{
  const {w}=fixture(kind),result=detach(w),before=resolveSnapshot(result.workspace,'view').drawing,newId=result.nodeUnbind.nodeId,position=nodeAt(before,moving).position,wanted=moveNode(before,newId,[position[0]+.2,position[1]+.3]),local=prepareSnapshotLocalDrawingEdit(result.workspace,{snapshotId:'view',state:'saved',beforeDrawing:before,drawing:wanted}).workspace;expectDrawing(resolveSnapshot(local,'view').drawing,wanted);
  const root=local.library.curves[moving.curveId].nodes[0],delta:Point2=[.1,.4];local.library.nodes[root].position=local.library.nodes[root].position.map((v,i)=>v+delta[i]) as Point2;for(const curve of Object.values(local.library.curves))for(const end of [0,1] as const)if(curve.nodes[end]===root)curve.handles[end]=curve.handles[end].map((v,i)=>v+delta[i]) as Point2;
  const live=resolveSnapshot(local,'view').drawing;expect(nodeAt(live,moving).position).toEqual(nodeAt(wanted,moving).position.map((v,i)=>expect.closeTo(v+delta[i],8)));if(kind==='alias')expect(nodeAt(live,fixed).position).toEqual(nodeAt(wanted,fixed).position);
 });
 it('detaches the retained alias authority while the other branch keeps its old node ID',()=>{
  const {w}=fixture('alias'),before=resolveSnapshot(w,'view').drawing,result=detach(w,fixed),actual=resolveSnapshot(result.workspace,'view').drawing;expectDrawing(actual,result.wanted);expect(nodeAt(actual,moving).id).toBe(nodeAt(before,moving).id);expect(result.workspace.snapshots.find(value=>value.id==='view')!.nodeAliases).toBeDefined();
 });
 it('binds, unbinds and binds the new local endpoint repeatedly without duplicating authorities',()=>{
  const {w}=fixture('alias'),first=detach(w),a=resolveSnapshot(first.workspace,'view').drawing,b=connect(a,fixed,moving,'POSITION'),rebound=prepareSnapshotLocalDrawingEdit(first.workspace,{snapshotId:'view',state:'saved',beforeDrawing:a,drawing:b}).workspace;expectDrawing(resolveSnapshot(rebound,'view').drawing,b);
  const second=detach(rebound),c=resolveSnapshot(second.workspace,'view').drawing;expectDrawing(c,second.wanted);expect(Object.values(second.workspace.snapshots.find(value=>value.id==='view')!.nodeForks!).filter(value=>value.bind!==false)).toHaveLength(1);expect(nodeAt(c,moving).id).not.toBe(first.nodeUnbind.nodeId);
 });
 it.each(['alias','source'] as const)('preserves fork identity on a parent %s split and keeps its material range IDs',kind=>{
  const {w,drawing,source}=fixture(kind),detached=detach(w),before=resolveSnapshot(detached.workspace,'view').drawing;let serial=0;const raw=createCurveSplitIntent(drawing,'right',.4,{allocateId:()=>`split-${++serial}`}),intent=mapCurveSplitIntent(raw,cid),plan=prepareSnapshotCurveSplit(detached.workspace,source.id,intent),candidate=upsertDrawingSource(detached.workspace,'source',applyCurveSplitIntent(drawing,raw).document,'Drawing source',{splitRetiredIds:new Set([intent.curveId])}),result=finishSnapshotCurveSplit(plan,candidate),actual=resolveSnapshot(result,'view').drawing,wanted=applyCurveSplitIntent(before,{...intent,sourceNodeIds:before.curves.find(curve=>curve.id===intent.curveId)!.nodes},{propagate:true}).document;
  expectDrawing(actual,wanted);expect(result.snapshots.find(value=>value.id==='view')!.nodeForks?.[detached.nodeUnbind.nodeId]).toEqual({curveId:intent.childCurveIds[0],end:0});expect(nodeAt(actual,{curveId:intent.childCurveIds[0],end:0}).id).toBe(detached.nodeUnbind.nodeId);
 });
 it('shares the independent local node through references and expands it in independent copies',()=>{
  const detached=detach(fixture('alias').w),w=detached.workspace,parent=w.snapshots.find(value=>value.id==='view')!,child=emptyRecordingSnapshot('child');child.layers=[{kind:'reference',id:'child-slot',name:'Child',baseSnapshotId:parent.id,baseLayerId:'slot'}];w.snapshots.push(child);const actual=resolveSnapshot(w,'view').drawing;expectDrawing(resolveSnapshot(w,'child').drawing,actual);
  const copy=prepareIndependentSnapshotLayers(w,parent,['slot'],()=> 'fork-copy'),copied=resolveSnapshot({...w,library:copy.library,snapshots:[...w.snapshots,copy.snapshot]},copy.snapshot.id).drawing;expect(copy.snapshot.nodeForks).toBeUndefined();expect(nodeAt(copied,{...moving,curveId:copy.idMap[moving.curveId]}).id).toBe(copy.idMap[detached.nodeUnbind.nodeId]);expect(nodeAt(copied,{...moving,curveId:copy.idMap[moving.curveId]}).id).not.toBe(nodeAt(copied,{...fixed,curveId:copy.idMap[fixed.curveId]}).id);
 });
 it('retires the local identity and references when its source curve is deleted',()=>{
  const {w,drawing,source}=fixture('alias'),detached=detach(w),nextDrawing=deleteObjects(drawing,['right']),candidate=upsertDrawingSource(detached.workspace,'source',nextDrawing),removed=new Set([cid('right'),...drawing.curves.find(curve=>curve.id==='right')!.nodes.filter(id=>!nextDrawing.nodes.some(node=>node.id===id)).map(cid)]),after=removeDeletedSourceReferences(detached.workspace,candidate,source.id,removed);expect(after.snapshots.find(value=>value.id==='view')!.nodeForks).toBeUndefined();expect(resolveSnapshot(after,'view').drawing.nodes.some(node=>node.id===detached.nodeUnbind.nodeId)).toBe(false);expect(()=>parseRecordingSnapshots(after)).not.toThrow();
 });
 it('commits the explicit command through one common transaction and atomic Undo/Redo',()=>{
  const {w}=fixture('source'),project={...createEmptyProject(),recordingSnapshots:w},beforeDrawing=resolveSnapshot(w,'view').drawing,drawing=unbind(beforeDrawing,moving),nodeUnbind=createSnapshotNodeUnbindIntent('view',beforeDrawing,drawing,moving)!,plan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-local-drawing',snapshotId:'view',state:'saved',beforeDrawing,drawing,nodeUnbind});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);expectDrawing(resolveSnapshot(useEditor.getState().project.recordingSnapshots!,'view').drawing,drawing);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);
 });
 it('keeps a live endpoint origin when the detached curve is split only in this Snapshot',()=>{
  const detached=detach(fixture('alias').w),before=resolveSnapshot(detached.workspace,'view').drawing,intent=createCurveSplitIntent(before,moving.curveId,.4),result=splitSnapshotLocalCurve(detached.workspace,'view',intent).workspace,wanted=applyCurveSplitIntent(before,intent,{propagate:true}).document,actual=resolveSnapshot(result,'view').drawing;
  expectDrawing(actual,wanted);expect(result.snapshots.find(value=>value.id==='view')!.nodeForks?.[detached.nodeUnbind.nodeId]).toEqual({curveId:intent.childCurveIds[0],end:0,source:moving});expect(()=>parseRecordingSnapshots(result)).not.toThrow();
 });
 it('preserves current controls and the local node identity under an inherited coherent affine',()=>{
  const f=fixture('source');f.w.snapshots.find(value=>value.id===f.source.id)!.deformation.layerDomains=[{id:'shear',layerIds:[cid('layer')],matrix:[1,.2,.3,1,0,0]}];const result=detach(f.w),actual=resolveSnapshot(result.workspace,'view').drawing;expectDrawing(actual,result.wanted);const copy=prepareIndependentSnapshotLayers(result.workspace,result.workspace.snapshots.find(value=>value.id==='view')!,['slot'],()=> 'affine-copy');expect(copy.snapshot.nodeForks).toBeUndefined();
 });
 it('recognizes the inherited fork ID in real basis edits, interior corrections, insertion and JSON dependency validation',()=>{
  const detached=detach(fixture('source').w),w=detached.workspace,nodeId=detached.nodeUnbind.nodeId,front=emptyRecordingSnapshot('front'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0});
  for(const view of [front,side])view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:'view',baseLayerId:'slot'}];side.deformation.layers.slot={shape:{nodes:{[nodeId]:[1,.5]},handles:{}}};w.snapshots.push(front,side);const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=[front.id,side.id];recording.activeSnapshotId=front.id;recording.angleGraph=createSnapshotAngleGraph([front,side].map(view=>({snapshotId:view.id,angle:view.angle})));w.recordings=[recording];w.activeRecordingId=recording.id;
  expect(w.library.nodes[nodeId]).toBeUndefined();expect(allSnapshotIds(w)).toContain(nodeId);let project={...createEmptyProject(),recordingSnapshots:w};const base=resolveSnapshot(w,front.id).drawing.nodes.find(node=>node.id===nodeId)!.position;
  const saved=prepareSnapshotBatch(project,{commands:[{op:'moveShapeNode',layerId:'slot',nodeId,position:[base[0]+.1,base[1]+.1]},{op:'updateSnapshot'}]});project={...project,recordingSnapshots:saved.recordingSnapshots};expect(evaluateRecordingSnapshot(project.recordingSnapshots,'recording').drawing.nodes.find(node=>node.id===nodeId)!.position).toEqual([base[0]+.1,base[1]+.1]);
  const middle=evaluateRecordingSnapshot(project.recordingSnapshots,'recording',{angle:{x:45,y:0}}).drawing.nodes.find(node=>node.id===nodeId)!.position,wanted:Point2=[middle[0]+.1,middle[1]+.05],corrected=prepareSnapshotBatch(project,{commands:[{op:'setAngle',angle:{x:45,y:0}},{op:'moveShapeNode',layerId:'slot',nodeId,position:wanted},{op:'updateSnapshot'}]});project={...project,recordingSnapshots:corrected.recordingSnapshots};
  expect(evaluateRecordingSnapshot(project.recordingSnapshots,'recording').drawing.nodes.find(node=>node.id===nodeId)!.position).toEqual(wanted.map(value=>expect.closeTo(value,8)));const inserted=prepareSnapshotBatch(project,{commands:[{op:'createSnapshot',angle:{x:30,y:0}}]}).recordingSnapshots,registry=JSON.stringify(inserted.recordings[0].angleGraph!.responseExpressions),pruned=pruneSnapshotResponseDependencies(inserted);expect(JSON.stringify(pruned.recordings[0].angleGraph!.responseExpressions)).toBe(registry);expect(pruned.library.nodes[nodeId]).toBeUndefined();
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(pruned)));expect(evaluateRecordingSnapshot(loaded,'recording',{angle:{x:45,y:0}}).drawing.nodes.find(node=>node.id===nodeId)!.position).toEqual(wanted.map(value=>expect.closeTo(value,8)));
 });
 it('removes explicit local-curve dependents when their fork origin is permanently deleted',()=>{
  const {w,drawing,source}=fixture('alias'),detached=detach(w),before=resolveSnapshot(detached.workspace,'view').drawing,intent=createCurveSplitIntent(before,moving.curveId,.4),local=splitSnapshotLocalCurve(detached.workspace,'view',intent).workspace,nextDrawing=deleteObjects(drawing,['right']),candidate=upsertDrawingSource(local,'source',nextDrawing),removed=new Set([cid('right'),...drawing.curves.find(curve=>curve.id==='right')!.nodes.filter(id=>!nextDrawing.nodes.some(node=>node.id===id)).map(cid)]),after=removeDeletedSourceReferences(local,candidate,source.id,removed);
  expect(after.snapshots.find(value=>value.id==='view')!.nodeForks).toBeUndefined();expect(after.library.curves[intent.childCurveIds[0]]).toBeUndefined();expect(resolveSnapshot(after,'view').drawing.nodes.some(node=>node.id===detached.nodeUnbind.nodeId)).toBe(false);expect(()=>parseRecordingSnapshots(after)).not.toThrow();
 });
 it('rejects an unmarked, stale or malformed identity event before any mutation',()=>{
  const {w}=fixture('source'),beforeDrawing=resolveSnapshot(w,'view').drawing,drawing=unbind(beforeDrawing,moving),nodeUnbind=createSnapshotNodeUnbindIntent('view',beforeDrawing,drawing,moving)!,saved=JSON.stringify(w);expect(()=>prepareSnapshotLocalDrawingEdit(w,{snapshotId:'view',state:'saved',beforeDrawing,drawing})).toThrow(/explicit local split\/unbind/);expect(()=>prepareSnapshotLocalDrawingEdit(w,{snapshotId:'view',state:'saved',beforeDrawing,drawing,nodeUnbind:{...nodeUnbind,nodeId:'stale'}})).toThrow(/no longer matches/);expect(JSON.stringify(w)).toBe(saved);expect(()=>validateSnapshotNodeForks({a:{curveId:'right',end:0},b:{curveId:'right',end:0}})).toThrow(/multiple local node authorities/);
 });
});

const browserFixture=process.env.SNAPSHOT_NODE_UNBIND_FIXTURE??new URL('../../../artifacts/triangulated-recorder-qa/v63-reference-relation-browser-save.json',import.meta.url).pathname;
it.skipIf(!existsSync(browserFixture))('replays the real saved mouth’s inherited shared-node unbind through the Drawing transaction',()=>{
 const project=parseLandmarks(readFileSync(browserFixture,'utf8')),before=currentDrawingPresentation(project),presentation=drawingSnapshotPresentation(project.recordingSnapshots!,project.drawingSnapshots!.activeId!)!,endpoint={curveId:canonicalElementId('1818859f-0eca-4acb-ad48-4e27b439df68','823d4140-276a-40a6-b633-f700d90b4b48'),end:0 as const},wanted=unbind(before,endpoint),intent=createSnapshotNodeUnbindIntent(presentation.snapshotId,before,wanted,endpoint)!,plan=prepareDrawingSnapshotEdit(project,wanted,intent),after=plan.project;
 expectDrawing(currentDrawingPresentation(after),wanted);expect(after.drawing).toBe(project.drawing);expect(after.drawingSnapshots).toEqual(project.drawingSnapshots);expect(after.drawingWorkingCopies).toEqual(project.drawingWorkingCopies);expect(after.recordingSnapshots!.library).toEqual(project.recordingSnapshots!.library);expectDrawing(currentDrawingPresentation(parseLandmarks(JSON.stringify(after))),wanted);
 useWorkspaceMode.setState({mode:'drawing'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
 const node=nodeAt(currentDrawingPresentation(after),endpoint),position:Point2=[node.position[0]+.03,node.position[1]+.02],api=createVectorEditingApi(),moved=api.execute({commands:[{op:'moveNode',nodeId:intent.nodeId,position}]});expect(moved.ok,moved.ok?'':moved.error.message).toBe(true);expect(nodeAt(currentDrawingPresentation(useEditor.getState().project),endpoint).position).toEqual(position.map(value=>expect.closeTo(value,8)));expect(useEditor.getState().project.recordingSnapshots!.library).toEqual(after.recordingSnapshots!.library);
 if(process.env.SNAPSHOT_NODE_UNBIND_OUTPUT)writeFileSync(process.env.SNAPSHOT_NODE_UNBIND_OUTPUT,JSON.stringify(after));
},120000);
