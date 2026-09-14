import {world} from './world-fixture';
import {it,expect} from 'vitest';
import {solveSmooth} from '../domain/smooth/solver';
import {buildLattice} from '../domain/smooth/lattice';
import {displacement} from '../domain/smooth/field';
import {smoothFixture} from './smooth-fixture';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {readFileSync} from 'node:fs';
import {addPatch} from '../domain/patches/model';
it('same plane with parameter shear has zero seam residual and zero correction',()=>{
 for(const shear of [0,.35,.9]){const p=smoothFixture(0,shear),r=solveSmooth(p);
 expect(r.error).toBeUndefined();expect(r.diagnostics.before).toBeLessThan(1e-12);expect(r.diagnostics.maxDisplacement).toBeLessThan(1e-10);
 }
});
it('real crease residual decreases, source unchanged and anchors/open edges fixed',()=>{
 const p=smoothFixture(.65),before=JSON.stringify(p),r=solveSmooth(p);
 expect(r.error).toBeUndefined();expect(r.diagnostics.before).toBeGreaterThan(.5);
 expect(r.diagnostics.after).toBeLessThan(r.diagnostics.before*.15);expect(r.diagnostics.maxDisplacement).toBeGreaterThan(.001);
 expect(JSON.stringify(p)).toBe(before);
 const g=buildLattice(p);
 for(const chart of g.charts.values())for(let j=0;j<chart.ids.length;j++)for(let i=0;i<chart.ids[j].length;i++){
 if(g.nodes[chart.ids[j][i]].fixed)expect(r.fields[chart.id].values[j][i]).toEqual([0,0,0]);
 }
 expect(displacement(r.fields.pa,.5,.5)).toEqual([0,0,0]);
});
it('influence zero truly fixes seam, and no-seam solution is zero',()=>{
 const p=smoothFixture(.6);p.surfaceSmooth!.edgeInfluenceOverrides.seam=0;const r=solveSmooth(p);
 expect(r.error).toBeUndefined();expect(r.diagnostics.maxDisplacement).toBe(0);
});
it('deterministic shared Tri/Quad and mirrored real fixture solves without source mutation',()=>{
 const base=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));
 const tri=['左面壳前边界·颧颊至下颊','左颊部体积线·颧颊至颊峰','左颊部体积线·颊峰至下颊'];
 const quad=['左面壳前边界·颧颊至下颊','左斜面带横向桥·颧颊层','左面壳后边界·颧弓至下颌角','左斜面带横向桥·下颊层'];
 let p=addPatch(base,tri.map(n=>base.curves.find(c=>c.name===n)!.id));p=addPatch(p,quad.map(n=>base.curves.find(c=>c.name===n)!.id));
 const r=solveSmooth(p);expect(r.error).toBeUndefined();expect(r.diagnostics.seamSamples).toBe(22);
 expect(r.diagnostics.after).toBeLessThan(r.diagnostics.before);
 expect(solveSmooth(p)).toEqual(r);
});

import {installSmoothResult,getSmoothResult,solveKey} from '../domain/smooth/evaluation';
import {evaluator,fullnessEvaluator,tessellate} from '../domain/patches/geometry';
import {contourSource} from '../domain/contour/source';
import {latticeWeights} from '../domain/smooth/field';
import {parseSmooth,defaultSmooth} from '../domain/smooth/model';
it('OFF and strength zero are exact base even after solve; strength reuses the full solution',()=>{
 const p=smoothFixture(.6),r=solveSmooth(p);installSmoothResult(p,r);
 const half={...p,surfaceSmooth:{...p.surfaceSmooth!,strength:.5}},zero={...p,surfaceSmooth:{...p.surfaceSmooth!,strength:0}},off={...p,surfaceSmooth:{...p.surfaceSmooth!,enabled:false}};
 expect(solveKey(half)).toBe(solveKey(p));expect(getSmoothResult(half)).toBe(r);
 for(const patch of p.patches!)for(const [u,v] of [[.1,.3],[.5,.5],[1,.5],[0,.5]]){
 const base=fullnessEvaluator(p,patch)(u,v),full=evaluator(p,patch)(u,v);
 expect(evaluator(zero,patch)(u,v)).toEqual(base);expect(evaluator(off,patch)(u,v)).toEqual(base);
 const h=evaluator(half,patch)(u,v);h.forEach((x,i)=>expect(x).toBeCloseTo((full[i]+base[i])/2,12));
 }
});
it('shared seam remains welded at arbitrary t and hard edge preserves source with other seams active',()=>{
 const p=smoothFixture(.6),r=solveSmooth(p);installSmoothResult(p,r);const g=buildLattice(p);
 const charts=[...g.charts.values()];
 const edgeUV=(c:typeof charts[number],t:number)=>{
 const e=c.ring.findIndex(x=>x.id==='seam'),q=c.ring[e].reverse?1-t:t;return [[q,0],[1,q],[1-q,1],[0,1-q]][e];
 };
 for(const t of [.035,.2,.413,.77,.95]){
 const a=edgeUV(charts[0],t),b=edgeUV(charts[1],t),x=evaluator(p,p.patches![0])(...a as [number,number]),y=evaluator(p,p.patches![1])(...b as [number,number]);
 expect(Math.hypot(...x.map((v,i)=>v-y[i]))).toBeLessThan(1e-12);
 }
});
it('all display/contour sampling consumes one field and failures fallback atomically',()=>{
 const p=smoothFixture(.6),r=solveSmooth(p);installSmoothResult(p,r);
 const f=evaluator(p,p.patches![0]),point=f(.133,.233);
 for(const n of [4,6,12,24]){tessellate(p,p.patches![0],n);expect(evaluator(p,p.patches![0])(.133,.233)).toEqual(point);}
 const c=contourSource({...p,smoothResult:r});expect(c.mesh.vertices).not.toEqual(contourSource({...p,surfaceSmooth:{...p.surfaceSmooth!,enabled:false}}).mesh.vertices);
 installSmoothResult(p,{...r,fields:{},error:'test failure'});
 expect(evaluator(p,p.patches![0])(.133,.233)).toEqual(fullnessEvaluator(p,p.patches![0])(.133,.233));
});
it('central Fullness stays unchanged outside band',()=>{
 const p=smoothFixture(.6);p.patches![0].fullness=.8;
 const r=solveSmooth(p);expect(r.error).toBeUndefined();installSmoothResult(p,r);
 expect(evaluator(p,p.patches![0])(.5,.5)).toEqual(fullnessEvaluator(p,p.patches![0])(.5,.5));
});
it('displacement interpolation is linear along every Tri edge',()=>{
 const values=Array.from({length:13},(_,j)=>Array.from({length:13-j},(_,i)=>[i/12,j/12,0] as [number,number,number]));
 for(const [u,v] of [[.133,0],[0,.74],[.27,.73],[.11,.43]]){const q=displacement({type:'tri',n:12,values},u,v);expect(q[0]).toBeCloseTo(u,12);expect(q[1]).toBeCloseTo(v,12);expect(latticeWeights('tri',12,u,v).reduce((s,w)=>s+w.weight,0)).toBeCloseTo(1,12);}
});
it('corrupted topology falls back; isolated bad tangent samples warn instead of failing',()=>{
 const p=smoothFixture(.6);const c=p.curves.find(c=>c.id==='seam')!;if(c.role!=='canonical')throw Error('fixture');
 c.shape.startHandle.along=1;c.shape.endHandle.along=1;
 const r=solveSmooth(p);expect(r.error).toBeUndefined();expect(r.diagnostics.warnings.some(x=>x.includes('退化'))).toBe(true);
 const broken={...p,curves:p.curves.filter(c=>c.id!=='seam')};expect(solveSmooth(broken).error).toBeTruthy();
});
it('non-manifold edge warns and stays fixed',()=>{
 const p=smoothFixture(.6);p.patches!.push({...p.patches![1],id:'duplicate'});const r=solveSmooth(p);expect(r.error).toBeUndefined();expect(r.diagnostics.warnings.some(x=>x.includes('Non-manifold'))).toBe(true);const g=buildLattice(p);
 for(const c of g.charts.values())for(let j=0;j<c.ids.length;j++)for(let i=0;i<c.ids[j].length;i++)if(g.nodes[c.ids[j][i]].key.startsWith('E:seam:')){expect(g.nodes[c.ids[j][i]].fixed).toBe(true);expect(r.fields[c.id].values[j][i]).toEqual([0,0,0]);}
});
it('settings validate, old defaults OFF, stale deleted overrides repaired',()=>{
 const p=smoothFixture(.3);
 expect(parseSmooth(undefined,p)).toEqual(defaultSmooth);
 expect(parseSmooth({enabled:true,strength:.4,edgeInfluenceOverrides:{seam:.2,deleted:.5}},p)).toEqual({enabled:true,strength:.4,edgeInfluenceOverrides:{seam:.2}});
 expect(()=>parseSmooth({enabled:true,strength:2,edgeInfluenceOverrides:{}},p)).toThrow();
});
it('real mirror surfaces share canonical correction exactly; source edits invalidate solve identity',()=>{
 const base=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));
 let p=base;
 for(const names of [
 ['左面壳前边界·颧颊至下颊','左颊部体积线·颧颊至颊峰','左颊部体积线·颊峰至下颊'],
 ['左面壳前边界·颧颊至下颊','左斜面带横向桥·颧颊层','左面壳后边界·颧弓至下颌角','左斜面带横向桥·下颊层'],
 ['左面壳前边界·额颞至颧颊','左斜面带横向桥·额颞层','左面壳后边界·颞侧至颧弓','左斜面带横向桥·颧颊层']
 ])p=addPatch(p,names.map(n=>base.curves.find(c=>c.name===n)!.id));
 p={...p,surfaceSmooth:{...defaultSmooth,enabled:true}};
 const seam=p.curves.find(c=>c.name==='左面壳前边界·颧颊至下颊')!;const owner=seam.role==='mirror'?seam.canonicalCurveId:seam.id;
 p.surfaceSmooth!.edgeInfluenceOverrides={[owner]:0};
 const r=solveSmooth(p);expect(r.error).toBeUndefined();expect(r.diagnostics.maxDisplacement).toBeGreaterThan(0);installSmoothResult(p,r);
 for(const patch of p.patches!)if(patch.canonicalId){
 const a=evaluator(p,p.patches!.find(c=>c.id===patch.canonicalId)!),b=evaluator(p,patch);
 for(const [u,v] of [[.23,.11],[.61,.32],[0,.41],[.17,0]]){const q=a(u,v);expect(b(u,v)).toEqual([-q[0],q[1],q[2]]);}
 }
 const g=buildLattice(p);
 for(const chart of g.charts.values())if(r.fields[chart.id])for(let j=0;j<chart.ids.length;j++)for(let i=0;i<chart.ids[j].length;i++){
 const node=g.nodes[chart.ids[j][i]];if(node.key.startsWith('E:'+seam.id+':'))expect(r.fields[chart.id].values[j][i]).toEqual([0,0,0]);
 }
 for(const edit of [
 {...p,landmarks:p.landmarks.map((l)=>l.id!==seam.startLandmarkId?l:{...l,placement: {kind:'WORLD' as const,position:[world(l).position[0],world(l).position[1]+.01,world(l).position[2]] as [number,number,number]}})},
 {...p,curves:p.curves.map(c=>c.role==='canonical'?{...c,shape:{...c.shape,startHandle:{...c.shape.startHandle,offset:c.shape.startHandle.offset+.01}}}:c)},
 {...p,patches:p.patches!.map(c=>c.canonicalId?c:{...c,fullness:.2})}
 ])expect(solveKey(edit)).not.toBe(solveKey(p));
 expect(parseLandmarks(JSON.stringify(p)).surfaceSmooth).toEqual(p.surfaceSmooth);
});
it('normalized solve is scale-independent',()=>{
 const p=smoothFixture(.6),r=solveSmooth(p);
 for(const scale of [.01,10]){
 const scaled={...p,landmarks:p.landmarks.map(l=>({...l,placement: {kind:'WORLD' as const,position:world(l).position.map(x=>x*scale) as [number,number,number]}}))},s=solveSmooth(scaled);
 expect(s.error).toBeUndefined();expect(s.diagnostics.after).toBeCloseTo(r.diagnostics.after,9);
 for(const id in r.fields)r.fields[id].values.forEach((row,j)=>row.forEach((v,i)=>v.forEach((x,k)=>expect(s.fields[id].values[j][i][k]/scale).toBeCloseTo(x,9))));
 }
});
it('self-symmetric quad has hard reflected variables including centerplane samples',()=>{
 const p=smoothFixture();p.landmarks=[];p.curves=[];p.patches=[];
 const positions:Record<string,[number,number,number]>={b:[0,0,1],t:[0,1,1],l:[-1,.5,1],r:[1,.5,1],o:[-1,1.5,2],q:[1,1.5,2]};
 const partner:Record<string,string>={l:'r',r:'l',o:'q',q:'o',b:'b',t:'t'};
 for(const [id,position] of Object.entries(positions))p.landmarks.push({id,name:id,placement: {kind:'WORLD' as const,position:position},type:['t','b'].includes(id)?'CENTERLINE':id==='l'||id==='o'?'LEFT':'RIGHT',...(['t','b'].includes(id)?{}:{mirrorPartnerId:partner[id]}),viewLocks:{}});
 for(const [id,a,b] of [['tl','t','l'],['lb','l','b'],['lo','l','o'],['ot','o','t']]){
 p.curves.push({id,name:id,startLandmarkId:a,endLandmarkId:b,role:'canonical',mirrorPartnerCurveId:id+'m',shape:{planeNormal:[0,0,1],startHandle:{along:1/3,offset:0},endHandle:{along:1/3,offset:0}}});
 p.curves.push({id:id+'m',name:id+'m',role:'mirror',canonicalCurveId:id,mirrorPartnerCurveId:id,startLandmarkId:partner[a],endLandmarkId:partner[b]});
 }
 const withQuad=addPatch(p,['tl','lb','lbm','tlm']),all=addPatch(withQuad,['tl','lo','ot']);
 const r=solveSmooth(all);expect(r.error).toBeUndefined();expect(r.diagnostics.maxDisplacement).toBeGreaterThan(.001);installSmoothResult(all,r);
 const g=buildLattice(all),patch=all.patches![0],chart=g.charts.get(patch.id)!;
 for(let j=0;j<=12;j++)for(let i=0;i<=12;i++){
 const n=g.nodes[chart.ids[j][i]],m=g.nodes[g.byKey.get(n.mirror!)!];
 expect(n.indices).toEqual(m.indices);
 if(n.key===n.mirror)expect(n.indices[0]).toBe(-1);
 }
 const f=evaluator(all,patch),permutation=chart.ring.map(x=>chart.ring.findIndex(y=>y.vertex===partner[x.vertex]));
 for(const [u,v] of [[.13,.22],[.1,.7],[.5,.5]]){
 const w=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v],a=w[permutation[1]]+w[permutation[2]],b=w[permutation[2]]+w[permutation[3]],x=f(u,v),y=f(a,b);
 expect(y[0]).toBeCloseTo(-x[0],12);expect(y[1]).toBeCloseTo(x[1],12);expect(y[2]).toBeCloseTo(x[2],12);
 }
});
it('30-patch user head converges beyond the old 1000 iteration cap without source changes',()=>{
 const p=parseLandmarks(readFileSync('artifacts/surface-smooth/full-head-regression.json','utf8')),before=JSON.stringify(p),r=solveSmooth(p);
 expect(p.patches).toHaveLength(30);expect(r.error).toBeUndefined();expect(r.diagnostics.variables).toBe(3892);
 expect(r.diagnostics.iterations).toBeGreaterThan(1000);expect(r.diagnostics.relativeResidual).toBeLessThan(1e-8);
 expect(r.diagnostics.after).toBeLessThan(r.diagnostics.before*.01);expect(JSON.stringify(p)).toBe(before);
});
