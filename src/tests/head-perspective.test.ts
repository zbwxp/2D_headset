import {test,expect} from 'vitest';
import {Vector3} from 'three';
import {headPerspective,parseHeadPerspective} from '../domain/head/perspective';
import {displayPoint,rawDisplayPlane} from '../rendering/moduleDisplay';
import {contourDisplay} from '../rendering/contourDisplay';
import {contourSource} from '../domain/contour/source';
import {headScreenRay} from '../ui/authoring/constrainedDrag';
import {intersectLoomis} from '../domain/head/surfacePoint';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {ensureScaffold,HELMET,RIM_R} from '../domain/head/scaffold';
import {migrateHeadFrame,toHead} from '../domain/head/frame';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {createEyeScaffold} from '../domain/eyes/scaffold';
import {moduleEditAllowed} from '../domain/modules/ownership';
import {orthographicView,worldToPlane,worldToScreen} from '../rendering/orthographic';
import {customView} from '../domain/landmarks/views';
import {evaluationContext} from '../domain/geometry/evaluation';
import type {Vec3} from '../domain/project/types';
const base=()=>({...ensureScaffold(migrateHeadFrame(createLandmarkProject())),headPerspective:{x:1,y:1}});
const facing:Vec3=[Math.SQRT1_2,0,Math.SQRT1_2];
const distance=(a:Vec3,b:Vec3)=>Math.hypot(...a.map((v,i)=>v-b[i]));

test('zero/front identity, near/far scale, independent X/Y, exact inverse, finite extremes',()=>{
 const p=base(),v:Vec3=[.4,.3,.5];
 expect(headPerspective({...p,headPerspective:undefined},facing).display(v)).toEqual(v);
 expect(headPerspective(p,[0,0,1]).display(v)).toEqual(v);
 const pose=headPerspective(p,facing),make=(depth:number)=>new Vector3(...pose.center).addScaledVector(new Vector3(...pose.right),.2).addScaledVector(new Vector3(...pose.up),.3).addScaledVector(new Vector3(...pose.forward),depth).toArray();
 const width=(d:number)=>new Vector3(...pose.display(make(d))).sub(new Vector3(...pose.center)).dot(new Vector3(...pose.right));
 expect(width(.5)).toBeGreaterThan(.2);expect(width(-.5)).toBeLessThan(.2);
 const x=headPerspective({...p,headPerspective:{x:1,y:0}},facing),y=headPerspective({...p,headPerspective:{x:0,y:1}},facing);
 expect(new Vector3(...x.display(make(.5))).sub(new Vector3(...make(.5))).dot(new Vector3(...pose.up))).toBeCloseTo(0,12);
 expect(new Vector3(...y.display(make(.5))).sub(new Vector3(...make(.5))).dot(new Vector3(...pose.right))).toBeCloseTo(0,12);
 for(const q of [v,make(.5),make(-.5),make(100),make(-100)]){const d=pose.display(q);expect(d.every(Number.isFinite)).toBe(true);expect(distance(pose.raw(d),q)).toBeLessThan(1e-10);}
});

test('mirrored views mirror the whole head and all object kinds share the same seam transform',()=>{
 const p=base(),v:Vec3=[.5,.2,.7],a=displayPoint(p,HELMET,v,facing),b=displayPoint(p,RIM_R,[-v[0],v[1],v[2]],[-facing[0],0,facing[2]]);
 expect(distance([-a[0],a[1],a[2]],b)).toBeLessThan(1e-12);
 expect(displayPoint(p,HELMET,v,facing)).toEqual(displayPoint(p,RIM_R,v,facing));
 const before=JSON.stringify(p),curve=evaluationContext(p).curve(RIM_R).sample(32);headPerspective(p,facing).display(v);
 expect(JSON.stringify(p)).toBe(before);expect(evaluationContext(p).curve(RIM_R).sample(32)).toEqual(curve);
});

test('Eye controls isolated, persistence validated, HeadSet settings module-owned',()=>{
 const p=createEyeScaffold(base()),q={...p,headPerspective:{x:0,y:0}},eye=p.eyeScaffold!.right.curveIds[0],v:Vec3=[.5,.2,.7];
 expect(displayPoint(p,eye,v,facing)).toEqual(displayPoint(q,eye,v,facing));
 expect(moduleEditAllowed(q,p,'EYES')).toBe(false);expect(moduleEditAllowed(q,p,'HEADSET')).toBe(true);
 expect(parseLandmarks(JSON.stringify(p)).headPerspective).toEqual({x:1,y:1});
 expect(parseHeadPerspective(undefined)).toBeUndefined();expect(()=>parseHeadPerspective({x:2,y:0})).toThrow();expect(()=>parseHeadPerspective({x:NaN,y:0})).toThrow();
});

test('2D inverse editing and analytic surface picking follow the displayed geometry',()=>{
 const p=base(),v=customView('perspective',45,15),view=orthographicView(v.camera,v.canvas,700,600);
 const q=toHead(p,[.3,.2,Math.sqrt(1-.3**2-.2**2)]),shown=displayPoint(p,'head',q,view.forward),xy=worldToPlane(shown,view),raw=rawDisplayPlane(p,'head',[xy[0],xy[1]],view,q),expected=worldToPlane(q,view);
 expect(raw[0]).toBeCloseTo(expected[0],10);expect(raw[1]).toBeCloseTo(expected[1],10);
 const ray=headScreenRay(p,worldToScreen(shown,view),view),direction=intersectLoomis(p,ray.origin,ray.direction)!;
 expect(distance(toHead(p,direction),q)).toBeLessThan(1e-7);
});

test('Contour uses identical display transform for mesh and boundaries without mutating source',()=>{
 const p=base(),source=contourSource(p),before=JSON.stringify(source.mesh),posed=contourDisplay(source,facing);
 const range=source.displayVertices[0],index=range.start+Math.min(30,range.count-1);
 expect(posed.vertices[index]).toEqual(displayPoint(p,range.id,source.baseVertices[index],facing));
 const b=source.displayBoundaries[0];expect(b).toBeDefined();
 expect(posed.boundaries![b.index][5]).toEqual(displayPoint(p,b.id,source.baseBoundaries[b.index][5],facing));
 expect(JSON.stringify(source.mesh)).toBe(before);
 expect(contourDisplay({...source,project:{...source.project,headPerspective:{x:0,y:0}}},facing).vertices).toEqual(source.baseVertices);
});
