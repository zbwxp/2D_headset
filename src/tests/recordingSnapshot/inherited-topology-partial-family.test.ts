import {expect,test} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {createCurveSplitIntent,applyCurveSplitIntent,mapCurveSplitIntent} from '../../domain/drawing/layerEditIntent';
import {deleteCurves,deleteLayer,moveHandle,createCurve,connect} from '../../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument,type Cubic} from '../../domain/drawing/model';
import {neutralBend} from '../../domain/deformation/coons';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {canonicalElementId,drawingSnapshotForArtwork,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {resolveSnapshot,evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {applySnapshotMembershipEdit} from '../../domain/recordingSnapshot/localMembership';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {derivedUses} from '../../domain/drawing/roundedJoin';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {continueCubicRange} from '../../domain/drawing/cubicRangeContinuation';
import {subcurve} from '../../domain/drawing/roundedJoin';
const cid=(id:string)=>canonicalElementId('$working',id);
function fixture(postShape=false){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[{id:'a',position:[-.8,-.3]},{id:'b',position:[.7,.5]},{id:'c',position:[-.7,.7]},{id:'d',position:[.6,.8]}],curves:[{id:'curve',name:'Curve',nodes:['a','b'],handles:[[-.6,.6],[.4,-.5]],width:.01,visible:true,locked:false},{id:'other',name:'Other',nodes:['c','d'],handles:[[-.1,.3],[.4,.9]],width:.01,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',items:['curve','other'],visible:true,locked:false}],displayIntervals:[{id:'material',scope:'CURVE',anchor:{id:'curve',reverse:false},ranges:[{id:'range',start:.15,end:.82}]}]};
 const project=ensureRecordingSnapshots({...createEmptyProject(),drawing}),workspace=project.recordingSnapshots,source=drawingSnapshotForArtwork(workspace,'$working')!,view=emptyRecordingSnapshot('view'),bend=neutralBend();bend.handles[1][0][0]=1.25;
 view.layers=[{kind:'reference',id:'slot',name:'Curve',baseSnapshotId:source.id,baseLayerId:cid('layer')}];view.deformation.layerDomains=[{kind:'h-coons',id:'cage',layerIds:['slot'],restRect:{min:[-1,-1],max:[1,1]},quad:[[-1,-1],[1,-.7],[.7,1],[-.9,.8]],bend,...(postShape?{postShape:{nodes:{[cid('a')]:[.03,.05] as [number,number]},handles:{[cid('curve')]:[[.04,.06],[-.02,.01]] as [[number,number],[number,number]]}}}:{})}];workspace.snapshots.push(view);
 const other=emptyRecordingSnapshot('other-view');other.layers=structuredClone(view.layers);workspace.snapshots.push(other);const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=['view','other-view'];recording.activeSnapshotId='view';recording.angleGraph=createSnapshotAngleGraph([{snapshotId:'view',angle:{x:0,y:0}},{snapshotId:'other-view',angle:{x:90,y:0}}]);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 let serial=0;const intent=createCurveSplitIntent(drawing,'curve',.371,{allocateId:()=>`partial-${++serial}`}),canonical=mapCurveSplitIntent(intent,cid),split=prepareSnapshotEdit(snapshotEditContext(project,true),{kind:'original-geometry',drawing:applyCurveSplitIntent(drawing,intent).document,intent}).project;
 return {project:split,workspace:split.recordingSnapshots!,intent,canonical,sourceId:source.id};
}
const expectShape=(a:Cubic,b:Cubic)=>a.forEach((p,i)=>p.forEach((v,k)=>expect(v).toBeCloseTo(b[i][k],8)));
function exclude(f:ReturnType<typeof fixture>,id:string){applySnapshotMembershipEdit(f.workspace,'view',{op:'excludeElements',layerId:'slot',elementIds:[id]},()=>{throw Error('Unexpected identity allocation');});}

import {prepareSnapshotLocalDrawingEdit} from '../../domain/recordingSnapshot/drawingTopology';
for(const operation of ['P','bind'] as const)test(`inherited ${operation} retains a separately edited hidden live split sibling`,()=>{
 const f=fixture(true),raw=f.intent.childCurveIds[0],left=f.canonical.childCurveIds[0],right=f.canonical.childCurveIds[1],source=f.project.drawing!,curve=source.curves.find(curve=>curve.id===raw)!;f.workspace=upsertDrawingSource(f.workspace,'$working',moveHandle(source,{curveId:raw,end:0},[curve.handles[0][0]+.15,curve.handles[0][1]-.11]));
 const local=emptyRecordingSnapshot('child');local.layers=[{kind:'reference',id:'child-slot',name:'Child',baseSnapshotId:'view',baseLayerId:'slot',membership:{excludeElementIds:[left]}}];f.workspace.snapshots.push(local);const before=resolveSnapshot(f.workspace,'child').drawing,library=structuredClone(f.workspace.library),wanted=operation==='P'?createCurve(before,'child-slot',[[-.6,-.6],[-.3,-.4],[.2,-.5],[.5,-.6]],.01,'Local','new'):connect(before,{curveId:cid('other'),end:0},{curveId:right,end:1},'POSITION');
 const workspace=prepareSnapshotLocalDrawingEdit(f.workspace,{snapshotId:'child',state:'saved',beforeDrawing:before,drawing:wanted}).workspace,after=resolveSnapshot(workspace,'child').drawing;for(const value of wanted.curves)expectShape(shapeOf(after,value.id),shapeOf(wanted,value.id));if(operation==='P'){const domains=workspace.snapshots.find(snapshot=>snapshot.id==='child')!.deformation.layerDomains!;for(const domain of domains)expect(Object.keys(domain.postShape?.handles??{}).filter(id=>id!=='new')).toEqual([]);}expect(after.curves.some(curve=>curve.id===left)).toBe(false);expect(after.layers.flatMap(layer=>layer.items)).not.toContain(left);for(const kind of ['nodes','curves'] as const)for(const [key,value] of Object.entries(library[kind]))expect(workspace.library[kind][key]).toEqual(value);
 const loaded=resolveSnapshot(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace))),'child').drawing;for(const value of wanted.curves)expectShape(shapeOf(loaded,value.id),shapeOf(wanted,value.id));
 const updated=upsertDrawingSource(workspace,'$working',moveHandle(source,{curveId:raw,end:0},[curve.handles[0][0]+.25,curve.handles[0][1]-.19])),live=resolveSnapshot(updated,'child').drawing;expect(shapeOf(live,right)).not.toEqual(shapeOf(after,right));expect(live.curves.some(curve=>curve.id===left)).toBe(false);
});
