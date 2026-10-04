import {expect,test} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {useEditor} from '../../app/store';
import {emptyDrawing,shapeOf,type DrawingDocument,type Cubic} from '../../domain/drawing/model';
import {createCurve,connect,deleteCurves} from '../../domain/drawing/commands';
import {createCurveSplitIntent,applyCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,syncRecordingSnapshotSources} from '../../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshot} from '../../domain/recordingSnapshot/model';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {layerCageDomainProjection,type SnapshotLayerCageDomain} from '../../domain/recordingSnapshot/layerCageDomain';
import {layerCageCurveIds} from '../../domain/recordingSnapshot/layerCageScope';
import {remapLayerDomains} from '../../domain/recordingSnapshot/layerDomains';
import {layerCageIntentForSelection} from '../../ui/drawing/layerDomainGesture';
import {resolveDrawingCage,beginDrawingCageGesture,updateDrawingCageGesture} from '../../ui/drawing/cageEditorController';
import {prepareSnapshotLocalDrawingEdit} from '../../domain/recordingSnapshot/drawingTopology';
const cid=(id:string)=>canonicalElementId('$working',id);
const line=(a:[number,number],b:[number,number]):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
const near=(a:Cubic,b:Cubic)=>a.flat().forEach((value,i)=>expect(value).toBeCloseTo(b.flat()[i],8));
function fixture(scoped=true){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[-.8,-.3]},{id:'b',position:[.3,.2]},{id:'c',position:[-.6,.4]},{id:'d',position:[.1,.5]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[-.6,.2],[.1,-.2]],width:.01,visible:true,locked:false},{id:'other',name:'Other',nodes:['c','d'],handles:[[-.4,.6],[-.1,.2]],width:.01,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',items:['curve','other'],visible:true,locked:false}]};
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing}),source=drawingSnapshotForArtwork(project.recordingSnapshots,'$working')!,view=emptyRecordingSnapshot('view');
 const domain:SnapshotLayerCageDomain={kind:'h-coons',id:'cage',layerIds:['slot'],...(scoped?{strokeScope:{kind:'continuous-strokes',curveIds:[cid('curve')]}}:{}),restRect:{min:[-1,-1],max:[1,1]},quad:[[-1,-1],[1,-.7],[.7,1],[-.9,.8]]};
 view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:cid('layer')}];view.deformation.layerDomains=[domain];project.recordingSnapshots.snapshots.push(view);return {project,drawing,domain};
}
function grow(drawing:DrawingDocument){
 let next=createCurve(drawing,'layer',line([.3,.2],[.8,.4]),.01,'Connected','connected');next=connect(next,{curveId:'curve',end:1},{curveId:'connected',end:0},'POSITION',undefined,true);
 return createCurve(next,'layer',line([-.2,.1],[.2,.3]),.01,'Nearby','nearby');
}
test('source additions follow whole layers or only their actual continuous stroke, never the rectangle',()=>{
 for(const scoped of [true,false]){const f=fixture(scoped),source=grow(f.drawing),project=syncRecordingSnapshotSources({...f.project,drawing:source}),evaluated=resolveSnapshot(project.recordingSnapshots!,'view'),field=layerCageDomainProjection(f.domain);
  expect(evaluated.diagnostics.filter(issue=>issue.code==='LAYER_DOMAIN')).toEqual([]);
  for(const id of ['connected','nearby','other']){const sourceShape=shapeOf(source,id),actual=shapeOf(evaluated.drawing,cid(id)),member=!scoped||id==='connected';expect(actual[0]).toEqual(member?field.map(sourceShape[0]):sourceShape[0]);expect(actual[3]).toEqual(member?field.map(sourceShape[3]):sourceShape[3]);}
  expect([...layerCageCurveIds(evaluated.source,f.domain)].sort()).toEqual((scoped?[cid('curve'),cid('connected')]:evaluated.source.curves.map(curve=>curve.id)).sort());
  expect(parseRecordingSnapshots(JSON.parse(JSON.stringify(project.recordingSnapshots)))).toEqual(project.recordingSnapshots);
 }
});
test('source split/deletion retain provenance and existing chronological Undo restores the exact cage',()=>{
 const f=fixture(),grown=syncRecordingSnapshotSources({...f.project,drawing:grow(f.drawing)});let serial=0;const intent=createCurveSplitIntent(grown.drawing!,'curve',.371,{allocateId:()=>`scope-${++serial}`}),plan=prepareSnapshotEdit(snapshotEditContext(grown,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(grown.drawing!,intent).document,intent}),split=plan.project;
 const cage=resolveSnapshot(split.recordingSnapshots!,'view').state.layerDomains![0] as SnapshotLayerCageDomain;expect([...cage.strokeScope!.curveIds].sort()).toEqual([...intent.childCurveIds.map(cid),cid('connected')].sort());
 const remove=prepareSnapshotEdit(snapshotEditContext(split,true),{kind:'original-geometry',drawing:deleteCurves(split.drawing!,[...intent.childCurveIds])}),after=resolveSnapshot(remove.project.recordingSnapshots!,'view');expect(after.diagnostics.filter(issue=>issue.code==='LAYER_DOMAIN')).toEqual([]);expect((after.state.layerDomains![0] as SnapshotLayerCageDomain).strokeScope!.curveIds).toEqual([cid('connected')]);near(shapeOf(after.drawing,cid('other')),shapeOf(f.drawing,'other'));
 const previous=useEditor.getState();try{useEditor.setState({project:split,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(remove);useEditor.getState().undo();expect(useEditor.getState().project).toBe(split);useEditor.getState().redo();expect(useEditor.getState().project).toBe(remove.project);}finally{useEditor.setState(previous,true);}
});
test('deleting the original anchor retains an appended connected survivor and empty scope never widens',()=>{
 const f=fixture(),grown=syncRecordingSnapshotSources({...f.project,drawing:grow(f.drawing)}),deleted=prepareSnapshotEdit(snapshotEditContext(grown,true),{kind:'original-geometry',drawing:deleteCurves(grown.drawing!,['curve'])}).project,evaluation=resolveSnapshot(deleted.recordingSnapshots!,'view'),domain=evaluation.state.layerDomains![0] as SnapshotLayerCageDomain;
 expect(domain.strokeScope!.curveIds).toEqual([cid('connected')]);expect(shapeOf(evaluation.drawing,cid('connected'))[3]).toEqual(layerCageDomainProjection(domain).map(shapeOf(deleted.drawing!,'connected')[3]));
 const empty=prepareSnapshotEdit(snapshotEditContext(deleted,true),{kind:'original-geometry',drawing:deleteCurves(deleted.drawing!,['connected'])}).project,last=resolveSnapshot(empty.recordingSnapshots!,'view');expect((last.state.layerDomains![0] as SnapshotLayerCageDomain).strokeScope!.curveIds).toEqual([]);near(shapeOf(last.drawing,cid('other')),shapeOf(f.drawing,'other'));expect(last.diagnostics.filter(issue=>issue.code==='LAYER_DOMAIN')).toEqual([]);
});
test('whole-stroke selection authors and reopens the same stage; full layer selection stays distinct',()=>{
 const f=fixture(),evaluation=resolveSnapshot(f.project.recordingSnapshots,'view'),drawing=evaluation.drawing,selection={ids:[cid('curve')]},cage=resolveDrawingCage(drawing,selection,{domains:evaluation.state.layerDomains})!,next=updateDrawingCageGesture(beginDrawingCageGesture(cage,selection,{corner:2},cage.quad[2]),[.8,1]);expect(next.intent!.operationId).toBe('cage');expect(next.intent!.replace).toBe(true);expect(next.intent!.domain.strokeScope).toEqual(f.domain.strokeScope);
 const layerIntent=layerCageIntentForSelection(drawing,{ids:drawing.curves.map(c=>c.id),layer:'slot'},f.domain);expect(layerIntent!.domain.strokeScope).toEqual(f.domain.strokeScope);const fresh={kind:'h-coons' as const,restRect:f.domain.restRect,quad:f.domain.quad};expect(layerCageIntentForSelection(drawing,{ids:drawing.curves.map(c=>c.id),layer:'slot'},fresh)!.domain.strokeScope).toBeUndefined();
 const grown=grow(f.drawing);expect(layerCageIntentForSelection(grown,{ids:['curve']},fresh)).toBeUndefined();expect(layerCageIntentForSelection(grown,{ids:['curve','connected']},fresh)!.domain.strokeScope!.curveIds).toEqual(['curve','connected']);
 const copy=remapLayerDomains([f.domain],id=>`copy:${id}`)[0] as SnapshotLayerCageDomain;expect(copy.strokeScope!.curveIds).toEqual([`copy:${cid('curve')}`]);
});
test('local new disconnected curves retain their authored controls beside a restricted cage',()=>{
 const f=fixture(),beforeDrawing=resolveSnapshot(f.project.recordingSnapshots,'view').drawing,wanted=createCurve(beforeDrawing,'slot',line([-.2,.1],[.2,.3]),.01,'Local','local'),next=prepareSnapshotLocalDrawingEdit(f.project.recordingSnapshots,{snapshotId:'view',state:'saved',beforeDrawing,drawing:wanted}).workspace,result=resolveSnapshot(next,'view');near(shapeOf(result.drawing,'local'),shapeOf(wanted,'local'));near(shapeOf(result.drawing,cid('curve')),shapeOf(beforeDrawing,cid('curve')));expect([...layerCageCurveIds(result.source,result.state.layerDomains![0] as SnapshotLayerCageDomain)]).toEqual([cid('curve')]);
});
