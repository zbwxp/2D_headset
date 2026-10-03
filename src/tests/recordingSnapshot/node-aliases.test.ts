import {afterEach,describe,expect,it} from 'vitest';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import {currentDrawingPresentation} from '../../app/drawingSnapshotPresentation';
import {prepareDrawingSnapshotEdit} from '../../app/drawingSnapshotEdit';
import {emptyDrawing,nodeAt,shapeOf,type DrawingDocument,type Point2,type Cubic} from '../../domain/drawing/model';
import {createCurve,connect,moveNode,deleteObjects,unbind,linkEndpoints} from '../../domain/drawing/commands';
import {createCurveSplitIntent,applyCurveSplitIntent,mapCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot} from '../../domain/recordingSnapshot/model';
import {canonicalElementId,upsertDrawingSource,drawingSnapshotForArtwork} from '../../domain/recordingSnapshot/sources';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {prepareSnapshotLocalDrawingEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {prepareIndependentSnapshotLayers} from '../../domain/recordingSnapshot/independentCopy';
import {prepareSnapshotCurveSplit,finishSnapshotCurveSplit} from '../../domain/recordingSnapshot/topologyEdits';
import {removeDeletedSourceReferences} from '../../domain/recordingSnapshot/sourceDeletion';
import {normalizeSnapshotNodeAliases} from '../../domain/recordingSnapshot/nodeAliases';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
const cid=(id:string)=>canonicalElementId('source',id),line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
const fixed={curveId:cid('left'),end:1 as const},moving={curveId:cid('right'),end:0 as const},third={curveId:cid('third'),end:0 as const};
const initial=useEditor.getState(),mode=useWorkspaceMode.getState().mode;afterEach(()=>{useEditor.setState(initial,true);useWorkspaceMode.setState({mode});});
function fixture(){
 let drawing:DrawingDocument={...emptyDrawing(),layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:[]}]};for(const [id,a,b] of [['left',[0,0],[1,0]],['right',[2,.5],[3,.5]],['third',[4,1],[5,1]]] as Array<[string,Point2,Point2]>)drawing=createCurve(drawing,'layer',line(a,b),.01,id,id);
 drawing.curves[0].profile='EYELID';drawing.curves[1].inkEnds=[{taper:.04},{taper:.05}];drawing.displayIntervals=[{id:'ink',scope:'CURVE',anchor:{id:'right',reverse:false},ranges:[{id:'range',start:.1,end:.8}]}];
 const w=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing),source=w.snapshots[0],view=emptyRecordingSnapshot('view');view.parentSnapshotId=source.id;view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:cid('layer')}];w.snapshots.push(view);return {w,source,view,drawing};
}
function edit(w:ReturnType<typeof fixture>['w'],operation:(drawing:DrawingDocument)=>DrawingDocument,snapshotId='view'){const beforeDrawing=resolveSnapshot(w,snapshotId,{diagnostics:'preview'}).drawing,drawing=operation(beforeDrawing);return {...prepareSnapshotLocalDrawingEdit(w,{snapshotId,state:'saved',beforeDrawing,drawing}),wanted:drawing};}
function expectDrawing(actual:DrawingDocument,wanted:DrawingDocument){for(const curve of wanted.curves){expect(actual.curves.find(value=>value.id===curve.id)?.nodes).toEqual(curve.nodes);expect(shapeOf(actual,curve.id).flat()).toEqual(shapeOf(wanted,curve.id).flat().map(v=>expect.closeTo(v,8)));}expect(actual.joins).toEqual(wanted.joins);expect((actual.displayIntervals??[]).map(track=>[track.id,track.ranges.map(range=>range.id)])).toEqual((wanted.displayIntervals??[]).map(track=>[track.id,track.ranges.map(range=>range.id)]));}
describe('Snapshot shared-node alias authority',()=>{
 it.each(['POSITION','SMOOTH','CUSP','ARC'] as const)('binds two inherited curves with ordinary %s topology and local appearance',mode=>{
  const {w,source}=fixture(),saved=JSON.stringify(w),old=resolveSnapshot(w,'view').drawing,result=edit(w,d=>connect(d,fixed,moving,mode)),actual=resolveSnapshot(result.workspace,'view').drawing;
  expectDrawing(actual,result.wanted);expect(nodeAt(actual,fixed).id).toBe(nodeAt(actual,moving).id);expect(result.workspace.snapshots.find(value=>value.id==='view')!.nodeAliases).toEqual({[nodeAt(old,moving).id]:nodeAt(old,fixed).id});expect(result.workspace.library).toEqual(w.library);expect(result.workspace.snapshots.find(value=>value.id===source.id)).toEqual(source);expect(JSON.stringify(w)).toBe(saved);
  expectDrawing(resolveSnapshot(parseRecordingSnapshots(JSON.parse(JSON.stringify(result.workspace))),'view').drawing,result.wanted);expect(actual.curves.find(curve=>curve.id===moving.curveId)!.inkEnds?.[0]).toEqual({taper:0,extension:0});
 });
 it('keeps the selected authority, flattens repeated aliases and updates all inherited members live',()=>{
  const {w}=fixture(),first=edit(w,d=>connect(d,fixed,moving,'POSITION')).workspace,before=resolveSnapshot(first,'view').drawing,next=edit(first,d=>connect(d,third,fixed,'POSITION')).workspace,snapshot=next.snapshots.find(value=>value.id==='view')!,actual=resolveSnapshot(next,'view').drawing,authority=nodeAt(actual,third).id;
  expect(snapshot.nodeAliases).toEqual({[nodeAt(resolveSnapshot(w,'view').drawing,moving).id]:authority,[nodeAt(before,fixed).id]:authority});expect(new Set([nodeAt(actual,fixed).id,nodeAt(actual,moving).id,nodeAt(actual,third).id]).size).toBe(1);
  const curve=next.library.curves[third.curveId],node=next.library.nodes[curve.nodes[0]];node.position=[node.position[0]+.4,node.position[1]+.2];curve.handles[0]=[curve.handles[0][0]+.4,curve.handles[0][1]+.2];const live=resolveSnapshot(next,'view').drawing;expect(nodeAt(live,fixed).position).toEqual(node.position);expect(nodeAt(live,moving).position).toEqual(node.position);
 });
 it('shares the merged graph through references and expands an independent copy without aliases',()=>{
  const {w}=fixture(),after=edit(w,d=>connect(d,fixed,moving,'CUSP')).workspace,parent=after.snapshots.find(value=>value.id==='view')!,child=emptyRecordingSnapshot('child');child.layers=[{kind:'reference',id:'child-slot',name:'Child',baseSnapshotId:parent.id,baseLayerId:'slot'}];after.snapshots.push(child);const current=resolveSnapshot(after,parent.id).drawing;expectDrawing(resolveSnapshot(after,child.id).drawing,{...current,layers:current.layers.map(layer=>({...layer,id:'child-slot'}))});
  const copy=prepareIndependentSnapshotLayers(after,parent,['slot'],()=> 'copy');expect(copy.snapshot.nodeAliases).toBeUndefined();const copied=resolveSnapshot({...after,library:copy.library,snapshots:[...after.snapshots,copy.snapshot]},copy.snapshot.id).drawing;expect(nodeAt(copied,{...fixed,curveId:copy.idMap[fixed.curveId]}).id).toBe(nodeAt(copied,{...moving,curveId:copy.idMap[moving.curveId]}).id);
 });
 it('moves the one shared authority on a later ordinary node edit with one Undo and source unchanged',()=>{
  const {w}=fixture(),first=edit(w,d=>connect(d,fixed,moving,'POSITION')).workspace,project={...createEmptyProject(),recordingSnapshots:first},beforeDrawing=resolveSnapshot(first,'view').drawing,drawing=moveNode(beforeDrawing,nodeAt(beforeDrawing,moving).id,[1.4,.2]),plan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-local-drawing',snapshotId:'view',state:'saved',beforeDrawing,drawing});
  expectDrawing(resolveSnapshot(plan.project.recordingSnapshots!,'view').drawing,drawing);expect(plan.project.recordingSnapshots!.library).toEqual(first.library);useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);
 });
 it('retains alias outer endpoints on a parent split and never aliases its new seam',()=>{
  const {w,drawing,source}=fixture(),after=edit(w,d=>connect(d,fixed,moving,'POSITION')).workspace,before=resolveSnapshot(after,'view').drawing;let serial=0;const raw=createCurveSplitIntent(drawing,'right',.4,{allocateId:()=>`split-${++serial}`}),intent=mapCurveSplitIntent(raw,cid),plan=prepareSnapshotCurveSplit(after,source.id,intent),candidate=upsertDrawingSource(after,'source',applyCurveSplitIntent(drawing,raw).document),result=finishSnapshotCurveSplit(plan,candidate),actual=resolveSnapshot(result,'view').drawing,wanted=applyCurveSplitIntent(before,{...intent,sourceNodeIds:before.curves.find(curve=>curve.id===intent.curveId)!.nodes},{propagate:true}).document;
  expectDrawing(actual,wanted);expect(result.snapshots.find(value=>value.id==='view')!.nodeAliases).toEqual(after.snapshots.find(value=>value.id==='view')!.nodeAliases);expect(result.snapshots.find(value=>value.id==='view')!.nodeAliases).not.toHaveProperty(intent.seamNodeId);expect(nodeAt(actual,{curveId:intent.childCurveIds[0],end:0}).id).toBe(nodeAt(actual,fixed).id);expect(()=>parseRecordingSnapshots(result)).not.toThrow();
 });
 it.each(['left','right'])('retires a source deletion on the %s side without stale aliases',removedCurve=>{
  const {w,drawing,source}=fixture(),after=edit(w,d=>connect(d,fixed,moving,'POSITION')).workspace,nextDrawing=deleteObjects(drawing,[removedCurve]),candidate=upsertDrawingSource(after,'source',nextDrawing),deleted=new Set([cid(removedCurve),...drawing.curves.find(curve=>curve.id===removedCurve)!.nodes.filter(id=>!nextDrawing.nodes.some(node=>node.id===id)).map(cid)]),result=removeDeletedSourceReferences(after,candidate,source.id,deleted);
  expect(result.snapshots.find(value=>value.id==='view')!.nodeAliases).toBeUndefined();expect(resolveSnapshot(result,'view').drawing.curves.some(curve=>curve.id===cid(removedCurve))).toBe(false);expect(()=>parseRecordingSnapshots(result)).not.toThrow();
 });
 it('keeps coherent inherited affine material for same-domain aliases',()=>{
  const {w,source}=fixture();source.deformation.layerDomains=[{id:'shear',layerIds:[cid('layer')],matrix:[1,.2,.3,1,0,0]}];const result=edit(w,d=>connect(d,fixed,moving,'CUSP')),actual=resolveSnapshot(result.workspace,'view').drawing;expectDrawing(actual,result.wanted);expect(()=>displayField(actual,displayPath(actual,fixed.curveId))).not.toThrow();const copy=prepareIndependentSnapshotLayers(result.workspace,result.workspace.snapshots.find(value=>value.id==='view')!,['slot'],()=> 'affine-copy');expect(copy.snapshot.nodeAliases).toBeUndefined();
 });
 it('replays authored shape and draft vectors on the new authority without retaining retired node offsets',()=>{
  const {w,view}=fixture(),before=resolveSnapshot(w,'view').drawing,a=nodeAt(before,fixed).id,b=nodeAt(before,moving).id;view.deformation.layers.slot={shape:{nodes:{[a]:[.1,.2],[b]:[-.3,.4]},handles:{[moving.curveId]:[[.1,.1],[.2,0]]}}};view.draft={angle:view.angle,deformation:{warps:[],bindings:[],layers:{slot:{shape:{nodes:{[a]:[.2,.3],[b]:[-.2,.5]},handles:{[moving.curveId]:[[.2,.1],[.3,0]]}}}},relationPositions:{}},channels:[]};
  const current=resolveSnapshot(w,'view').drawing,wanted=connect(current,fixed,moving,'SMOOTH'),result=prepareSnapshotLocalDrawingEdit(w,{snapshotId:'view',state:'active-draft',beforeDrawing:current,drawing:wanted}).workspace,snapshot=result.snapshots.find(value=>value.id==='view')!;expectDrawing(resolveSnapshot(result,'view').drawing,wanted);expect(snapshot.deformation.layers.slot.shape!.nodes).not.toHaveProperty(b);expect(snapshot.draft!.deformation.layers.slot.shape!.nodes).not.toHaveProperty(b);
 });
 it('keeps the canonical-source stale intent guard when adapting local aliases for source splitting',()=>{
  const {w,source}=fixture(),after=edit(w,d=>connect(d,fixed,moving,'POSITION')).workspace,before=resolveSnapshot(after,'view').drawing;const localIntent=createCurveSplitIntent(before,moving.curveId,.4);expect(()=>prepareSnapshotCurveSplit(after,source.id,localIntent)).toThrow(/canonical source curve topology/);
 });
 it('retains inherited join IDs and curve-local interval IDs through the same shared node graph',()=>{
  const f=fixture(),drawing=connect(f.drawing,{curveId:'left',end:0},{curveId:'third',end:1},'CUSP'),w=upsertDrawingSource(f.w,'source',drawing),before=resolveSnapshot(w,'view').drawing,originalJoin=before.joins[0],result=edit(w,d=>connect(d,fixed,moving,'SMOOTH')),actual=resolveSnapshot(result.workspace,'view').drawing;
  expectDrawing(actual,result.wanted);expect(actual.joins.find(join=>join.id===originalJoin.id)).toEqual(originalJoin);expect(actual.displayIntervals![0].id).toBe(before.displayIntervals![0].id);expect(actual.displayIntervals![0].ranges.map(range=>range.id)).toEqual(before.displayIntervals![0].ranges.map(range=>range.id));expect(result.workspace.snapshots.find(snapshot=>snapshot.id==='view')!.relations.joins?.add).toHaveLength(1);
 });
 it('invalidates cached membership input when only the immutable alias authority changes',()=>{
  const {w}=fixture(),before=resolveSnapshot(w,'view',{immutableInputs:true}),a=nodeAt(before.drawing,fixed).id,b=nodeAt(before.drawing,moving).id;
  const aliased={...w,snapshots:w.snapshots.map(snapshot=>snapshot.id==='view'?{...snapshot,nodeAliases:{[b]:a}}:snapshot)},after=resolveSnapshot(aliased,'view',{immutableInputs:true});expect(nodeAt(after.drawing,moving).id).toBe(a);expect(nodeAt(before.drawing,moving).id).toBe(b);expect(resolveSnapshot(aliased,'view',{immutableInputs:true}).drawing).toBe(after.drawing);
 });
 it('uses Drawing link cleanup when a later parent link becomes redundant in the local shared graph',()=>{
  const {w,drawing,source}=fixture(),after=edit(w,d=>connect(d,fixed,moving,'POSITION')).workspace,linked=linkEndpoints(drawing,{curveId:'left',end:1},{curveId:'right',end:0},true),live=upsertDrawingSource(after,'source',linked),actual=resolveSnapshot(live,'view').drawing;
  expect(nodeAt(actual,moving).id).toBe(nodeAt(actual,fixed).id);expect(actual.endpointLinks).toEqual([]);expect(resolveSnapshot(live,source.id).drawing.endpointLinks).toHaveLength(1);expect(()=>parseRecordingSnapshots(live)).not.toThrow();
 });
 it('rejects alias cycles and explicit inherited unbind without mutating state',()=>{
  for(const aliases of [{a:'a'},{a:'b',b:'a'},{a:''}] as Array<Record<string,string>>)expect(()=>normalizeSnapshotNodeAliases(aliases)).toThrow(/distinct IDs|authority cycle/);
  const {w}=fixture(),after=edit(w,d=>connect(d,fixed,moving,'POSITION')).workspace,saved=JSON.stringify(after);expect(()=>edit(after,d=>unbind(d,moving))).toThrow(/explicit local split\/unbind topology operation/);expect(JSON.stringify(after)).toBe(saved);
 });
});

const browserFixture=process.env.SNAPSHOT_NODE_ALIAS_FIXTURE??new URL('../../../artifacts/triangulated-recorder-qa/v63-reference-relation-browser-save.json',import.meta.url).pathname;
it.skipIf(!existsSync(browserFixture))('replays real saved Drawing inherited mouth endpoint bind with every source unchanged',()=>{
 const project=parseLandmarks(readFileSync(browserFixture,'utf8')),before=currentDrawingPresentation(project),id=(raw:string)=>canonicalElementId('1818859f-0eca-4acb-ad48-4e27b439df68',raw),a={curveId:id('61994863-fafd-4c74-857c-82adc0e9ef36'),end:0 as const},b={curveId:id('823d4140-276a-40a6-b633-f700d90b4b48'),end:1 as const};
 const wanted=connect(before,a,b,'POSITION'),plan=prepareDrawingSnapshotEdit(project,wanted),after=plan.project,actual=currentDrawingPresentation(after);expectDrawing(actual,wanted);expect(nodeAt(actual,a).id).toBe(nodeAt(actual,b).id);expect(after.drawing).toBe(project.drawing);expect(after.drawingSnapshots).toEqual(project.drawingSnapshots);expect(after.drawingWorkingCopies).toEqual(project.drawingWorkingCopies);expect(after.recordingSnapshots!.library).toEqual(project.recordingSnapshots!.library);
 const snapshot=drawingSnapshotForArtwork(after.recordingSnapshots!,project.drawingSnapshots!.activeId!)!;expect(snapshot.nodeAliases).toEqual({[nodeAt(before,b).id]:nodeAt(before,a).id});expectDrawing(currentDrawingPresentation(parseLandmarks(JSON.stringify(after))),wanted);useWorkspaceMode.setState({mode:'drawing'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);
 if(process.env.SNAPSHOT_NODE_ALIAS_OUTPUT)writeFileSync(process.env.SNAPSHOT_NODE_ALIAS_OUTPUT,JSON.stringify(after));
},120000);
