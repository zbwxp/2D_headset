import {afterEach,describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createEmptyProject} from '../../app/emptyProject';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {emptyDrawing,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {setDepthOffset,depthPaintBatches} from '../../domain/drawing/depth';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {validateSnapshotCurveAppearance} from '../../domain/recordingSnapshot/curveAppearance';
import {prepareSnapshotLocalDrawingEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {prepareSnapshotDrawingPropertyEdit} from '../../ui/vectorRecording/snapshotDrawingPropertyEdit';
import {mirrorSnapshotDrawing} from '../../domain/recordingSnapshot/snapshotMirror';
import SnapshotDrawingProperties from '../../ui/vectorRecording/SnapshotDrawingProperties';
import PaintScene from '../../ui/drawing/PaintScene';

const cid=(id:string)=>canonicalElementId('source',id),extra=(id:string)=>canonicalElementId('extra',id),editor=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(editor,true);useWorkspaceMode.setState({mode});});
function sourceDrawing(ids:string[]):DrawingDocument {
 return {...emptyDrawing(),nodes:ids.flatMap((id,index)=>[{id:`${id}0`,position:[0,index] as Point2},{id:`${id}1`,position:[1,index] as Point2}]),curves:ids.map((id,index)=>({id,name:id,nodes:[`${id}0`,`${id}1`],handles:[[.3,index],[.7,index]],visible:true,locked:false,width:.01})),layers:ids.map(id=>({id:`${id}-layer`,name:id,visible:true,locked:false,items:[id]}))};
}
function fixture(sourceDepth=0){
 const drawing=sourceDrawing(['front','back']);drawing.curves[1]={...drawing.curves[1],depthOffset:sourceDepth,depthScope:'LAYER'};
 let workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing);const source=workspace.snapshots[0];workspace=upsertDrawingSource(workspace,'extra',sourceDrawing(['extra']));const other=workspace.snapshots.find(snapshot=>snapshot.source?.artworkId==='extra')!,view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording');
 view.layers=[{kind:'reference',id:extra('extra-layer'),name:'Extra',baseSnapshotId:other.id,baseLayerId:extra('extra-layer')},...source.layers.map(layer=>({kind:'reference' as const,id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:layer.id}))];side.layers=structuredClone(view.layers);recording.mode='triangulated';recording.snapshotIds=['view','side'];recording.activeSnapshotId='view';recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots.push(view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {project:{...createEmptyProject(),drawing,recordingSnapshots:workspace},source,other};
}
const order=(result:ReturnType<typeof resolveSnapshot>)=>result.paintBatches.map(batch=>batch.owner??batch.item.id);
function edit(project:ReturnType<typeof fixture>['project'],value:number){const beforeDrawing=resolveSnapshot(project.recordingSnapshots,'view').drawing;return prepareSnapshotDrawingPropertyEdit(project,{recordingId:'recording',snapshotId:'view',angle:{x:0,y:0},beforeDrawing,drawing:setDepthOffset(beforeDrawing,cid('back'),value,'LAYER')});}

describe('Snapshot-local shared depth properties',()=>{
 it('uses current Snapshot sibling targets without writing original curve or layer data',()=>{
  const {project}=fixture(),prior=JSON.stringify(project),plan=edit(project,2),workspace=plan.project.recordingSnapshots!,result=resolveSnapshot(workspace,'view');
  expect(order(result)).toEqual([cid('back'),extra('extra'),cid('front')]);expect(result.paintBatches.map(batch=>batch.owner??batch.item.id)).toEqual(depthPaintBatches(result.drawing).map(batch=>batch.owner??batch.item.id));
  expect(workspace.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layers[cid('back-layer')].curveAppearance?.[cid('back')]).toEqual({depthOffset:2});expect(workspace.library).toEqual(project.recordingSnapshots.library);expect(plan.project.drawing).toBe(project.drawing);expect(JSON.stringify(project)).toBe(prior);
  expect(order(resolveSnapshot(workspace,'side'))).toEqual([extra('extra'),cid('front'),cid('back')]);
 });
 it('holds explicit local zero against a source depth change, with one Undo and JSON reconstruction',()=>{
  const {project}=fixture(1),plan=edit(project,0),workspace=plan.project.recordingSnapshots!;expect(order(resolveSnapshot(project.recordingSnapshots,'view'))).toEqual([extra('extra'),cid('back'),cid('front')]);expect(order(resolveSnapshot(workspace,'view'))).toEqual([extra('extra'),cid('front'),cid('back')]);
  useWorkspaceMode.setState({mode:'recording'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);
  const restored=parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)));restored.library.curves[cid('back')].depthOffset=-1;expect(order(resolveSnapshot(restored,'view'))).toEqual([extra('extra'),cid('front'),cid('back')]);expect(JSON.stringify(restored)).not.toContain('depthContext');
 });
 it('inherits local depth ownership and never retargets an omitted parent neighbour to an unrelated child layer',()=>{
  const {project,other}=fixture(),workspace=edit(project,2).project.recordingSnapshots!,child=emptyRecordingSnapshot('child');child.layers=[{kind:'reference',id:'unrelated-child',name:'Unrelated',baseSnapshotId:other.id,baseLayerId:extra('extra-layer')},{kind:'reference',id:'only-back',name:'Back',baseSnapshotId:'view',baseLayerId:cid('back-layer')}];
  // Use a genuinely different canonical neighbour, even though both have the
  // same curve shape. Missing parent targets must stay missing.
  const unrelated=sourceDrawing(['other']);let next=upsertDrawingSource(workspace,'third',unrelated),third=next.snapshots.find(snapshot=>snapshot.source?.artworkId==='third')!;child.layers[0]={kind:'reference',id:'unrelated-child',name:'Unrelated',baseSnapshotId:third.id,baseLayerId:canonicalElementId('third','other-layer')};next.snapshots.push(child);
  const result=resolveSnapshot(next,'child');expect(result.drawing.curves.find(curve=>curve.id===cid('back'))!.depthOffset).toBe(2);expect(order(result)).toEqual([canonicalElementId('third','other'),cid('back')]);
  const wanted=setDepthOffset(result.drawing,cid('back'),1,'LAYER'),changed=prepareSnapshotLocalDrawingEdit(next,{snapshotId:'child',state:'saved',beforeDrawing:result.drawing,drawing:wanted}).workspace;expect(order(resolveSnapshot(changed,'child'))).toEqual([cid('back'),canonicalElementId('third','other')]);
  const reloaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(changed)));expect(order(resolveSnapshot(reloaded,'child'))).toEqual(order(resolveSnapshot(changed,'child')));
 });
 it('preserves local depth targets through semantic mirror input',()=>{
  const {project}=fixture(),workspace=edit(project,2).project.recordingSnapshots!,parent=resolveSnapshot(workspace,'view'),mirror={axisX:0,curvePairs:[]},child=emptyRecordingSnapshot('mirror');child.parentSnapshotId='view';child.inputMirror=mirror;child.layers=structuredClone(workspace.snapshots.find(snapshot=>snapshot.id==='view')!.layers).map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:'view',baseLayerId:layer.id}));workspace.snapshots.push(child);
  const result=resolveSnapshot(workspace,'mirror'),expected=depthPaintBatches(mirrorSnapshotDrawing(parent.drawing,mirror).drawing).map(batch=>batch.owner??batch.item.id);expect(order(result)).toEqual(expected);
 });
 it('renders the shared DepthControls and actual paint batches in the locally authored order',()=>{
  const {project}=fixture(),workspace=edit(project,2).project.recordingSnapshots!,result=resolveSnapshot(workspace,'view'),d=result.drawing;
  const properties=renderToStaticMarkup(createElement(SnapshotDrawingProperties,{drawing:d,selection:{ids:[cid('back')]},choose:()=>{},run:()=>{},preview:()=>{},session:{current:()=>d,undo:()=>{},redo:()=>{}},tool:()=>{},transform:()=>{},propertiesEditable:true,topologyEditable:true,geometryEditable:true,intervalEditable:true,onPosition:()=>{}}));expect(properties).toContain('drawing-depth-controls');
  const svg=renderToStaticMarkup(createElement('svg',{},createElement(PaintScene,{d,paintBatches:result.paintBatches,screen:(point:Point2)=>point,unit:250,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:()=>{},paintDown:()=>{},arcDown:()=>{}})));const ordered=[...svg.matchAll(/data-stroke="([^"]+)"/g)].map(match=>match[1]);expect(ordered.indexOf(cid('back'))).toBeGreaterThan(ordered.indexOf(extra('extra')));
  expect(()=>validateSnapshotCurveAppearance({curve:{depthOffset:0,depthScope:'LAYER',localPaintOrder:false}})).not.toThrow();for(const patch of [{depthOffset:.2},{depthOffset:Infinity},{depthScope:'SCENE'},{localPaintOrder:0}])expect(()=>validateSnapshotCurveAppearance({curve:patch})).toThrow();
 });
});
