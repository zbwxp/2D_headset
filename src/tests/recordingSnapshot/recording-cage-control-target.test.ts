import {expect,test} from 'vitest';
import {emptyDrawing,shapeOf,type Point2,type Cubic} from '../../domain/drawing/model';
import {addLayer,createCurve} from '../../domain/drawing/commands';
import {upsertDrawingSource,canonicalElementId} from '../../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {snapshotCurveEditCommand} from '../../ui/vectorRecording/snapshotCurveEditCommand';
import {neutralBend} from '../../domain/deformation/coons';
import {hasNonlinearDeformationFor} from '../../domain/drawing/evaluatedDeformation';
const near=(a:Point2,b:Point2)=>a.forEach((n,i)=>expect(n).toBeCloseTo(b[i],8));
function fixture(inherited:boolean){
 let drawing=addLayer(emptyDrawing(),'Layer');drawing=createCurve(drawing,drawing.layers[0].id,[[0,0],[.3,.2],[.7,.5],[1,1]] as Cubic,.01,'Curve','curve');
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing),source=workspace.snapshots[0],parent=emptyRecordingSnapshot('parent'),view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording');
 const domain={kind:'h-coons' as const,id:'cage',layerIds:['slot'],restRect:{min:[-.2,-.2] as Point2,max:[1.2,1.2] as Point2},quad:[[-.2,-.2],[1.1,-.1],[.9,1.3],[-.1,1.1]] as [Point2,Point2,Point2,Point2],bend:neutralBend()};domain.bend.handles[1][0][0]=1.2;
 parent.layers=[{kind:'reference',id:'parent-slot',name:'Parent layer',baseSnapshotId:source.id,baseLayerId:source.layers[0].id}];parent.deformation.layerDomains=[{...domain,layerIds:['parent-slot']}];
 view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:inherited?parent.id:source.id,baseLayerId:inherited?'parent-slot':source.layers[0].id}];
 if(!inherited)view.deformation.layerDomains=[domain];
 view.deformation.layers.slot={placement:{translation:[.3,-.2],rotation:27,scale:1.4},elementPlacements:{[canonicalElementId('source','curve')]:{translation:[-.1,.3],rotation:-13,scale:.8}}};
 side.layers=structuredClone(view.layers);recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots.push(parent,view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {workspace,view,curveId:canonicalElementId('source','curve')};
}
test.each([false,true])('Recorder A sends final cage controls once through placement (inherited=%s)',inherited=>{
 const {workspace,view,curveId}=fixture(inherited),originals=JSON.stringify(workspace.library),evaluation=evaluateRecordingSnapshot(workspace,'recording'),p=shapeOf(evaluation.drawing,curveId)[1],wanted:Point2=[p[0]+.07,p[1]-.04];
 expect(hasNonlinearDeformationFor(evaluation.drawing,curveId)).toBe(true);
 if(inherited)expect(evaluation.state.layerDomains).toBeUndefined();
 const command=snapshotCurveEditCommand(evaluation,{kind:'handle',curveId,end:0,position:wanted});expect('position' in command&&command.position).toEqual(wanted);
 applySnapshotCommand(workspace,command);near(shapeOf(evaluateRecordingSnapshot(workspace,'recording').drawing,curveId)[1],wanted);
 applySnapshotCommand(workspace,{op:'saveSelected',layerIds:['slot'],warpIds:[]});near(shapeOf(evaluateRecordingSnapshot(workspace,'recording').drawing,curveId)[1],wanted);expect(view.draft).toBeUndefined();expect(JSON.stringify(workspace.library)).toBe(originals);
});
