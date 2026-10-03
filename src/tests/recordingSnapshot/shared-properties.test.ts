import {finalizeGeometryEdit} from '../../domain/drawing/geometryEdit';
import {afterEach,describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createEmptyProject} from '../../app/emptyProject';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {prepareSnapshotBatch} from '../../app/recordingSnapshotApi';
import {emptyDrawing,DEFAULT_FILL_MIST,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {curveChange,widthChange,setArcRadius} from '../../domain/drawing/commands';
import {changePaint,setInk,setInkEnd} from '../../domain/drawing/paintCommands';
import {setContourMist,strokeInkPasses} from '../../domain/drawing/mist';
import {setFillMist,fillMistLayout,fillMistAlpha} from '../../domain/drawing/fillMist';
import {changeDisplayInterval} from '../../domain/drawing/displayIntervals';
import {fillGeometry,offsetGeometry,strokeInk} from '../../domain/drawing/appearance';
import {strokes} from '../../domain/drawing/strokes';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {resolveSnapshot,evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {prepareSnapshotReferencePaste} from '../../domain/recordingSnapshot/referenceClipboard';
import {validateSnapshotPaintAppearance} from '../../domain/recordingSnapshot/paintAppearance';
import {validateSnapshotCurveAppearance} from '../../domain/recordingSnapshot/curveAppearance';
import {prepareSnapshotDrawingPropertyEdit,snapshotDrawingIntervalCommands,snapshotDrawingTransformTarget} from '../../ui/vectorRecording/snapshotDrawingPropertyEdit';
import SnapshotDrawingProperties from '../../ui/vectorRecording/SnapshotDrawingProperties';
import PaintScene from '../../ui/drawing/PaintScene';

const cid=(id:string)=>canonicalElementId('source',id),originalStore=useEditor.getState(),originalMode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.setState(originalStore,true);useWorkspaceMode.setState({mode:originalMode});});
function fixture(){
 const points:Point2[]=[[0,0],[1,0],[1,1],[0,1]],drawing:DrawingDocument={...emptyDrawing(),nodes:points.map((position,index)=>({id:`n${index}`,position})),curves:points.map((a,index)=>{const b=points[(index+1)%4];return {id:`c${index}`,name:`Curve ${index}`,nodes:[`n${index}`,`n${(index+1)%4}`],handles:[[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3]],visible:true,locked:false,width:.008,mist:{mode:'INK_EDGE',enabled:true,width:.004,density:.7}};}),layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['c0','c1','c2','c3','fill','offset']}],fills:[{id:'fill',name:'Fill',visible:true,locked:false,color:'white',boundary:points.map((_,index)=>({id:`c${index}`,reverse:false})),mist:{...DEFAULT_FILL_MIST,enabled:false}}],offsets:[{id:'offset',name:'Offset',visible:true,locked:false,source:[{id:'c0',reverse:false}],distance:.04,start:.2,end:.8,taper:.1,width:.012,translation:[.1,.2]}],displayIntervals:[{id:'interval',anchor:{id:'c0',reverse:false},ranges:[{id:'range',start:.1,end:.8,enabled:true}]}]};
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing),source=workspace.snapshots[0],view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording');
 view.layers=[{kind:'reference',id:cid('layer'),name:'Layer',baseSnapshotId:source.id,baseLayerId:cid('layer')}];side.layers=structuredClone(view.layers);recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots.push(view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 const project={...createEmptyProject(),drawing,recordingSnapshots:workspace};return {project,sourceId:source.id};
}
function edit(project:ReturnType<typeof fixture>['project'],operation:(drawing:DrawingDocument)=>DrawingDocument){const recording=project.recordingSnapshots.recordings[0],beforeDrawing=evaluateRecordingSnapshot(project.recordingSnapshots,recording.id,{useDraft:true}).drawing;return prepareSnapshotDrawingPropertyEdit(project,{recordingId:recording.id,snapshotId:recording.activeSnapshotId!,angle:recording.angle,beforeDrawing,drawing:finalizeGeometryEdit(beforeDrawing,operation(beforeDrawing))});}
const view=(project:ReturnType<typeof fixture>['project'])=>resolveSnapshot(project.recordingSnapshots,'view').drawing;
const reload=(project:ReturnType<typeof fixture>['project'])=>({...project,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(project.recordingSnapshots)))});
const nextProject=(plan:ReturnType<typeof edit>)=>plan.project as ReturnType<typeof fixture>['project'];

describe('shared Drawing properties in Recording',()=>{
 it('persists sparse name, ink visibility and fieldwise mist without freezing source values or geometry',()=>{
  const {project,sourceId}=fixture(),saved=JSON.stringify(project),before=view(project),plan=edit(project,d=>setContourMist(setInk(curveChange(d,cid('c0'),{name:'Local curve'}),[cid('c0')],{inkVisible:false}),[cid('c0')],{enabled:false,density:0})),next=nextProject(plan),local=next.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!;
  expect(local.deformation.layers[cid('layer')].curveAppearance?.[cid('c0')]).toEqual({name:'Local curve',inkVisible:false,mist:{enabled:false,density:0}});
  expect(next.recordingSnapshots.library).toEqual(project.recordingSnapshots.library);expect(next.recordingSnapshots.snapshots.find(snapshot=>snapshot.id===sourceId)).toEqual(project.recordingSnapshots.snapshots.find(snapshot=>snapshot.id===sourceId));expect(next.drawing).toBe(project.drawing);expect(JSON.stringify(project)).toBe(saved);
  expect(view(next).nodes).toEqual(before.nodes);expect(view(next).curves.map(curve=>curve.handles)).toEqual(before.curves.map(curve=>curve.handles));
  const changed=reload(next),source=changed.recordingSnapshots.library.curves[cid('c0')];source.width=.03;source.profile='EYELID';source.mist!.width=.01;source.mist!.density=.8;
  expect(view(changed).curves[0]).toMatchObject({name:'Local curve',width:.03,profile:'EYELID',inkVisible:false,mist:{enabled:false,width:.01,density:0}});
  expect(resolveSnapshot(changed.recordingSnapshots,'side').drawing.curves[0]).toMatchObject({name:'Curve 0',width:.03,mist:{enabled:true,density:.8}});
 });
 it('changes fill color and real mist parameters, retaining live source boundary and unedited mist fields',()=>{
  const {project,sourceId}=fixture(),plan=edit(project,d=>setFillMist(changePaint(d,cid('fill'),{color:'black',name:'Local fill'}),cid('fill'),{enabled:true,width:.12,opacity:0})),next=nextProject(plan),local=next.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!;
  expect(local.deformation.layers[cid('layer')].paintAppearance?.[cid('fill')]).toEqual({kind:'fill',name:'Local fill',color:'black',mist:{enabled:true,width:.12,opacity:0}});
  expect(next.recordingSnapshots.library).toEqual(project.recordingSnapshots.library);expect(next.drawing).toBe(project.drawing);
  const changed=reload(next);changed.recordingSnapshots.library.fills[cid('fill')].mist!.side='OUTSIDE';const drawing=view(changed),fill=drawing.fills[0],geometry=fillGeometry(drawing,fill);expect(geometry.error).toBeUndefined();expect(fill.mist).toEqual({enabled:true,width:.12,opacity:0,side:'OUTSIDE'});expect(fill.boundary).toEqual(view(project).fills[0].boundary);
  const layout=fillMistLayout(geometry.shapes,fill.mist!);expect(layout!.bounds[0]).toBeLessThan(0);expect(fillMistAlpha(.03,.12)).toBeGreaterThan(fillMistAlpha(.09,.12));expect(fillMistAlpha(.12,.12)).toBe(0);
  const pasted=prepareSnapshotReferencePaste(changed.recordingSnapshots,{sourceSnapshotId:sourceId,targetSnapshotId:'view',layerIds:[cid('layer')]});expect(pasted.changed).toBe(false);expect(pasted.workspace).toBe(changed.recordingSnapshots);
  const child=emptyRecordingSnapshot('child');child.layers=[{kind:'reference',id:'child-layer',name:'Child',baseSnapshotId:'view',baseLayerId:cid('layer')}];changed.recordingSnapshots.snapshots.push(child);expect(resolveSnapshot(changed.recordingSnapshots,'child').drawing.fills[0]).toEqual(fill);
 });
 it('uses live offset recipes, fixed ink units and inverse-mapped translation under nonuniform placement',()=>{
  const {project}=fixture(),state=project.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!.deformation;state.layers[cid('layer')]={placement:{translation:[2,-1],rotation:0,scale:1,scaleX:2,scaleY:.5}};
  const before=view(project),plan=edit(project,d=>setContourMist(setInkEnd(changePaint(d,cid('offset'),{name:'Local offset',distance:-.08,start:.1,end:.9,taper:0,width:.024,translation:[.6,.4],profile:'TAPER_END',profileReverse:false}),cid('offset'),0,{taper:0,extension:0}),[cid('offset')],{enabled:true,density:0})),next=nextProject(plan),drawing=view(reload(next)),offset=drawing.offsets[0];
  expect(offset).toMatchObject({name:'Local offset',distance:-.08,start:.1,end:.9,taper:0,width:.024,translation:[.6,.4],profile:'TAPER_END',profileReverse:false,inkEnds:[{taper:0,extension:0},{}],mist:{enabled:true,density:0}});
  expect(offsetGeometry(drawing,offset).error).toBeUndefined();expect(offsetGeometry(drawing,offset).shapes).not.toEqual(offsetGeometry(before,before.offsets[0]).shapes);
  expect(drawing.curves.map(curve=>shapeOf(drawing,curve.id))).toEqual(before.curves.map(curve=>shapeOf(before,curve.id)));expect(next.recordingSnapshots.library).toEqual(project.recordingSnapshots.library);
  expect(next.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layers[cid('layer')].paintAppearance?.[cid('offset')]).toMatchObject({translation:[.3,.8]});
 });
 it('does not reject roundoff from a rotated nonuniform offset translation',()=>{
  const {project}=fixture();project.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layers[cid('layer')]={placement:{translation:[1.3,-.4],rotation:33,scale:1,scaleX:1.7,scaleY:.6}};
  const next=nextProject(edit(project,d=>changePaint(d,cid('offset'),{translation:[-.23,.61]}))),offset=view(next).offsets[0];expect(offset.translation![0]).toBeCloseTo(-.23,12);expect(offset.translation![1]).toBeCloseTo(.61,12);expect(next.recordingSnapshots.library).toEqual(project.recordingSnapshots.library);
 });
 it('preserves all property edits through one Undo/Redo, saved/draft merge and JSON',()=>{
  const {project}=fixture();project.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!.draft={angle:{x:0,y:0},channels:[],deformation:{warps:[],bindings:[],layers:{},relationPositions:{}}};
  const plan=edit(project,d=>setFillMist(widthChange(d,[cid('c0')],.025),cid('fill'),{opacity:0})),next=nextProject(plan),local=next.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!;
  expect(local.deformation.layers).toEqual({});expect(local.draft!.deformation.layers[cid('layer')].paintAppearance?.[cid('fill')]).toMatchObject({mist:{opacity:0}});
  useWorkspaceMode.setState({mode:'recording'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(view(reload(next))).toEqual(view(next));
  const result=prepareSnapshotBatch(next,{commands:[{op:'updateSnapshot',snapshotId:'view'}]});expect(result.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layers[cid('layer')].paintAppearance?.[cid('fill')]).toMatchObject({mist:{opacity:0}});
 });
 it('allows style at exact zero scale, rejects locked or structurally invalid property patches atomically',()=>{
  const {project}=fixture();project.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layers[cid('layer')]={placement:{translation:[0,0],rotation:0,scale:1,scaleX:0,scaleY:2}};
  const next=nextProject(edit(project,d=>setContourMist(widthChange(d,[cid('c0')],.02),[cid('c0')],{density:0})));expect(view(next).curves[0].width).toBe(.02);expect(next.recordingSnapshots.library).toEqual(project.recordingSnapshots.library);
  expect(()=>edit(next,d=>changePaint(d,cid('offset'),{translation:[.3,.4]}))).toThrow(/collapsed/);
  next.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!.objectLocks={[cid('fill')]:true};expect(()=>edit(next,d=>({...d,fills:d.fills.map(fill=>({...fill,color:'black'}))}))).toThrow(/Unlock/);
  expect(()=>validateSnapshotPaintAppearance({x:{kind:'fill',boundary:[]}})).toThrow();expect(()=>validateSnapshotPaintAppearance({x:{kind:'offset',source:[]}})).toThrow();expect(()=>validateSnapshotCurveAppearance({x:{mist:{enabled:false,extra:true}}})).toThrow();expect(()=>validateSnapshotPaintAppearance({x:{kind:'fill',mist:{opacity:NaN}}})).toThrow();
 });
 it('keeps interval endpoint edits on their response channel while rejecting intermediate appearance ownership',()=>{
  const {project}=fixture();const side=project.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='side')!,basis=structuredClone(view(project).displayIntervals![0]);basis.ranges[0].start=.5;side.deformation.layers[cid('layer')]={intervals:{[basis.id]:{appearance:basis,enabled:{}}}};const moved={...project,recordingSnapshots:prepareSnapshotBatch(project,{commands:[{op:'setAngle',angle:{x:45,y:0}}]}).recordingSnapshots},before=evaluateRecordingSnapshot(moved.recordingSnapshots,'recording').drawing,track=before.displayIntervals![0],range=track.ranges[0],wanted=changeDisplayInterval(before,track.id,range.id,{start:.2});
  expect(snapshotDrawingIntervalCommands(before,wanted)).toEqual([{op:'changeInterval',layerId:cid('layer'),sourceTrackId:track.id,rangeId:range.id,start:.2}]);
  const next=nextProject(edit(moved,d=>changeDisplayInterval(d,track.id,range.id,{start:.2})));expect(evaluateRecordingSnapshot(next.recordingSnapshots,'recording').drawing.displayIntervals![0].ranges[0].start).toBeCloseTo(.2,8);expect(next.recordingSnapshots.snapshots).toEqual(moved.recordingSnapshots.snapshots);
  expect(()=>edit(moved,d=>widthChange(d,[cid('c0')],.025))).toThrow(/real Snapshot/);expect(()=>edit(moved,d=>setFillMist(d,cid('fill'),{opacity:.2}))).toThrow(/real Snapshot/);
 });
 it('keeps shared ARC radius controls in logical units through a placed real snapshot',()=>{
  const {project,sourceId}=fixture(),source=project.recordingSnapshots.snapshots.find(snapshot=>snapshot.id===sourceId)!;source.relations.joins={add:[{id:'arc',a:{curveId:cid('c0'),end:1},b:{curveId:cid('c1'),end:0},mode:'ARC',radius:.08}]};
  project.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layers[cid('layer')]={placement:{translation:[1,2],rotation:0,scale:2}};
  const before=view(project);expect(before.joins[0].radius).toBeCloseTo(.16,8);const next=nextProject(edit(project,d=>setArcRadius(d,'arc',.12)));expect(view(next).joins[0].radius).toBeCloseTo(.12,8);expect(next.recordingSnapshots.library).toEqual(project.recordingSnapshots.library);expect(next.recordingSnapshots.snapshots.find(snapshot=>snapshot.id===sourceId)).toEqual(source);
 });
 it('inverse-transports real-view interval numbers from the visible path without changing material ownership',()=>{
  const {project}=fixture();project.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layers[cid('layer')]={shape:{nodes:{[cid('n1')]:[.7,.4]},handles:{}}};
  const before=view(project),track=before.displayIntervals![0],wanted=.21,next=nextProject(edit(project,d=>changeDisplayInterval(d,track.id,track.ranges[0].id,{start:wanted}))),after=view(next);
  expect(after.displayIntervals![0].ranges[0].start).toBeCloseTo(wanted,7);expect(next.recordingSnapshots.library).toEqual(project.recordingSnapshots.library);expect(after.nodes).toEqual(before.nodes);
  const stored=next.recordingSnapshots.snapshots.find(snapshot=>snapshot.id==='view')!.draft!.deformation.layers[cid('layer')].intervals![track.id].appearance!.ranges[0].start;expect(Math.abs(stored-wanted)).toBeGreaterThan(.001);
 });
 it('uses the correction editing mirror preferences for numeric/V targets without altering basis-only ARC or interval properties',()=>{
  const d:DrawingDocument={...emptyDrawing(),nodes:[{id:'a0',position:[.2,0]},{id:'a1',position:[.6,1]},{id:'b0',position:[-.2,0]},{id:'b1',position:[-.6,1]}],curves:[{id:'a',name:'A',nodes:['a0','a1'],handles:[[.3,.3],[.5,.7]],width:.01,visible:true,locked:false},{id:'b',name:'B',nodes:['b0','b1'],handles:[[-.3,.3],[-.5,.7]],width:.01,visible:true,locked:false}],layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:['a','b']}],mirrorAxisX:0,mirrorEditing:{enabled:true,curvePairs:[{id:'pair',a:'a',b:'b',reverse:false}]}};
  const next=snapshotDrawingTransformTarget(d,['a'],{translation:[.1,.2],rotation:0,scale:1});expect(next.nodes.find(node=>node.id==='a0')!.position).toEqual([.30000000000000004,.2]);expect(next.nodes.find(node=>node.id==='b0')!.position).toEqual([-.30000000000000004,.2]);expect(next.mirrorEditing).toEqual(d.mirrorEditing);expect(d.nodes[0].position).toEqual([.2,0]);
  const {project}=fixture(),source=project.recordingSnapshots.snapshots[0];source.relations.joins={add:[{id:'arc',a:{curveId:cid('c0'),end:1},b:{curveId:cid('c1'),end:0},mode:'ARC',radius:.08}]};const drawing=view(project),scaled=snapshotDrawingTransformTarget(drawing,drawing.curves.map(curve=>curve.id),{translation:[0,0],rotation:0,scale:2});expect(scaled.joins).toBe(drawing.joins);expect(scaled.displayIntervals).toEqual(drawing.displayIntervals);expect(scaled.curves.map(curve=>curve.width)).toEqual(drawing.curves.map(curve=>curve.width));
 });
 it('renders the actual shared properties and paint scene from the local values',()=>{
  const {project}=fixture(),next=nextProject(edit(project,d=>setContourMist(changePaint(changePaint(d,cid('fill'),{color:'black'}),cid('offset'),{width:.024,distance:-.08}),[cid('c0')],{density:.2}))),drawing=view(next);
  const shared=(selection:{ids:string[];paint?:string})=>renderToStaticMarkup(createElement(SnapshotDrawingProperties,{drawing,selection,choose:()=>{},run:()=>{},preview:()=>{},session:{current:()=>drawing,undo:()=>{},redo:()=>{}},tool:()=>{},transform:()=>{},propertiesEditable:true,topologyEditable:true,geometryEditable:true,intervalEditable:true,onPosition:()=>{}}));
  const curveControls=shared({ids:[cid('c0')]});expect(curveControls).toContain('drawing-mist-controls');expect(curveControls).toContain('numeric-slider');expect(curveControls).toContain('drawing-display-intervals');expect(curveControls).toContain('drawing-control-select');
  expect(shared({ids:[],paint:cid('fill')})).toContain('drawing-fill-mist-controls');expect(shared({ids:[],paint:cid('offset')})).toContain('drawing-ink-ends');
  const html=renderToStaticMarkup(createElement('svg',{},createElement(PaintScene,{d:drawing,screen:(point:Point2)=>point.map(value=>value*250) as Point2,unit:250,preview:true,showFills:true,referenceMoving:false,tool:'select',curveDown:()=>{},paintDown:()=>{},arcDown:()=>{}})));
  expect(html).toContain('data-testid="drawing-fill"');expect(html).toContain('fill="black"');expect(html).toContain('data-testid="drawing-offset"');expect(html).toContain('stroke-width="6"');
  const stroke=strokes(drawing,drawing.layers[0].id)[0],passes=strokeInkPasses(drawing,stroke,strokeInk(drawing,stroke));expect(passes.some(pass=>pass.mist?.density===.2)).toBe(true);
 });
});
