import {planarShape} from './planar-fixture';
import {test,expect} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import type {LandmarkProject} from '../domain/landmarks/model';
import type {Vec3} from '../domain/project/types';
import {evaluationContext} from '../domain/geometry/evaluation';
import {addSmoothJoin,setJoinRadius,removeSmoothJoin} from '../domain/curves/smoothJoin/commands';
import {resolveJoin} from '../domain/curves/smoothJoin/geometry';
import {joinOccurrences,validateJoins} from '../domain/curves/smoothJoin/model';
import {dependencyGraph,dirtyDescendants,deleteClosure} from '../domain/geometry/dependencies';
import {boundaryGeometry} from '../domain/patches/boundary';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {mirrorPoint} from '../domain/head/frame';
import {evaluator} from '../domain/patches/geometry';
export function joinFixture():LandmarkProject{
 const base=createLandmarkProject();
 const positions:Vec3[]=[[.3,0,0],[-.7,1,0],[1.3,.6,.4]];
 return {...base,headFrame:undefined,loomisScaffold:undefined,loomisRegions:[],loomisCaps:[],patches:[],centerlineOrder:[],landmarks:positions.map((position,i)=>({id:'p'+i,name:'Point '+i,type:'RIGHT',placement:{kind:'WORLD',position},viewLocks:{},tags:[],mirrorPartnerId:undefined})),curves:[[-0,1],[0,2]].map(([a,b],i)=>({id:'c'+i,name:'Curve '+i,role:'canonical',startLandmarkId:'p'+a,endLandmarkId:'p'+b,shape:{planeNormal:i?[0,-.4,.6]:[0,0,1],startHandle:{along:.3,offset:0},endHandle:{along:.3,offset:0}}}))};
}
const join=(p:LandmarkProject,a='c0',b='c1',point='p0',ea:'START'|'END'='START',eb:'START'|'END'='START')=>addSmoothJoin(p,point,{curveId:a,endpoint:ea},{curveId:b,endpoint:eb},.08);
const norm=(v:Vec3)=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
test('non-mirror non-coplanar local G1, fixed Point, exact outer source, no-op removal',()=>{
 const source=joinFixture(),p=join(source),ctx=evaluationContext(p),r=resolveJoin(p,p.curveSmoothJoins![0],id=>ctx.sourceCurve(id));expect(r.warning).toBeUndefined();expect(r.blends).toHaveLength(2);
 const a=norm(ctx.curve('c0').derivative(0)),b=norm(ctx.curve('c1').derivative(0));a.forEach((x,i)=>expect(x+b[i]).toBeCloseTo(0,12));
 expect(p.curves).toEqual(source.curves);expect(p.landmarks).toEqual(source.landmarks);
 for(const blend of r.blends){const g=ctx.curve(blend.endpoint.curveId),s=ctx.sourceCurve(blend.endpoint.curveId),t=blend.t;expect(g.controls).toBeUndefined();expect(g.evaluate(0)).toEqual(s.evaluate(0));expect(g.evaluate(.7)).toEqual(s.evaluate(.7));expect(g.evaluate(t)).toEqual(s.evaluate(t));expect(g.evaluate(t/2)).not.toEqual(s.evaluate(t/2));const l=norm(g.derivative(t-1e-9)),r=norm(s.derivative(t));l.forEach((x,i)=>expect(x).toBeCloseTo(r[i],6));}
 expect(ctx.curve('c0').evaluate(.03)[2]).not.toBe(0);
 expect(evaluationContext(removeSmoothJoin(p,p.curveSmoothJoins![0].id)).curve('c0').controls).toEqual(ctx.sourceCurve('c0').controls);
});
test('cusp rejects, existing degenerate join falls back and recovers, zero radius exact no-op',()=>{
 const base=joinFixture(),p=join(base),id=p.curveSmoothJoins![0].id;
 const cusp={...base,landmarks:base.landmarks.map(x=>x.id==='p2'?{...x,placement:{kind:'WORLD' as const,position:[-1.7,2,0] as Vec3}}:x)};
 expect(()=>join(cusp)).toThrow(/cusp/);
 const broken={...cusp,curveSmoothJoins:p.curveSmoothJoins},ctx=evaluationContext(broken);expect(resolveJoin(broken,broken.curveSmoothJoins![0],id=>ctx.sourceCurve(id)).warning).toMatch(/cusp/);expect(ctx.curve('c0')).toBe(ctx.sourceCurve('c0'));
 const off=evaluationContext(setJoinRadius(p,id,0));expect(off.curve('c0')).toBe(off.sourceCurve('c0'));
 expect(evaluationContext(p).curve('c0').controls).toBeUndefined();
});
test('endpoint occupancy, exact semantic identity, FREE restriction and independent pairs',()=>{
 let p=joinFixture();p={...p,curves:[...p.curves,...p.curves.map(c=>({...c,id:c.id+'b'}))]};p=join(p);expect(()=>join(p,'c0','c1b')).toThrow(/already belongs/);p=join(p,'c0b','c1b');expect(p.curveSmoothJoins).toHaveLength(2);validateJoins(p);
 expect(()=>join(p,'c0b','c1b','p1')).toThrow(/same Point/);
 expect(()=>join(joinFixture(),'c0','c0')).toThrow(/different/);
});
test('partner source invalidates both Final providers and downstream normalized arc points/spans',()=>{
 let p=join(joinFixture());p={...p,landmarks:[...p.landmarks,{...p.landmarks[0],id:'on',placement:{kind:'ON_CURVE',hostCurveId:'c0',role:'canonical',s:.02}}]};
 const j=p.curveSmoothJoins![0],q=setJoinRadius(p,j.id,.2),ctx=evaluationContext(q);
 expect(q.landmarks.find(x=>x.id==='on')!.placement).toEqual(p.landmarks.find(x=>x.id==='on')!.placement);
 expect(ctx.pointPosition('on')).toEqual(ctx.curve('c0').atArcLength(.02));expect(ctx.pointPosition('on')).not.toEqual(evaluationContext(p).pointPosition('on'));
 expect(boundaryGeometry(q,{curveId:'c0',startLandmarkId:'p0',endLandmarkId:'on'}).evaluate(1)).toEqual(ctx.pointPosition('on'));
 const dirty=dirtyDescendants(p,q);expect([...dirty.curves].sort()).toEqual(['c0','c1']);expect(dirty.points.has('on')).toBe(true);
 const changed={...q,landmarks:q.landmarks.map(x=>x.id==='p2'?{...x,placement:{kind:'WORLD' as const,position:[1.4,.4,.8] as Vec3}}:x)};
 expect(dirtyDescendants(q,changed).curves.has('c0')).toBe(true);expect(evaluationContext(changed).curve('c0').key).not.toBe(ctx.curve('c0').key);
});
test('DAG has common source solve, rejects real ON_CURVE feedback; deletion preserves unrelated partner',()=>{
 const p=join(joinFixture());expect(()=>dependencyGraph(p)).not.toThrow();expect(dependencyGraph(p).dependencies.get('curve:c0')).toContain('join:'+p.curveSmoothJoins![0].id);
 const cycle={...p,landmarks:p.landmarks.map(x=>x.id==='p2'?{...x,placement:{kind:'ON_CURVE' as const,role:'canonical' as const,hostCurveId:'c0',s:.3}}:x)};expect(()=>dependencyGraph(cycle)).toThrow(/循环/);
 const deleted=deleteClosure(p,['curve:c0']);expect(deleted.curveSmoothJoins).toEqual([]);expect(deleted.curves.map(x=>x.id)).toContain('c1');
});
import {spanFixture} from './span-fixture';
import {addPatch} from '../domain/patches/model';
import {createCurve} from './planar-fixture';
import {followEndpoints} from '../domain/curves/geometry';
import {isDerived} from '../domain/curves/model';
test('same-side mirrored relation persists once, strict reflected Final, Patch follows Radius',()=>{
 const f=spanFixture();let p=addPatch(f.p,[f.use,f.ac,f.bc]);
 p=join(p,f.ac,f.bc,f.c,'END','END');expect(joinOccurrences(p,p.curveSmoothJoins![0])).toHaveLength(2);
 const ctx=evaluationContext(p),c=p.curves.find(c=>c.id===f.ac)!,owner=c.role==='canonical'?c.id:c.canonicalCurveId,mirror=p.curves.find(c=>c.role==='mirror'&&c.canonicalCurveId===owner)!;
 for(const t of [0,.37,.98,1])expect(ctx.curve(mirror.id).evaluate(t)).toEqual(mirrorPoint(p,ctx.curve(owner).evaluate(t)));
 const q=setJoinRadius(p,p.curveSmoothJoins![0].id,.2),x=p.patches![0];const at=evaluator(p,x),after=evaluator(q,x);expect(Array.from({length:21},(_,i)=>Array.from({length:21-i},(_,k)=>JSON.stringify(at(i/20,k/20))!==JSON.stringify(after(i/20,k/20)))).flat().some(Boolean)).toBe(true);expect(dirtyDescendants(p,q).patches.has(x.id)).toBe(true);
 const loaded=parseLandmarks(JSON.stringify(p));expect(loaded.curveSmoothJoins).toEqual(p.curveSmoothJoins);expect(loaded.version).toBe('landmarks-0.9.2');
 evaluationContext(loaded).curve(f.ac).evaluate(.98).forEach((x,i)=>expect(x).toBeCloseTo(ctx.curve(f.ac).evaluate(.98)[i],12));
});
test('self mirrored centerline Join, source editing and mirrored endpoint selection',()=>{
 let p=createLandmarkProject();const point=p.landmarks.find(l=>l.name==='下巴尖点')!,end=p.landmarks.find(l=>l.name==='右外眼角点')!;
 const made=createCurve(p,point.id,end.id,p.views[0],'Join demo');p=made.project;const c=p.curves.find(c=>c.id===made.selectedId)!;
 p=join(p,c.id,c.mirrorPartnerCurveId!,point.id);expect(joinOccurrences(p,p.curveSmoothJoins![0])).toHaveLength(1);
 const ctx=evaluationContext(p),a=ctx.curve(c.id),b=ctx.curve(c.mirrorPartnerCurveId!);expect(a.evaluate(.01)[1]).toBeGreaterThan(ctx.pointPosition(point.id)[1]);expect(b.evaluate(.01)).toEqual(mirrorPoint(p,a.evaluate(.01)));
 expect(norm(a.derivative(0))[1]).toBeCloseTo(0,12);
 const q={...p,curves:p.curves.map(x=>x.id===c.id&&!isDerived(x)&&x.role==='canonical'?{...x,shape:{...x.shape,startHandle:{along:.4,offset:.05}}}:x)};expect(evaluationContext(q).curve(c.id).key).not.toEqual(a.key);
 expect(parseLandmarks(JSON.stringify(p)).curveSmoothJoins).toHaveLength(1);
});
test('two end joins retain exact middle, source plane transports without handle rewrite',()=>{
 let p=joinFixture();p={...p,landmarks:[...p.landmarks,{...p.landmarks[1],id:'p3',placement:{kind:'WORLD',position:[-1.7,1.2,0]}}],curves:[...p.curves,{...(p.curves[0] as import('../domain/curves/model').BezierCurve),id:'c2',startLandmarkId:'p1',endLandmarkId:'p3'}]};
 p=join(p);p=join(p,'c0','c2','p1','END','START');p=setJoinRadius(setJoinRadius(p,p.curveSmoothJoins![0].id,.35),p.curveSmoothJoins![1].id,.35);
 const ctx=evaluationContext(p);for(const t of [.4,.5,.6])expect(ctx.curve('c0').evaluate(t)).toEqual(ctx.sourceCurve('c0').evaluate(t));
 const changed={...p,landmarks:p.landmarks.map(x=>x.id==='p0'?{...x,placement:{kind:'WORLD' as const,position:[.4,-.1,.1] as Vec3}}:x)},q=followEndpoints(p,changed);
 expect(q.curveSmoothJoins).toEqual(p.curveSmoothJoins);for(const c of q.curves)if(!isDerived(c)&&c.role==='canonical'){const before=p.curves.find(x=>x.id===c.id)!;if(!isDerived(before)&&before.role==='canonical')expect(planarShape(c.shape).startHandle).toEqual(planarShape(before.shape).startHandle);}
 expect(evaluationContext(q).curve('c0').sample().flat().every(Number.isFinite)).toBe(true);
});
import {contourSource} from '../domain/contour/source';
test('OPEN_EDGE Contour receives the same Final geometry without a contour-specific modifier',()=>{
 const original=joinFixture(),base={...original,curves:original.curves.map(c=>({...c,contourRole:'OPEN_EDGE' as const}))},p=join(base);
 const result=contourSource(p);expect(result.invalid).toEqual([]);expect(result.mesh.boundaries![0]).toEqual(evaluationContext(p).curve('c0').sample(512));expect(result.mesh.boundaries![0]).not.toEqual(evaluationContext(base).curve('c0').sample(512));
});
test('length scale invariance and monotonic local blends, radius bounds',()=>{
 const base=joinFixture(),p=join(base),huge={...base,landmarks:base.landmarks.map(l=>({...l,placement:{kind:'WORLD' as const,position:evaluationContext(base).pointPosition(l.id).map(x=>x*100) as Vec3}}))},q=join(huge);
 for(const t of [0,.01,.04,.1,.5,1])evaluationContext(p).curve('c0').evaluate(t).forEach((x,i)=>expect(evaluationContext(q).curve('c0').evaluate(t)[i]).toBeCloseTo(x*100,9));
 const ctx=evaluationContext(p),blend=resolveJoin(p,p.curveSmoothJoins![0],id=>ctx.sourceCurve(id)).blends[0],P=ctx.curve('c0').evaluate(0);let last=0;
 for(let i=0;i<=100;i++){const x=ctx.curve('c0').evaluate(blend.t*i/100),d=Math.hypot(...x.map((v,k)=>v-P[k]));expect(d+1e-12).toBeGreaterThanOrEqual(last);last=d;}
 expect(()=>setJoinRadius(p,p.curveSmoothJoins![0].id,.36)).toThrow(/Radius/);
});
test('already opposite tangents preserve exact source even at positive Radius',()=>{
 const base=joinFixture(),p={...base,landmarks:base.landmarks.map(l=>l.id==='p2'?{...l,placement:{kind:'WORLD' as const,position:[1.3,-1,0] as Vec3}}:l)},q=join(p),ctx=evaluationContext(q);expect(ctx.curve('c0')).toBe(ctx.sourceCurve('c0'));expect(ctx.curve('c1')).toBe(ctx.sourceCurve('c1'));
});
test('three independent pairs at one Point, invalid references and derived curves are rejected',()=>{
 const base=joinFixture();let p={...base,curves:[...base.curves,...base.curves.map(c=>({...c,id:c.id+'b'})),...base.curves.map(c=>({...c,id:c.id+'c'}))]};p=join(p);p=join(p,'c0b','c1b');p=join(p,'c0c','c1c');expect(p.curveSmoothJoins).toHaveLength(3);
 const invalid={...p,curveSmoothJoins:p.curveSmoothJoins!.map((j,i)=>i===0?{...j,a:{...j.a,curveId:'missing'}}:j)};expect(()=>validateJoins(invalid)).toThrow(/FREE/);
 const analytic={...base,curves:base.curves.map(c=>c.id==='c0'?{id:c.id,name:c.name,geometryType:'ON_PATCH' as const,hostPatchId:'host',role:'canonical' as const,startLandmarkId:'p0',endLandmarkId:'p1',path:{startBoundary:0,endBoundary:1,winding:0}}:c)};expect(()=>join(analytic)).toThrow(/FREE/);
});
