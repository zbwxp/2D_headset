import {expect,test} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {createCurveSplitIntent,applyCurveSplitIntent,mapCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {emptyDrawing,shapeOf,type DrawingDocument} from '../../domain/drawing/model';
import {neutralBend} from '../../domain/deformation/coons';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork} from '../../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {resolveSnapshot,evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluatedControlParameter} from '../../domain/drawing/evaluatedDeformation';
import {createSnapshotSplitParameterField,recordSnapshotSplitParameterRanges,resolveSnapshotFitParameter} from '../../domain/recordingSnapshot/splitParameterField';
import {remapSnapshotMaterialPartitions} from '../../domain/recordingSnapshot/materialSplit';
import {remapSnapshotMaterialPathLineages} from '../../domain/recordingSnapshot/materialPathLineages';
import {transportSnapshotSimplexMaterial} from '../../domain/recordingSnapshot/simplexMaterial';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {point} from '../../domain/drawing/sampling';
import {subcurve} from '../../domain/drawing/roundedJoin';
const cid=(id:string)=>canonicalElementId('$working',id),curveId=cid('curve'),nativeT=.371;
function fixture(scope:'CURVE'|'PATH'='CURVE',ends:readonly [number,number]=[.15,.82]){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[-.8,-.3]},{id:'b',position:[.7,.5]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[-.6,.6],[.4,-.5]],width:.01,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',items:['curve'],visible:true,locked:false}],displayIntervals:[{id:'material',...(scope==='CURVE'?{scope}:{}),anchor:{id:'curve',reverse:false},ranges:[{id:'range',start:ends[0],end:ends[1]}]}]};
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing}),workspace=project.recordingSnapshots,source=drawingSnapshotForArtwork(workspace,'$working')!,view=emptyRecordingSnapshot('view'),bend=neutralBend();bend.handles[1][0][0]=1.25;
 view.layers=[{kind:'reference',id:'slot',name:'Curve',baseSnapshotId:source.id,baseLayerId:cid('layer')}];view.deformation.layerDomains=[{kind:'h-coons',id:'cage',layerIds:['slot'],restRect:{min:[-1,-1],max:[1,1]},quad:[[-1,-1],[1,-.7],[.7,1],[-.9,.8]],bend}];workspace.snapshots.push(view);
 const other=emptyRecordingSnapshot('other-view','Other','view',{x:90,y:0});other.layers=structuredClone(view.layers);workspace.snapshots.push(other);const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=['view','other-view'];recording.activeSnapshotId='view';recording.angleGraph=createSnapshotAngleGraph([{snapshotId:'view',angle:{x:0,y:0}},{snapshotId:'other-view',angle:{x:90,y:0}}]);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 let serial=0;const intent=createCurveSplitIntent(drawing,'curve',nativeT,{allocateId:()=>`proof-${++serial}`}),canonical=mapCurveSplitIntent(intent,cid),bases=recording.snapshotIds.map(snapshotId=>({snapshotId,drawing:resolveSnapshot(workspace,snapshotId,{useDraft:false}).drawing}));
 return {project,workspace,drawing,recording,intent,canonical,bases};
}

import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {moveHandle} from '../../domain/drawing/commands';
import {upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
function worldEndpoints(drawing:DrawingDocument){return (drawing.displayIntervals??[]).flatMap(track=>{const field=displayField(drawing,displayPath(drawing,track.anchor.id));return track.ranges.flatMap(range=>[field.at(field.native(track,range.start)).p,field.at(field.native(track,range.end)).p]);});}
function expectPoints(actual:readonly (readonly number[])[],expected:readonly (readonly number[])[]){expect(actual.length).toBe(expected.length);actual.forEach((p,i)=>p.forEach((value,axis)=>expect(value).toBeCloseTo(expected[i][axis],8)));}
test('equivalent transient parent cubics share one bounded numerical material table',()=>{const shape=shapeOf(fixture().bases[0].drawing,curveId),field=createSnapshotSplitParameterField(shape);expect(createSnapshotSplitParameterField(structuredClone(shape))).toBe(field);});
for(const scope of ['CURVE','PATH'] as const)for(const angle of [30,60])test(`inherited ${scope} material survives insertion at${angle} with either dominant basis`,()=>{
 const f=fixture(scope),project=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.drawing,f.intent).document,intent:f.intent}).project,ws=project.recordingSnapshots!,before=evaluateRecordingSnapshot(ws,f.recording.id,{angle:{x:angle,y:0},useDraft:false}).drawing;applySnapshotCommand(ws,{op:'createSnapshot',angle:{x:angle,y:0}});const actual=evaluateRecordingSnapshot(ws,f.recording.id,{angle:{x:angle,y:0},useDraft:false}).drawing;expectPoints(worldEndpoints(actual),worldEndpoints(before));
});
test('inserted real view replays the full live fitted parameter function through JSON and a source edit',()=>{
 const f=fixture(),parent=shapeOf(evaluateRecordingSnapshot(f.workspace,f.recording.id,{angle:{x:60,y:0},useDraft:false}).drawing,curveId),project=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.drawing,f.intent).document,intent:f.intent}).project,ws=project.recordingSnapshots!,parts=[{curveId:f.canonical.childCurveIds[0],parameterRange:[0,nativeT] as const},{curveId:f.canonical.childCurveIds[1],parameterRange:[nativeT,1] as const}];
 applySnapshotCommand(ws,{op:'createSnapshot',angle:{x:60,y:0}});const actual=evaluateRecordingSnapshot(ws,f.recording.id,{angle:{x:60,y:0},useDraft:false}).drawing;
 for(const t of [.13,.371,.713]){const expected=createSnapshotSplitParameterField(parent).parameterAt(f.bases.map(b=>evaluatedControlParameter(b.drawing,curveId,t)),[1/3,2/3]);expect(resolveSnapshotFitParameter(actual,parts,t)).toBeCloseTo(expected,8);}
 const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(ws)));expectPoints(worldEndpoints(evaluateRecordingSnapshot(loaded,f.recording.id,{angle:{x:60,y:0},useDraft:false}).drawing),worldEndpoints(actual));
 const source=project.drawing!,child=source.curves.find(c=>c.id===f.intent.childCurveIds[0])!,edited=moveHandle(source,{curveId:child.id,end:0},[child.handles[0][0]+.02,child.handles[0][1]+.013]),changed=upsertDrawingSource(loaded,'$working',edited),next=evaluateRecordingSnapshot(changed,f.recording.id,{angle:{x:60,y:0},useDraft:false}).drawing;
 expect(resolveSnapshotFitParameter(next,parts,.713)).not.toBe(resolveSnapshotFitParameter(actual,parts,.713));const roundtrip=parseRecordingSnapshots(JSON.parse(JSON.stringify(changed)));expectPoints(worldEndpoints(evaluateRecordingSnapshot(roundtrip,f.recording.id,{angle:{x:31,y:0},useDraft:false}).drawing),worldEndpoints(evaluateRecordingSnapshot(changed,f.recording.id,{angle:{x:31,y:0},useDraft:false}).drawing));
});
test('a further source split after insertion retains the current whole field and material points',()=>{
 const f=fixture(),project=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.drawing,f.intent).document,intent:f.intent}).project,ws=project.recordingSnapshots!;applySnapshotCommand(ws,{op:'createSnapshot',angle:{x:60,y:0}});const angles=[31,60,77],before=angles.map(x=>evaluateRecordingSnapshot(ws,f.recording.id,{angle:{x,y:0},useDraft:false}).drawing);let serial=0;const intent=createCurveSplitIntent(project.drawing!,f.intent.childCurveIds[1],.423,{allocateId:()=>`insert-repeat-${++serial}`}),canonical=mapCurveSplitIntent(intent,cid),after=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(project.drawing!,intent).document,intent}).project.recordingSnapshots!;
 const insertedId=Object.keys(ws.recordings[0].angleGraph!.materialBasisRecipes!)[0],inserted=after.snapshots.find(snapshot=>snapshot.id===insertedId)!;
 for(const state of [inserted.inheritedState,inserted.deformation,inserted.draft?.deformation])expect(Object.values(state?.layers??{}).flatMap(layer=>Object.values(layer.intervals??{})).filter(value=>value.appearance)).toEqual([]);
 for(const [index,x] of angles.entries()){const actual=evaluateRecordingSnapshot(after,f.recording.id,{angle:{x,y:0},useDraft:false}).drawing,old=before[index],parent=shapeOf(old,cid(intent.curveId)),a=shapeOf(actual,canonical.childCurveIds[0]),b=shapeOf(actual,canonical.childCurveIds[1]),u=a[1].map((v,i)=>v-a[0][i]),v=parent[1].map((v,i)=>v-parent[0][i]),axis=Math.abs(v[0])>Math.abs(v[1])?0:1,q=u[axis]/v[axis];expectPoints([...a,...b],[...subcurve(parent,0,q),...subcurve(parent,q,1)]);
  const oldTrack=old.displayIntervals!.find(t=>t.id===cid('material'))!,oldRight=old.displayIntervals!.find(t=>t.id===f.canonical.intervals[0].rightTrackId)!,newTrack=actual.displayIntervals!.find(t=>t.id===oldTrack.id)!,newRight=actual.displayIntervals!.find(t=>t.id===canonical.intervals[0].rightTrackId)!,oldField=displayField(old,displayPath(old,oldTrack.anchor.id)),newField=displayField(actual,displayPath(actual,newTrack.anchor.id));expectPoints([newField.at(newField.native(newTrack,newTrack.ranges[0].start)).p,newField.at(newField.native(newRight,newRight.ranges[0].end)).p],[oldField.at(oldField.native(oldTrack,oldTrack.ranges[0].start)).p,oldField.at(oldField.native(oldRight,oldRight.ranges[0].end)).p]);
 }
});
test('a fitted source split rejects an inserted view\'s affected authored interval atomically',()=>{
 const f=fixture(),project=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.drawing,f.intent).document,intent:f.intent}).project,ws=project.recordingSnapshots!;applySnapshotCommand(ws,{op:'createSnapshot',angle:{x:60,y:0}});
 const insertedId=Object.keys(ws.recordings[0].angleGraph!.materialBasisRecipes!)[0],inserted=ws.snapshots.find(snapshot=>snapshot.id===insertedId)!,drawing=resolveSnapshot(ws,insertedId,{useDraft:false}).drawing,rightId=f.canonical.intervals[0].rightTrackId,track=drawing.displayIntervals!.find(track=>track.id===rightId)!,layerId=drawing.layers.find(layer=>layer.items.includes(track.anchor.id))!.id;
 applySnapshotCommand(ws,{op:'changeInterval',layerId,sourceTrackId:rightId,rangeId:track.ranges[0].id,end:.9});applySnapshotCommand(ws,{op:'saveSelected',layerIds:[layerId]});expect(inserted.deformation.layers[layerId]?.intervals?.[rightId]?.appearance).toBeDefined();
 const bytes=JSON.stringify(project);let serial=0;const intent=createCurveSplitIntent(project.drawing!,f.intent.childCurveIds[1],.423,{allocateId:()=>`authored-repeat-${++serial}`});
 expect(()=>prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(project.drawing!,intent).document,intent})).toThrow(/authored interval .* inherited fitted material field needs exact authored-parameter rebasing/);
 expect(JSON.stringify(project)).toBe(bytes);
});
