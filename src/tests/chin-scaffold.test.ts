import {test,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,mirrorPoint,toHead,rotateFrame} from '../domain/head/frame';
import {ensureScaffold} from '../domain/head/scaffold';
import {ensureChin,slots,seamId,chinRoles,pointId,chinDirections,defaults,parseChin,parameterRanges} from '../domain/chin/model';
import {chinGeometry} from '../domain/chin/geometry';
import {bindChinCurve,createChinControl,addChinPoint} from '../domain/chin/management';
import {evaluationContext,pointPosition} from '../domain/geometry/evaluation';
import {dependencyGraph,deleteClosure,dirtyDescendants} from '../domain/geometry/dependencies';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {isChin,isFree3DShape} from '../domain/curves/model';
import {addOnCurvePoint,validatePlacements} from '../domain/landmarks/placement';
import {curveMemberships} from '../domain/head/membership';
import {createCurve} from '../domain/curves/management';
import {addPatch} from '../domain/patches/model';
import {tessellate} from '../domain/patches/geometry';
import {contourSource} from '../domain/contour/source';
import {CHIN} from '../domain/chin/model';
import {add,cross,sub} from '../domain/geometry/core';
// Legacy V0.9.5 kernel remains readable only to migrate authored dependencies.
const base=()=>ensureChin({...ensureScaffold(migrateHeadFrame(createLandmarkProject())),chinScaffold:{version:2,visible:true,parameters:{...defaults},bindings:[]}});
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));

test('small dimensions share horizontal R, and pitch is rigid about the local center on an anisotropic rotated frame',()=>{
 const p=base();p.headFrame={...p.headFrame!,radiusX:1.7,radiusY:2.3,radiusZ:.9,orientation:[0,Math.sin(.2),0,Math.cos(.2)]};
 const a=p.chinScaffold!.parameters,center=toHead(p,[0,a.y,a.z]),at=chinGeometry(p),front=pointPosition(p,pointId('CHIN_C'));
 expect(distance(center,pointPosition(p,pointId('CHIN_M')))).toBeCloseTo(a.height*p.headFrame.radiusX,12);
 expect(distance(center,front)).toBeCloseTo(.5*a.depth*(1+a.frontBulge)/(1+.5*(a.frontBulge+a.rearBulge))*p.headFrame.radiusX,12);
 const q={...p,chinScaffold:{...p.chinScaffold!,parameters:{...a,pitch:35}}},rotated=chinGeometry(q),angle=35*Math.PI/180;
 for(const i of [0,72,230,1000,2304]){
  const local=rotateFrame(sub(at.mesh.vertices[i],center),p.headFrame,true),expected=add(center,rotateFrame([local[0],local[1]*Math.cos(angle)+local[2]*Math.sin(angle),-local[1]*Math.sin(angle)+local[2]*Math.cos(angle)],p.headFrame));
  expect(distance(rotated.mesh.vertices[i],expected)).toBeLessThan(1e-12);
  expect(distance(center,rotated.mesh.vertices[i])).toBeCloseTo(distance(center,at.mesh.vertices[i]),12);
 }
 expect(rotated.key).not.toBe(at.key);
 expect(dirtyDescendants(p,q).curves.has(seamId('CENTER'))).toBe(true);
 expect(()=>validatePlacements(q)).not.toThrow();
 expect(parseLandmarks(JSON.stringify(q)).chinScaffold?.version).toBe(3);
});

test.each([.01,.1])('size %sR remains finite, symmetric and usable at both pitch limits',size=>{
 for(const pitch of [-90,0,90]){
  const p=base();p.chinScaffold!.parameters={...defaults,width:size,depth:size,height:size,pitch};
  const g=chinGeometry(p);expect(g.mesh.vertices.flat().every(Number.isFinite)).toBe(true);expect(g.diagnostic).toBeUndefined();
  if(pitch===0){const local=g.mesh.vertices.map(v=>rotateFrame(sub(v,p.headFrame!.center),p.headFrame!,true));for(let axis=0;axis<3;axis++)expect(Math.max(...local.map(v=>v[axis]))-Math.min(...local.map(v=>v[axis]))).toBeCloseTo(size*p.headFrame!.radiusX,10);}
  expect(()=>validatePlacements(p)).not.toThrow();
  for(const f of g.mesh.triangles){const [a,b,c]=f.map(i=>g.mesh.vertices[i]);expect(Math.hypot(...cross(sub(b,a),sub(c,a)))).toBeGreaterThan(1e-12);}
  for(const slot of slots){const controlled=createChinControl(p,slot);expect(chinGeometry(controlled.project).diagnostic).toBeUndefined();}
 }
 for(const key of ['width','depth','height'] as const)expect(parameterRanges[key]).toEqual([.01,.1]);
});

test('legacy oversized scaffold loads into the new size range without losing IDs or bindings',()=>{
 const p=base(),binding={slot:'FRONT' as const,curveId:'preserved',reversed:false,reflect:false};
 const {pitch:_,...oldParameters}=defaults;
 const legacy={version:1,visible:true,parameters:{...oldParameters,width:.48,depth:.42,height:.23},bindings:[binding]};
 const result=parseChin(legacy,p.headFrame)!;
 expect(result.version).toBe(2);expect(result.parameters.pitch).toBe(0);expect(result.bindings).toEqual([binding]);
 expect(result.parameters.width).toBe(.1);
 expect(result.parameters.depth/result.parameters.width).toBeCloseTo(.42*p.headFrame!.radiusZ/.48/p.headFrame!.radiusX,12);
 expect(parseChin(result,p.headFrame)).toEqual(result);
 expect(()=>parseChin({...result,parameters:{...result.parameters,width:.101}})).toThrow('范围');
 expect(()=>parseChin({...result,parameters:{...result.parameters,pitch:91}})).toThrow('范围');
 const loaded=parseLandmarks(JSON.stringify({...p,chinScaffold:{...legacy,bindings:[]}}));
 expect(loaded.landmarks.filter(l=>l.placement.kind==='CHIN_SURFACE').map(l=>l.id)).toEqual([pointId('CHIN_M')]);
 expect(loaded.chinScaffold!.parameters.width).toBe(.1);
});

test('one symmetric shell, shared pole/wrap and derived scaffold points and seams',()=>{
 const p=base(),g=chinGeometry(p);expect(g.diagnostic).toBeUndefined();expect(p.curves.filter(isChin)).toHaveLength(11);
 const edges=new Map<string,number>();for(const f of g.mesh.triangles)for(let i=0;i<3;i++){const key=[f[i],f[(i+1)%3]].sort((a,b)=>a-b).join(':');edges.set(key,(edges.get(key)??0)+1);}
 expect([...edges.values()].filter(n=>n===1)).toHaveLength(96);expect(Math.max(...edges.values())).toBe(2);
 const f=g.mesh.triangles[0],v=g.mesh.vertices;expect(cross(sub(v[f[1]],v[f[0]]),sub(v[f[2]],v[f[0]]))[1]).toBeLessThan(0);
 for(const role of chinRoles)expect(pointPosition(p,pointId(role))).toEqual(g.evaluate(chinDirections[role]));
 for(const slot of slots){const ctx=evaluationContext(p),a=ctx.curve(seamId(slot));for(let i=0;i<=20;i++)if(slot!=='CENTER')expect(distance(ctx.curve(seamId(slot,true)).evaluate(i/20),mirrorPoint(p,a.evaluate(i/20)))).toBeLessThan(1e-10);}
 expect(()=>dependencyGraph(p)).not.toThrow();expect(parseLandmarks(JSON.stringify(p)).chinScaffold?.version).toBe(3);expect(parseLandmarks(JSON.stringify(p)).version).toBe('landmarks-0.9.7');
});

test.each(slots)('independent editable %s control binds and releases without source feedback',slot=>{
 const p=base(),r=createChinControl(p,slot),q=r.project;
 expect(chinGeometry(q).diagnostic).toBeUndefined();expect(chinGeometry(q).maxError).toBeLessThan(1e-5);
 expect(()=>dependencyGraph(q)).not.toThrow();expect(bindChinCurve(q,slot).chinScaffold?.bindings).toHaveLength(0);
 expect(chinGeometry(bindChinCurve(q,slot)).mesh).toEqual(chinGeometry(p).mesh);
 expect(chinGeometry(deleteClosure(q,[`curve:${r.selectedId}`])).mesh).toEqual(chinGeometry(p).mesh);
 const loaded=parseLandmarks(JSON.stringify(q));expect(loaded.chinScaffold?.version).toBe(3);expect(loaded.curves.some(c=>c.id===r.selectedId)).toBe(true);expect(chinGeometry(loaded).mesh.triangles).toHaveLength(0);
});

test('moderate control edit updates shell and descendants; deleting source releases only that slot',()=>{
 let p=base();const a=createChinControl(p,'FRONT');p=a.project;const b=createChinControl(p,'REAR');p=b.project;
 const q={...p,curves:p.curves.map(c=>c.id===a.selectedId&&c.role==='canonical'&&!isChin(c)&&c.shape&&isFree3DShape(c.shape)?{...c,shape:{...c.shape,startHandleOffset:[c.shape.startHandleOffset[0],c.shape.startHandleOffset[1]-.0015,c.shape.startHandleOffset[2]] as [number,number,number]}}:c)};
 expect(chinGeometry(q).diagnostic).toBeUndefined();expect(chinGeometry(q).mesh).not.toEqual(chinGeometry(p).mesh);expect(dirtyDescendants(p,q).curves.has(seamId('FRONT'))).toBe(true);
 const deleted=deleteClosure(q,[`curve:${a.selectedId}`]);expect(deleted.chinScaffold?.bindings.map(b=>b.slot)).toEqual(['REAR']);expect(chinGeometry(deleted).diagnostic).toBeUndefined();
 expect(()=>bindChinCurve(p,'FRONT',seamId('FRONT'))).toThrow();
});

test('surface/curve points are ordinary endpoints and follow the shell; actual seam intersections can form Patch boundaries',()=>{
 let p=base();const a=addOnCurvePoint(p,seamId('FRONT'));p=a.project;
 const b=addChinPoint(p,[.6,-.8,0]);p=b.project;
 p=createCurve(p,a.selectedId,b.selectedId,p.views[0],"连接").project;expect(()=>validatePlacements(p)).not.toThrow();
 const before=pointPosition(p,b.selectedId);p={...p,chinScaffold:{...p.chinScaffold!,parameters:{...p.chinScaffold!.parameters,height:.06}}};expect(pointPosition(p,b.selectedId)).not.toEqual(before);
 expect(distance(pointPosition(parseLandmarks(JSON.stringify(p)),b.selectedId),pointPosition(p,b.selectedId))).toBeLessThan(1e-10);
 expect(curveMemberships(p,pointId('CHIN_F')).find(m=>m.curveId===seamId('CENTER'))?.t).toBeCloseTo(1/3,10);
 p=addPatch(p,[{curveId:seamId('CENTER'),startLandmarkId:pointId('CHIN_C'),endLandmarkId:pointId('CHIN_F')},seamId('FRONT'),seamId('FRONT_RIM')]);
 for(const patch of p.patches??[])expect(tessellate(p,patch,8).vertices.flat().every(Number.isFinite)).toBe(true);
 const derived=createCurve(p,pointId('CHIN_C'),pointId('CHIN_N'),p.views[0],"依赖线");expect(()=>bindChinCurve(derived.project,'CENTER',derived.selectedId)).toThrow(/依赖下巴壳/);
});

test('Contour includes only true rim boundaries, and shared rim interval is suppressed',()=>{
 let p=base();let result=contourSource(p);const boundaries=result.displayBoundaries.map(b=>b.id);
 expect(boundaries.filter(id=>p.curves.some(c=>c.id===id&&isChin(c)))).toHaveLength(6);
 expect(boundaries).not.toContain(seamId('CENTER'));expect(boundaries).not.toContain(seamId('FRONT'));
 const a=createCurve(p,pointId('CHIN_RF'),pointId('CHIN_C'),p.views[0],"接面");p=addPatch(a.project,[a.selectedId,seamId('FRONT_RIM')]);result=contourSource(p);
 expect(result.displayBoundaries.map(b=>b.id)).not.toContain(seamId('FRONT_RIM'));expect(result.invalid).toEqual([]);
 expect(result.mesh.triangles.some(t=>t.patchId===CHIN)).toBe(true);
});

test('multiple meeting controls remain compatible, mirror normals stay smooth, and severe constraints are diagnosed',()=>{
 let p=base();for(const slot of ['FRONT_RIM','SIDE','REAR_RIM','CENTER','FRONT','REAR'] as const)p=createChinControl(p,slot).project;
 expect(chinGeometry(p).diagnostic).toBeUndefined();
 const g=chinGeometry(p),q=(x:number):[number,number,number]=>[x,-Math.sqrt(1-x*x-.09),.3],h=1e-4,center=g.evaluate(q(0)),a=g.evaluate(q(h)),b=g.evaluate(q(-h));
 expect(distance(a.map((v,i)=>(v-center[i])/h),b.map((v,i)=>(center[i]-v)/h))).toBeLessThan(.02);
 const id=p.chinScaffold!.bindings.find(b=>b.slot==='FRONT')!.curveId;
 const bad={...p,curves:p.curves.map(c=>c.id===id&&c.role==='canonical'&&!isChin(c)&&c.shape&&isFree3DShape(c.shape)?{...c,shape:{...c.shape,startHandleOffset:[-5,0,0] as [number,number,number]}}:c)};
 expect(chinGeometry(bad).diagnostic).toBeTruthy();expect(chinGeometry(bad).mesh.vertices.flat().every(Number.isFinite)).toBe(true);
});
