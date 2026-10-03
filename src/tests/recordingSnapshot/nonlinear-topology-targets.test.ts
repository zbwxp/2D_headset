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
 recording.mode='triangulated';recording.snapshotIds=[view.id,side.id];recording.activeSnapshotId=view.id;recording.angleGraph=createSnapshotAngleGraph([view,side].map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.snapshots.push(view,side);workspace.recordings=[recording];workspace.activeRecordingId=recording.id;return {workspace,sourceDrawing,layer,domain:view.deformation.layerDomains[0]};
}
const edit=(workspace:ReturnType<typeof fixture>['workspace'],drawing:DrawingDocument)=>prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:'view',state:'saved',beforeDrawing:resolveSnapshot(workspace,'view').drawing,drawing}).workspace;

test('child-owned P retains an explicit output target, then A/save and parent live members keep distinct ownership',()=>{
 const f=fixture(),library=structuredClone(f.workspace.library),before=resolveSnapshot(f.workspace,'view').drawing,shape:Cubic=[[-.5,.6],[-.3,.9],[.1,.7],[.3,.6]],target=createCurve(before,'slot',shape,.01,'Local','local');let workspace=edit(f.workspace,target);
 sameGeometry(resolveSnapshot(workspace,'view').drawing,target);for(const kind of ['nodes','curves'] as const)for(const [key,value] of Object.entries(library[kind]))expect(workspace.library[kind][key]).toEqual(value);
 const saved=workspace.snapshots.find(value=>value.id==='view')!.deformation.layerDomains![0];expect(saved.postShape!.handles.local).toBeDefined();expect(Object.keys(saved.postShape!.handles)).toEqual(['local']);
 const wanted:Point2=[-.2,1];applySnapshotCommand(workspace,{op:'moveShapeHandle',layerId:'slot',curveId:'local',end:0,position:wanted});applySnapshotCommand(workspace,{op:'saveSelected',layerIds:['slot'],warpIds:[]});workspace=parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)));close(shapeOf(resolveSnapshot(workspace,'view').drawing,'local')[1],wanted);
 const fresh=line([-.6,-.4],[.3,-.2]);workspace=upsertDrawingSource(workspace,'source',createCurve(f.sourceDrawing,f.layer,fresh,.01,'Fresh','fresh'));const actual=resolveSnapshot(workspace,'view').drawing,domain=f.domain;if(domain.kind!=='h-coons')throw Error('fixture');const expected=fitDeformedCubic(fresh,drawingDeformProjection(domain.restRect,domain.quad,domain.bend)).shape;shapeOf(actual,id('fresh')).forEach((p,i)=>close(p,expected[i]));expect(workspace.snapshots.find(value=>value.id==='view')!.deformation.layerDomains![0].postShape!.handles[id('fresh')]).toBeUndefined();
});

test('local bind under a retained cage preserves its exact target and source input, including a prior node correction',()=>{
 const f=fixture(),before=resolveSnapshot(f.workspace,'view').drawing,library=structuredClone(f.workspace.library);applySnapshotCommand(f.workspace,{op:'moveShapeNode',layerId:'slot',nodeId:nodeAt(before,{curveId:id('b'),end:0}).id,position:[.3,.3]});applySnapshotCommand(f.workspace,{op:'saveSelected',layerIds:['slot'],warpIds:[]});
 const current=resolveSnapshot(f.workspace,'view').drawing,target=connect(current,{curveId:id('a'),end:1},{curveId:id('b'),end:0},'POSITION'),workspace=edit(f.workspace,target);sameGeometry(resolveSnapshot(workspace,'view').drawing,target);expect(workspace.library).toEqual(library);expect(workspace.snapshots.find(value=>value.id==='view')!.nodeAliases).toBeDefined();
 const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace))),drawing=resolveSnapshot(loaded,'view').drawing,node=nodeAt(drawing,{curveId:id('a'),end:1}).id;applySnapshotCommand(loaded,{op:'moveShapeNode',layerId:'slot',nodeId:node,position:[.1,.25]});applySnapshotCommand(loaded,{op:'saveSelected',layerIds:['slot'],warpIds:[]});const after=resolveSnapshot(loaded,'view').drawing;close(nodeAt(after,{curveId:id('a'),end:1}).position,[.1,.25]);expect(nodeAt(after,{curveId:id('a'),end:1}).id).toBe(nodeAt(after,{curveId:id('b'),end:0}).id);expect(loaded.library).toEqual(library);
});

test('a collapsed later affine does not require a P preimage and one transaction is undoable',()=>{
 const f=fixture(),view=f.workspace.snapshots.find(value=>value.id==='view')!;view.deformation.layerDomains!.push({id:'zero',layerIds:['slot'],matrix:[0,0,0,0,.1,.2]});const beforeDrawing=resolveSnapshot(f.workspace,'view').drawing,drawing=createCurve(beforeDrawing,'slot',line([-.6,.4],[.5,.6]),.01,'Local','local'),project={...createEmptyProject(),recordingSnapshots:f.workspace};
 const plan=prepareSnapshotEdit(snapshotEditContext(project,false),{kind:'snapshot-local-drawing',snapshotId:'view',state:'saved',beforeDrawing,drawing});sameGeometry(resolveSnapshot(plan.project.recordingSnapshots!,'view').drawing,drawing);const domains=plan.project.recordingSnapshots!.snapshots.find(value=>value.id==='view')!.deformation.layerDomains!;expect(domains[0].postShape).toBeUndefined();expect(domains[1].postShape!.handles.local).toBeDefined();
 const previous=useEditor.getState();try{useEditor.setState({project,past:[],future:[]});useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);useEditor.getState().redo();expect(useEditor.getState().project).toBe(plan.project);}finally{useEditor.setState(previous,true);}
});

test('Drawing P API and a continued local bind use the same nonlinear target transaction and one Undo',async()=>{
 const {createVectorEditingApi}=await import('../../app/vectorEditingApi'),{prepareDrawingSnapshotEdit}=await import('../../app/drawingSnapshotEdit'),{currentDrawingPresentation}=await import('../../ui/drawing/snapshotPresentation'),{drawingSnapshotForArtwork}=await import('../../domain/recordingSnapshot/sources'),{useWorkspaceMode}=await import('../../app/workspaceMode');
 const f=fixture(),blank=emptyDrawing(),workspace=upsertDrawingSource(f.workspace,'author',blank),author=drawingSnapshotForArtwork(workspace,'author')!;author.layers=structuredClone(workspace.snapshots.find(value=>value.id==='view')!.layers);author.deformation.layerDomains=structuredClone([f.domain]);
 const project={...createEmptyProject(),drawing:blank,drawingSnapshots:{version:1 as const,activeId:'author',items:[{id:'author',name:'Author',drawing:blank}],images:[]},recordingSnapshots:workspace},shape=line([-.6,.7],[.3,.8]),previous=useEditor.getState(),mode=useWorkspaceMode.getState().mode;
 try{
  useWorkspaceMode.setState({mode:'drawing'});useEditor.setState({project,past:[],future:[]});const api=createVectorEditingApi(),created=api.execute({commands:[{op:'createCurve',layerId:'slot',shape,width:.01,ref:'new'}]});expect(created.ok,created.ok?'':created.error.message).toBe(true);if(!created.ok)return;
  const after=useEditor.getState().project,newId=created.value.created.find(value=>value.ref==='new')!.id,before=currentDrawingPresentation(after);shapeOf(before,newId).forEach((p,i)=>close(p,shape[i]));expect(after.drawing).toBe(blank);expect(useEditor.getState().past).toEqual([project]);
  const target=connect(before,{curveId:id('a'),end:1},{curveId:newId,end:0},'POSITION'),plan=prepareDrawingSnapshotEdit(after,target);sameGeometry(currentDrawingPresentation(plan.project),target);expect(plan.project.drawing).toBe(blank);useEditor.getState().commitPreparedSnapshotEdit(plan);expect(useEditor.getState().past).toEqual([project,after]);useEditor.getState().undo();expect(useEditor.getState().project).toBe(after);useEditor.getState().undo();expect(useEditor.getState().project).toBe(project);
 }finally{useEditor.setState(previous,true);useWorkspaceMode.setState({mode});}
});

test.each(['POSITION','CUSP','SMOOTH'] as const)('the existing Pen controller continues %s segments through a retained domain',async join=>{
 const {penCandidate}=await import('../../ui/drawing/penController'),f=fixture(),options={layerId:'slot',unit:250,width:.01,join,taperScale:1};let workspace=f.workspace,current=resolveSnapshot(workspace,'view').drawing;
 const first=penCandidate(current,{position:[-.6,.5],out:[.1,.1]},[-.1,.7],[-.1,.7],options);workspace=edit(workspace,first.document);current=resolveSnapshot(workspace,'view').drawing;const post=structuredClone(workspace.snapshots.find(value=>value.id==='view')!.deformation.layerDomains![0].postShape!);
 const second=penCandidate(current,first.next,[.4,.5],[.5,.6],options);workspace=edit(workspace,second.document);sameGeometry(resolveSnapshot(workspace,'view').drawing,second.document);const saved=workspace.snapshots.find(value=>value.id==='view')!.deformation.layerDomains![0].postShape!;
 for(const [id,value] of Object.entries(post.handles))value.forEach((point,end)=>close(saved.handles[id][end],point));for(const curve of f.sourceDrawing.curves)expect(saved.handles[id(curve.id)]).toBeUndefined();
});

test('new identity collisions reject atomically before any nonlinear source input is installed',()=>{
 const f=fixture(),curve=f.workspace.library.curves[id('a')];f.workspace.library.curves.occupied={...structuredClone(curve),id:'occupied'};const snapshot=JSON.stringify(f.workspace),current=resolveSnapshot(f.workspace,'view').drawing,target=createCurve(current,'slot',line([-.6,.6],[.3,.5]),.01,'Collision','occupied');expect(()=>edit(f.workspace,target)).toThrow(/already belongs/);expect(JSON.stringify(f.workspace)).toBe(snapshot);
});


test('P can share a local fork under its own cage without storing a second fork coordinate',async()=>{
 const {unbind}=await import('../../domain/drawing/commands'),{createSnapshotNodeUnbindIntent}=await import('../../domain/recordingSnapshot/nodeForks'),f=fixture(),a={curveId:id('a'),end:1 as const},b={curveId:id('b'),end:0 as const};
 let before=resolveSnapshot(f.workspace,'view').drawing,workspace=edit(f.workspace,connect(before,a,b,'POSITION'));before=resolveSnapshot(workspace,'view').drawing;const detached=unbind(before,b),intent=createSnapshotNodeUnbindIntent('view',before,detached,b)!;workspace=prepareSnapshotLocalDrawingEdit(workspace,{snapshotId:'view',state:'saved',beforeDrawing:before,drawing:detached,nodeUnbind:intent}).workspace;
 before=resolveSnapshot(workspace,'view').drawing;const start=nodeAt(before,b).position,created=createCurve(before,'slot',line(start,[.5,.7]),.01,'P','p'),target=connect(created,b,{curveId:'p',end:0},'POSITION');workspace=edit(workspace,target);sameGeometry(resolveSnapshot(workspace,'view').drawing,target);expect(workspace.library.nodes[intent.nodeId]).toBeUndefined();expect(workspace.library.curves.p.nodes[0]).toBe(intent.nodeId);sameGeometry(resolveSnapshot(parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace))),'view').drawing,target);
});


test('editing one layer preserves other layers corrections inside the same ordered domain',()=>{
 const f=fixture();let source=addLayer(f.sourceDrawing,'Other');const other=source.layers.find(layer=>layer.id!==f.layer)!.id;source=createCurve(source,other,line([-.3,-.4],[.4,-.6]),.01,'Other','other');const workspace=upsertDrawingSource(f.workspace,'source',source),view=workspace.snapshots.find(snapshot=>snapshot.id==='view')!;view.layers.push({kind:'reference',id:'other-slot',name:'Other',baseSnapshotId:workspace.snapshots[0].id,baseLayerId:id(other)});view.deformation.layerDomains![0].layerIds.push('other-slot');view.deformation.layerDomains![0].postShape={nodes:{},handles:{[id('other')]:[[.03,.04],[0,0]]}};
 const before=resolveSnapshot(workspace,'view').drawing,original=structuredClone(view.deformation.layerDomains![0].postShape),target=createCurve(before,'slot',line([-.5,.6],[.3,.7]),.01,'New','new'),after=edit(workspace,target);sameGeometry(resolveSnapshot(after,'view').drawing,target);expect(after.snapshots.find(snapshot=>snapshot.id==='view')!.deformation.layerDomains![0].postShape!.handles[id('other')]).toEqual(original.handles[id('other')]);
});
