import {describe,it,expect} from 'vitest';
import {emptyDrawing,nodeAt,shapeOf,type DrawingDocument,type Endpoint} from '../../domain/drawing/model';
import {createCurve,linkEndpoints,unlinkEndpoints,connect,moveNode} from '../../domain/drawing/commands';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {canonicalElementId,upsertDrawingSource} from '../../domain/recordingSnapshot/sources';
import {prepareSnapshotDrawingTopologyEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {createEmptyProject} from '../../app/emptyProject';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {addDisplayInterval} from '../../domain/drawing/displayIntervals';
import {adoptDisplayRoute} from '../../domain/drawing/displayRouteAuthoring';
import {setEndpointLinkBrush} from '../../domain/drawing/endpointRelationAuthoring';
const cid=(id:string)=>canonicalElementId('source',id),a:Endpoint={curveId:cid('a'),end:1},b:Endpoint={curveId:cid('b'),end:0};
function fixture(){
 let drawing:DrawingDocument={...emptyDrawing(),layers:[{id:'left',name:'Left',visible:true,locked:false,items:[]},{id:'right',name:'Right',visible:true,locked:false,items:[]}]};
 drawing=createCurve(drawing,'left',[[-1,0],[-.7,.2],[-.3,.2],[0,0]],.02,'A','a');drawing=createCurve(drawing,'right',[[.3,.3],[.5,.6],[.8,.6],[1,.3]],.03,'B','b');
 const w=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',drawing),source=w.snapshots[0],view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording');
 view.layers=drawing.layers.map(layer=>({kind:'reference',id:layer.id,name:layer.name,baseSnapshotId:source.id,baseLayerId:cid(layer.id)}));side.layers=structuredClone(view.layers);recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));w.snapshots.push(view,side);w.recordings=[recording];w.activeRecordingId=recording.id;w.legacyArchive={projectJSON:'{}',format:'landmark-project-json',migrationVersion:2};return {w,view,source,recording,drawing};
}
function edit(w:ReturnType<typeof fixture>['w'],change:(drawing:DrawingDocument)=>DrawingDocument){const beforeDrawing=resolveSnapshot(w,'view',{diagnostics:'preview'}).drawing;return prepareSnapshotDrawingTopologyEdit(w,{recordingId:'recording',snapshotId:'view',angle:{x:0,y:0},beforeDrawing,drawing:change(beforeDrawing)}).workspace;}
function sameGeometry(actual:DrawingDocument,wanted:DrawingDocument){expect(actual.curves.map(curve=>curve.nodes)).toEqual(wanted.curves.map(curve=>curve.nodes));for(const curve of wanted.curves)for(const [index,point] of shapeOf(wanted,curve.id).entries())for(const axis of [0,1])expect(shapeOf(actual,curve.id)[index][axis]).toBeCloseTo(point[axis],8);}
describe('Snapshot local EndpointLink authoring',()=>{
 it('links cross-layer inherited nodes through one position authority while retaining source, widths and other views',()=>{
  const {w,source}=fixture(),sourceBefore=structuredClone(source),library=structuredClone(w.library),before=resolveSnapshot(w,'view').drawing,target=linkEndpoints(before,a,b,true),result=edit(w,()=>target),view=result.snapshots.find(snapshot=>snapshot.id==='view')!;
  sameGeometry(resolveSnapshot(result,'view').drawing,target);expect(result.library).toEqual(library);expect(result.snapshots.find(snapshot=>snapshot.id===source.id)).toEqual(sourceBefore);expect(resolveSnapshot(result,'side').drawing).toEqual(resolveSnapshot(w,'side').drawing);expect(view.relations.endpointLinks?.add).toEqual(target.endpointLinks);expect(Object.values(view.deformation.relationPositions)).toHaveLength(1);expect(view.deformation.layers.left.shape?.nodes).toEqual({});expect(view.deformation.layers.right.shape?.nodes).toEqual({});expect(resolveSnapshot(result,'view').drawing.curves.map(curve=>curve.width)).toEqual(before.curves.map(curve=>curve.width));
  sameGeometry(resolveSnapshot(parseRecordingSnapshots(JSON.parse(JSON.stringify(result))),'view').drawing,target);
 });
 it('keeps both sides coupled for direct editing and subsequent source sync without changing canonical IDs',()=>{
  const {w,drawing}=fixture();let result=edit(w,d=>linkEndpoints(d,a,b,true));const linked=resolveSnapshot(result,'view').drawing,nodeId=nodeAt(linked,b).id;
  applySnapshotCommand(result,{op:'moveShapeNode',layerId:'right',nodeId,position:[.4,-.2]});const moved=resolveSnapshot(result,'view').drawing;expect(nodeAt(moved,a).position).toEqual(nodeAt(moved,b).position);expect(nodeAt(moved,a).position[0]).toBeCloseTo(.4,8);
  const changed=moveNode(drawing,drawing.curves.find(curve=>curve.id==='a')!.nodes[0],[-1.3,.1]);result=upsertDrawingSource(result,'source',changed);const synced=resolveSnapshot(result,'view').drawing;expect(nodeAt(synced,a).position).toEqual(nodeAt(synced,b).position);expect(synced.curves.map(curve=>curve.nodes)).toEqual(linked.curves.map(curve=>curve.nodes));
 });
 it('unlink retains the visible controls, then either endpoint moves independently',()=>{
  const {w}=fixture(),linked=edit(w,d=>linkEndpoints(d,a,b,true)),before=resolveSnapshot(linked,'view').drawing,result=edit(linked,d=>unlinkEndpoints(d,d.endpointLinks![0].id));sameGeometry(resolveSnapshot(result,'view').drawing,before);expect(Object.values(result.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.relationPositions)).toHaveLength(0);
  applySnapshotCommand(result,{op:'moveShapeNode',layerId:'left',nodeId:nodeAt(before,a).id,position:[.5,.4]});expect(nodeAt(resolveSnapshot(result,'view').drawing,b).position).toEqual(nodeAt(before,b).position);
 });
 it('unlink through an existing draft retains geometry and removes stale relation authority metadata',()=>{
  const {w}=fixture(),linked=edit(w,d=>linkEndpoints(d,a,b,true)),view=linked.snapshots.find(snapshot=>snapshot.id==='view')!;view.draft={angle:{x:0,y:0},channels:[],deformation:{warps:[],bindings:[],layers:{left:{depth:2}},relationPositions:{}}};
  const before=resolveSnapshot(linked,'view').drawing,result=edit(linked,d=>unlinkEndpoints(d,d.endpointLinks![0].id)),actual=resolveSnapshot(result,'view');sameGeometry(actual.drawing,before);expect(actual.diagnostics.filter(issue=>issue.code==='MISSING_RELATION')).toEqual([]);expect(result.snapshots.find(snapshot=>snapshot.id==='view')!.draft!.deformation.layers.left.depth).toBe(2);
 });
 it('rejects correction frames, incompatible placements and inherited node merging atomically',()=>{
  const {w,view,recording}=fixture();view.deformation.layers.right={placement:{translation:[.2,.1],rotation:.2,scale:1}};const before=JSON.stringify(w);expect(()=>edit(w,d=>linkEndpoints(d,a,b,true))).toThrow(/incompatible.*placements/);expect(JSON.stringify(w)).toBe(before);
  view.deformation.layers={};recording.angle={x:45,y:0};expect(()=>edit(w,d=>linkEndpoints(d,a,b,true))).toThrow(/actual recorder vertex/);recording.angle={x:0,y:0};
  view.layers[0].kind==='reference'&&(view.layers[0].membership={addElementIds:[]});const current=resolveSnapshot(w,'view').drawing,sameLayer={...current,layers:[{...current.layers[0],items:current.curves.map(curve=>curve.id)}]};expect(()=>edit(w,()=>connect(sameLayer,a,b,'POSITION'))).toThrow(/merge two distinct inherited nodes/);
 });
 it('commits linking and unlinking in one Undo step apiece',()=>{
  const {w}=fixture(),project={...createEmptyProject(),recordingSnapshots:w},beforeDrawing=resolveSnapshot(w,'view').drawing;
  const plan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'local-drawing-topology',recordingId:'recording',snapshotId:'view',angle:{x:0,y:0},beforeDrawing,drawing:linkEndpoints(beforeDrawing,a,b,true)});
  useWorkspaceMode.setState({mode:'recording'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);
 });
 it('stores active SMOOTH and ARC brush edits locally through the shared Drawing command',()=>{
  const {w,drawing}=fixture();drawing.curves[1].width=.02;let original=linkEndpoints(drawing,{curveId:'a',end:1},{curveId:'b',end:0},true);original=addDisplayInterval(original,'a');original=adoptDisplayRoute(original,original.displayIntervals![0].id,original.endpointLinks![0].id).document;let linked=upsertDrawingSource(w,'source',original);
  const library=structuredClone(linked.library);for(const brush of [{kind:'SMOOTH' as const},{kind:'ARC' as const,trimDistance:.04}]){let target!:DrawingDocument;linked=edit(linked,d=>target=setEndpointLinkBrush(d,d.endpointLinks![0].id,brush));const actual=resolveSnapshot(linked,'view').drawing;sameGeometry(actual,target);expect(actual.endpointLinks![0].joinBrush).toEqual(brush);expect(linked.library).toEqual(library);}

 });
 it('rejects a new route over separated source controls atomically instead of silently losing it',()=>{
  const {w}=fixture();w.library.curves[cid('b')].width=.02;const linked=edit(w,d=>linkEndpoints(d,a,b,true)),before=JSON.stringify(linked);
  expect(()=>edit(linked,d=>{const intervals=addDisplayInterval(d,a.curveId);return adoptDisplayRoute(intervals,intervals.displayIntervals![0].id,intervals.endpointLinks![0].id).document;})).toThrow(/cannot yet retain a through-display route/);expect(JSON.stringify(linked)).toBe(before);
 });
});
