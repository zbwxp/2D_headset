import {test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,mirrorPoint} from '../domain/head/frame';
import {createEyeScaffold,rebuildEyeScaffold} from '../domain/eyes/scaffold';
import {migrateEyeCoord,moveEyeLocal} from '../domain/eyes/coord';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {pointPosition,evaluationContext} from '../domain/geometry/evaluation';
import {dependencyGraph,dirtyDescendants} from '../domain/geometry/dependencies';
import {gazePose} from '../domain/eyes/tracking';
const setup=()=>rebuildEyeScaffold(migrateEyeCoord(createEyeScaffold(migrateHeadFrame(createLandmarkProject()))));
test('EyeCoord migration removes cylinder and preserves ball/iris, roundtrips',()=>{
 const legacy=createEyeScaffold(migrateHeadFrame(createLandmarkProject())),center=pointPosition(legacy,legacy.eyeScaffold!.right.pointIds[20]);
 const p=rebuildEyeScaffold(migrateEyeCoord(legacy)),e=p.eyeScaffold!;
 expect(pointPosition(p,e.right.pointIds[20])).toEqual(center);
 expect(e.right.pointIds.slice(0,8).some(id=>p.landmarks.some(l=>l.id===id))).toBe(false);
 expect(e.right.curveIds.slice(0,12).some(id=>p.curves.some(c=>c.id===id))).toBe(false);
 const round=parseLandmarks(JSON.stringify(p));expect(round.eyeScaffold).toEqual(e);expect(()=>dependencyGraph(round)).not.toThrow();
 for(const side of ['left','right'] as const)for(const id of e.coord![side].curves){expect(evaluationContext(round).curve(id).controls).toHaveLength(4);}
});
test('local edits mirror; width/frame/pose propagate; gaze does not change lids',()=>{
 const p=setup(),e=p.eyeScaffold!,q=e.coord!,id=q.right.points[2],v=pointPosition(p,id),changed=moveEyeLocal(p,id,[v[0]+.02,v[1]+.03,v[2]-.01]);
 const a=pointPosition(changed,id),b=pointPosition(changed,q.left.points[2]);expect(b).toEqual(mirrorPoint(changed,a));
 expect(dirtyDescendants(p,changed).curves.has(q.right.curves[0])).toBe(true);
 const posed=rebuildEyeScaffold({...changed,eyeScaffold:{...e,coord:{...q,orientation:[20,15,10],width:.65}}});
 for(let i=0;i<6;i++){const a=pointPosition(posed,q.right.points[i]),b=pointPosition(posed,q.left.points[i]);expect(Math.hypot(...mirrorPoint(posed,a).map((x,j)=>x-b[j]))).toBeLessThan(1e-10);}
 expect(()=>parseLandmarks(JSON.stringify(posed))).not.toThrow();
 const before=pointPosition(posed,id);gazePose(posed,'right',[.8,.3,1]);expect(pointPosition(posed,id)).toEqual(before);
});
test('actual eye archive drops cylinder patch and dependent anchors, preserves iris',()=>{
 const raw=JSON.parse(readFileSync('/Users/bowen/Desktop/眼睛研究1.json','utf8')),p=parseLandmarks(JSON.stringify(raw));
 expect(p.eyeScaffold?.coord).toBeDefined();expect(p.gazeEyeball).toBeDefined();
 expect(p.landmarks.some(l=>l.placement.kind==='ON_PATCH'&&!p.patches?.some(x=>x.id===(l.placement as {hostPatchId:string}).hostPatchId))).toBe(false);
 expect(()=>dependencyGraph(p)).not.toThrow();expect(()=>parseLandmarks(JSON.stringify(p))).not.toThrow();
});

import {addOnCurvePoint} from '../domain/landmarks/placement';
test('lid curves reuse on-curve anchors and keep normalized s after local edits',()=>{
 let p=setup();const e=p.eyeScaffold!,q=e.coord!,r=addOnCurvePoint(p,q.right.curves[0]);p=r.project;
 const saved=parseLandmarks(JSON.stringify(p));expect(saved.landmarks.find(l=>l.id===r.selectedId)?.placement).toMatchObject({kind:'ON_CURVE',s:.5});
 const v=pointPosition(p,q.right.points[2]),next=moveEyeLocal(p,q.right.points[2],[v[0],v[1]+.1,v[2]]);
 expect(pointPosition(next,r.selectedId)).not.toEqual(pointPosition(p,r.selectedId));expect(()=>parseLandmarks(JSON.stringify(next))).not.toThrow();
});

import {independentEyeFrames} from '../domain/eyes/coord';
import {nudgePoint} from '../domain/landmarks/nudge';
import {toRelative} from '../domain/head/frame';
import {irisGeometry} from '../domain/eyes/gaze';
test('eyeball and lid transforms are independent, including perspective and gaze',()=>{
 const p=independentEyeFrames(setup()),e=p.eyeScaffold!,q=e.coord!,id=q.right.points[2];
 const next=rebuildEyeScaffold({...p,eyeScaffold:{...e,parameters:{...e.parameters,x:e.parameters.x+.1,y:e.parameters.y+.2},ballOrientation:[10,20,30]}});
 expect(pointPosition(next,id)).toEqual(pointPosition(p,id));
 const moved=rebuildEyeScaffold({...p,eyeScaffold:{...e,coord:{...q,position:[.8,.1,.9],orientation:[15,25,35]}}});
 for(const curve of e.right.curveIds.slice(12))expect(evaluationContext(moved).curve(curve).sample(8)).toEqual(evaluationContext(p).curve(curve).sample(8));
 expect(pointPosition(moved,id)).not.toEqual(pointPosition(p,id));
 const g={version:1 as const,leftId:crypto.randomUUID(),rightId:crypto.randomUUID(),irisScale:.4,recessDepth:.1,tracking:true};
 expect(irisGeometry({...moved,gazeEyeball:g},'right',[.5,.2,1])!.rim(.3)).toEqual(irisGeometry({...p,gazeEyeball:g},'right',[.5,.2,1])!.rim(.3));
 expect(parseLandmarks(JSON.stringify(moved)).eyeScaffold).toEqual(moved.eyeScaffold);
});
test('point XYZ sliders move model axes, even for tilted local frames and either side',()=>{
 const p0=setup(),p=rebuildEyeScaffold({...p0,eyeScaffold:{...p0.eyeScaffold!,coord:{...p0.eyeScaffold!.coord!,orientation:[30,20,10],tilt:25}}});
 for(const side of ['left','right'] as const)for(const axis of [0,1,2] as const){const id=p.eyeScaffold!.coord![side].points[2],before=toRelative(p,pointPosition(p,id)),next=nudgePoint(p,id,axis,.05),after=toRelative(next,pointPosition(next,id));
 after.forEach((v,i)=>expect(v-before[i]).toBeCloseTo(i===axis?.05:0,12));}
});
