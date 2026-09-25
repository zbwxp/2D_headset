import {test,expect} from 'vitest';
import {Vector3} from 'three';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame,rotateFrame} from '../domain/head/frame';
import {createEyeScaffold} from '../domain/eyes/scaffold';
import {gazePose} from '../domain/eyes/tracking';
import {irisGeometry} from '../domain/eyes/gaze';
const setup=()=>({...createEyeScaffold(migrateHeadFrame(createLandmarkProject())),gazeEyeball:{version:1 as const,leftId:crypto.randomUUID(),rightId:crypto.randomUUID(),irisScale:.45,recessDepth:.12,tracking:true}});
test('common target, independent rotations, fixed centers and full ellipsoid rigid rotation',()=>{
 const p=setup();p.eyeScaffold!.perspective={x:0,y:0};const before=JSON.stringify(p);const a=gazePose(p,'left',[.5,.2,1]),b=gazePose(p,'right',[.5,.2,1]);expect(a.target).toEqual(b.target);expect(a.rotation.toArray()).not.toEqual(b.rotation.toArray());
 for(const side of ['left','right'] as const){const pose=gazePose(p,side,[.5,.2,1]);expect(pose.transform(pose.center)).toEqual(pose.center);const forward=new Vector3(...rotateFrame([0,0,1],p.headFrame!)).applyQuaternion(pose.rotation),desired=new Vector3(...pose.target).sub(new Vector3(...pose.center)).normalize();expect(forward.distanceTo(desired)).toBeLessThan(1e-12);
 const rim=irisGeometry(p,side,[.5,.2,1])!,center=new Vector3(...rim.rim(0)).add(new Vector3(...rim.rim(Math.PI))).multiplyScalar(.5).sub(new Vector3(...pose.center)).normalize();expect(center.distanceTo(desired)).toBeLessThan(1e-12);
 const off={...p,gazeEyeball:{...p.gazeEyeball,tracking:false}};expect(gazePose(off,side,[1,0,0]).rotation.toArray()).toEqual([0,0,0,1]);expect(irisGeometry(off,side,[1,0,0])!.rim(.7)).toEqual(irisGeometry(p,side)!.rim(.7));}
 expect(JSON.stringify(p)).toBe(before);
});
test('rotated HeadFrame and antipodal camera stay finite, view results remain independent',()=>{
 const p=setup();p.headFrame={...p.headFrame!,orientation:[0,Math.sin(.3),0,Math.cos(.3)]};
 for(const facing of [[0,0,-1],[0,1,0],[1,0,0]] as [number,number,number][]){for(const side of ['left','right'] as const){const pose=gazePose(p,side,facing);expect(pose.rotation.toArray().every(Number.isFinite)).toBe(true);}}
 expect(irisGeometry(p,'left',[0,0,1])!.rim(.5)).not.toEqual(irisGeometry(p,'left',[1,0,0])!.rim(.5));
});

import {parseGaze} from '../domain/eyes/gaze';
test('adjustable distant target reduces convergence, persists and does not mutate geometry',()=>{
 const p=setup(),before=JSON.stringify(p);
 const angle=(distance:number)=>{const q={...p,gazeEyeball:{...p.gazeEyeball,viewDistance:distance}},a=gazePose(q,'left',[0,0,1]),b=gazePose(q,'right',[0,0,1]);expect(a.target).toEqual(b.target);return new Vector3(...a.target).sub(new Vector3(...a.center)).angleTo(new Vector3(...b.target).sub(new Vector3(...b.center)));};
 expect(angle(50)).toBeLessThan(angle(10)/4);expect(angle(200)).toBeLessThan(angle(50));
 const g={...p.gazeEyeball,viewDistance:75};expect(parseGaze(JSON.parse(JSON.stringify(g)))).toEqual(g);expect(()=>parseGaze({...g,viewDistance:0})).toThrow();expect(JSON.stringify(p)).toBe(before);
});

import {gazeTargetDirection} from '../domain/eyes/tracking';
test('follow strength scales local yaw/pitch, preserves full follow, mirrors and persists',()=>{
 const p=setup(),d=Math.PI/180;
 for(const yaw of [-45,0,45,90]){const q={...p,gazeEyeball:{...p.gazeEyeball,followStrength:.5}},v=gazeTargetDirection(q,[Math.sin(yaw*d),0,Math.cos(yaw*d)]);expect(Math.atan2(v[0],v[2])/d).toBeCloseTo(Math.max(-45,Math.min(45,yaw))/2,12);}
 const p2={...p,headFrame:{...p.headFrame!,orientation:[0,Math.sin(.2),0,Math.cos(.2)] as [number,number,number,number]}};
 const facing=rotateFrame([Math.sin(40*d)*Math.cos(20*d),Math.sin(20*d),Math.cos(40*d)*Math.cos(20*d)],p2.headFrame);
 const q={...p2,gazeEyeball:{...p.gazeEyeball,followStrength:.5}},v=rotateFrame(gazeTargetDirection(q,facing),p2.headFrame,true);
 expect(Math.atan2(v[0],v[2])/d).toBeCloseTo(20);expect(Math.asin(v[1])/d).toBeCloseTo(10);
 expect(gazeTargetDirection({...q,gazeEyeball:{...q.gazeEyeball,followStrength:0}},facing)).toEqual(rotateFrame([0,0,1],p2.headFrame));
 gazeTargetDirection(p2,facing).forEach((v,i)=>expect(v).toBeCloseTo(new Vector3(...facing).normalize().toArray()[i],12));
 expect(parseGaze(JSON.parse(JSON.stringify(q.gazeEyeball)))?.followStrength).toBe(.5);
 expect(()=>parseGaze({...q.gazeEyeball,followStrength:1.1})).toThrow();
 expect(gazePose(q,'left',facing).target).toEqual(gazePose(q,'right',facing).target);
});
test('yaw stops at signed 45 degrees while pitch continues and strength applies afterward',()=>{
 const p=setup(),d=Math.PI/180;
 for(const sign of [-1,1])for(const strength of [1,.5])for(const yaw of [45,60,85,120]){
 const q={...p,gazeEyeball:{...p.gazeEyeball,followStrength:strength}};
 for(const pitch of [-30,0,30]){const v=gazeTargetDirection(q,[Math.sin(sign*yaw*d)*Math.cos(pitch*d),Math.sin(pitch*d),Math.cos(sign*yaw*d)*Math.cos(pitch*d)]);
 expect(Math.atan2(v[0],v[2])/d).toBeCloseTo(sign*45*strength,10);expect(Math.asin(v[1])/d).toBeCloseTo(pitch*strength,10);}
 }
});
