import {test,expect,vi} from 'vitest';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {ensureScaffold,RING_Y} from '../domain/head/scaffold';
import {migrateHeadFrame,mirrorPoint} from '../domain/head/frame';
import {duplicateRing} from '../domain/head/duplicateRing';
import type {LandmarkProject} from '../domain/landmarks/model';
import {addLoopPatch,orientLoopUses} from '../domain/patches/model';
import {closedBoundary,boundaryGeometry,boundaryKey} from '../domain/patches/boundary';
import {baseEvaluator,evaluator,tessellate} from '../domain/patches/geometry';
import {baseDifferential,bubble} from '../domain/patches/fullness';
import {relations} from '../domain/continuity/model';
import {solveContinuity,fairDifferential,seamAngle} from '../domain/continuity/solver';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {dirtyDescendants,deleteClosure} from '../domain/geometry/dependencies';
import {evaluationContext} from '../domain/geometry/evaluation';
import {isSection} from '../domain/curves/model';
const dist=(a:number[],b:number[])=>Math.hypot(...a.map((x,i)=>x-b[i]));
const A='70000000-0000-4000-8000-000000000001',B='70000000-0000-4000-8000-000000000002',C='70000000-0000-4000-8000-000000000003';
function fixture(){let p=ensureScaffold(migrateHeadFrame(createLandmarkProject()));
 for(const [d,id] of [[-.55,A],[0,B],[.55,C]] as const){const r=duplicateRing(p,RING_Y);p=JSON.parse(JSON.stringify(r.project).replaceAll(r.selectedId,id));p={...p,curves:p.curves.map(c=>c.id===id&&isSection(c)&&c.role==='canonical'?{...c,section:{...c.section,planeOffset:d}}:c)};}
 return p;
}
function add(p:LandmarkProject,a:string,b:string){return addLoopPatch(p,orientLoopUses(p,[closedBoundary(p,a),closedBoundary(p,b)]));}
test('logical closed rings loft without semantic corners; welded periodic seam and exact boundaries',()=>{
 let p=add(fixture(),A,B),x=p.patches![0],f=baseEvaluator(p,x);expect(x.type).toBe('loop');expect(x.boundaryUses.every(b=>b.kind==='closed'&&!b.startLandmarkId)).toBe(true);
 for(let i=0;i<=32;i++){const s=i/32;expect(dist(f(s,0),boundaryGeometry(p,x.boundaryUses[0]).evaluate(s))).toBeLessThan(1e-12);expect(dist(f(s,1),boundaryGeometry(p,x.boundaryUses[1]).evaluate(s))).toBeLessThan(1e-12);expect(dist(f(0,s),f(1,s))).toBe(0);}
 const m=tessellate(p,x,24);expect(m.invalid).toBeUndefined();expect(m.vertices).toHaveLength(96*25);expect(m.triangles).toHaveLength(96*24*2);
 const edges=new Map<string,number>();for(const t of m.triangles)for(let i=0;i<3;i++){const key=[t[i],t[(i+1)%3]].sort((a,b)=>a-b).join(',');edges.set(key,(edges.get(key)??0)+1);}expect([...edges.values()].filter(n=>n===1)).toHaveLength(192);
});
test('orientation reversal detected once; same canonical starts; roundtrip preserves traversal',()=>{
 let p=fixture();p={...p,curves:p.curves.map(c=>c.id===B&&isSection(c)&&c.role==='canonical'?{...c,logicalRing:undefined,section:{...c.section,planeNormal:[0,-1,0]}}:c)};
 const bs=orientLoopUses(p,[closedBoundary(p,A),closedBoundary(p,B)]);expect(bs[1].reversed).toBe(true);p=addLoopPatch(p,bs);
 const a=boundaryGeometry(p,bs[0]),b=boundaryGeometry(p,bs[1]);for(const s of [.12,.32,.63])expect(dist([a.evaluate(s)[0],a.evaluate(s)[2]],[b.evaluate(s)[0],b.evaluate(s)[2]])).toBeLessThan(.4);
});
test('loop Fullness is periodic with boundary position and first-order no-op',()=>{
 const p=add(fixture(),A,B),x=p.patches![0],q={...p,patches:[{...x,fullness:.3}]},base=baseEvaluator(p,x),f=evaluator(q,q.patches[0]);expect(dist(f(.2,.5),base(.2,.5))).toBeGreaterThan(.01);
 for(const s of [0,.12,.52,1])for(const v of [0,1]){expect(f(s,v)).toEqual(base(s,v));const h=1e-7,V=v===0?h:1-h;expect(dist(f(s,V),base(s,V))/h).toBeLessThan(1e-4);}
 expect(f(0,.4)).toEqual(f(1,.4));expect(bubble('loop',0,.5)).toBe(1);
});
test('whole closed boundary gets periodic continuity, no fade at seam; exact source stays fixed',()=>{
 const p=add(add(fixture(),A,B),B,C),r=relations(p).find(x=>x.pair)!;expect(r.use.kind).toBe('closed');const result=solveContinuity(p);expect(Object.values(result.patches).map(x=>x.error)).toEqual([undefined,undefined]);
 for(const s of [0,.017,.24,.55,.99,1]){expect(seamAngle(p,r,s,result)).toBeLessThan(seamAngle(p,r,s));expect(seamAngle(p,r,s,result)).toBeLessThan(2);}
 for(const x of p.patches!){const d=fairDifferential(p,x,result),b=baseEvaluator(p,x);for(const s of [0,.2,.63,1])for(const v of [0,1])expect(dist(d(s,v).position,b(s,v))).toBeLessThan(1e-12);expect(dist(d(0,.43).position,d(1,.43).position)).toBeLessThan(1e-12);expect(dist(d(0,.43).du,d(1,.43).du)).toBeLessThan(1e-12);}
});
test('host change dirties only dependent patches; host delete cascades',()=>{
 const p=add(fixture(),A,B);expect(parseLandmarks(JSON.stringify(p)).patches).toEqual(p.patches);const q={...p,curves:p.curves.map(c=>c.id===A&&isSection(c)&&c.role==='canonical'?{...c,section:{...c.section,planeOffset:-.3}}:c)};
 expect(dirtyDescendants(p,q).patches.has(p.patches![0].id)).toBe(true);expect(baseEvaluator(q,q.patches![0])(.25,.5)).not.toEqual(baseEvaluator(p,p.patches![0])(.25,.5));expect(deleteClosure(p,[`curve:${A}`]).patches).toHaveLength(0);
});

test('paired Sections use canonical final surface mirror, float Fullness and stable JSON',()=>{
 let p=fixture();const ids:string[]=[];for(const offset of [.2,.7]){const r=duplicateRing(p,'05500000-0000-4000-8000-000000000004');p=r.project;ids.push(r.selectedId);p={...p,curves:p.curves.map(c=>c.id===r.selectedId&&isSection(c)&&c.role==='canonical'?{...c,section:{...c.section,planeOffset:offset}}:c)};}
 p=add(p,ids[0],ids[1]);expect(p.patches).toHaveLength(2);p={...p,patches:p.patches!.map(x=>x.canonicalId?x:{...x,fullness:.1735})};const [a,b]=p.patches!,f=evaluator(p,a),g=evaluator(p,b);
 for(const [u,v] of [[0,.4],[.143,.3],[.777,.8],[1,1]])expect(g(u,v)).toEqual(mirrorPoint(p,f(u,v)));
 expect(parseLandmarks(JSON.stringify(p)).patches).toEqual(p.patches);expect(deleteClosure(p,[`curve:${ids[0]}`]).patches).toHaveLength(0);
});
test('open/same curves rejected; serialized malformed closed loop rejected',()=>{
 const p=fixture();expect(()=>closedBoundary(p,'05500000-0000-4000-8000-000000000007')).toThrow('闭合');expect(()=>add(p,A,A)).toThrow('不同');
 const q=add(p,A,B);expect(()=>parseLandmarks(JSON.stringify({...q,patches:[{...q.patches![0],boundaryUses:[q.patches![0].boundaryUses[0]]}]}))).toThrow();
});
test('periodic derivative matches numerical differentiation and rigid section rotation follows',()=>{
 const p=add(fixture(),A,B),x=p.patches![0],d=baseDifferential(p,x),f=baseEvaluator(p,x),h=1e-6;
 for(const u of [.12,.37,.71]){const a=d(u,.4);expect(dist(a.dv,f(u,.4+h).map((v,k)=>(v-f(u,.4-h)[k])/(2*h)))).toBeLessThan(1e-7);expect(dist(a.du,f(u+h,.4).map((v,k)=>(v-f(u-h,.4)[k])/(2*h)))).toBeLessThan(1e-7);}
});

test('Contour consumes final periodic triangles, not internal seam edges',async()=>{
 const {silhouette}=await import('../domain/contour/silhouette');const p=add(fixture(),A,B),m=tessellate(p,p.patches![0],24);
 const mesh={vertices:m.vertices,triangles:m.triangles.map((t,i)=>({indices:t as [number,number,number],patchId:'loop',triangleId:i}))};
 const result=silhouette(mesh,[0,0,0,1],192);expect(result.paths).toHaveLength(1);expect(result.coveredPixels).toBeGreaterThan(1000);
});
