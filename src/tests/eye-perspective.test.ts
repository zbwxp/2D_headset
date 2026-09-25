import {test,expect} from 'vitest';
import {Vector3} from 'three';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame} from '../domain/head/frame';
import {createEyeScaffold,parseEyeScaffold} from '../domain/eyes/scaffold';
import {eyePerspectiveMatrix} from '../domain/eyes/perspective';
import {irisGeometry} from '../domain/eyes/gaze';
import {eyeObjectMatrix,rawEyePlane} from '../rendering/eyeDisplay';
import {orthographicView,worldToPlane} from '../rendering/orthographic';
import {customView} from '../domain/landmarks/views';
const setup=()=>{const p=createEyeScaffold(migrateHeadFrame(createLandmarkProject()));p.eyeScaffold!.perspective={x:1,y:0};return p;};
test('front identity, near wider / far narrower, gap compression, independent Y and mirror',()=>{
 const p=setup(),f=[Math.SQRT1_2,0,Math.SQRT1_2] as [number,number,number],r=new Vector3(Math.SQRT1_2,0,-Math.SQRT1_2);
 for(const side of ['left','right'] as const){expect(eyePerspectiveMatrix(p,side,[0,0,1]).elements).toEqual(eyePerspectiveMatrix({...p,eyeScaffold:{...p.eyeScaffold!,perspective:{x:0,y:0}}},side,f).elements);const m=eyePerspectiveMatrix(p,side,f),origin=new Vector3().applyMatrix4(m),dx=r.clone().applyMatrix4(m).sub(origin).length(),dy=new Vector3(0,1,0).applyMatrix4(m).sub(origin).length();expect(dx).toBeCloseTo(1+(side==='right'?1:-1)*.55*Math.SQRT1_2);expect(dy).toBeCloseTo(1);const v=new Vector3(side==='left'?-.4:.4,.2,.9),reflected=v.clone();reflected.x*=-1;const a=v.applyMatrix4(m),b=reflected.applyMatrix4(eyePerspectiveMatrix(p,side==='left'?'right':'left',[-f[0],0,f[2]]));expect(a.x).toBeCloseTo(-b.x);expect(a.y).toBeCloseTo(b.y);expect(a.z).toBeCloseTo(b.z);}
 const q=p.eyeScaffold!.parameters,R=p.headFrame!.radiusX,center=(sign:number)=>new Vector3(sign*q.x*R,q.y*R,q.z*R).add(new Vector3(...p.headFrame!.center));const before=center(1).sub(center(-1)).dot(r),after=center(1).applyMatrix4(eyePerspectiveMatrix(p,'right',f)).sub(center(-1).applyMatrix4(eyePerspectiveMatrix(p,'left',f))).dot(r);expect(after/before).toBeCloseTo(.85);
 p.eyeScaffold!.perspective={x:0,y:1};const m=eyePerspectiveMatrix(p,'right',f),o=new Vector3().applyMatrix4(m);expect(r.clone().applyMatrix4(m).sub(o).length()).toBeCloseTo(1);expect(new Vector3(0,1,0).applyMatrix4(m).sub(o).length()).toBeGreaterThan(1);
});
test('source immutable, HeadSet unchanged, iris cap shares rim, inverse edits, old assets default zero',()=>{
 const p=setup();p.gazeEyeball={version:1,leftId:crypto.randomUUID(),rightId:crypto.randomUUID(),irisScale:.45,recessDepth:.12,tracking:true};const before=JSON.stringify(p),f:[number,number,number]=[.5,.3,.8];
 const g=irisGeometry(p,'right',f)!;expect(g.evaluate(1,.7)).toEqual(g.rim(.7));expect(eyeObjectMatrix(p,p.landmarks.find(l=>p.geometryModules?.[l.id]!=='EYES')!.id,f).elements).toEqual(eyePerspectiveMatrix({...p,eyeScaffold:undefined},'right',f).elements);
 const view=customView('',30,20),v=orthographicView(view.camera,view.canvas,600,560),id=p.eyeScaffold!.right.pointIds[20],raw=new Vector3(.5,.2,.8),display=raw.clone().applyMatrix4(eyeObjectMatrix(p,id,v.forward)),xy=worldToPlane(display.toArray(),v);const unwarped=rawEyePlane(p,id,[xy[0],xy[1]],v),expected=worldToPlane(raw.toArray(),v);expect(unwarped[0]).toBeCloseTo(expected[0]);expect(unwarped[1]).toBeCloseTo(expected[1]);expect(JSON.stringify(p)).toBe(before);
 expect(parseEyeScaffold({...p.eyeScaffold,perspective:undefined})!.perspective).toEqual({x:0,y:0});expect(()=>parseEyeScaffold({...p.eyeScaffold,perspective:{x:NaN,y:0}})).toThrow();
});
