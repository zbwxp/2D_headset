import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {addPatch,loop} from '../domain/patches/model';
import {evaluator,baseEvaluator,tessellate} from '../domain/patches/geometry';
import {baseDifferential,bubble,FULLNESS_SCALE} from '../domain/patches/fullness';
import {mirror} from '../domain/landmarks/model';
import {controls} from '../domain/curves/geometry';
import {arcLengthLUT} from '../domain/geometry/bezier';
const names={
tri:['左面壳前边界·颧颊至下颊','左颊部体积线·颧颊至颊峰','左颊部体积线·颊峰至下颊'],
quad:['左面壳前边界·额颞至颧颊','左斜面带横向桥·额颞层','左面壳后边界·颞侧至颧弓','左斜面带横向桥·颧颊层'],
self:['左颅壳前侧弧·颅顶至额颞','右颅壳前侧弧·颅顶至额颞','左面壳额部横向基准','右面壳额部横向基准']};
const fixture=(type:keyof typeof names,value=0)=>{
 const source=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));
 const p=addPatch(source,names[type].map(n=>source.curves.find(c=>c.name===n)!.id));
 return {...p,patches:p.patches!.map((x,i)=>i===0?{...x,fullness:value}:x)};
};
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((x,i)=>x-b[i]));
for(const type of ['tri','quad','self'] as const){
 it(type+' zero exact no-op, analytic differential agrees with base',()=>{
 const p=fixture(type),patch=p.patches[0],base=baseEvaluator(p,patch),f=evaluator(p,patch),d=baseDifferential(p,patch);
 for(const [u,v] of [[.15,.2],[.3,.4],[.5,.2]]){
 expect(f(u,v)).toEqual(base(u,v));expect(distance(d(u,v).position,base(u,v))).toBeLessThan(1e-12);
 const h=1e-6;
 for(const axis of [0,1]){const a=base(u+(axis===0?h:0),v+(axis===1?h:0)),b=base(u-(axis===0?h:0),v-(axis===1?h:0));
 expect(distance(axis===0?d(u,v).du:d(u,v).dv,a.map((x,i)=>(x-b[i])/(2*h)))).toBeLessThan(1e-8);}
 }
 });
 it(type+' outward scale, inward reversal, exact boundary and first derivatives',()=>{
 const p=fixture(type,1),patch=p.patches[0],f=evaluator(p,patch),base=baseEvaluator(p,patch),q=fixture(type,-1),g=evaluator(q,q.patches[0]);
 const uv=patch.type==='tri'?[1/3,1/3]:[.5,.5],b=base(uv[0],uv[1]),a=f(uv[0],uv[1]);
 expect(a.reduce((sum,x,i)=>sum+(x-b[i])*b[i],0)).toBeGreaterThan(0);
 const lengths=patch.boundaryEdgeIds.map(id=>arcLengthLUT(controls(p,p.curves.find(c=>c.id===id)!)).at(-1)!).sort((a,b)=>a-b);
 const median=lengths.length===3?lengths[1]:(lengths[1]+lengths[2])/2;
 expect(distance(a,b)).toBeCloseTo(median*FULLNESS_SCALE,10);
 expect(distance(g(uv[0],uv[1]),b.map((x,i)=>2*x-a[i]))).toBeLessThan(1e-12);
 const edges=patch.type==='tri'?[[.3,0],[0,.3],[.3,.7]]:[[.3,0],[0,.3],[1,.3],[.3,1]];
 for(const [u,v] of edges){
 expect(f(u,v)).toEqual(base(u,v));
 const h=1e-6, iu=u+(uv[0]-u)*h,iv=v+(uv[1]-v)*h;
 expect(distance(f(iu,iv),base(iu,iv))/h).toBeLessThan(1e-4);
 }
 expect(tessellate(p,patch,6).invalid).toBeUndefined();
 });
 it(type+' persistence and source immutability across quality levels',()=>{
 const p=fixture(type,.6),snapshot=JSON.stringify(p),patch=p.patches[0],f=evaluator(p,patch);
 for(const n of [4,6,12,24]){tessellate(p,patch,n);expect(evaluator(p,patch)).toBe(f);}
 expect(JSON.stringify(p)).toBe(snapshot);
 const loaded=parseLandmarks(JSON.stringify({...p,version:'landmarks-0.4.1'}));
 expect(loaded.patches).toEqual(p.patches);
 expect(loaded.landmarks).toEqual(p.landmarks);expect(loaded.curves).toEqual(p.curves);
 });
}
it('mirror is exact final world geometry, self symmetry retained',()=>{
 const p=fixture('quad',.8),f=evaluator(p,p.patches[0]),g=evaluator(p,p.patches[1]);
 expect(p.patches[1].fullness).toBeUndefined();
 for(const [u,v] of [[.2,.4],[.5,.5],[.8,.6]])expect(g(u,v)).toEqual(mirror(f(u,v)));
 const q=fixture('self',.8),patch=q.patches[0],h=evaluator(q,patch),ring=loop(q,patch.boundaryEdgeIds);
 const perm=ring.map(r=>{const l=q.landmarks.find(l=>l.id===r.vertex)!;return ring.findIndex(s=>s.vertex===(l.mirrorPartnerId??l.id));});
 for(const [u,v] of [[.2,.4],[.7,.5]]){const w=[(1-u)*(1-v),u*(1-v),u*v,(1-u)*v],m=perm.map(i=>w[i]);expect(distance(h(u,v),mirror(h(m[1]+m[2],m[2]+m[3])))).toBeLessThan(1e-10);}
});
it('source movement recomputes fullness and invalid geometry recovers',()=>{
 const p=fixture('tri',.8),patch=p.patches[0],vertex=loop(p,patch.boundaryEdgeIds)[0].vertex;
 const q={...p,landmarks:p.landmarks.map(l=>l.id===vertex?{...l,position:[l.position[0],l.position[1],l.position[2]+.1] as [number,number,number]}:l)};
 expect(evaluator(q,patch)(.3,.3)).not.toEqual(evaluator(p,patch)(.3,.3));
 const flat={...p,landmarks:p.landmarks.map(l=>({...l,position:[0,0,0] as [number,number,number]}))};
 expect(tessellate(flat,patch).invalid).toBeTruthy();expect(flat.patches).toEqual(p.patches);
 expect(tessellate(p,patch).invalid).toBeUndefined();
});
it('validates fullness state and old files default to zero',()=>{
 const p=fixture('quad',.4);
 for(const value of [2,-2,'oops'])expect(()=>parseLandmarks(JSON.stringify({...p,patches:p.patches.map((x,i)=>i?x:{...x,fullness:value})}))).toThrow();
 expect(()=>parseLandmarks(JSON.stringify({...p,patches:p.patches.map(x=>({...x,fullness:.4}))}))).toThrow();
 const old={...p,patches:p.patches.map(({fullness,...x})=>x)},loaded=parseLandmarks(JSON.stringify(old));
 expect(evaluator(loaded,loaded.patches![0])(.3,.4)).toEqual(baseEvaluator(loaded,loaded.patches![0])(.3,.4));
});
it('squared bubbles have zero boundary values and gradients',()=>{
 for(const type of ['tri','quad'] as const){expect(bubble(type,.3,0)).toBe(0);expect(bubble(type,0,.4)).toBe(0);expect(bubble(type,.3,1e-7)/1e-7).toBeLessThan(1e-5);}
});
it('Fullness is invariant under uniform source scaling',()=>{
 const p=fixture('quad',.75),patch=p.patches[0],f=evaluator(p,patch);
 for(const k of [.01,10,100]){
 const q={...p,landmarks:p.landmarks.map(l=>({...l,position:l.position.map(x=>x*k) as [number,number,number]}))};
 expect(distance(evaluator(q,patch)(.3,.4),f(.3,.4).map(x=>x*k))).toBeLessThan(1e-9*k);
 }
});
it('curvature and plane edits reevaluate Base plus Fullness',()=>{
 const p=fixture('quad',.7),patch=p.patches[0],id=patch.boundaryEdgeIds[0],edge=p.curves.find(c=>c.id===id)!;
 if(edge.role!=='canonical')throw Error('fixture');
 const q={...p,curves:p.curves.map(c=>c.id===id?{...edge,shape:{...edge.shape,startHandle:{...edge.shape.startHandle,offset:.25}}}:c)};
 expect(evaluator(q,patch)(.4,.4)).not.toEqual(evaluator(p,patch)(.4,.4));
});
it('ambiguous radial outward retains source and zero remains exact',()=>{
 const p=fixture('quad',.8);
 const flat={...p,landmarks:p.landmarks.map(l=>({...l,position:[l.position[0],l.position[1],0] as [number,number,number]})),
 curves:p.curves.map(c=>c.role==='canonical'?{...c,shape:{planeNormal:[0,0,1] as [number,number,number],startHandle:{along:1/3,offset:0},endHandle:{along:1/3,offset:0}}}:c)};
 expect(tessellate(flat,flat.patches[0]).invalid).toContain('Head Origin');
 const zero={...flat,patches:flat.patches.map((x,i)=>i?x:{...x,fullness:0})};
 expect(evaluator(zero,zero.patches[0])(.3,.3)).toEqual(baseEvaluator(zero,zero.patches[0])(.3,.3));
 expect(tessellate(p,p.patches[0]).invalid).toBeUndefined();
});
