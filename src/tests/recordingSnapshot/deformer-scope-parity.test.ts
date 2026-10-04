import {afterEach,expect,test,vi} from 'vitest';
import {createEmptyProject} from '../../app/emptyProject';
import {prepareSnapshotEdit,snapshotEditContext} from '../../app/snapshotEditTransaction';
import {prepareSnapshotDrawingToolEdit} from '../../app/snapshotDrawingToolEdit';
import {prepareRecordingTemporaryCageEdit} from '../../app/recordingTemporaryCageEdit';
import {applyDrawingControlEditPlan,prepareDrawingControlEditPlan,drawingControlEditStats} from '../../domain/drawing/controlEditPlan';
import {applyLayerDomainIntent,createLayerCageIntent} from '../../domain/drawing/layerDomainIntent';
import {createCurve,connect} from '../../domain/drawing/commands';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../../domain/drawing/model';
import {layerCageCurveIds} from '../../domain/recordingSnapshot/layerCageScope';
import {rectQuad} from '../../domain/drawing/deform';
import {neutralBend} from '../../domain/deformation/coons';
import * as cubicDeformation from '../../domain/deformation/cubicDeformation';
import {createSnapshotAngleGraph} from '../../domain/recordingSnapshot/angleGraph';
import {evaluateRecordingSnapshot} from '../../domain/recordingSnapshot/evaluation';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../../domain/recordingSnapshot/model';
import {parseRecordingSnapshots} from '../../domain/recordingSnapshot/persistence';
import {resolveDrawingCage,beginDrawingCageGesture,updateDrawingCageGesture} from '../../ui/drawing/cageEditorController';

afterEach(()=>vi.restoreAllMocks());
const angle=(x:number)=>({x,y:0});
const groupIds=['first','second','linked'];
const near=(actual:DrawingDocument,wanted:DrawingDocument)=>{
 for(const curve of wanted.curves)shapeOf(actual,curve.id).flat().forEach((value,i)=>expect(value).toBeCloseTo(shapeOf(wanted,curve.id).flat()[i],7));
};
function source():DrawingDocument {
 return {...emptyDrawing(),
  nodes:[{id:'a',position:[0,0]},{id:'b',position:[1,1]},{id:'c',position:[2,2]},{id:'d',position:[3,.5]},{id:'e',position:[4,1.5]},{id:'f',position:[-1,-1]},{id:'g',position:[0,0]}],
  curves:[
   {id:'first',name:'First',nodes:['a','b'],handles:[[.2,.3],[.7,.6]],width:.01,visible:true,locked:false},
   {id:'second',name:'Second',nodes:['b','c'],handles:[[1.3,1.4],[1.7,1.8]],width:.01,visible:true,locked:false},
   {id:'linked',name:'Linked',nodes:['f','g'],handles:[[-.8,-.7],[-.2,-.3]],width:.01,visible:true,locked:false},
   {id:'other',name:'Other',nodes:['d','e'],handles:[[3.3,.8],[3.7,1.2]],width:.01,visible:true,locked:false}],
  joins:[{id:'smooth',a:{curveId:'first',end:1},b:{curveId:'second',end:0},mode:'SMOOTH'}],
  endpointLinks:[{id:'link',a:{curveId:'first',end:0},b:{curveId:'linked',end:1},joinBrush:{kind:'SMOOTH'}}],
  groups:[{id:'group',name:'Linked strokes',visible:true,locked:false,curveIds:[...groupIds]}],
  layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:[...groupIds,'other']}]};
}
function fixture(x=60){
 const drawing=source(),workspace=emptyRecordingSnapshotWorkspace();
 workspace.library.nodes=Object.fromEntries(drawing.nodes.map(value=>[value.id,value]));
 workspace.library.curves=Object.fromEntries(drawing.curves.map(value=>[value.id,value]));
 const views=[emptyRecordingSnapshot('front'),emptyRecordingSnapshot('side','Side','view',angle(90))],restRect={min:[-2,-2] as Point2,max:[5,3] as Point2};
 for(const [index,view] of views.entries()){
  view.layers=drawing.layers.map(layer=>({...layer,kind:'original' as const}));
  view.relations={joins:{add:drawing.joins},endpointLinks:{add:drawing.endpointLinks},groups:{add:drawing.groups}};
  const bend=neutralBend();bend.handles[1][0][0]+=.03*(index+1);
  view.deformation.layerDomains=[{kind:'h-coons',id:`basis-cage-${index}`,layerIds:['layer'],restRect,quad:rectQuad(restRect).map(([px,py]):Point2=>index?[2*px+2,3*py+3]:[px+.1,py+.2]) as [Point2,Point2,Point2,Point2],bend}];
 }
 const recording=emptySnapshotRecording('recording');recording.mode='triangulated';recording.snapshotIds=views.map(view=>view.id);recording.activeSnapshotId='front';recording.angle=angle(x);recording.angleGraph=createSnapshotAngleGraph(views.map(view=>({snapshotId:view.id,angle:view.angle})));
 workspace.snapshots=views;workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {...createEmptyProject(),recordingSnapshots:workspace};
}
function cageIntent(drawing:DrawingDocument,scope:'group'|'layer',kind:'four-corner'|'curved',operationId='gesture'){
 const selection=scope==='layer'?{ids:drawing.curves.map(curve=>curve.id),layer:'layer'}:{ids:[...groupIds]},cage=resolveDrawingCage(drawing,selection,{domains:[]})!;
 const control=kind==='four-corner'?{corner:2}:{edge:1,handle:0 as const},start=cage.quad[2];
 return updateDrawingCageGesture(beginDrawingCageGesture(cage,selection,control,start,operationId),[start[0]+.08,start[1]+.06]).intent!;
}
function expectRelations(actual:DrawingDocument,before:DrawingDocument){
 expect(actual.joins).toEqual(before.joins);expect(actual.endpointLinks).toEqual(before.endpointLinks);expect(actual.groups).toEqual(before.groups);
 for(const relation of [...actual.joins,...actual.endpointLinks!]){
  const a=shapeOf(actual,relation.a.curveId),b=shapeOf(actual,relation.b.curveId),pa=a[relation.a.end?3:0],pb=b[relation.b.end?3:0],ha=a[relation.a.end?2:1],hb=b[relation.b.end?2:1];
  pa.forEach((n,i)=>expect(n).toBeCloseTo(pb[i],8));
  const va=[ha[0]-pa[0],ha[1]-pa[1]],vb=[hb[0]-pb[0],hb[1]-pb[1]];
  expect(va[0]*vb[1]-va[1]*vb[0]).toBeCloseTo(0,7);expect(va[0]*vb[0]+va[1]*vb[1]).toBeLessThan(0);
 }
}

for(const x of [0,60])for(const scope of ['group','layer'] as const)for(const kind of ['affine','four-corner','curved'] as const){
 test(`${x} degree ${scope} ${kind} shares Drawing controls and the current Recording transaction with LINK/SMOOTH`,()=>{
  const project=fixture(x),saved=JSON.stringify(project),before=evaluateRecordingSnapshot(project.recordingSnapshots,'recording',{useDraft:true,immutableInputs:true,diagnostics:'preview'}),context=snapshotEditContext(project,false),target={recordingId:'recording',snapshotId:before.snapshotId,angle:angle(x)},ids=scope==='layer'?before.drawing.curves.map(curve=>curve.id):groupIds;
  let wanted:DrawingDocument,plan:ReturnType<typeof prepareSnapshotDrawingToolEdit>;
  if(kind==='affine'){
   const controlPlan=prepareDrawingControlEditPlan(before.drawing,{kind:'curves',curveIds:ids,preserveRelations:true});
   wanted=applyDrawingControlEditPlan(controlPlan,{kind:'map',map:([px,py])=>[1.03*px+.02*py+.04,.01*px+1.02*py+.03]});
   plan=prepareSnapshotDrawingToolEdit(context,{...target,beforeDrawing:before.drawing,drawing:wanted,intent:{kind:'geometry',controlPlan}});
  }else{
   const intent=cageIntent(before.drawing,scope,kind),controlPlan=prepareDrawingControlEditPlan(before.drawing,{kind:'domain',layerIds:intent.scope.layerIds,curveIds:[...layerCageCurveIds(before.drawing,{...intent.domain,layerIds:intent.scope.layerIds})]});
   wanted=applyDrawingControlEditPlan(controlPlan,{kind:'cage',intent});near(wanted,applyLayerDomainIntent(before.drawing,intent).document);
   plan=x?prepareRecordingTemporaryCageEdit(context,{...target,beforeDrawing:before.drawing,intent}):prepareSnapshotEdit(context,{kind:'recording-layer-domain',...target,intent});
  }
  const workspace=plan.project.recordingSnapshots!,actual=evaluateRecordingSnapshot(workspace,'recording',{useDraft:true}).drawing;
  near(actual,wanted);expectRelations(actual,before.drawing);
  if(scope==='group')near({...actual,curves:actual.curves.filter(curve=>curve.id==='other')},{...before.drawing,curves:before.drawing.curves.filter(curve=>curve.id==='other')});
  expect(shapeOf(actual,'first')).not.toEqual(shapeOf(before.drawing,'first'));expect(workspace.library).toEqual(project.recordingSnapshots.library);expect(JSON.stringify(project)).toBe(saved);
  const loaded=parseRecordingSnapshots(JSON.parse(JSON.stringify(workspace)));near(evaluateRecordingSnapshot(loaded,'recording',{useDraft:true}).drawing,wanted);
  if(x){expect(workspace.snapshots).toEqual(project.recordingSnapshots.snapshots);expect(JSON.stringify(workspace.recordings[0].angleGraph)).not.toMatch(/restRect|"quad"|"layerDomains"/);}
 });
}

test.each(['four-corner','curved'] as const)('%s frozen gesture reuses one plan, changed group binding selects a new scope, and fitting counts actual members',kind=>{
 const project=fixture(),before=evaluateRecordingSnapshot(project.recordingSnapshots,'recording',{useDraft:true,immutableInputs:true}),intent=cageIntent(before.drawing,'group',kind),context=snapshotEditContext(project,false),edit={recordingId:'recording',snapshotId:before.snapshotId,angle:angle(60),beforeDrawing:before.drawing};
 const stats=drawingControlEditStats(),fit=vi.spyOn(cubicDeformation,'fitDeformedCubic');
 const makePlan=(value:typeof intent)=>prepareDrawingControlEditPlan(before.drawing,{kind:'domain',layerIds:value.scope.layerIds,curveIds:[...layerCageCurveIds(before.drawing,{...value.domain,layerIds:value.scope.layerIds})]});
 const first=makePlan(intent);expect(first.curveIds).toEqual(groupIds);expect(first.fallbackReason).toBe('live-domain-scope');
 for(let i=0;i<2;i++){fit.mockClear();applyDrawingControlEditPlan(first,{kind:'cage',intent});expect(fit).toHaveBeenCalledTimes(groupIds.length);expect(makePlan(intent)).toBe(first);}
 expect(drawingControlEditStats().dependencyIndexes-stats.dependencyIndexes).toBe(1);expect(drawingControlEditStats().plans-stats.plans).toBe(1);
 const other=createLayerCageIntent(['layer'],{...intent.domain,strokeScope:{kind:'continuous-strokes',curveIds:['other']}},{operationId:intent.operationId}),rebound=makePlan(other);expect(rebound).not.toBe(first);expect(rebound.curveIds).toEqual(['other']);
 fit.mockClear();applyDrawingControlEditPlan(rebound,{kind:'cage',intent:other});expect(fit).toHaveBeenCalledTimes(1);fit.mockRestore();
 // Same operation and frozen frame: only strokeScope changes. The Recording
 // gesture cache must not retain the previous group's writable controls.
 for(const value of [intent,other,cageIntent(before.drawing,'layer',kind,intent.operationId)]){
  const result=prepareRecordingTemporaryCageEdit(context,{...edit,intent:value});near(evaluateRecordingSnapshot(result.project.recordingSnapshots!,'recording',{useDraft:true}).drawing,applyLayerDomainIntent(before.drawing,value).document);
 }
});

test.each(['four-corner','curved'] as const)('%s fits a real source continuation but excludes a nearby disconnected addition from the group cage',kind=>{
 const before=source(),intent=cageIntent(before,'group',kind),end=shapeOf(before,'second')[3];
 let grown=createCurve(before,'layer',[end,[2.2,2.2],[2.4,2.3],[2.6,2.4]],.01,'Continuation','continued');grown=connect(grown,{curveId:'second',end:1},{curveId:'continued',end:0},'POSITION');
 grown=createCurve(grown,'layer',[[.2,.2],[.3,.3],[.4,.4],[.5,.5]],.01,'Nearby','nearby');
 const members=[...layerCageCurveIds(grown,{...intent.domain,layerIds:['layer']})],plan=prepareDrawingControlEditPlan(grown,{kind:'domain',layerIds:['layer'],curveIds:members}),fit=vi.spyOn(cubicDeformation,'fitDeformedCubic');
 expect(members).toContain('continued');expect(members).not.toContain('nearby');
 const result=applyDrawingControlEditPlan(plan,{kind:'cage',intent});expect(fit).toHaveBeenCalledTimes(4);expect(shapeOf(result,'continued')).not.toEqual(shapeOf(grown,'continued'));expect(shapeOf(result,'nearby')).toEqual(shapeOf(grown,'nearby'));expectRelations(result,grown);
 const whole=createLayerCageIntent(['layer'],{...intent.domain,strokeScope:undefined},{operationId:'whole-layer'}),wholePlan=prepareDrawingControlEditPlan(grown,{kind:'domain',layerIds:['layer']});fit.mockClear();const all=applyDrawingControlEditPlan(wholePlan,{kind:'cage',intent:whole});expect(fit).toHaveBeenCalledTimes(grown.curves.length);expect(shapeOf(all,'nearby')).not.toEqual(shapeOf(grown,'nearby'));
});
