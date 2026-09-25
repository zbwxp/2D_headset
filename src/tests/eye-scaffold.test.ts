import {test,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame} from '../domain/head/frame';
import {createEyeScaffold,rebuildEyeScaffold,eyeSide} from '../domain/eyes/scaffold';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {pointPosition,evaluationContext} from '../domain/geometry/evaluation';
import {assignModules,ownerOf,canPickModule} from '../domain/modules/ownership';
const setup=()=>createEyeScaffold(migrateHeadFrame(createLandmarkProject()));
test('eye scaffold is symmetric, wire-only, vertically aligned and owned by Eyes',()=>{
 const before=migrateHeadFrame(createLandmarkProject()),p=createEyeScaffold(before),s=p.eyeScaffold!;
 expect(p.patches).toBe(before.patches);expect(p.landmarks.length-before.landmarks.length).toBe(46);expect(p.curves.length-before.curves.length).toBe(50);
 const f=p.headFrame!;for(let i=0;i<23;i++){const a=pointPosition(p,s.left.pointIds[i]);expect(s.right.pointIds.some(id=>{const b=pointPosition(p,id);return Math.hypot(a[0]+b[0]-2*f.center[0],a[1]-b[1],a[2]-b[2])<1e-10;})).toBe(true);}
 const q=s.parameters,axis=evaluationContext(p).curve(s.right.curveIds[24]);expect(axis.evaluate(1)[1]-axis.evaluate(0)[1]).toBeCloseTo(q.height*f.radiusX);
 expect(p.curves.filter(c=>eyeSide(p,c.id)).every(c=>c.contourRole==='NONE')).toBe(true);
 const owned=assignModules(p,before,'EYES');expect(ownerOf(owned,s.left.pointIds[20])).toBe('EYES');expect(canPickModule(owned,s.left.pointIds[20],'HEADSET')).toBe(false);
 expect(createEyeScaffold(p)).toBe(p);
});
test('resize regenerates stable IDs, shared center, linked sides; roundtrips',()=>{
 const p=setup(),s=p.eyeScaffold!,next=rebuildEyeScaffold({...p,eyeScaffold:{...s,parameters:{...s.parameters,x:.6,radiusX:.4,height:1}}});
 expect(next.eyeScaffold!.right.pointIds).toBe(s.right.pointIds);expect(next.eyeScaffold!.right.curveIds).toBe(s.right.curveIds);
 expect(pointPosition(next,s.left.pointIds[20])[0]).toBeCloseTo(p.headFrame!.center[0]-.6*p.headFrame!.radiusX);
 const center=pointPosition(next,s.right.pointIds[20]),R=p.headFrame!.radiusX;expect(center[0]).toBeCloseTo(p.headFrame!.center[0]+.6*R);
 expect(pointPosition(next,s.right.pointIds[0])[0]-center[0]).toBeCloseTo(.4*R);
 const loaded=parseLandmarks(JSON.stringify(next));expect(loaded.eyeScaffold!.coord).toBeDefined();
 for(const id of s.right.curveIds.slice(12))for(const t of [0,.25,.5,.75,1])evaluationContext(loaded).curve(id).evaluate(t).forEach((n,i)=>expect(n).toBeCloseTo(evaluationContext(next).curve(id).evaluate(t)[i],12));
});
test('head-local guides follow rotated frame and scale all dimensions with width R',()=>{
 const p=setup(),f=p.headFrame!,s=p.eyeScaffold!,next=rebuildEyeScaffold({...p,headFrame:{...f,radiusX:2*f.radiusX,radiusY:3*f.radiusY}});
 const a=pointPosition(next,s.right.pointIds[21]),b=pointPosition(next,s.right.pointIds[22]);expect(b[1]-a[1]).toBeCloseTo(2*f.radiusX*s.parameters.height);
 const rotated=rebuildEyeScaffold({...p,headFrame:{...f,orientation:[0,0,Math.sin(.2),Math.cos(.2)]}});expect(()=>parseLandmarks(JSON.stringify(rotated))).not.toThrow();
 const bad=structuredClone(p);bad.eyeScaffold!.parameters.height=-1;expect(()=>parseLandmarks(JSON.stringify(bad))).toThrow();
});
test('legacy independent parameters migrate to one right canonical shape with stable IDs',()=>{
 const p=setup(),s=p.eyeScaffold!,old={...p,eyeScaffold:{version:1,left:{...s.left,parameters:{...s.parameters,x:-.8,height:.9}},right:{...s.right,parameters:{...s.parameters,x:.55,height:.8}}}};
 const loaded=parseLandmarks(JSON.stringify(old)),q=loaded.eyeScaffold!;
 expect(q.version).toBe(2);expect(q.parameters.x).toBe(.55);expect(q.parameters.height).toBe(.8);
 expect(q.left).toEqual(s.left);expect(q.right).toEqual(s.right);
 const l=pointPosition(loaded,q.left.pointIds[20]),r=pointPosition(loaded,q.right.pointIds[20]);expect(l[0]+r[0]).toBeCloseTo(2*loaded.headFrame!.center[0]);expect(l.slice(1)).toEqual(r.slice(1));
});
test('center XYZ translates every cylinder and eyeball point together in head local axes',()=>{
 const p=setup(),s=p.eyeScaffold!,R=p.headFrame!.radiusX;
 for(const key of ['x','y','z'] as const){const next=rebuildEyeScaffold({...p,eyeScaffold:{...s,parameters:{...s.parameters,[key]:s.parameters[key]+.2}}});
 for(const side of ['left','right'] as const)for(const id of s[side].pointIds){const a=pointPosition(p,id),b=pointPosition(next,id);for(let axis=0;axis<3;axis++)expect(b[axis]-a[axis]).toBeCloseTo(axis==='xyz'.indexOf(key)?.2*R*(key==='x'&&side==='left'?-1:1):0,10);}
 }
});
