import {drawingLayerDomainPlanStats,prepareDrawingLayerDomainPlan} from '../domain/drawing/layerDomainEditPlan';
import {neutralBend} from '../domain/deformation/coons';
import * as cubicDeformation from '../domain/deformation/cubicDeformation';
import {createCurve,connect} from '../domain/drawing/commands';
import {expect,test,vi} from 'vitest';
import {createEmptyProject} from '../app/emptyProject';
import {prepareRecordingLayerDomainWorkspace} from '../app/recordingLayerDomainEdit';
import {applyLayerDomainIntent,createLayerCageIntent,createLayerAffineIntent,layerDomainIntentStats} from '../domain/drawing/layerDomainIntent';
import {applyDrawingControlEditPlan,prepareDrawingControlEditPlan,drawingControlEditStats,applyDrawingControlWrites} from '../domain/drawing/controlEditPlan';
import {emptyDrawing,shapeOf,type DrawingDocument,type Point2} from '../domain/drawing/model';
import {createSnapshotAngleGraph} from '../domain/recordingSnapshot/angleGraph';
import {emptyRecordingSnapshot,emptyRecordingSnapshotWorkspace,emptySnapshotRecording} from '../domain/recordingSnapshot/model';

function drawingFixture(nuisance=0):DrawingDocument {
 const drawing={...emptyDrawing(),layers:[{id:'layer',name:'Layer',visible:true,locked:false,items:[] as string[]},{id:'other-layer',name:'Other',visible:true,locked:false,items:[] as string[]}]};
 for(let i=0;i<=nuisance;i++){const id=i?`other-${i}`:'curve',x=i*2;drawing.nodes.push({id:`${id}:a`,position:[x,0]},{id:`${id}:b`,position:[x+1,1]});drawing.curves.push({id,name:id,nodes:[`${id}:a`,`${id}:b`],handles:[[x+.2,.3],[x+.7,.6]],width:.01,visible:true,locked:false});drawing.layers[i?1:0].items.push(id);}
 return drawing;
}
function projectFixture(nuisance=0){
 const drawing=drawingFixture(nuisance),workspace=emptyRecordingSnapshotWorkspace(),view=emptyRecordingSnapshot('front'),side=emptyRecordingSnapshot('side','Side','view',{x:90,y:0}),recording=emptySnapshotRecording('recording');
 workspace.library.nodes=Object.fromEntries(drawing.nodes.map(n=>[n.id,n]));workspace.library.curves=Object.fromEntries(drawing.curves.map(c=>[c.id,c]));
 view.layers=drawing.layers.map(layer=>({...layer,kind:'original' as const}));side.layers=structuredClone(view.layers);workspace.snapshots=[view,side];
 recording.mode='triangulated';recording.snapshotIds=['front','side'];recording.activeSnapshotId='front';recording.angleGraph=createSnapshotAngleGraph(workspace.snapshots.map(snapshot=>({snapshotId:snapshot.id,angle:snapshot.angle})));workspace.recordings=[recording];workspace.activeRecordingId=recording.id;
 return {...createEmptyProject(),recordingSnapshots:workspace};
}
const cage=()=>createLayerCageIntent(['layer'],{kind:'h-coons',restRect:{min:[-1,-1],max:[2,2]},quad:[[-1,-1],[2,-1],[1.9,2],[-1,1.9]]},{operationId:'gesture'});

for(const nuisance of [0,100,1000])test(`frozen domain addresses ignore ${nuisance} unrelated curves across targets`,()=>{
 const drawing=drawingFixture(nuisance),intent=cage(),prior=drawingLayerDomainPlanStats(),controls=drawingControlEditStats();
 const controlPlan=prepareDrawingControlEditPlan(drawing,{kind:'domain',layerIds:['layer']}),prepared=drawingLayerDomainPlanStats(),direct=layerDomainIntentStats();
 for(let i=0;i<3;i++)applyDrawingControlEditPlan(controlPlan,{kind:'cage',intent});
 expect(drawingLayerDomainPlanStats()).toEqual(prepared);expect(layerDomainIntentStats().scopeResolutions-direct.scopeResolutions).toBe(0);
 expect(prepared.plans-prior.plans).toBe(1);expect(prepared.membershipResolutions-prior.membershipResolutions).toBe(1);expect(prepared.incidentEndpoints-prior.incidentEndpoints).toBe(2);expect(drawingControlEditStats().dependencyIndexes-controls.dependencyIndexes).toBe(1);
 const project=projectFixture(nuisance),before=drawingLayerDomainPlanStats(),index=drawingControlEditStats();
 for(let i=0;i<3;i++)prepareRecordingLayerDomainWorkspace(project,{recordingId:'recording',snapshotId:'front',angle:{x:0,y:0},intent});
 const after=drawingLayerDomainPlanStats();expect(after.plans-before.plans).toBe(1);expect(after.membershipResolutions-before.membershipResolutions).toBe(1);expect(after.incidentEndpoints-before.incidentEndpoints).toBe(2);expect(drawingControlEditStats().dependencyIndexes-index.dependencyIndexes).toBe(1);
});

for(const scope of ['line','layer'] as const)for(const kind of ['affine','quad','coons'] as const)test(`${scope} ${kind} reuses addresses and fits all actual members canonically`,()=>{
 const drawing=drawingFixture(1000);drawing.layers[0].items.push('other-1');drawing.layers[1].items.shift();drawing.curves[1].visible=false;
 const bend=neutralBend();bend.handles[1][0][0]+=0.05;
 const intent=createLayerCageIntent(['layer'],{...cage().domain,...scope==='line'?{strokeScope:{kind:'continuous-strokes' as const,curveIds:['curve']}}:{},...kind==='affine'?{quad:[[-.9,-.8],[2.1,-.8],[2.1,2.2],[-.9,2.2]] as [Point2,Point2,Point2,Point2]}:{},...kind==='coons'?{bend}:{}});
 const plan=prepareDrawingControlEditPlan(drawing,{kind:'domain',layerIds:['layer'],strokeScope:intent.domain.strokeScope}),stats=drawingLayerDomainPlanStats(),resolutions=layerDomainIntentStats(),fit=vi.spyOn(cubicDeformation,'fitDeformedCubic');
 let actual:DrawingDocument;
 try{actual=applyDrawingControlEditPlan(plan,{kind:'cage',intent});expect(fit).toHaveBeenCalledTimes(scope==='line'?1:2);}finally{fit.mockRestore();}
 expect(drawingLayerDomainPlanStats()).toEqual(stats);expect(layerDomainIntentStats()).toEqual(resolutions);
 expect(actual!).toEqual(applyLayerDomainIntent(drawing,intent).document);
 if(scope==='line')expect(shapeOf(actual!,'other-1')).toEqual(shapeOf(drawing,'other-1'));else expect(shapeOf(actual!,'other-1')).not.toEqual(shapeOf(drawing,'other-1'));
});

test('layer affine parameters reuse membership while keeping canonical full layer output',()=>{
 const drawing=drawingFixture(3),plan=prepareDrawingLayerDomainPlan(drawing,{layerIds:['layer']}),stats=drawingLayerDomainPlanStats();
 for(const matrix of [[1,.1,.2,1,.3,.4],[.9,.2,.1,1.1,-.1,.3]] as const){const intent=createLayerAffineIntent(['layer'],[...matrix]),actual=applyLayerDomainIntent(drawing,intent,{scopePlan:plan});expect(actual.document).toEqual(applyLayerDomainIntent(drawing,intent).document);}
 expect(drawingLayerDomainPlanStats()).toEqual(stats);
});

test('new frame, changed membership and changed stroke provenance cannot reuse old scope proof',()=>{
 const drawing=drawingFixture(2),intent=createLayerCageIntent(['layer'],{...cage().domain,strokeScope:{kind:'continuous-strokes',curveIds:['curve']}}),scope={layerIds:['layer'],strokeScope:intent.domain.strokeScope},old=prepareDrawingLayerDomainPlan(drawing,scope);
 let grown=createCurve(drawing,'layer',[[1,1],[1.2,1.2],[1.4,1.4],[1.6,1.6]],.01,'Continuation','continued');grown=connect(grown,{curveId:'curve',end:1},{curveId:'continued',end:0},'POSITION');
 grown=createCurve(grown,'layer',[[.2,.2],[.3,.3],[.4,.4],[.5,.5]],.01,'Nearby','nearby');
 const next=prepareDrawingLayerDomainPlan(grown,scope);expect(next).not.toBe(old);expect([...next.curveIds].sort()).toEqual(['continued','curve']);
 expect(applyLayerDomainIntent(grown,intent,{scopePlan:old}).document).toEqual(applyLayerDomainIntent(grown,intent).document);
 const whole={...intent,domain:{...intent.domain,strokeScope:undefined}},all=prepareDrawingLayerDomainPlan(grown,{layerIds:['layer']});expect(all.curveIds).toEqual(['curve','continued','nearby']);expect(applyLayerDomainIntent(grown,whole,{scopePlan:next}).ids).toEqual(all.curveIds);
 const rebound={...intent,domain:{...intent.domain,strokeScope:{kind:'continuous-strokes' as const,curveIds:['nearby']}}};expect(applyLayerDomainIntent(grown,rebound,{scopePlan:next}).ids).toEqual(['nearby']);
 const moved={...grown,layers:grown.layers.map(layer=>({...layer,items:layer.id==='layer'?layer.items.filter(id=>id!=='nearby'):[...layer.items,'nearby']}))};expect(prepareDrawingLayerDomainPlan(moved,{layerIds:['layer']}).curveIds).toEqual(['curve','continued']);
 const fallback=layerDomainIntentStats();expect(applyLayerDomainIntent(drawing,intent,{scopePlan:{...old}}).ids).toEqual(['curve']);expect(layerDomainIntentStats().scopeResolutions-fallback.scopeResolutions).toBe(1);
});

test('changed lock and shared-node or endpoint-link ownership retain the persistent guards',()=>{
 const project=projectFixture(1),intent=cage(),edit={recordingId:'recording',snapshotId:'front',angle:{x:0,y:0},intent};prepareRecordingLayerDomainWorkspace(project,edit);
 for(const kind of ['curve-lock','shared-node','endpoint-link'] as const){
  const changed=structuredClone(project),workspace=changed.recordingSnapshots;
  if(kind==='curve-lock')workspace.snapshots[0].objectLocks={curve:true};
  if(kind==='shared-node')workspace.library.curves['other-1'].nodes[0]='curve:b';
  if(kind==='endpoint-link')workspace.snapshots[0].relations.endpointLinks={add:[{id:'link',a:{curveId:'curve',end:1},b:{curveId:'other-1',end:0}}]};
  expect(()=>prepareRecordingLayerDomainWorkspace(changed,edit),kind).toThrow(kind.endsWith('lock')?/Unlock/:/linked layer/);
 }
 const drawing=drawingFixture(),plan=prepareDrawingLayerDomainPlan(drawing,{layerIds:['layer']}),locked={...drawing,layers:drawing.layers.map(layer=>({...layer,locked:true}))};expect(()=>applyLayerDomainIntent(locked,intent,{scopePlan:plan})).toThrow(/锁定/);
});

test.each([0,100,1000])('handle-only targets preserve the node array with %i unrelated curves',nuisance=>{
 const drawing=drawingFixture(nuisance),plan=prepareDrawingControlEditPlan(drawing,{kind:'handle',endpoint:{curveId:'curve',end:0}}),before=drawingControlEditStats(),target=applyDrawingControlEditPlan(plan,{kind:'point',position:[.2,.4]});
 expect(target.nodes).toBe(drawing.nodes);expect(target.curves).not.toBe(drawing.curves);expect(target.curves[0].handles[0]).toEqual([.2,.4]);expect(drawing.curves[0].handles[0]).toEqual([.2,.3]);
 expect(drawingControlEditStats().nodeArrayCopiedSlots-before.nodeArrayCopiedSlots).toBe(0);expect(drawingControlEditStats().curveArrayCopiedSlots-before.curveArrayCopiedSlots).toBe(nuisance+1);
 const nodePlan=prepareDrawingControlEditPlan(drawing,{kind:'node',nodeId:'curve:a'}),nodeTarget=applyDrawingControlWrites(nodePlan,{nodePositions:new Map([['curve:a',[.1,.1]]])});expect(nodeTarget.curves).toBe(drawing.curves);expect(nodeTarget.nodes).not.toBe(drawing.nodes);
});
