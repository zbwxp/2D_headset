import fullFace from '../../src/assets/hairless-symmetric-two-face-mirror.json';
import {parseDrawing,type Point2} from '../../src/domain/drawing/model';
import {createSnapshotAngleGraph} from '../../src/domain/recordingSnapshot/angleGraph';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../src/domain/recordingSnapshot/model';
import {upsertDrawingSource} from '../../src/domain/recordingSnapshot/sources';

export const FIXTURE_SOURCE='src/assets/hairless-symmetric-two-face-mirror.json';
export const RECORDING_ID='renderer-benchmark';
export const ENDPOINTS={startSnapshotId:'view:0:0',endSnapshotId:'view:90:0'};
export const VIEW={width:900,height:650,pixelsPerUnit:250,origin:[530,325] as Point2};
export const screen=(point:Point2):Point2=>[VIEW.origin[0]+point[0]*VIEW.pixelsPerUnit,VIEW.origin[1]-point[1]*VIEW.pixelsPerUnit];

function freeze<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}
 return value;
}

/** Public Drawing geometry, with the same nine-view synthetic translation
 * setup used by prepared-recording-context.test.ts. No app/store imports. */
export function makeFixture(){
 const drawing=parseDrawing(fullFace);
 if(drawing.curves.length!==121)throw Error(`Expected the complete 121-curve face; got ${drawing.curves.length}`);
 const features=['左眼睑','右眼睑','左眼内结构','右眼内结构','左耳','右耳'];
 for(const name of features){
  const layer=drawing.layers.find(value=>value.name===name);
  if(!layer?.visible||!drawing.curves.some(curve=>layer.items.includes(curve.id)&&curve.visible))throw Error(`Required visible eye/ear layer is missing: ${name}`);
 }
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'complete-face',drawing),source=workspace.snapshots[0];
 const views=[-90,0,90].flatMap(x=>[-90,0,90].map(y=>{
  const view=emptyRecordingSnapshot(`view:${x}:${y}`,`View ${x}/${y}`,'view',{x,y});
  view.layers=source.layers.map(layer=>({kind:'reference' as const,id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));
  view.deformation.layers=Object.fromEntries(view.layers.map(layer=>[layer.id,{placement:{translation:[x/300,y/300] as Point2,rotation:0,scale:1}}]));
  return view;
 }));
 const recording=emptySnapshotRecording(RECORDING_ID,'Public full-face renderer benchmark');
 recording.mode='triangulated';recording.snapshotIds=views.map(view=>view.id);recording.activeSnapshotId='view:0:0';recording.angle={x:37.137,y:14.713};
 recording.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));
 workspace.snapshots.push(...views);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {workspace:freeze(workspace),recording,sourceCounts:{curves:drawing.curves.length,nodes:drawing.nodes.length,layers:drawing.layers.length,fills:drawing.fills.length,visibleCurves:drawing.curves.filter(curve=>curve.visible).length,requiredVisibleFeatures:features}};
}

/** A controlled immutable basis change, not a simulation of inverse editing.
 * All cases use the same source geometry and exact production evaluator. */
export function shiftedBasis(workspace:RecordingSnapshotWorkspace,index:number):RecordingSnapshotWorkspace {
 const delta=.06*Math.sin((index+1)*.371);
 return {...workspace,snapshots:workspace.snapshots.map(view=>view.id!=='view:90:0'?view:{...view,deformation:{...view.deformation,layers:Object.fromEntries(Object.entries(view.deformation.layers).map(([id,state])=>[id,{...state,placement:{...state.placement!,translation:[.3+delta,delta*.4] as Point2}}]))}})};
}
