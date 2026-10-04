import {prepareDrawingControlEditPlan,applyDrawingControlEditPlan} from '../../domain/drawing/controlEditPlan';
import {preparedControlChangesBetween} from '../../domain/recordingSnapshot/preparedControlChanges';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotBatch,prepareSnapshotPreview,type SnapshotCommand} from '../../app/recordingSnapshotApi';
import {prepareSnapshotDrawingToolEdit} from '../../app/snapshotDrawingToolEdit';
import {prepareRecordingTemporaryCageEdit} from '../../app/recordingTemporaryCageEdit';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {useEditor} from '../../app/store';
import {useWorkspaceMode} from '../../app/workspaceMode';
import {createCurve,moveHandle,moveNode,transform} from '../../domain/drawing/commands';
import {dragNode} from '../../domain/drawing/nodeDrag';
import {applyMirrorEditing} from '../../domain/drawing/mirrorEditing';
import {applyLayerDomainIntent,createLayerAffineIntent,createLayerCageIntent} from '../../domain/drawing/layerDomainIntent';
import {rectQuad} from '../../domain/drawing/deform';
import {shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {parseLandmarks} from '../../domain/landmarks/persistence';
import type {LandmarkProject} from '../../domain/landmarks/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording,type Angle} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {effectiveSnapshotSurfaceResponses} from '../../domain/recordingSnapshot/surfaceTargets';
import {applyScenePlacement} from '../../domain/recordingScene/tracks';
import {identityScenePlacement,type ScenePlacementValue} from '../../domain/recordingScene/model';

const editor=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
afterEach(()=>{useEditor.getState().endEdit();useEditor.setState(editor,true);useWorkspaceMode.setState({mode});vi.useRealTimers();});

/** Small, public, synthetic geometry. H-P is deliberately identical at both
 * ends of the edge, while both node coordinates have a valid scalar inverse. */
function fixture(axis:'x'|'y'='x',sign=1,flatHandles=true):LandmarkProject {
 const workspace=emptyRecordingSnapshotWorkspace();
 workspace.library.nodes={a:{id:'a',position:[0,0]},b:{id:'b',position:[1,1]},p:{id:'p',position:[2,0]},q:{id:'q',position:[3,1]}};
 workspace.library.curves={
  ear:{id:'ear',name:'Ear',nodes:['a','b'],handles:[[.25,.5],[.75,.5]],visible:true,locked:false,width:.01},
  profile:{id:'profile',name:'Profile',nodes:['p','q'],handles:[[2.2,.3],[2.7,.8]],visible:true,locked:false,width:.01},
 };
 const zero=emptyRecordingSnapshot('zero','Zero'),side=emptyRecordingSnapshot('side','Side','view',{x:axis==='x'?90*sign:0,y:axis==='y'?90*sign:0});
 for(const snapshot of [zero,side])snapshot.layers=[{kind:'original',id:'ear-layer',name:'Ear',visible:true,locked:false,items:['ear']},{kind:'original',id:'profile-layer',name:'Profile',visible:true,locked:false,items:['profile']}];
 side.deformation.layers={
  'ear-layer':{shape:{nodes:{a:[1,.5],b:[.5,1]},handles:{ear:flatHandles?[[0,0],[0,0]]:[[.2,.3],[-.1,.2]]}}},
  'profile-layer':{shape:{nodes:{p:[.5,.3],q:[1,.6]},handles:{profile:flatHandles?[[0,0],[0,0]]:[[.1,.2],[-.2,.1]]}}},
 };
 const recording=emptySnapshotRecording('surface');recording.mode='triangulated';recording.snapshotIds=['zero','side'];recording.activeSnapshotId='zero';recording.angle={x:axis==='x'?60*sign:0,y:axis==='y'?60*sign:0};recording.angleGraph=createSnapshotAngleGraph([zero,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));
 workspace.snapshots=[zero,side];workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {...createEmptyProject(),recordingSnapshots:workspace};
}
const recording=(project:LandmarkProject)=>project.recordingSnapshots!.recordings.find(value=>value.id===project.recordingSnapshots!.activeRecordingId)!;
const evaluate=(project:LandmarkProject,angle=recording(project).angle,useDraft=true)=>evaluateRecordingSnapshot(project.recordingSnapshots!,recording(project).id,{angle,useDraft,diagnostics:'preview'});
const batch=(project:LandmarkProject,commands:SnapshotCommand[]):LandmarkProject=>({...project,recordingSnapshots:prepareSnapshotBatch(project,{commands}).recordingSnapshots});
function plan(project:LandmarkProject,wanted:DrawingDocument,validation:'preview'|'full'='full') {
 const before=evaluate(project),current=recording(project);
 return prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:current.id,snapshotId:before.snapshotId,angle:current.angle,beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry'},validation});
}
function near(actual:DrawingDocument,wanted:DrawingDocument,digits=7) {
 expect(actual.curves.map(curve=>curve.id)).toEqual(wanted.curves.map(curve=>curve.id));
 for(const node of wanted.nodes)for(const axis of [0,1] as const)expect(actual.nodes.find(value=>value.id===node.id)!.position[axis]).toBeCloseTo(node.position[axis],digits);
 for(const curve of wanted.curves)for(const end of [0,1] as const)for(const axis of [0,1] as const)expect(actual.curves.find(value=>value.id===curve.id)!.handles[end][axis]).toBeCloseTo(curve.handles[end][axis],digits);
}
function freeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
function sourceAndZeroUnchanged(before:LandmarkProject,after:LandmarkProject) {
 expect(JSON.stringify(after.recordingSnapshots!.library)).toBe(JSON.stringify(before.recordingSnapshots!.library));
 expect(JSON.stringify(after.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='zero'))).toBe(JSON.stringify(before.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='zero')));
 expect(JSON.stringify(evaluate(after,{x:0,y:0}).drawing)).toBe(JSON.stringify(evaluate(before,{x:0,y:0}).drawing));
 expect(after.drawing).toBe(before.drawing);
 expect(recording(after).snapshotIds).toEqual(recording(before).snapshotIds);
 expect(recording(after).angleGraph!.mesh).toEqual(recording(before).angleGraph!.mesh);
 expect(recording(after).tracks).toEqual(recording(before).tracks);
}
function followTarget(project:LandmarkProject,delta:Point2=[.08,-.04]) {
 const drawing=evaluate(project).drawing,p=drawing.nodes.find(node=>node.id==='a')!.position;
 return dragNode(drawing,'a',[p[0]+delta[0],p[1]+delta[1]],.4);
}
const transformCommand=(value:Partial<ScenePlacementValue>,curveIds=['ear']):SnapshotCommand=>({op:'transformShapeElements',curveIds,value:{...identityScenePlacement(),...value}});

describe('minimum-change inverse through the existing editing workflow',()=>{
 it('keeps the previously feasible signed response-only route exact, even beyond the fallback trust radius',()=>{
  const project=freeze(fixture()),before=evaluate(project),target=moveNode(before.drawing,'a',[25,-13],true),next=plan(project,target).project;
  near(evaluate(next).drawing,target,10);expect(next.recordingSnapshots!.snapshots).toEqual(project.recordingSnapshots!.snapshots);
  const graph=recording(next).angleGraph!,edge=Object.values(effectiveSnapshotSurfaceResponses(graph).edgeResponses)[0],sideIsSecond=graph.mesh.vertices.find(vertex=>vertex.id===graph.mesh.edges[0].vertexIds[1])!.snapshotId==='side';
  expect(edge.nodes.a.x!.at(-1)![1]).toBe(sideIsSecond?25:-24);expect(edge.nodes.a.y!.at(-1)![1]).toBe(sideIsSecond?-26:27);expect(edge.handles).toEqual({});
  sourceAndZeroUnchanged(project,next);
 });

 it.each([['x',1],['x',-1],['y',1],['y',-1]] as const)('remedies the flat H-P follow target on the %s/%s cardinal edge', (axis,sign)=>{
  const project=freeze(fixture(axis,sign)),original=JSON.stringify(project),target=followTarget(project),next=plan(project,target).project;
  near(evaluate(next).drawing,target);sourceAndZeroUnchanged(project,next);expect(JSON.stringify(project)).toBe(original);
  expect(next.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='side')!.draft).toBeDefined();
  expect(shapeOf(evaluate(next,recording(next).angleGraph!.mesh.vertices.find(vertex=>vertex.snapshotId==='side')!.angle).drawing,'ear')).not.toEqual(shapeOf(evaluate(project,recording(project).angleGraph!.mesh.vertices.find(vertex=>vertex.snapshotId==='side')!.angle).drawing,'ear'));
  expect(shapeOf(evaluate(next).drawing,'profile')).toEqual(shapeOf(evaluate(project).drawing,'profile'));
  const responses=effectiveSnapshotSurfaceResponses(recording(next).angleGraph!).edgeResponses;
  for(const edge of Object.values(responses))for(const response of [...Object.values(edge.nodes),...Object.values(edge.handles).flat()])for(const knots of [response.x,response.y])for(const [t,weight] of knots??[]){expect(Number.isFinite(t)&&Number.isFinite(weight)).toBe(true);expect(Math.abs(weight-t)).toBeLessThanOrEqual(8+1e-8);}
 });

 it('centers fallback weight bounds on pregesture signed responses above eight',()=>{
  const seed=fixture(),saved=batch(plan(seed,moveNode(evaluate(seed).drawing,'a',[25,-13],true)).project,[{op:'updateSnapshot'}]),before=evaluate(saved).drawing,handle=before.curves.find(curve=>curve.id==='ear')!.handles[0],wanted=moveHandle(before,{curveId:'ear',end:0},[handle[0]+.06,handle[1]-.03],true);
  const prior=Object.values(effectiveSnapshotSurfaceResponses(recording(saved).angleGraph!).edgeResponses)[0].nodes.a,next=plan(saved,wanted).project,after=Object.values(effectiveSnapshotSurfaceResponses(recording(next).angleGraph!).edgeResponses)[0].nodes.a;
  near(evaluate(next).drawing,wanted);sourceAndZeroUnchanged(saved,next);
  for(const axis of ['x','y'] as const){const old=prior[axis]!.at(-1)![1],weight=after[axis]!.at(-1)![1];expect(Math.abs(old)).toBeGreaterThan(8);expect(Number.isFinite(weight)).toBe(true);expect(Math.abs(weight-old)).toBeLessThanOrEqual(8+1e-8);}
 });

 it.each([{scaleX:1.2,scaleY:1},{scaleX:1,scaleY:.8},{rotation:17}])('uses the common V target pipeline for %j',value=>{
  const project=freeze(fixture()),before=evaluate(project).drawing,placement={...identityScenePlacement(),...value},wanted=transform(before,['ear'],point=>applyScenePlacement(placement,point),true,false),commands=[transformCommand(value)];
  const preview=prepareSnapshotPreview(project,{commands}),strict=prepareSnapshotBatch(project,{commands});
  near(evaluate({...project,recordingSnapshots:preview.recordingSnapshots}).drawing,wanted);near(evaluate({...project,recordingSnapshots:strict.recordingSnapshots}).drawing,wanted);
  sourceAndZeroUnchanged(project,{...project,recordingSnapshots:strict.recordingSnapshots});
 });

 it('routes an A handle command and an arbitrary final control target to the same geometry',()=>{
  const project=fixture(),before=evaluate(project).drawing,old=before.curves.find(curve=>curve.id==='ear')!.handles[0],position:Point2=[old[0]+.08,old[1]-.04],wanted=moveHandle(before,{curveId:'ear',end:0},position,true);
  const drawing=plan(project,wanted).project,command=batch(project,[{op:'moveShapeHandle',layerId:'ear-layer',curveId:'ear',end:0,position}]);
  near(evaluate(drawing).drawing,wanted);near(evaluate(command).drawing,wanted);sourceAndZeroUnchanged(project,command);
 });

 it('replays a temporary cage through the same fallback without persisting a new cage or viewpoint',()=>{
  const project=fixture(),before=evaluate(project),restRect={min:[-1,-1] as Point2,max:[3,3] as Point2},quad=rectQuad(restRect);quad[2]=[3.2,3.1];
  const intent=createLayerCageIntent(['ear-layer'],{kind:'h-coons',restRect,quad},{operationId:'temporary-cage'}),wanted=applyLayerDomainIntent(before.drawing,intent).document;
  const edit=prepareRecordingTemporaryCageEdit(snapshotEditContext(project,false),{recordingId:'surface',snapshotId:before.snapshotId,angle:recording(project).angle,beforeDrawing:before.drawing,intent});
  near(evaluate(edit.project).drawing,wanted);sourceAndZeroUnchanged(project,edit.project);
  expect(JSON.stringify(recording(edit.project).angleGraph)).not.toMatch(/temporary-cage|h-coons|restRect|quad/);
 });

 it('protects the evaluated output of a previously saved calibration angle',()=>{
  const start=batch(fixture(),[{op:'setAngle',angle:{x:30,y:0}}]),current=evaluate(start).drawing,p=current.nodes.find(node=>node.id==='a')!.position;
  const saved=batch(plan(start,moveNode(current,'a',[p[0]+.12,p[1]-.08],true)).project,[{op:'updateSnapshot'}]),old=evaluate(saved,{x:30,y:0},false).drawing;
  const before=batch(saved,[{op:'setAngle',angle:{x:60,y:0}}]),wanted=followTarget(before),next=plan(before,wanted).project;
  near(evaluate(next).drawing,wanted);near(evaluate(next,{x:30,y:0}).drawing,old,8);sourceAndZeroUnchanged(before,next);
  const committed=batch(next,[{op:'updateSnapshot'}]);near(evaluate(committed,{x:30,y:0},false).drawing,old,8);near(evaluate(committed,undefined,false).drawing,wanted);
 });

 it('solves every preview from the frozen beforeProject and ends at the direct target regardless of pointer detours',()=>{
  const project=freeze(fixture()),json=JSON.stringify(project),wanted=followTarget(project),direct=plan(project,wanted),previews=[followTarget(project,[.2,.1]),followTarget(project,[-.1,.07]),wanted].map(target=>plan(project,target,'preview'));
  for(const preview of previews){sourceAndZeroUnchanged(project,preview.project);expect(preview.before).toBe(project);}
  const last=previews.at(-1)!.project;near(evaluate(last).drawing,wanted,9);
  expect(last.recordingSnapshots!.snapshots).toEqual(direct.project.recordingSnapshots!.snapshots);
  expect(effectiveSnapshotSurfaceResponses(recording(last).angleGraph!).edgeResponses).toEqual(effectiveSnapshotSurfaceResponses(recording(direct.project).angleGraph!).edgeResponses);
  expect(JSON.stringify(project)).toBe(json);
  const noop=plan(project,evaluate(project).drawing);expect(noop.changed).toBe(false);expect(noop.project).toBe(project);
 });

 it('one global Undo/Redo restores the coupled basis and response and the Recording room',()=>{
  vi.useFakeTimers();const project=fixture(),wanted=followTarget(project),edit=plan(project,wanted);useWorkspaceMode.setState({mode:'recording'});useEditor.setState({project,past:[],future:[]});
  useEditor.getState().commitPreparedSnapshotEdit(edit);const after=useEditor.getState().project;expect(useEditor.getState().past).toEqual([project]);expect(after.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='side')!.draft).toBeDefined();
  useWorkspaceMode.setState({mode:'drawing'});useEditor.getState().undo();expect(useWorkspaceMode.getState().mode).toBe('recording');expect(useEditor.getState().project).toBe(project);expect(useEditor.getState().past).toEqual([]);
  useEditor.getState().redo();expect(useEditor.getState().project).toBe(after);near(evaluate(after).drawing,wanted);expect(useEditor.getState().past).toEqual([project]);
 });

 it('cancelled previews and failed or stale targets preserve project bytes, history, and Redo',()=>{
  vi.useFakeTimers();const project=fixture(),edit=plan(project,followTarget(project));useWorkspaceMode.setState({mode:'recording'});useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(edit);useEditor.getState().undo();const state=useEditor.getState(),json=JSON.stringify(state.project);
  state.beginEdit(true);state.setRecordingSnapshots(plan(project,followTarget(project,[.12,.08]),'preview').project.recordingSnapshots!);state.cancelEdit();
  expect(useEditor.getState().project).toBe(project);expect(useEditor.getState().past).toBe(state.past);expect(useEditor.getState().future).toBe(state.future);
  const before=evaluate(project),invalid={...before.drawing,curves:before.drawing.curves.map(curve=>({...curve,width:curve.width*2}))};expect(()=>plan(project,invalid)).toThrow(/preserve topology/);
  expect(()=>prepareSnapshotDrawingToolEdit(snapshotEditContext(edit.project,false),{recordingId:'surface',snapshotId:before.snapshotId,angle:recording(project).angle,beforeDrawing:before.drawing,drawing:followTarget(project),intent:{kind:'geometry'}})).toThrow(/changed during/);
  expect(JSON.stringify(useEditor.getState().project)).toBe(json);expect(useEditor.getState().past).toBe(state.past);expect(useEditor.getState().future).toBe(state.future);
 });

 it('save, selected discard, and JSON round trips keep basis and response in the same state',()=>{
  const project=fixture(),wanted=followTarget(project),draft=plan(project,wanted).project;
  const loaded={...draft,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(draft.recordingSnapshots)))};near(evaluate(loaded).drawing,wanted);near(evaluate(loaded,undefined,false).drawing,evaluate(project).drawing);
  const discarded=batch(loaded,[{op:'discardSelected',layerIds:['ear-layer'],warpIds:[]}]);near(evaluate(discarded).drawing,evaluate(project).drawing);expect(discarded.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='side')!.draft).toBeUndefined();expect(recording(discarded).angleGraph!.correctionFrames?.some(frame=>frame.status==='draft')??false).toBe(false);
  const saved=batch(loaded,[{op:'saveSelected',layerIds:['ear-layer'],warpIds:[]}]),reopened={...saved,recordingSnapshots:parseRecordingSnapshots(JSON.parse(JSON.stringify(saved.recordingSnapshots)))};
  near(evaluate(reopened,undefined,false).drawing,wanted);expect(reopened.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='side')!.draft).toBeUndefined();expect(recording(reopened).angleGraph!.correctionFrames?.some(frame=>frame.status==='draft')??false).toBe(false);sourceAndZeroUnchanged(project,reopened);
 });

 it.each(['updateEndpointCorrection','discardEndpointCorrection'] as const)('holds direct real-view topology, property and domain edits until coupled %s',finish=>{
  const project=fixture(),draft=plan(project,followTarget(project)).project;
  const navigate=(from:LandmarkProject,angle:Angle)=>prepareSnapshotEdit(snapshotEditContext(from,false),{kind:'snapshot-state',workspace:prepareSnapshotBatch(from,{commands:[{op:'setAngle',angle}]}).recordingSnapshots}).project;
  const atZero=freeze(navigate(draft,{x:0,y:0})),original=JSON.stringify(atZero);
  const topology=(from:LandmarkProject)=>{const beforeDrawing=evaluate(from).drawing;return prepareSnapshotEdit(snapshotEditContext(from,false),{kind:'snapshot-local-drawing',snapshotId:'zero',state:'saved',beforeDrawing,drawing:createCurve(beforeDrawing,'ear-layer',[[.1,.2],[.2,.3],[.3,.4],[.4,.5]],.01,'New local curve','new-local')});};
  const property=(from:LandmarkProject)=>{const workspace=structuredClone(from.recordingSnapshots!);workspace.snapshots.find(snapshot=>snapshot.id==='zero')!.deformation.layers['ear-layer']={curveAppearance:{ear:{width:.02}}};return prepareSnapshotEdit(snapshotEditContext(from,false),{kind:'snapshot-state',workspace});};
  const domain=(from:LandmarkProject)=>prepareSnapshotEdit(snapshotEditContext(from,false),{kind:'recording-layer-domain',recordingId:'surface',snapshotId:'zero',angle:{x:0,y:0},intent:createLayerAffineIntent(['ear-layer'],[1,0,0,1,.03,0],{operationId:'new-local-domain'})});
  for(const edit of [topology,property,domain])expect(()=>edit(atZero)).toThrow(/coupled.*pending.*save or discard/i);
  expect(JSON.stringify(atZero)).toBe(original);expect(recording(atZero).angle).toEqual({x:0,y:0});expect(atZero.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='side')!.draft).toBeDefined();
  const returned=navigate(atZero,{x:60,y:0}),finished=prepareSnapshotEdit(snapshotEditContext(returned,false),{kind:'snapshot-state',workspace:prepareSnapshotBatch(returned,{commands:[{op:finish}]}).recordingSnapshots}).project;
  expect(recording(finished).angleGraph!.correctionFrames?.some(frame=>frame.status==='draft')??false).toBe(false);expect(finished.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='side')!.draft).toBeUndefined();
  const reopened=navigate(finished,{x:0,y:0});for(const edit of [topology,property,domain])expect(edit(reopened).changed).toBe(true);
 });
});

// Opt in locally: CONTOUR_MINCHANGE_PRIVATE_FIXTURE=/absolute/path/124.json.
// No private drawing bytes, IDs, or derived geometry are checked into this test.
const privateFixture=process.env.CONTOUR_MINCHANGE_PRIVATE_FIXTURE;
it.skipIf(!privateFixture).each(['ear X','ear Y','profile X','profile Y'] as const)('replays the supplied private %s target without altering its file',kind=>{
 const raw=readFileSync(privateFixture!,'utf8'),digest=createHash('sha256').update(raw).digest('hex');expect(digest).toBe('8bd646f952dfca21f149b7cb89c25534564827eff8a5caadd69a17f96b046a7c');
 const project=parseLandmarks(raw),original=JSON.stringify(project),r=recording(project),angle:Angle={x:-60,y:0},before=evaluate(project,angle),zero=evaluate(project,{x:0,y:0}).drawing,axis=kind.endsWith('X')?0:1;
 let target:DrawingDocument;
 if(kind.startsWith('ear')){
  const ear=before.drawing.curves.find(curve=>curve.name==='左片·外侧下颌')!;expect(ear).toBeDefined();
  const node=before.drawing.nodes.find(node=>node.id===ear.nodes[0])!,position:Point2=[...node.position];position[axis]+=.02;
  target=applyMirrorEditing(before.drawing,dragNode(before.drawing,node.id,position,.4),{nodes:[{nodeId:node.id,position}]});
 }else{
  const profile=before.drawing.layers.find(layer=>layer.name==='朝左·额鼻唇颏开放轮廓')!;expect(profile).toBeDefined();const profileIds=profile.items.filter(id=>before.drawing.curves.some(curve=>curve.id===id));expect(profileIds).toHaveLength(9);
  target=transform(before.drawing,profileIds,point=>applyScenePlacement({...identityScenePlacement(),scaleX:axis===0?1.08:1,scaleY:axis===1?.92:1},point),true,false);
 }
 const started=performance.now(),result=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:r.id,snapshotId:before.snapshotId,angle,beforeDrawing:before.drawing,drawing:target,intent:{kind:'geometry'},validation:'preview'}),elapsedMs=performance.now()-started;
 near(evaluate(result.project,angle).drawing,target);expect(JSON.stringify(evaluate(result.project,{x:0,y:0}).drawing)).toBe(JSON.stringify(zero));expect(JSON.stringify(result.project.recordingSnapshots!.library)).toBe(JSON.stringify(project.recordingSnapshots!.library));expect(recording(result.project).snapshotIds).toEqual(r.snapshotIds);
 expect(JSON.stringify(project)).toBe(original);expect(createHash('sha256').update(readFileSync(privateFixture!)).digest('hex')).toBe(digest);
 console.info(JSON.stringify({fixture:'private minchange regression',target:kind,elapsedMs:Math.round(elapsedMs)}));
},120000);

it('planned 90-degree fallback records its expanded basis and solved protection controls',()=>{
 const project=fixture(),before=evaluateRecordingSnapshot(project.recordingSnapshots!,'surface',{useDraft:true,immutableInputs:true,diagnostics:'preview'}),controlPlan=prepareDrawingControlEditPlan(before.drawing,{kind:'node',nodeId:'a',followStrength:.4}),p=before.drawing.nodes.find(node=>node.id==='a')!.position,wanted=applyDrawingControlEditPlan(controlPlan,{kind:'point',position:[p[0]+.08,p[1]-.04]}),next=prepareSnapshotDrawingToolEdit(snapshotEditContext(project,false),{recordingId:'surface',snapshotId:before.snapshotId,angle:recording(project).angle,beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry',controlPlan},validation:'preview'}).project;
 near(evaluate(next).drawing,wanted);sourceAndZeroUnchanged(project,next);
 const changes=preparedControlChangesBetween(project.recordingSnapshots!,next.recordingSnapshots!,'surface');expect(changes).toBeDefined();expect(changes!.basisControls.get('side')).toContainEqual({kind:'node',nodeId:'b'});expect(changes!.basisControls.get('side')).toContainEqual({kind:'handle',curveId:'ear',end:1});expect(changes!.responseControls.length).toBeGreaterThan(0);expect(changes!.basisControls.get('side')!.some(control=>control.kind==='handle'&&control.curveId==='profile')).toBe(false);
});
