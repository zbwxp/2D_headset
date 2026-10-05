import {describe,expect,it} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {useEditor} from '../../app/store';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {propagateAutomaticSnapshotLayers,seedAutomaticExtremeSnapshots} from '../../domain/recordingSnapshot/automaticSnapshotEdits';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';

function fixture(){
 const workspace=emptyRecordingSnapshotWorkspace(),source=emptyRecordingSnapshot('source','Source','drawing'),zero=emptyRecordingSnapshot('zero','Zero','view',{x:0,y:0}),negative=emptyRecordingSnapshot('negative','Negative','view',{x:-90,y:0});
 for(const [index,id] of ['left','profile','right'].entries()){
  workspace.library.nodes[`${id}-a`]={id:`${id}-a`,position:[index,.1]};workspace.library.nodes[`${id}-b`]={id:`${id}-b`,position:[index+.2,.2]};
  workspace.library.curves[id]={id,name:id,nodes:[`${id}-a`,`${id}-b`],handles:[[index+.05,.1],[index+.15,.2]],visible:true,locked:false,width:.01};
 }
 source.layers=['left','profile','right'].map(id=>({kind:'original',id:`${id}-layer`,name:id,items:[id],visible:true,locked:false}));
 source.source={artworkId:'asset',originIds:{},mirrorAxisX:0,mirrorEditing:{enabled:false,curvePairs:[{id:'pair',a:'left',b:'right',reverse:false}]}};
 for(const view of [zero,negative])view.layers=source.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}));
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=[zero.id,negative.id];recording.activeSnapshotId=negative.id;recording.angle={x:-90,y:0};recording.angleGraph=createSnapshotAngleGraph([zero,negative].map(view=>({snapshotId:view.id,angle:view.angle})));
 workspace.snapshots=[source,zero,negative];workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 let serial=0;for(const view of [zero,negative])seedAutomaticExtremeSnapshots(workspace,recording.id,view.id,()=>`generated-${++serial}`);
 return {...createEmptyProject(),recordingSnapshots:workspace};
}
const child=(workspace:RecordingSnapshotWorkspace,x:number,y:number)=>workspace.snapshots.find(snapshot=>snapshot.parentSnapshotId&&snapshot.angle.x===x&&snapshot.angle.y===y)!;
const descendants=(workspace:RecordingSnapshotWorkspace)=>workspace.snapshots.filter(snapshot=>snapshot.parentSnapshotId&&snapshot.angle.x!==0);
const order=(snapshot:RecordingSnapshotWorkspace['snapshots'][number])=>snapshot.layers.map(layer=>layer.id);
const mirrored=(ids:string[])=>ids.map(id=>id==='left-layer'?'right-layer':id==='right-layer'?'left-layer':id);
const topologyOrder=(project:ReturnType<typeof fixture>,ids:string[])=>{
 const beforeDrawing=resolveSnapshot(project.recordingSnapshots,'negative',{useDraft:false}).drawing,drawing={...beforeDrawing,layers:ids.map(id=>beforeDrawing.layers.find(layer=>layer.id===id)!)};
 return prepareSnapshotBatch(project,{commands:[{op:'applyDrawingTopology',beforeDrawing,drawing}]});
};
function expectInherited(workspace:RecordingSnapshotWorkspace,ids:string[]){
 expect(descendants(workspace)).toHaveLength(5);
 for(const snapshot of descendants(workspace)){expect(snapshot.parentLayers).toEqual({});expect(order(snapshot)).toEqual(snapshot.angle.x>0?mirrored(ids):ids);}
}

describe('automatic layer order through complete project transactions',()=>{
 it('keeps all five descendants live after topology propagation, normalization, replay, and a later parent reorder',()=>{
  const project=fixture(),baseline=JSON.stringify(project),ids=['right-layer','left-layer','profile-layer'],plan=topologyOrder(project,ids),after=plan.recordingSnapshots;
  expectInherited(after,ids);
  // The domain topology writer and outer project gate share this original
  // before. Repeating that pass must not promote automatic order to intent.
  expect(propagateAutomaticSnapshotLayers(project.recordingSnapshots,after).workspace).toBe(after);
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(after)));expect(loaded).toEqual(after);expectInherited(loaded,ids);
  const nextIds=['profile-layer','left-layer','right-layer'],later=prepareSnapshotBatch({...plan.preparedPlan.project,recordingSnapshots:loaded},{commands:[{op:'reorderLayers',layerIds:nextIds}]}).recordingSnapshots;
  expectInherited(later,nextIds);
  const reflected=resolveSnapshot(later,child(later,90,0).id);expect(reflected.provenance.right.materialContext?.elementId).toBe('left');expect(reflected.provenance.left.materialContext?.elementId).toBe('right');expect(reflected.provenance.profile.materialContext?.elementId).toBe('profile');
  expect(JSON.stringify(project)).toBe(baseline);
 });

 it('preserves genuine local mirror order and already saved override flags',()=>{
  const project=fixture(),mirror=child(project.recordingSnapshots,90,0),localOrder=['profile-layer','left-layer','right-layer'];
  const local=prepareSnapshotBatch(project,{commands:[{op:'selectSnapshot',snapshotId:mirror.id},{op:'reorderLayers',layerIds:localOrder}]}).preparedPlan.project;
  expect(child(local.recordingSnapshots!,90,0).parentLayers?.orderOverride).toBe(true);
  const next=prepareSnapshotBatch(local,{commands:[{op:'selectSnapshot',snapshotId:'negative'},{op:'reorderLayers',layerIds:['right-layer','left-layer','profile-layer']}]}).recordingSnapshots;
  for(const y of [-90,0,90]){const view=child(next,90,y);expect(order(view)).toEqual(localOrder);expect(view.parentLayers).toEqual(y===0?{orderOverride:true}:{});}
  const saved=fixture(),savedMirror=child(saved.recordingSnapshots,90,0);savedMirror.parentLayers={orderOverride:true};const original=order(savedMirror);
  const preserved=topologyOrder(saved,['right-layer','left-layer','profile-layer']).recordingSnapshots;
  expect(child(preserved,90,0).parentLayers).toEqual({orderOverride:true});expect(order(child(preserved,90,0))).toEqual(original);
 });

 it('recognizes automatic inherited slots around a local layer while retaining an explicit local move',()=>{
  const project=fixture(),view=child(project.recordingSnapshots,-90,-90);view.layers.splice(1,0,{kind:'original',id:'local-layer',name:'Local',items:[],visible:true,locked:false});
  const plan=topologyOrder(project,['right-layer','left-layer','profile-layer']),after=plan.preparedPlan.project,inherited=child(after.recordingSnapshots!,-90,-90);
  expect(order(inherited)).toEqual(['right-layer','local-layer','left-layer','profile-layer']);expect(inherited.parentLayers).toEqual({});
  const localOrder=['local-layer','right-layer','left-layer','profile-layer'],local=prepareSnapshotBatch(after,{commands:[{op:'selectSnapshot',snapshotId:view.id},{op:'reorderLayers',layerIds:localOrder}]}).preparedPlan.project;
  expect(child(local.recordingSnapshots!,-90,-90).parentLayers).toEqual({orderOverride:true});
  const later=prepareSnapshotBatch(local,{commands:[{op:'selectSnapshot',snapshotId:'negative'},{op:'reorderLayers',layerIds:['profile-layer','right-layer','left-layer']}]}).recordingSnapshots;
  expect(order(child(later,-90,-90))).toEqual(localOrder);
 });

 it('keeps the original baseline immutable through the production Undo and Redo boundary',()=>{
  const project=fixture(),baseline=JSON.stringify(project),plan=topologyOrder(project,['right-layer','left-layer','profile-layer']).preparedPlan,previous=useEditor.getState();
  try{
   useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expectInherited(useEditor.getState().project.recordingSnapshots!,['right-layer','left-layer','profile-layer']);
   useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);expect(JSON.stringify(useEditor.getState().project)).toBe(baseline);
   useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);expectInherited(useEditor.getState().project.recordingSnapshots!,['right-layer','left-layer','profile-layer']);
  }finally{useEditor.setState(previous,true);}
 });
});
