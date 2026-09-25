import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {spanFixture} from './span-fixture';
import {createCurve,deleteCurve} from '../domain/curves/management';
import {addOnCurvePoint,setOnCurveS} from '../domain/landmarks/placement';
import {deleteLandmark,duplicateLandmark} from '../domain/landmarks/management';
import {mirror} from '../domain/landmarks/model';
import {controls,followEndpoints} from '../domain/curves/geometry';
import {evaluationContext,pointPosition} from '../domain/geometry/evaluation';
import {evaluate,derivative,arcLengthLUT} from '../domain/geometry/bezier';
import {boundaryControls,canonicalBoundary,boundaryParameters,wholeBoundary,boundaryKey,mirrorBoundary,eligibleAnchors} from '../domain/patches/boundary';
import {loop,addPatch,parsePatches} from '../domain/patches/model';
import {baseEvaluator,fullnessEvaluator} from '../domain/patches/base';
import {tessellate} from '../domain/patches/geometry';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {dependencyGraph,dirtyDescendants} from '../domain/geometry/dependencies';
import {patchInputKey,surfaceInputKey} from '../domain/geometry/revisions';
import {diagnostics} from '../domain/geometry/diagnostics';
import {surfaceAdjacency} from '../domain/smooth/model';
import {buildLattice} from '../domain/smooth/lattice';
import {solveSmooth} from '../domain/smooth/solver';
import {solveKey} from '../domain/smooth/evaluation';

const patchFixture=()=>{const f=spanFixture();return {...f,p:addPatch(f.p,[f.bc,f.use,f.ac])};};
const close=(a:number[],b:number[],eps=1e-10)=>a.forEach((v,i)=>expect(Math.abs(v-b[i])).toBeLessThan(eps));
it('whole uses return original CP, exact interval/reversal and derivatives',()=>{
 const f=spanFixture(),ctx=evaluationContext(f.p),cp=ctx.curveControls(f.host);expect(boundaryControls(f.p,wholeBoundary(f.p,f.host))).toBe(cp);
 const sub=boundaryControls(f.p,f.use),{t0,t1}=boundaryParameters(f.p,f.use),rev={...f.use,startLandmarkId:f.b,endLandmarkId:f.a};expect(boundaryControls(f.p,rev)).toEqual([...sub].reverse());
 for(let i=0;i<=20;i++){const u=i/20;close(evaluate(sub,u),evaluate(cp,t0+(t1-t0)*u));close(derivative(sub,u),derivative(cp,t0+(t1-t0)*u).map(x=>x*(t1-t0)));}
 close(sub[0],pointPosition(f.p,f.a));close(sub[3],pointPosition(f.p,f.b));
});
it('tri mixed closure is UUID based, no hidden curves and boundary exact at fullness extremes',()=>{
 const f=patchFixture(),p=f.p,patch=p.patches![0],ring=loop(p,patch.boundaryUses);expect(p.curves).toHaveLength(6);expect(p.patches).toHaveLength(2);
 for(const fullness of [-1,0,1]){const q={...p,patches:p.patches!.map(x=>x.id===patch.id?{...x,fullness}:x)},evalP=fullnessEvaluator(q,q.patches![0]);
 for(let i=0;i<=12;i++){const t=i/12;close(evalP(t,0),evaluate(boundaryControls(p,ring[0].use),t));close(evalP(1-t,t),evaluate(boundaryControls(p,ring[1].use),t));close(evalP(0,1-t),evaluate(boundaryControls(p,ring[2].use),t));}}
 expect(()=>addPatch(p,[f.use,f.ac,f.bc])).toThrow(/已有/);
 expect(()=>boundaryControls(p,{...f.use,endLandmarkId:f.c})).toThrow(/不属于/);
});
it('intermediate unreferenced locator does not split, dirty, change surface cache or cascade patch',()=>{
 const f=patchFixture(),r=addOnCurvePoint(f.p,f.host),p=r.project,key=surfaceInputKey(p),curves=p.curves,meshes=p.patches!.map(x=>tessellate(p,x,6));
 const q=setOnCurveS(p,r.selectedId,.6);expect(dirtyDescendants(p,q).patches.size).toBe(0);expect(surfaceInputKey(q)).toBe(key);expect(q.curves).toBe(curves);q.patches!.forEach((x,i)=>expect(tessellate(q,x,6)).toBe(meshes[i]));expect(deleteLandmark(q,r.selectedId).patches).toEqual(p.patches);
});
it('direct anchor→Patch dependency in a valid quad with two uses of one host; no incident curve',()=>{
 const f=spanFixture();let p=f.p;const r=addOnCurvePoint(p,f.host);p=r.project;const host=p.curves.find(c=>c.id===f.host)!;
 const ac=createCurve(p,host.startLandmarkId!,f.c,p.views[0],'host start-C');p=ac.project;const bc=createCurve(p,host.endLandmarkId!,f.c,p.views[0],'host end-C');p=bc.project;
 p=addPatch(p,[{curveId:f.host,startLandmarkId:host.startLandmarkId!,endLandmarkId:r.selectedId},{curveId:f.host,startLandmarkId:r.selectedId,endLandmarkId:host.endLandmarkId!},ac.selectedId,bc.selectedId]);
 expect(p.curves.some(c=>c.startLandmarkId ===r.selectedId||c.endLandmarkId ===r.selectedId)).toBe(false);
 const patch=p.patches![0],graph=dependencyGraph(p);expect(graph.dependencies.get(`patch:${patch.id}`)).toContain(`point:${r.selectedId}`);
 const before=patchInputKey(p,patch),mesh=tessellate(p,patch,6);expect(mesh.invalid).toBeUndefined();diagnostics.reset();
 const q=setOnCurveS(p,r.selectedId,.6);expect(dirtyDescendants(p,q).patches.size).toBe(2);expect(dirtyDescendants(p,q).curves.size).toBe(0);expect(patchInputKey(q,q.patches![0])).not.toBe(before);expect(tessellate(q,q.patches![0],6)).not.toBe(mesh);expect(diagnostics.snapshot().counters.arcLengthLUTBuilds??0).toBe(0);
 const deleted=deleteLandmark(q,r.selectedId);expect(deleted.patches).toEqual([]);expect(deleted.curves).toEqual(q.curves);
});
it('anchor crossing keeps topology, collision persists INVALID and recovers',()=>{
 const f=patchFixture(),patch=f.p.patches![0],topology=JSON.stringify(patch.boundaryUses);
 const collided=followEndpoints(f.p,setOnCurveS(f.p,f.a,.8));expect(tessellate(collided,patch,6).invalid).toMatch(/退化/);const loaded=parseLandmarks(JSON.stringify(collided));expect(loaded.patches).toEqual(collided.patches);
 const crossed=followEndpoints(collided,setOnCurveS(collided,f.a,.9));expect(tessellate(crossed,patch,6).invalid).toBeUndefined();expect(JSON.stringify(patch.boundaryUses)).toBe(topology);close(boundaryControls(crossed,f.use)[0],pointPosition(crossed,f.a));
});
it('mirror maps actual anchors and canonical final fullness geometry, not independent side shapes',()=>{
 const f=patchFixture(),p={...f.p,patches:f.p.patches!.map(x=>!x.canonicalId?{...x,fullness:.7}:x)},a=p.patches[0],b=p.patches[1];
 expect(b.boundaryUses).toEqual(a.boundaryUses.map(u=>mirrorBoundary(p,u)));for(const u of a.boundaryUses){const m=mirrorBoundary(p,u);boundaryControls(p,m).forEach((q,i)=>close(q,mirror(boundaryControls(p,u)[i])));}
 const fa=fullnessEvaluator(p,a),fb=fullnessEvaluator(p,b);for(const [u,v] of [[0,0],[.2,.3],[.4,.1]])expect(fb(u,v)).toEqual(mirror(fa(u,v)));
 const candidateIds=eligibleAnchors(p,f.host).map(l=>l.id);expect(candidateIds).toContain(f.a);expect(candidateIds).not.toContain(p.landmarks.find(l=>l.id===f.a)!.mirrorPartnerId);
});
it('same span reverse is same seam; different/overlapping intervals are not welded',()=>{
 const f=patchFixture(),rev={...f.use,startLandmarkId:f.b,endLandmarkId:f.a};expect(boundaryKey(f.p,f.use)).toBe(boundaryKey(f.p,rev));
 const r=addOnCurvePoint(f.p,f.host),other={...f.use,endLandmarkId:r.selectedId};expect(boundaryKey(r.project,other)).not.toBe(boundaryKey(r.project,f.use));
 const p={...r.project,patches:[{...r.project.patches![0],id:'one',boundaryUses:[f.use]},{...r.project.patches![0],id:'two',boundaryUses:[rev,other]}]};const adj=surfaceAdjacency(p);expect(adj.get(boundaryKey(p,f.use))).toEqual(['one','two']);expect(adj.get(boundaryKey(p,other))).toEqual(['two']);
});
it('two real patches sharing a reversed span solve and mirror lattice maps every sample',()=>{
 const f=patchFixture();let p=f.p;const d=p.landmarks.find(l=>l.name==='右嘴角点')!.id;
 const a=createCurve(p,f.a,d,p.views[0],'A-D');p=a.project;const b=createCurve(p,f.b,d,p.views[0],'B-D');p=b.project;p=addPatch(p,[a.selectedId,b.selectedId,{...f.use,startLandmarkId:f.b,endLandmarkId:f.a}]);
 const key=boundaryKey(p,f.use),lattice=buildLattice(p);expect(lattice.adjacency.get(key)).toHaveLength(2);expect(lattice.byKey.has('E:'+key+':1')).toBe(true);const result=solveSmooth(p);expect(result.error).toBeUndefined();expect(result.diagnostics.seamSamples).toBeGreaterThan(0);expect(result.diagnostics.after).toBeLessThanOrEqual(result.diagnostics.before+1e-10);
});
it('delete used anchor/host cascades pairs, duplicate never rewires, save contains references only',()=>{
 const f=patchFixture(),p=f.p;expect(deleteLandmark(p,f.a).patches).toEqual([]);expect(deleteCurve(p,f.host).patches).toEqual([]);
 const copy=duplicateLandmark(p,f.a,'副本');expect(copy.project.patches).toEqual(p.patches);expect(copy.selectedId).not.toBe(f.a);expect(deleteLandmark(copy.project,copy.selectedId).patches).toEqual(p.patches);
 const loaded=parseLandmarks(JSON.stringify(p));expect(loaded.patches).toEqual(p.patches);for(const x of loaded.patches!)for(const b of x.boundaryUses)expect(Object.keys(b).sort()).toEqual(['curveId','endLandmarkId','startLandmarkId']);
 expect(JSON.stringify(loaded.patches)).not.toContain('boundaryEdgeIds');
});
it('legacy whole patch migration preserves deterministic loop, Fullness, Smooth and mesh',()=>{
 const p=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));const ns=['左面壳前边界·颧颊至下颊','左颊部体积线·颧颊至颊峰','左颊部体积线·颊峰至下颊'];
 const q=addPatch(p,ns.map(n=>p.curves.find(c=>c.name===n)!.id));q.patches![0].fullness=.6;
 const legacy=q.patches!.map(({boundaryUses,...x})=>({...x,boundaryEdgeIds:boundaryUses.map(b=>b.curveId).reverse()}));const migrated={...q,patches:parsePatches(legacy,q)};
 for(let i=0;i<q.patches!.length;i++){const a=q.patches![i],b=migrated.patches[i];expect(loop(q,a.boundaryUses).map(r=>[r.id,r.reverse,r.vertex])).toEqual(loop(migrated,b.boundaryUses).map(r=>[r.id,r.reverse,r.vertex]));for(const uv of [[.1,.2],[.3,.4]])expect(baseEvaluator(q,a)(...uv as [number,number])).toEqual(baseEvaluator(migrated,b)(...uv as [number,number]));expect(tessellate(q,a,12)).toEqual(tessellate(migrated,b,12));}
 expect(solveSmooth(migrated)).toEqual(solveSmooth(q));
});
it('shared authoring state: span/whole, Esc, undo/redo and locator slider session',async()=>{
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});const {useEditor}=await import('../app/store'),f=spanFixture(),s=()=>useEditor.getState();s().load(f.p);s().startPatch();s().setPatchMode('span');s().pickPatchEdge(f.host);s().pickPatchAnchor(f.a);s().hoverPatchAnchor(f.b);expect(s().patchCreation?.hover).toBe(f.b);s().undoToolStep();s().undoToolStep();expect(s().patchCreation?.host).toBeUndefined();expect(s().patchCreation).not.toBeNull();s().pickPatchEdge(f.host);s().pickPatchAnchor(f.a);s().pickPatchAnchor(f.b);s().setPatchMode('whole');s().pickPatchEdge(f.ac);const n=s().past.length;s().pickPatchEdge(f.bc);expect(s().project.patches).toHaveLength(2);expect(s().past.length).toBe(n+1);expect(s().patchCreation?.uses).toEqual([]);s().cancelPatch();s().undo();expect(s().project.patches??[]).toHaveLength(0);s().redo();const before=s().project;s().beginEdit();for(const x of [.25,.3,.4])s().setOnCurveS(f.a,x);s().endEdit();expect(solveKey(s().project)).not.toBe(solveKey(before));s().undo();expect(s().project).toEqual(before);
});

it('Fullness scale uses actual span lengths and preserves first-order boundary behavior',()=>{
 const f=patchFixture(),p={...f.p,patches:f.p.patches!.map(x=>x.canonicalId?x:{...x,fullness:.8})},patch=p.patches[0],base=baseEvaluator(p,patch),full=fullnessEvaluator(p,patch);
 const lengths=patch.boundaryUses.map(b=>arcLengthLUT(boundaryControls(p,canonicalBoundary(p,b))).at(-1)!).sort((a,b)=>a-b),a=base(1/3,1/3),b=full(1/3,1/3);
 expect(Math.hypot(...b.map((v,i)=>v-a[i]))).toBeCloseTo(.8*.15*lengths[1],12);
 const h=1e-7,near=full(.35,h),original=base(.35,h);expect(Math.hypot(...near.map((v,i)=>v-original[i]))/h).toBeLessThan(1e-5);
});
it('partially overlapping real span patches render but have no welded seam',()=>{
 const f=patchFixture();let p=f.p;const a=addOnCurvePoint(p,f.host);p=setOnCurveS(a.project,a.selectedId,.5);const b=addOnCurvePoint(p,f.host);p=setOnCurveS(b.project,b.selectedId,.95);const d=p.landmarks.find(l=>l.name==='右嘴角点')!.id;
 const ac=createCurve(p,a.selectedId,d,p.views[0],'C-D');p=ac.project;const bc=createCurve(p,b.selectedId,d,p.views[0],'E-D');p=bc.project;p=addPatch(p,[ac.selectedId,bc.selectedId,{curveId:f.host,startLandmarkId:a.selectedId,endLandmarkId:b.selectedId}]);
 const result=solveSmooth(p);expect(result.error).toBeUndefined();expect(result.diagnostics.seamSamples).toBe(0);expect(result.diagnostics.warnings.some(w=>w.includes('重叠区间'))).toBe(true);for(const patch of p.patches!)expect(tessellate(p,patch,6).invalid).toBeUndefined();
});
