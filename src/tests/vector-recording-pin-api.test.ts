import {expect,test} from 'vitest';
import {createVectorEditingApi,type VectorResult} from '../app/vectorEditingApi';
import {createEmptyProject} from '../app/emptyProject';
import {addLayer,createCurve} from '../domain/drawing/commands';
import {emptyDrawing,type Point2} from '../domain/drawing/model';
import {createWarpMapper} from '../domain/vectorWarp/evaluation';
import {currentPose,evaluatePose} from '../domain/vectorRecording/model';
import type {LandmarkProject} from '../domain/landmarks/model';
const value=<T>(r:VectorResult<T>)=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
function harness(){let d=addLayer(emptyDrawing(),'Face');d=createCurve(d,d.layers[0].id,[[0,0],[.3,.2],[.7,.2],[1,0]],.01,'Source');let project:LandmarkProject={...createEmptyProject(),drawing:d},past:LandmarkProject[]=[],future:LandmarkProject[]=[],mode:'drawing'|'recording'='recording';const api=createVectorEditingApi({getState:()=>({project,past,future}),getMode:()=>mode,commitDrawing(){throw Error('source write forbidden');},commitRecording(r){past.push(project);future=[];project={...project,vectorRecording:r};},undo(){const p=past.pop();if(p){future.unshift(project);project=p;}},redo(){const p=future.shift();if(p){past.push(project);project=p;}}});value(api.recording({commands:[{op:'ensureRig'},{op:'createDeformer',layerIds:[d.layers[0].id],rows:2,columns:2,name:'Child',ref:'child'}]}));return {api,p:()=>project,past:()=>past,mode:(m:typeof mode)=>{mode=m;}};}
const rig=(h:ReturnType<typeof harness>)=>h.p().vectorRecording!.rigs[0];

 test('one-shot pin changes only draft controls and returns actual residual/support diagnostics with one Undo',()=>{
  const h=harness(),before=h.p(),id=rig(h).deformers[0].id,base=rig(h).deformers[0].grid,sourcePoint:Point2=[.37,.08],targetPoint:Point2=[.4,.09],revision=h.api.inspect().revision,commands=[{op:'pinGridPoint' as const,deformerId:id,sourcePoint,targetPoint}];
  const dry=value(h.api.recording({commands,dryRun:true,expectedRevision:revision}));expect(dry.pinResults[0]).toMatchObject({withinTolerance:true,targetParentId:null,sourcePoint,targetPoint});expect(h.p()).toBe(before);expect(h.api.inspect().revision).toBe(revision);
  const result=value(h.api.recording({commands,expectedRevision:revision})),report=result.pinResults[0],grid=currentPose(rig(h),h.p().drawing).grids[id];expect(report.residualNorm).toBeLessThanOrEqual(report.tolerance);expect(report.changes.length).toBeGreaterThan(0);expect(report.changes.length).toBeLessThanOrEqual(4);expect(report.maxControlDelta).toBeGreaterThan(0);expect(report).not.toHaveProperty('grid');expect(createWarpMapper([grid]).mapPoint(sourcePoint)[0]).toBeCloseTo(targetPoint[0],12);expect(createWarpMapper([grid]).mapPoint(sourcePoint)[1]).toBeCloseTo(targetPoint[1],12);
  for(const c of report.changes)for(const key of ['handleU','handleV'] as const)for(const axis of [0,1] as const)expect(grid.nodes[c.nodeIndex][key][axis]-grid.nodes[c.nodeIndex].position[axis]).toBeCloseTo(base.nodes[c.nodeIndex][key][axis]-base.nodes[c.nodeIndex].position[axis],12);
  expect(grid.bounds).toEqual(base.bounds);expect(rig(h).deformers[0].grid).toEqual(base);expect(h.p().drawing).toBe(before.drawing);expect(h.past()).toHaveLength(2);value(h.api.undo());expect(h.p()).toBe(before);value(h.api.redo());expect(rig(h).draft).toBeDefined();
 });

 test('the API derives immediate-parent frame/bounds and rejects extrapolated targets without partial state',()=>{
  const h=harness(),child=rig(h).deformers[0].id,setup=value(h.api.recording({commands:[{op:'createDeformer',layerIds:[],name:'Parent',ref:'parent'},{op:'setDeformer',deformerId:child,parentId:'$parent'}]})),parent=setup.created.find(c=>c.ref==='parent')!.id;
  const good=value(h.api.recording({commands:[{op:'pinGridPoint',deformerId:child,sourcePoint:[.37,.08],targetPoint:[.4,.09]}]}));expect(good.pinResults[0].targetParentId).toBe(parent);const before=h.p();
  expect(h.api.recording({commands:[{op:'setDeformer',deformerId:child,name:'Must not persist'},{op:'pinGridPoint',deformerId:child,sourcePoint:[.37,.08],targetPoint:[100,100]}]})).toMatchObject({ok:false,error:{code:'WARP_PIN_TARGET_OUTSIDE_PARENT',commandIndex:1}});expect(h.p()).toBe(before);
  expect(h.api.recording({commands:[{op:'pinGridPoint',deformerId:child,sourcePoint:[100,100],targetPoint:[.4,.09]}]})).toMatchObject({ok:false,error:{code:'WARP_PIN_SOURCE_OUTSIDE_GRID'}});expect(h.p()).toBe(before);
 });

 test('corresponding one-shot pins at authored keys interpolate through the production field',()=>{
  const h=harness(),id=rig(h).deformers[0].id,sourcePoint:Point2=[.37,.08];value(h.api.recording({commands:[{op:'setAngle',angle:{x:30,y:0}},{op:'pinGridPoint',deformerId:id,sourcePoint,targetPoint:[.4,.1]},{op:'saveKeyform'},{op:'setAngle',angle:{x:60,y:0}},{op:'pinGridPoint',deformerId:id,sourcePoint,targetPoint:[.5,.12]},{op:'saveKeyform'}]}));const p=evaluatePose(rig(h),{x:45,y:0},h.p().drawing),point=createWarpMapper([p.grids[id]]).mapPoint(sourcePoint);expect(point[0]).toBeCloseTo(.45,12);expect(point[1]).toBeCloseTo(.11,12);expect(JSON.stringify(h.p().vectorRecording)).not.toContain('pinGridPoint');expect(JSON.stringify(h.p().vectorRecording)).not.toContain('sourcePoint');
 });

 test('pin command remains Recording-only, validates finite coordinates and previews without storing a draft',()=>{
  const h=harness(),id=rig(h).deformers[0].id,before=h.p(),command={op:'pinGridPoint' as const,deformerId:id,sourcePoint:[.37,.08] as Point2,targetPoint:[.4,.09] as Point2};h.mode('drawing');expect(h.api.recording({commands:[command]})).toMatchObject({ok:false,error:{code:'MODE_RESTRICTED'}});const preview=value(h.api.previewRecording({commands:[command],width:300,height:300}));expect(preview.svg).toContain('<svg');expect(preview.usedDraft).toBe(true);expect(h.p()).toBe(before);h.mode('recording');expect(h.api.recording({commands:[{...command,targetPoint:[Infinity,0]}]})).toMatchObject({ok:false,error:{code:'INVALID_REQUEST'}});expect(h.p()).toBe(before);
 });
