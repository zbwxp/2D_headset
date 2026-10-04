import {createDrawingPathMaterialFrame} from '../../domain/drawing/pathMaterialSupport';
import {snapshotSplitParameterParts} from '../../domain/recordingSnapshot/splitParameterField';
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
import {resolveSnapshotFitParameter} from '../../domain/recordingSnapshot/splitParameterField';
import {displayField,displayPath} from '../../domain/drawing/displayIntervals';
import {point} from '../../domain/drawing/sampling';
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
function worldEndpoints(drawing:DrawingDocument){return (drawing.displayIntervals??[]).flatMap(track=>{const field=displayField(drawing,displayPath(drawing,track.anchor.id));return track.ranges.flatMap(range=>[field.at(field.native(track,range.start)).p,field.at(field.native(track,range.end)).p]);});}
function expectPoints(actual:readonly (readonly number[])[],expected:readonly (readonly number[])[]){expect(actual.length).toBe(expected.length);actual.forEach((p,i)=>p.forEach((value,axis)=>expect(value).toBeCloseTo(expected[i][axis],8)));}

import {useEditor} from '../../app/store';
function authoredFixture(scope:'CURVE'|'PATH'='CURVE',collapsed=false,insertAngle=60,independent=false){
 const f=fixture(scope),project=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.drawing,f.intent).document,intent:f.intent}).project,ws=project.recordingSnapshots!;applySnapshotCommand(ws,{op:'createSnapshot',angle:{x:insertAngle,y:0}});
 const insertedId=Object.keys(ws.recordings[0].angleGraph!.materialBasisRecipes!)[0],drawing=resolveSnapshot(ws,insertedId,{useDraft:false}).drawing,rightId=scope==='CURVE'?f.canonical.intervals[0].rightTrackId:cid('material'),track=drawing.displayIntervals!.find(track=>track.id===rightId)!,layerId=drawing.layers.find(layer=>layer.items.includes(track.anchor.id))!.id;
 applySnapshotCommand(ws,{op:'changeInterval',layerId,sourceTrackId:rightId,rangeId:track.ranges[0].id,...(collapsed?{start:.9}:{}),end:.9});applySnapshotCommand(ws,{op:'saveSelected',layerIds:[layerId]});
 if(independent){const current=resolveSnapshot(ws,insertedId,{useDraft:false}).drawing,curve=current.curves.find(curve=>curve.id===cid(f.intent.childCurveIds[1]))!;applySnapshotCommand(ws,{op:'moveShapeHandle',layerId,curveId:curve.id,end:1,position:[curve.handles[1][0]+.07,curve.handles[1][1]+.09]});applySnapshotCommand(ws,{op:'saveSelected',layerIds:[layerId]});expect(resolveSnapshot(ws,insertedId,{useDraft:false}).drawing.curves.find(value=>value.id===curve.id)!.handles[1]).not.toEqual(curve.handles[1]);}
 let serial=0;const intent=createCurveSplitIntent(project.drawing!,f.intent.childCurveIds[1],.423,{allocateId:()=>`authored-repeat-${++serial}`}),canonical=mapCurveSplitIntent(intent,cid);
 return {...f,project,ws,insertedId,rightId,layerId,intent,canonical};
}
function outer(drawing:DrawingDocument,startId:string,endId:string){const start=drawing.displayIntervals!.find(t=>t.id===startId)!,end=drawing.displayIntervals!.find(t=>t.id===endId)!,field=displayField(drawing,displayPath(drawing,start.anchor.id));return [field.at(field.native(start,start.ranges[0].start)).p,field.at(field.native(end,end.ranges[0].end)).p];}
for(const [scope,collapsed,insertAngle,independent] of [['CURVE',false,60,false],['PATH',false,60,false],['CURVE',true,60,false],['CURVE',false,30,false],['PATH',false,30,false],['CURVE',false,60,true]] as const)test(`authored ${scope}${collapsed?' collapsed':''}${independent?' independently shaped':''} at ${insertAngle} material keeps its live source frame through split, JSON and Undo`,()=>{
 const f=authoredFixture(scope,collapsed,insertAngle,independent),angles=[insertAngle,29,31,59,61,77],before=angles.map(x=>evaluateRecordingSnapshot(f.ws,f.recording.id,{angle:{x,y:0},useDraft:false}).drawing),bytes=JSON.stringify(f.project),raw=f.ws.snapshots.find(s=>s.id===f.insertedId)!.deformation.layers[f.layerId].intervals![f.rightId].appearance!,plan=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.project.drawing!,f.intent).document,intent:f.intent}),after=plan.project.recordingSnapshots!,lastId=scope==='CURVE'?f.canonical.intervals[0].rightTrackId:f.rightId;
 expect(plan.before).toBe(f.project);expect(plan.changed).toBe(true);expect(JSON.stringify(f.project)).toBe(bytes);
 const owned=after.snapshots.find(s=>s.id===f.insertedId)!.deformation.layers[f.layerId].intervals!;
 expect(owned[lastId].appearance).toBeDefined();expect(owned[lastId].authoredMaterial!.appearance).toEqual(raw);
 for(const [i,x] of angles.entries()){const drawing=evaluateRecordingSnapshot(after,f.recording.id,{angle:{x,y:0},useDraft:false}).drawing;expectPoints(outer(drawing,cid('material'),lastId),outer(before[i],cid('material'),f.rightId));if(collapsed&&x===insertAngle)for(const track of drawing.displayIntervals!)for(const range of track.ranges)expect(range.start).toBe(range.end);}
 const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(after)));for(const x of angles)expectPoints(worldEndpoints(evaluateRecordingSnapshot(loaded,f.recording.id,{angle:{x,y:0},useDraft:false}).drawing),worldEndpoints(evaluateRecordingSnapshot(after,f.recording.id,{angle:{x,y:0},useDraft:false}).drawing));
 const previous=useEditor.getState();try{useEditor.setState({project:f.project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([f.project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(f.project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);}finally{useEditor.setState(previous,true);}
 // Source refresh retains the authored native support while the fitted cut
 // changes. Evaluate that support on the live children independently of the
 // material-transfer implementation, then verify all interpolated JSON frames.
 const originalSource=resolveSnapshot(f.ws,f.insertedId,{useDraft:false}).source,input=originalSource.displayIntervals!.find(t=>t.id===f.rightId)!,support=createDrawingPathMaterialFrame(originalSource,input).materialAt(raw.ranges[0].end);expect(support.kind).toBe('curve');if(support.kind!=='curve')return;
 const oldQ=resolveSnapshotFitParameter(resolveSnapshot(after,f.insertedId,{useDraft:false}).drawing,f.canonical.childCurveIds.map((curveId,i)=>({curveId,parameterRange:(i?[.423,1]:[0,.423]) as [number,number]})),.713);
 const source=f.project.drawing!,curve=source.curves.find(c=>c.id===f.intent.curveId)!,changed=moveHandle(source,{curveId:curve.id,end:1},[curve.handles[1][0]-.04,curve.handles[1][1]+.06]),newProject=prepareSnapshotEdit(snapshotEditContext(plan.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(changed,f.intent).document}).project,newLive=newProject.recordingSnapshots!,currentEvaluation=resolveSnapshot(newLive,f.insertedId,{useDraft:false}),current=currentEvaluation.drawing,parts=snapshotSplitParameterParts(current,f.canonical.childCurveIds.map((curveId,i)=>({curveId,parameterRange:(i?[.423,1]:[0,.423]) as [number,number]}))),fitted=resolveSnapshotFitParameter(currentEvaluation.source,f.canonical.childCurveIds.map((curveId,i)=>({curveId,parameterRange:(i?[.423,1]:[0,.423]) as [number,number]})),support.t)!,part=parts.find(part=>fitted<=part.parameterRange[1])??parts.at(-1)!,t=(fitted-part.parameterRange[0])/(part.parameterRange[1]-part.parameterRange[0]);
 expect(resolveSnapshotFitParameter(current,f.canonical.childCurveIds.map((curveId,i)=>({curveId,parameterRange:(i?[.423,1]:[0,.423]) as [number,number]})),.713)).not.toBe(oldQ);
 expectPoints(outer(current,cid('material'),lastId).slice(-1),[point(shapeOf(current,part.curveId),t)]);
 const liveLoaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(newLive)));for(const x of angles)expectPoints(worldEndpoints(evaluateRecordingSnapshot(liveLoaded,f.recording.id,{angle:{x,y:0},useDraft:false}).drawing),worldEndpoints(evaluateRecordingSnapshot(newLive,f.recording.id,{angle:{x,y:0},useDraft:false}).drawing));
},20000);


test('an authored ARC material split remains atomic until its retained grid is supported',()=>{
 const f=authoredFixture(),snapshot=f.ws.snapshots.find(value=>value.id===f.insertedId)!,joined=resolveSnapshot(f.ws,f.insertedId,{useDraft:false}).drawing.joins.find(join=>join.a.curveId===cid(f.intent.curveId)||join.b.curveId===cid(f.intent.curveId))!;
 snapshot.relations.joins={update:[{...joined,mode:'ARC',radius:.02}]};
 const bytes=JSON.stringify(f.project),previous=useEditor.getState();
 try{useEditor.setState({project:f.project,past:[],future:[]});expect(()=>{const plan=prepareSnapshotEdit(snapshotEditContext(f.project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(f.project.drawing!,f.intent).document,intent:f.intent});useEditor.getState().commitPreparedSnapshotEdit(plan);}).toThrow(/authored interval .* exact retained material grid for its ARC or compound path/);expect(JSON.stringify(f.project)).toBe(bytes);expect(useEditor.getState().project).toBe(f.project);expect(useEditor.getState().past).toEqual([]);expect(useEditor.getState().future).toEqual([]);}finally{useEditor.setState(previous,true);}
},20000);
