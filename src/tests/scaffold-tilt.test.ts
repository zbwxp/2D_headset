import {test,expect} from 'vitest';
import {ensureScaffold,RING_Y,SIDE_R,RIM_R,RIM_L,helmetRelative,sideToHead,sideBasis} from '../domain/head/scaffold';
import {migrateHeadFrame,toRelative,mirrorPoint} from '../domain/head/frame';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {evaluationContext,pointPosition} from '../domain/geometry/evaluation';
import {curveMemberships} from '../domain/head/membership';
import {helmetMesh,helmetDomain} from '../domain/head/helmet';
import {rimHeight} from '../domain/head/rim';
import {parseLandmarks} from '../domain/landmarks/persistence';
const base=()=>ensureScaffold(migrateHeadFrame(createLandmarkProject()));
test('translated horizontal ring and tilted side cuts retain all exact multi-host intersections',()=>{
 for(const h of [-.15,0,.2])for(const angle of [-20,0,25]){const p0=base(),p=ensureScaffold({...p0,loomisScaffold:{...p0.loomisScaffold!,horizontalOffset:h,sideTilt:angle}}),ctx=evaluationContext(p),s=p.loomisScaffold!,b=sideBasis(s);
 for(const v of ctx.curve(RING_Y).sample(20))expect(toRelative(p,v)[1]).toBeCloseTo(h,12);
 for(const v of ctx.curve(SIDE_R).sample(20)){const q=toRelative(p,v);expect(Math.hypot(...q)).toBeCloseTo(1,12);expect(q[0]*b.c+q[1]*b.sn).toBeCloseTo(.75,12);}
 for(const l of p.landmarks.filter(l=>l.systemRole&&!l.systemRole.startsWith('APEX')))for(const m of curveMemberships(p,l.id)){const a=ctx.curve(m.curveId).evaluate(m.t),v=pointPosition(p,l.id);expect(Math.hypot(...a.map((x,i)=>x-v[i]))).toBeLessThan(1e-9);}
 expect(()=>parseLandmarks(JSON.stringify(p))).not.toThrow();
 }
});
test('rim and final shell follow tilt without boundary gaps; mirror remains exact',()=>{
 const b=base(),p=ensureScaffold({...b,loomisScaffold:{...b.loomisScaffold!,horizontalOffset:.1,sideTilt:-20}}),s=p.loomisScaffold!,ctx=evaluationContext(p),rim=ctx.curve(RIM_R),c=p.curves.find(c=>c.id===RIM_R)!;
 for(const [t,id] of [[0,c.startLandmarkId!],[1,c.endLandmarkId!]] as const)expect(Math.hypot(...rim.evaluate(t).map((v,i)=>v-pointPosition(p,id)[i]))).toBeLessThan(1e-9);
 for(let i=0;i<=20;i++){const v=rim.evaluate(i/20),q=toRelative(p,v);expect(q[1]).toBeCloseTo(rimHeight(s,q[2]),9);expect(ctx.curve(RIM_L).evaluate(i/20)).toEqual(mirrorPoint(p,v));}
 const r=Math.sqrt(1-s.sidePosition**2);for(const a of [0,.7,2]){const v=sideToHead(s,[s.sidePosition,r*Math.cos(a),r*Math.sin(a)]);expect(Math.hypot(...helmetRelative(s,v).map((x,i)=>x-v[i]))).toBeLessThan(1e-9);}
 expect(helmetMesh(p).vertices.flat().every(Number.isFinite)).toBe(true);
});
test('invalid combinations reject before system intersections disappear',()=>{const p=base();expect(()=>ensureScaffold({...p,loomisScaffold:{...p.loomisScaffold!,sideTilt:60}})).toThrow();expect(()=>ensureScaffold({...p,loomisScaffold:{...p.loomisScaffold!,horizontalOffset:.9}})).toThrow();});
