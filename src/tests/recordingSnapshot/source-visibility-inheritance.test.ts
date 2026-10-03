import {describe,expect,test} from 'vitest';
import {curveChange,layerChange} from '../../domain/drawing/commands';
import {emptyDrawing,type DrawingDocument} from '../../domain/drawing/model';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotDeformationState,type RecordingSnapshotWorkspace} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {canonicalElementId,canonicalSourceId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';

const artworkId='helper-frame-source',sourceId=canonicalSourceId(artworkId),cid=(id:string)=>canonicalElementId(artworkId,id);
const descendants=['view','sibling','child','grandchild'];
function fixture(){
 const drawing:DrawingDocument={...emptyDrawing(),nodes:[],curves:[],layers:[
  {id:'frame',name:'Helper frame',visible:true,locked:false,items:['frame-a','frame-b']},
  {id:'art',name:'Artwork',visible:true,locked:false,items:['art-curve']},
 ]};
 for(const [index,id] of ['frame-a','frame-b','art-curve'].entries()){
  drawing.nodes.push({id:`${id}-start`,position:[0,index]},{id:`${id}-end`,position:[1,index]});
  drawing.curves.push({id,name:id,nodes:[`${id}-start`,`${id}-end`],handles:[[1/3,index],[2/3,index]],visible:true,locked:false,width:.01});
 }
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),artworkId,drawing);
 for(const [id,parentId] of [['view',sourceId],['sibling',sourceId],['child','view'],['grandchild','child']]){
  const snapshot=emptyRecordingSnapshot(id,id);snapshot.parentSnapshotId=parentId;
  snapshot.layers=['frame','art'].map(layerId=>({kind:'reference',id:`${layerId}-slot`,name:layerId,baseSnapshotId:parentId,baseLayerId:parentId===sourceId?cid(layerId):`${layerId}-slot`}));
  workspace.snapshots.push(snapshot);
 }
 return {drawing,workspace};
}
function flags(workspace:RecordingSnapshotWorkspace,snapshotId:string,useDraft=false){
 const result=resolveSnapshot(workspace,snapshotId,{useDraft,diagnostics:'preview',immutableInputs:true});
 expect(result.diagnostics).toEqual([]);
 expect(result.drawing.layers).toHaveLength(2);
 expect(result.drawing.curves).toHaveLength(3);
 return Object.fromEntries(result.drawing.curves.map(curve=>[curve.id,curve.visible]));
}
function override(workspace:RecordingSnapshotWorkspace,snapshotId:string,value:boolean|null){
 workspace.snapshots.find(snapshot=>snapshot.id===snapshotId)!.deformation.layers['frame-slot']={visibility:{[cid('frame-a')]:value}};
}

describe('live Drawing visibility across snapshot references',()=>{
 test('a Drawing layer hide reaches direct, sibling and nested references without removing membership',()=>{
  const {drawing,workspace}=fixture();
  for(const id of [sourceId,...descendants])expect(Object.values(flags(workspace,id))).toEqual([true,true,true]);
  // V3 layer controls are one-shot member operations; layer.visible is retired.
  const hidden=layerChange(drawing,'frame',{visible:false});
  expect(hidden.layers[0].visible).toBe(true);
  const next=upsertDrawingSource(workspace,artworkId,hidden);
  for(const id of [sourceId,...descendants])expect(flags(next,id)).toEqual({[cid('frame-a')]:false,[cid('frame-b')]:false,[cid('art-curve')]:true});
  expect(JSON.stringify(workspace.library)).not.toBe(JSON.stringify(next.library));
  for(const id of descendants)expect(next.snapshots.find(snapshot=>snapshot.id===id)!.layers).toEqual(workspace.snapshots.find(snapshot=>snapshot.id===id)!.layers);
 });

 test('a Drawing curve hide reaches every reference while the other frame member remains visible',()=>{
  const {drawing,workspace}=fixture();
  const next=upsertDrawingSource(workspace,artworkId,curveChange(drawing,'frame-a',{visible:false}));
  for(const id of [sourceId,...descendants])expect(flags(next,id)).toEqual({[cid('frame-a')]:false,[cid('frame-b')]:true,[cid('art-curve')]:true});
 });

 test('an explicit local show survives a later source layer hide and is inherited only along its branch',()=>{
  const {drawing,workspace}=fixture();override(workspace,'view',true);
  const next=upsertDrawingSource(workspace,artworkId,layerChange(drawing,'frame',{visible:false}));
  for(const id of ['view','child','grandchild'])expect(flags(next,id)).toEqual({[cid('frame-a')]:true,[cid('frame-b')]:false,[cid('art-curve')]:true});
  expect(flags(next,'sibling')[cid('frame-a')]).toBe(false);
  expect(next.library.curves[cid('frame-a')].visible).toBe(false);
 });

 test('a deeper explicit local hide overrides a parent show and survives later source show',()=>{
  const {drawing,workspace}=fixture();override(workspace,'view',true);override(workspace,'child',false);
  const hidden=upsertDrawingSource(workspace,artworkId,curveChange(drawing,'frame-a',{visible:false}));
  const shown=upsertDrawingSource(hidden,artworkId,drawing);
  for(const next of [hidden,shown]){
   expect(flags(next,'view')[cid('frame-a')]).toBe(true);
   for(const id of ['child','grandchild'])expect(flags(next,id)[cid('frame-a')]).toBe(false);
  }
 });

 test('null clears the local override and follows the live parent after source hide and show',()=>{
  const {drawing,workspace}=fixture();
  const view=workspace.snapshots.find(snapshot=>snapshot.id==='view')!;
  view.inheritedState={...emptySnapshotDeformationState(),layers:{'frame-slot':{visibility:{[cid('frame-a')]:true}}}};
  override(workspace,'view',null);
  const hidden=upsertDrawingSource(workspace,artworkId,curveChange(drawing,'frame-a',{visible:false}));
  for(const id of descendants)expect(flags(hidden,id)[cid('frame-a')]).toBe(false);
  const shown=upsertDrawingSource(hidden,artworkId,drawing);
  for(const id of descendants)expect(flags(shown,id)[cid('frame-a')]).toBe(true);
 });

 test('a local show draft affects its owner only until saved and keeps source inheritance live',()=>{
  const {drawing,workspace}=fixture(),view=workspace.snapshots.find(snapshot=>snapshot.id==='view')!;
  view.draft={angle:{...view.angle},channels:[],deformation:{...emptySnapshotDeformationState(),layers:{'frame-slot':{visibility:{[cid('frame-a')]:true}}}}};
  const next=upsertDrawingSource(workspace,artworkId,layerChange(drawing,'frame',{visible:false}));
  expect(flags(next,'view',true)[cid('frame-a')]).toBe(true);
  expect(flags(next,'view',false)[cid('frame-a')]).toBe(false);
  for(const id of ['sibling','child','grandchild'])expect(flags(next,id,true)[cid('frame-a')]).toBe(false);
 });

 test('opening a local container gate preserves source-hidden members until explicitly shown',()=>{
  const {drawing,workspace}=fixture(),view=workspace.snapshots.find(snapshot=>snapshot.id==='view')!;
  view.deformation.layers['frame-slot']={visibility:{'frame-slot':true}};
  const hidden=upsertDrawingSource(workspace,artworkId,layerChange(drawing,'frame',{visible:false}));
  expect(flags(hidden,'view')[cid('frame-a')]).toBe(false);
  const shown=structuredClone(hidden);
  shown.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layers['frame-slot'].visibility![cid('frame-a')]=true;
  expect(flags(shown,'view')[cid('frame-a')]).toBe(true);
  expect(flags(shown,'view')[cid('frame-b')]).toBe(false);
 });

 test('round-trip persistence keeps hidden source geometry and explicit branch overrides separate',()=>{
  const {drawing,workspace}=fixture();override(workspace,'child',true);
  const hidden=upsertDrawingSource(workspace,artworkId,layerChange(drawing,'frame',{visible:false}));
  const restored=parseRecordingSnapshots(JSON.parse(JSON.stringify(hidden)));
  expect(restored).toEqual(hidden);
  for(const id of ['view','sibling'])expect(flags(restored,id)[cid('frame-a')]).toBe(false);
  for(const id of ['child','grandchild'])expect(flags(restored,id)[cid('frame-a')]).toBe(true);
  expect(restored.library.curves[cid('frame-a')].visible).toBe(false);
 });
});
