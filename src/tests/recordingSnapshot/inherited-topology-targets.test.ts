import {expect,test} from 'vitest';
import {addLayer,createCurve,connect,moveNode} from '../../domain/drawing/commands';
import {emptyDrawing,shapeOf,nodeAt,type DrawingDocument,type Cubic,type Point2} from '../../domain/drawing/model';
import {neutralBend} from '../../domain/deformation/coons';
import {fitDeformedCubic} from '../../domain/deformation/cubicDeformation';
import {drawingDeformProjection} from '../../domain/deformation/cageField';
import {emptyRecordingSnapshotWorkspace,emptyRecordingSnapshot,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {upsertDrawingSource,canonicalElementId} from '../../domain/recordingSnapshot/sources';
import {prepareSnapshotLocalDrawingEdit} from '../../domain/recordingSnapshot/drawingTopology';
import {resolveSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {applySnapshotCommand} from '../../domain/recordingSnapshot/commands';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {useEditor} from '../../app/store';
const id=(raw:string)=>canonicalElementId('source',raw);
const line=(a:Point2,b:Point2):Cubic=>[a,[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],[a[0]+(b[0]-a[0])*2/3,a[1]+(b[1]-a[1])*2/3],b];
const close=(a:Point2,b:Point2)=>a.forEach((value,i)=>expect(value).toBeCloseTo(b[i],9));
const sameGeometry=(actual:DrawingDocument,wanted:DrawingDocument)=>{for(const curve of wanted.curves){expect(actual.curves.find(value=>value.id===curve.id)!.nodes).toEqual(curve.nodes);shapeOf(actual,curve.id).forEach((point,i)=>close(point,shapeOf(wanted,curve.id)[i]));}};
function fixture(){
 let sourceDrawing=addLayer(emptyDrawing(),'Layer');const layer=sourceDrawing.layers[0].id;sourceDrawing=createCurve(sourceDrawing,layer,line([-.8,0],[-.1,0]),.01,'A','a');sourceDrawing=createCurve(sourceDrawing,layer,line([.2,.2],[.7,.8]),.01,'B','b');
 const workspace=upsertDrawingSource(emptyRecordingSnapshotWorkspace(),'source',sourceDrawing),source=workspace.snapshots[0],view=emptyRecordingSnapshot('view'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording'),bend=neutralBend();bend.handles[1][0][0]=1.2;
 view.layers=[{kind:'reference',id:'slot',name:'Layer',baseSnapshotId:source.id,baseLayerId:id(layer)}];side.layers=structuredClone(view.layers);view.deformation.layerDomains=[{kind:'h-coons',id:'cage',layerIds:['slot'],restRect:{min:[-1,-1],max:[1,1]},quad:[[-1,-1],[.9,-.8],[.5,1],[-.9,.8]],bend}];
 recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots.push(view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;const child=emptyRecordingSnapshot('child');child.layers=[{kind:'reference',id:'child-slot',name:'Child',baseSnapshotId:'view',baseLayerId:'slot'}];workspace.snapshots.push(child);return {workspace,sourceDrawing,layer,domain:view.deformation.layerDomains[0]};
}
const edit=(workspace:ReturnType<typeof fixture>['workspace'],drawing:DrawingDocument)=>prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:'child',state:'saved',beforeDrawing:resolveSnapshot(workspace,'child').drawing,drawing}).workspace;


const child=(workspace:ReturnType<typeof fixture>['workspace'])=>resolveSnapshot(workspace,'child').drawing;
test('inherited parent cage: P creates a local canonical input and exact final target without changing parent',()=>{
 const f=fixture(),before=child(f.workspace),parent=structuredClone(f.workspace.snapshots.find(s=>s.id==='view')!),library=structuredClone(f.workspace.library),shape:Cubic=[[-.5,.6],[-.3,.9],[.1,.7],[.3,.6]],target=createCurve(before,'child-slot',shape,.01,'Local','local'),workspace=edit(f.workspace,target);
 sameGeometry(child(workspace),target);expect(workspace.snapshots.find(s=>s.id==='view')).toEqual(parent);for(const kind of ['nodes','curves'] as const)for(const [key,value] of Object.entries(library[kind]))expect(workspace.library[kind][key]).toEqual(value);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)))),target);
});

test.each(['POSITION','CUSP','SMOOTH','ARC'] as const)('inherited parent cage: true %s bind retains source identity',mode=>{
 const f=fixture(),before=child(f.workspace),library=structuredClone(f.workspace.library),target=connect(before,{curveId:id('a'),end:1},{curveId:id('b'),end:0},mode),workspace=edit(f.workspace,target);sameGeometry(child(workspace),target);expect(workspace.library).toEqual(library);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)))),target);
});

test.each(['POSITION','CUSP','SMOOTH'] as const)('inherited parent cage: native Pen continues %s with drag handles',async join=>{
 const {penCandidate}=await import('../../ui/drawing/penController'),f=fixture(),options={layerId:'child-slot',unit:250,width:.01,join,taperScale:1};let workspace=f.workspace,current=child(workspace);
 const first=penCandidate(current,{position:[-.6,.5],out:[.1,.1]},[-.1,.7],[-.05,.8],options);workspace=edit(workspace,first.document);sameGeometry(child(workspace),first.document);current=child(workspace);const second=penCandidate(current,first.next,[.4,.5],[.5,.6],options);workspace=edit(workspace,second.document);sameGeometry(child(workspace),second.document);
});

test.each(['POSITION','SMOOTH','ARC'] as const)('inherited parent cage: a new local curve joins an existing endpoint with %s',mode=>{
 const f=fixture(),before=child(f.workspace),library=structuredClone(f.workspace.library),created=createCurve(before,'child-slot',[[-.1,.7],[.2,.8],[.5,.7],[.6,.4]],.02,'Local','local'),target=connect(created,{curveId:id('a'),end:1},{curveId:'local',end:0},mode),workspace=edit(f.workspace,target),actual=child(workspace);
 sameGeometry(actual,target);expect(nodeAt(actual,{curveId:'local',end:0}).id).toBe(nodeAt(actual,{curveId:id('a'),end:1}).id);for(const kind of ['nodes','curves'] as const)for(const [key,value] of Object.entries(library[kind]))expect(workspace.library[kind][key]).toEqual(value);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)))),target);
});

test('inherited parent cage: later parent source members have zero local deltas and parent program remains live',()=>{
 const f=fixture(),before=child(f.workspace),target=createCurve(before,'child-slot',[[-.5,.6],[-.3,.9],[.1,.7],[.3,.6]],.01,'Local','local');let workspace=edit(f.workspace,target);
 const fresh=line([-.6,-.4],[.3,-.2]);workspace=upsertDrawingSource(workspace,'source',createCurve(f.sourceDrawing,f.layer,fresh,.01,'Fresh','fresh'));const actual=child(workspace),parent=resolveSnapshot(workspace,'view').drawing;shapeOf(actual,id('fresh')).forEach((p,i)=>close(p,shapeOf(parent,id('fresh'))[i]));const state=workspace.snapshots.find(snapshot=>snapshot.id==='child')!.deformation;for(const domain of state.layerDomains??[])expect(domain.postShape?.handles[id('fresh')]).toBeUndefined();
 const localBefore=shapeOf(actual,'local'),owner=workspace.snapshots.find(snapshot=>snapshot.id==='view')!;if(owner.deformation.layerDomains![0].kind!=='h-coons')throw Error('fixture');owner.deformation.layerDomains![0].quad[1][0]+=.2;const changed=child(workspace);expect(shapeOf(changed,'local')).not.toEqual(localBefore);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)))),changed);shapeOf(changed,id('fresh')).forEach((p,i)=>close(p,shapeOf(resolveSnapshot(workspace,'view').drawing,id('fresh'))[i]));
});

test('inherited parent cage: a prior parent correction and local node target survive bind, later moves and Undo',()=>{
 const f=fixture(),parent=f.workspace.snapshots.find(snapshot=>snapshot.id==='view')!,sourceBytes=JSON.stringify(f.workspace.library),parentNode=nodeAt(resolveSnapshot(f.workspace,'view').drawing,{curveId:id('b'),end:0}).id;
 parent.deformation.layerDomains![0].postShape={nodes:{[parentNode]:[.03,-.02]},handles:{[id('b')]:[[.02,.01],[0,0]]}};
 const beforeDrawing=child(f.workspace),drawing=connect(beforeDrawing,{curveId:id('a'),end:1},{curveId:id('b'),end:0},'POSITION'),project={...createEmptyProject(),recordingSnapshots:f.workspace},plan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-local-drawing',snapshotId:'child',state:'saved',beforeDrawing,drawing});
 sameGeometry(child(plan.project.recordingSnapshots!),drawing);expect(JSON.stringify(plan.project.recordingSnapshots!.library)).toBe(sourceBytes);expect(plan.project.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='view')).toEqual(parent);
 const workspace=parseRecordingSnapshots(JSON.parse(JSON.stringify(plan.project.recordingSnapshots))),current=child(workspace),authority=nodeAt(current,{curveId:id('a'),end:1}).id,wanted=moveNode(current,authority,[.05,.4]),moved=edit(workspace,wanted);sameGeometry(child(moved),wanted);expect(nodeAt(child(moved),{curveId:id('b'),end:0}).id).toBe(authority);expect(JSON.stringify(moved.library)).toBe(sourceBytes);
 const previous=useEditor.getState();try{useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);}finally{useEditor.setState(previous,true);}
});

test('inherited parent cage: P also starts in an empty child membership with parent sparse controls',()=>{
 const f=fixture(),parent=f.workspace.snapshots.find(snapshot=>snapshot.id==='view')!,local=f.workspace.snapshots.find(snapshot=>snapshot.id==='child')!;parent.deformation.layerDomains![0].postShape={nodes:{},handles:{[id('b')]:[[.03,.02],[0,0]]}};if(local.layers[0].kind!=='reference')throw Error('fixture');local.layers[0].membership={excludeElementIds:[id('a'),id('b')]};
 const before=child(f.workspace);expect(before.curves).toHaveLength(0);const wanted=createCurve(before,'child-slot',[[-.5,.6],[-.3,.9],[.1,.7],[.3,.6]],.01,'Local','local'),workspace=edit(f.workspace,wanted);sameGeometry(child(workspace),wanted);sameGeometry(child(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)))),wanted);expect(workspace.snapshots.find(snapshot=>snapshot.id==='view')).toEqual(parent);
});

test('Drawing API P and endpoint binding edit the inherited view with one Undo each and keep source untouched',async()=>{
 const {createVectorEditingApi}=await import('../../app/vectorEditingApi'),{prepareDrawingSnapshotEdit}=await import('../../app/drawingSnapshotEdit'),{currentDrawingPresentation}=await import('../../ui/drawing/snapshotPresentation'),{drawingSnapshotForArtwork}=await import('../../domain/recordingSnapshot/sources'),{useWorkspaceMode}=await import('../../app/workspaceMode');
 const f=fixture(),blank=emptyDrawing(),workspace=upsertDrawingSource(f.workspace,'author',blank),author=drawingSnapshotForArtwork(workspace,'author')!;author.layers=[{kind:'reference',id:'author-slot',name:'Inherited cage',baseSnapshotId:'view',baseLayerId:'slot'}];
 const project={...createEmptyProject(),drawing:blank,drawingSnapshots:{version:1 as const,activeId:'author',items:[{id:'author',name:'Author',drawing:blank}],images:[]},recordingSnapshots:workspace},shape:Cubic=[[-.5,.6],[-.3,.9],[.1,.7],[.3,.6]],previous=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
 try{
  useWorkspaceMode.setState({mode:'drawing'});useEditor.setState({project,past:[],future:[]});const api=createVectorEditingApi(),created=api.execute({commands:[{op:'createCurve',layerId:'author-slot',shape,width:.023,ref:'new'}]});expect(created.ok,created.ok?'':created.error.message).toBe(true);if(!created.ok)return;
  const after=useEditor.getState().project,newId=created.value.created.find(value=>value.ref==='new')!.id,before=currentDrawingPresentation(after);shapeOf(before,newId).forEach((p,i)=>close(p,shape[i]));expect(before.curves.find(curve=>curve.id===newId)!.width).toBe(.023);expect(after.drawing).toBe(blank);expect(useEditor.getState().past).toEqual([project]);
  const target=connect(before,{curveId:id('a'),end:1},{curveId:newId,end:0},'ARC'),plan=prepareDrawingSnapshotEdit(after,target);sameGeometry(currentDrawingPresentation(plan.project),target);expect(plan.project.drawing).toBe(blank);expect(plan.project.recordingSnapshots!.snapshots.find(snapshot=>snapshot.id==='view')).toEqual(workspace.snapshots.find(snapshot=>snapshot.id==='view'));useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project,after]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(after);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);
 }finally{useEditor.setState(previous,true);useWorkspaceMode.setState({mode});}
});

test('Recording real Snapshot topology uses the same inherited target and correction frames reject atomically',async()=>{
 const {prepareSnapshotDrawingTopologyEdit}=await import('../../domain/recordingSnapshot/drawingTopology'),f=fixture(),recording=f.workspace.recordings[0],local=f.workspace.snapshots.find(snapshot=>snapshot.id==='child')!;recording.snapshotIds=['child','side'];recording.activeSnapshotId='child';recording.angleGraph=createSnapshotAngleGraph([local,f.workspace.snapshots.find(snapshot=>snapshot.id==='side')!].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));
 const beforeDrawing=child(f.workspace),drawing=createCurve(beforeDrawing,'child-slot',line([-.5,.6],[.3,.7]),.01,'Local','local'),result=prepareSnapshotDrawingTopologyEdit(f.workspace,{recordingId:recording.id,snapshotId:'child',angle:{x:0,y:0},beforeDrawing,drawing});sameGeometry(child(result.workspace),drawing);
 const bytes=JSON.stringify(f.workspace);expect(()=>prepareSnapshotDrawingTopologyEdit(f.workspace,{recordingId:recording.id,snapshotId:'child',angle:{x:1,y:0},beforeDrawing,drawing})).toThrow(/exact requested angle/);expect(JSON.stringify(f.workspace)).toBe(bytes);
});

test('inherited parent cage: ARC and interval material replay through the retained program after true bind and JSON',async()=>{
 const {displayField,displayPath}=await import('../../domain/drawing/displayIntervals'),{evaluatedMaterialSource,evaluatedMaterialProgram}=await import('../../domain/drawing/evaluatedDeformation'),f=fixture();f.sourceDrawing.displayIntervals=[{id:'ink',scope:'CURVE',anchor:{id:'b',reverse:false},ranges:[{id:'range',start:.15,end:.85}]}];const beforeWorkspace=upsertDrawingSource(f.workspace,'source',f.sourceDrawing),before=child(beforeWorkspace),target=connect(before,{curveId:id('a'),end:1},{curveId:id('b'),end:0},'ARC'),workspace=edit(beforeWorkspace,target),actual=child(workspace),loaded=child(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace))));
 const field=displayField(actual,displayPath(actual,id('b'))),roundtrip=displayField(loaded,displayPath(loaded,id('b')));for(const t of [0,.15,.4,.85,1])close(roundtrip.at(t).p,field.at(t).p);expect(actual.curves.map(curve=>curve.width)).toEqual(target.curves.map(curve=>curve.width));expect(evaluatedMaterialProgram(actual,id('b'))!.some(step=>step.kind==='cage')).toBe(true);expect(evaluatedMaterialSource(actual).curves.find(curve=>curve.id===id('b'))!.nodes[0]).toBe(nodeAt(actual,{curveId:id('a'),end:1}).id);expect(workspace.library).toEqual(beforeWorkspace.library);
});
