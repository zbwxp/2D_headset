import {afterEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createEmptyProject} from '../../app/emptyProject';
import {useEditor} from '../../app/store';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {emptyDrawing,shapeOf} from '../../domain/drawing/model';
import {saveDrawingSnapshot} from '../../domain/drawing/snapshots';
import {ensureRecordingSnapshots} from '../../domain/recordingSnapshot/migration';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import SnapshotRecordingWorkspace from '../../ui/vectorRecording/SnapshotRecordingWorkspace';
import SceneOnionSkin from '../../ui/vectorRecording/SceneOnionSkin';
import {interpolateSnapshotSurfaceOnion} from '../../ui/vectorRecording/surfaceOnion';
vi.mock('../../app/store',async original=>{const m=await original<typeof import('../../app/store')>();return {...m,useEditor:Object.assign((select?:(s:ReturnType<typeof m.useEditor.getState>)=>unknown)=>select?select(m.useEditor.getState()):m.useEditor.getState(),m.useEditor)};});

const prior=useEditor.getState();afterEach(()=>useEditor.setState(prior,true));
function fixture(){const d=emptyDrawing();d.nodes=[{id:'a',position:[0,0]},{id:'b',position:[1,0]}];d.curves=[{id:'curve',name:'Full line',nodes:['a','b'],handles:[[.3,.1],[.7,.1]],width:.01,visible:true,locked:false}];d.layers=[{id:'layer',name:'Layer',visible:true,locked:false,items:['curve']}];let project=ensureRecordingSnapshots({...createEmptyProject(),...saveDrawingSnapshot({drawing:d},'Source')});const apply=(commands:unknown[])=>{project={...project,recordingSnapshots:prepareSnapshotBatch(project,{commands}).recordingSnapshots};};apply([{op:'createTriangulatedRecording',name:'Surface'}]);const source=project.recordingSnapshots.snapshots.find(s=>s.source)!,recordingId=project.recordingSnapshots.activeRecordingId!,recording=()=>project.recordingSnapshots.recordings.find(r=>r.id===recordingId)!;apply([{op:'pasteLayers',sourceSnapshotId:source.id,layerIds:[source.layers[0].id]}]);return {get project(){return project;},apply,recording,source};}
describe('triangulated workspace presentation',()=>{
 it('shows a real view and mesh binding controls, then red read-only fallback outside coverage',()=>{
  const f=fixture();useEditor.setState({project:f.project,past:[],future:[]});let html=renderToStaticMarkup(createElement(SnapshotRecordingWorkspace));expect(html).toContain('snapshot-update-view');expect(html).toContain('Snapshot binding X');expect(html).toContain('surface-correction-summary');
  f.apply([{op:'setAngle',angle:{x:90,y:0}}]);useEditor.setState({project:f.project,past:[],future:[]});html=renderToStaticMarkup(createElement(SnapshotRecordingWorkspace));expect(html).toContain('snapshot-outside-coverage');expect(html).toContain('stroke="#e24755"');expect(html).toContain('snapshot-create-view');expect(html).not.toContain('data-testid="snapshot-save-correction"');
 });
 it('creates an empty out-of-range real view without capturing the red reference',()=>{
  const f=fixture();f.apply([{op:'setAngle',angle:{x:90,y:0}},{op:'createSnapshot',name:'Side'}]);let result=evaluateRecordingSnapshot(f.project.recordingSnapshots,f.recording().id);expect(result.drawing.curves).toHaveLength(0);expect(result.angleSurface!.outsideCurves).toHaveLength(1);
  f.apply([{op:'pasteLayers',sourceSnapshotId:f.source.id,layerIds:[f.source.layers[0].id]}]);result=evaluateRecordingSnapshot(f.project.recordingSnapshots,f.recording().id);expect(result.drawing.curves).toHaveLength(1);expect(result.angleSurface!.outsideCurves).toHaveLength(0);
 });
 it('samples live corrections through the same geometry as the canvas without extra keys',()=>{
  const f=fixture();f.apply([{op:'createSnapshot',name:'Side',angle:{x:90,y:0}},{op:'pasteLayers',sourceSnapshotId:f.source.id,layerIds:[f.source.layers[0].id]}]);
  let e=evaluateRecordingSnapshot(f.project.recordingSnapshots,f.recording().id),layerId=e.drawing.layers[0].id,nodeId=e.drawing.nodes[0].id;
  f.apply([{op:'setLayerPlacement',layerId,value:{translation:[1,1],rotation:0,scale:1}},{op:'updateSnapshot'},{op:'setAngle',angle:{x:30,y:0}}]);e=evaluateRecordingSnapshot(f.project.recordingSnapshots,f.recording().id);layerId=e.drawing.layers.find(layer=>layer.items.includes(e.drawing.curves[0].id))!.id;
  f.apply([{op:'moveShapeNode',layerId,nodeId,position:[e.drawing.nodes[0].position[0]+.1,e.drawing.nodes[0].position[1]]}]);const r=f.recording(),before=JSON.stringify(f.project.recordingSnapshots),current=evaluateRecordingSnapshot(f.project.recordingSnapshots,r.id),views=r.angleGraph!.mesh.vertices.filter(v=>v.angle.y===0).sort((a,b)=>a.angle.x-b.angle.x),ends={startSnapshotId:views[0].snapshotId,endSnapshotId:views.at(-1)!.snapshotId};
  const onion=interpolateSnapshotSurfaceOnion(r,current,ends,10);expect(onion.frames).toHaveLength(10);
  for(const frame of onion.frames){const actual=evaluateRecordingSnapshot(f.project.recordingSnapshots,r.id,{angle:frame.angle,useDraft:true});expect(frame.centerlines![0].cubic).toEqual(shapeOf(actual.drawing,actual.drawing.curves[0].id));}
  const svg=renderToStaticMarkup(createElement('svg',null,createElement(SceneOnionSkin,{frames:onion.frames,angle:r.angle,opacity:.16,screen:(p:[number,number])=>p,unit:100})));expect(svg).toContain('data-frame-count="9"');expect(r.tracks).toHaveLength(0);expect(JSON.stringify(f.project.recordingSnapshots)).toBe(before);
 });
});
