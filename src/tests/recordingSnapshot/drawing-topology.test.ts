import {describe,it,expect} from 'vitest';
import {emptyDrawing,shapeOf,type DrawingDocument,type Cubic,type Point2} from '../../domain/drawing/model';
import {addLayer,createCurve,createPenCurve,connect,deleteObjects,deleteLayer,duplicateLayer,moveHandle} from '../../domain/drawing/commands';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {resolveSnapshot,evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {prepareSnapshotDrawingTopologyEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {createWarpGrid,moveWarpNode} from '../../domain/vectorWarp/model';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {createEmptyProject} from '../../app/emptyProject';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],b];
const cid=(id:string)=>canonicalElementId('source',id);
function fixture(){
 let drawing:DrawingDocument={...emptyDrawing(),layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:[]}]};drawing=createCurve(drawing,'layer',line([0,0],[1,0]),.02,'Original','curve');
 const w=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing),source=w.snapshots[0],view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording');
 view.parentSnapshotId=source.id;view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:cid('layer')}];side.layers=structuredClone(view.layers);
 recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));w.snapshots.push(view,side);w.recordings=[recording];w.activeRecordingId=recording.id;
 w.legacyArchive={projectJSON:'{}',format:'landmark-project-json',migrationVersion:2};return {w,source,view,side,recording,drawing};
}
function edit(w:ReturnType<typeof fixture>['w'],change:(drawing:DrawingDocument)=>DrawingDocument){const beforeDrawing=resolveSnapshot(w,'view',{diagnostics:'preview'}).drawing;return prepareSnapshotDrawingTopologyEdit(w,{recordingId:'recording',snapshotId:'view',angle:{x:0,y:0},beforeDrawing,drawing:change(beforeDrawing)});}
function expectGeometry(actual:DrawingDocument,target:DrawingDocument){for(const curve of target.curves){expect(actual.curves.find(item=>item.id===curve.id)?.nodes).toEqual(curve.nodes);for(const [i,point] of shapeOf(target,curve.id).entries())for(const axis of [0,1])expect(shapeOf(actual,curve.id)[i][axis]).toBeCloseTo(point[axis],8);}}
describe('Drawing topology in real Recording snapshots',()=>{
 it('creates an empty owned layer and pen curve with stable IDs, then preserves one atomic Undo/Redo boundary',()=>{
  const {w}=fixture(),project={...createEmptyProject(),recordingSnapshots:w},beforeDrawing=resolveSnapshot(w,'view',{diagnostics:'preview'}).drawing,target=addLayer(beforeDrawing,'New layer'),layer=target.layers[0];
  const result=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'local-drawing-topology',recordingId:'recording',snapshotId:'view',angle:{x:0,y:0},beforeDrawing,drawing:target});
  expect(result.project.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='view')!.layers[0]).toEqual({...layer,kind:'original'});
  useWorkspaceMode.setState({mode:'recording'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(result);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(result.project);
  const next=edit(result.project.recordingSnapshots!,d=>createPenCurve(d,layer.id,line([0,1],[1,1]),.02,'new-pen')).workspace;expect(next.library.curves['new-pen']).toBeDefined();expect(next.snapshots.find(snapshot=>snapshot.id==='view')!.parentSnapshotId).toBe(w.snapshots.find(snapshot=>snapshot.id==='view')!.parentSnapshotId);expect(()=>parseRecordingSnapshots(next)).not.toThrow();
 });
 it('continues a local stroke using actual shared nodes and SMOOTH through the common Drawing commands',()=>{
  let {w}=fixture();w=edit(w,d=>createPenCurve(d,'slot',line([0,1],[1,1]),.02,'pen-a')).workspace;
  let wanted!:DrawingDocument;const result=edit(w,d=>{wanted=connect(createPenCurve(d,'slot',line([1,1],[2,1]),.02,'pen-b'),{curveId:'pen-a',end:1},{curveId:'pen-b',end:0},'SMOOTH',undefined,true);return wanted;});
  const actual=resolveSnapshot(result.workspace,'view').drawing;expectGeometry(actual,wanted);expect(actual.curves.find(curve=>curve.id==='pen-a')!.nodes[1]).toBe(actual.curves.find(curve=>curve.id==='pen-b')!.nodes[0]);expect(actual.joins).toEqual(wanted.joins);expect(result.workspace.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layers.slot?.shape).toBeUndefined();
  const reloaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(result.workspace)));expectGeometry(resolveSnapshot(reloaded,'view').drawing,wanted);expect(evaluateRecordingSnapshot(reloaded,'recording',{angle:{x:45,y:0}}).drawing.curves.map(curve=>curve.id)).toEqual([cid('curve')]);
 });
 it('inverts affine local Warp and anisotropic placement while retaining live layer domains',()=>{
  const {w,view,source}=fixture(),grid=createWarpGrid({min:[-1,-1],max:[2,2]},2,2),map=(p:Point2):Point2=>[2*p[0]+.3*p[1]+.5,.5*p[0]+1.5*p[1]-.2];
  for(const node of grid.nodes){node.position=map(node.position);node.handleU=map(node.handleU);node.handleV=map(node.handleV);}
  view.deformation.warps=[{id:'warp',name:'Warp',restGrid:createWarpGrid(grid.bounds,2,2),grid}];view.deformation.bindings=[{layerId:'slot',warpId:'warp'}];view.deformation.layers.slot={placement:{translation:[.3,.7],rotation:.2,scale:1,scaleX:1.2,scaleY:.8}};
  const sourceBefore=JSON.stringify(source),libraryBefore=JSON.stringify(w.library),statesBefore=JSON.stringify(view.deformation),targetShape:Cubic=[[.1,.6],[.4,.9],[.8,.2],[1.2,.7]];
  const result=edit(w,d=>createPenCurve(d,'slot',targetShape,.02,'affine-new'));expect(shapeOf(resolveSnapshot(result.workspace,'view').drawing,'affine-new').flat()).toEqual(expect.arrayContaining(targetShape.flat().map(value=>expect.closeTo(value,8))));
  expect(JSON.stringify(result.workspace.snapshots.find(snapshot=>snapshot.id===source.id))).toBe(sourceBefore);for(const category of ['nodes','curves','fills','offsets'] as const)for(const [id,value] of Object.entries(JSON.parse(libraryBefore)[category]))expect(result.workspace.library[category][id]).toEqual(value);expect(JSON.stringify(result.workspace.snapshots.find(snapshot=>snapshot.id==='view')!.deformation)).toBe(statesBefore);
  const local=result.workspace.snapshots.find(snapshot=>snapshot.id==='view')!;local.deformation.layers.slot.placement!.translation[0]+=2;expect(shapeOf(resolveSnapshot(result.workspace,'view').drawing,'affine-new')[0][0]).toBeCloseTo(targetShape[0][0]+2,8);
 });
 it('adds a real shared-node continuation of inherited geometry without writing its canonical source',()=>{
  const {w,view}=fixture(),before=JSON.stringify(w.library),node=w.library.curves[cid('curve')].nodes[1];view.deformation.layers.slot={shape:{nodes:{[node]:[.2,.3]},handles:{}}};
  let wanted!:DrawingDocument;const result=edit(w,d=>{const p=shapeOf(d,cid('curve'))[3];wanted=connect(createPenCurve(d,'slot',line(p,[p[0]+1,p[1]]),.02,'continued'),{curveId:cid('curve'),end:1},{curveId:'continued',end:0},'SMOOTH',undefined,true);return wanted;});
  expectGeometry(resolveSnapshot(result.workspace,'view').drawing,wanted);expect(result.workspace.library.curves.continued.nodes[0]).toBe(node);expect(result.workspace.library.curves[cid('curve')]).toEqual(JSON.parse(before).curves[cid('curve')]);expect(result.workspace.library.nodes[node]).toEqual(JSON.parse(before).nodes[node]);
 });
 it('keeps inherited deletion local and deletes a local original through its descendants',()=>{
  const {w,source}=fixture(),sourceBefore=JSON.stringify(source),libraryBefore=JSON.stringify(w.library),excluded=edit(w,d=>deleteObjects(d,[cid('curve')])).workspace;
  expect(JSON.stringify(excluded.library)).toBe(libraryBefore);expect(JSON.stringify(excluded.snapshots.find(snapshot=>snapshot.id===source.id))).toBe(sourceBefore);expect(resolveSnapshot(excluded,'side').drawing.curves).toHaveLength(1);expect(resolveSnapshot(excluded,'view').drawing.curves).toHaveLength(0);
  let local=edit(w,d=>createPenCurve(d,'slot',line([0,2],[1,2]),.02,'own')).workspace;const child=emptyRecordingSnapshot('child');child.layers=[{kind:'reference',id:'child-slot',name:'Child',baseSnapshotId:'view',baseLayerId:'slot'}];local.snapshots.push(child);expect(resolveSnapshot(local,'child').drawing.curves.some(curve=>curve.id==='own')).toBe(true);
  local=edit(local,d=>deleteObjects(d,['own'])).workspace;expect(local.library.curves.own).toBeUndefined();expect(resolveSnapshot(local,'child').drawing.curves.some(curve=>curve.id==='own')).toBe(false);expect(local.library.curves[cid('curve')]).toBeDefined();
 });
 it('duplicates a layer and its independent geometry through Drawing’s existing command',()=>{
  const {w}=fixture();let wanted!:DrawingDocument;const result=edit(w,d=>{wanted=duplicateLayer(d,'slot');return wanted;});expectGeometry(resolveSnapshot(result.workspace,'view').drawing,wanted);expect(result.workspace.snapshots.find(snapshot=>snapshot.id==='view')!.layers.filter(layer=>layer.kind==='original')).toHaveLength(1);
 });
 it('deletes an inherited layer without changing its source or semantic parent',()=>{
  const {w,view,source}=fixture();view.parentLayers={};view.parentSnapshotId=source.id;view.layers[0].id=cid('layer');const result=edit(w,d=>deleteLayer(d,cid('layer'))).workspace;
  expect(result.snapshots.find(snapshot=>snapshot.id==='view')!.layers).toEqual([]);expect(result.snapshots.find(snapshot=>snapshot.id==='view')!.parentSnapshotId).toBe(source.id);expect(result.snapshots.find(snapshot=>snapshot.id==='view')!.parentLayers?.excludedLayerIds).toEqual([cid('layer')]);expect(result.library).toEqual(w.library);
 });
 it('allows local geometry with missing provenance and reports a warning',()=>{
  const {w,view}=fixture();if(view.layers[0].kind!=='reference')throw Error('Expected reference');view.layers[0].baseSnapshotId='missing';view.layers[0].membership={addElementIds:[]};
  expect(resolveSnapshot(w,'view').drawing.layers.map(layer=>layer.id)).toEqual(['slot']);
  const result=edit(w,d=>createPenCurve(d,'slot',line([0,2],[1,2]),.02,'missing-parent-new'));expect(resolveSnapshot(result.workspace,'view').drawing.curves.map(curve=>curve.id)).toEqual(['missing-parent-new']);expect(result.diagnostics.some(issue=>issue.code==='MISSING_SNAPSHOT')).toBe(true);
 });
 it('rejects correction frames, exact-angle near misses, nonlinear and singular inverses atomically',()=>{
  const {w,view,recording}=fixture(),beforeDrawing=resolveSnapshot(w,'view').drawing,target=createPenCurve(beforeDrawing,'slot',line([0,2],[1,2]),.02,'new');recording.angle={x:45,y:0};recording.angleGraph!.correctionFrames=[{id:'correction',angle:{x:45,y:0},status:'saved'}];
  expect(()=>prepareSnapshotDrawingTopologyEdit(w,{recordingId:'recording',snapshotId:'view',angle:recording.angle,beforeDrawing,drawing:target})).toThrow(/actual recorder vertex/);recording.angle={x:Number.EPSILON,y:0};expect(()=>edit(w,d=>d)).toThrow(/exact requested angle/);recording.angle={x:0,y:0};
  const restGrid=createWarpGrid({min:[-1,-1],max:[2,2]},2,2);view.deformation.warps=[{id:'warp',name:'Warp',restGrid,grid:moveWarpNode(restGrid,4,[.5,.8])}];view.deformation.bindings=[{layerId:'slot',warpId:'warp'}];const before=JSON.stringify(w);expect(()=>edit(w,d=>createPenCurve(d,'slot',line([0,2],[1,2]),.02,'new'))).toThrow(/nonlinear local Warp/);expect(JSON.stringify(w)).toBe(before);
  view.deformation.warps=[];view.deformation.bindings=[];view.deformation.layers.slot={placement:{translation:[0,0],rotation:0,scale:1,scaleX:0,scaleY:1}};expect(()=>edit(w,d=>createPenCurve(d,'slot',line([0,2],[1,2]),.02,'new'))).toThrow(/collapsed placement axis/);
 });
 it('preserves saved and draft residuals while applying a Drawing pen handle edit locally',()=>{
  let {w}=fixture();w=edit(w,d=>createPenCurve(d,'slot',line([0,1],[1,1]),.02,'pen')).workspace;const local=w.snapshots.find(snapshot=>snapshot.id==='view')!;local.draft={angle:{x:0,y:0},deformation:{warps:[],bindings:[],layers:{slot:{placement:{translation:[.2,.1],rotation:0,scale:1}}},relationPositions:{}},channels:[]};const saved=structuredClone(local.deformation);let wanted!:DrawingDocument;
  const result=edit(w,d=>{wanted=moveHandle(d,{curveId:'pen',end:1},[.6,1.3]);return wanted;});expectGeometry(resolveSnapshot(result.workspace,'view').drawing,wanted);expect(result.workspace.snapshots.find(snapshot=>snapshot.id==='view')!.deformation).toEqual(saved);expect(result.workspace.snapshots.find(snapshot=>snapshot.id==='view')!.draft!.deformation.layers.slot.placement).toEqual(local.draft.deformation.layers.slot.placement);
 });
 it('uses the saved snapshot coordinate after recorder angle rebinding',()=>{
  const {w,recording,view}=fixture();applySnapshotCommand(w,{op:'rebindSnapshotAngle',snapshotId:view.id,angle:{x:15,y:0}});
  view.draft={angle:{x:0,y:0},deformation:{warps:[],bindings:[],layers:{slot:{placement:{translation:[.4,.2],rotation:0,scale:1}}},relationPositions:{}},channels:[]};
  const beforeDrawing=evaluateRecordingSnapshot(w,recording.id,{angle:{x:15,y:0},useDraft:true,diagnostics:'preview'}).drawing,target=createPenCurve(beforeDrawing,'slot',line([0,2],[1,2]),.02,'rebound-pen');
  const result=prepareSnapshotDrawingTopologyEdit(w,{recordingId:recording.id,snapshotId:view.id,angle:{x:15,y:0},beforeDrawing,drawing:target});expectGeometry(evaluateRecordingSnapshot(result.workspace,recording.id,{angle:{x:15,y:0},useDraft:true}).drawing,target);expect(result.workspace.snapshots.find(snapshot=>snapshot.id===view.id)!.angle).toEqual({x:0,y:0});
 });
 it('exposes empty layers and Drawing targets through the same command facade',()=>{
  const {w}=fixture(),created=applySnapshotCommand(w,{op:'createLocalLayer',name:'Empty'}).created.find(value=>value.kind==='layer')!;expect(resolveSnapshot(w,'view').drawing.layers.some(layer=>layer.id===created.id)).toBe(true);const beforeDrawing=resolveSnapshot(w,'view').drawing;
  applySnapshotCommand(w,{op:'applyDrawingTopology',beforeDrawing,drawing:createPenCurve(beforeDrawing,created.id,line([0,3],[1,3]),.02,'facade-pen')});expect(w.library.curves['facade-pen']).toBeDefined();expect(()=>parseRecordingSnapshots(w)).not.toThrow();
 });
});
