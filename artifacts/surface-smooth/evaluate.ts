import {readFileSync,writeFileSync} from 'node:fs';
import {parseLandmarks} from '../../src/domain/landmarks/persistence';
import {addPatch} from '../../src/domain/patches/model';
import {solveSmooth} from '../../src/domain/smooth/solver';
import {smoothFixture} from '../../src/tests/smooth-fixture';
import {installSmoothResult} from '../../src/domain/smooth/evaluation';
import {evaluator,fullnessEvaluator} from '../../src/domain/patches/geometry';
import {buildLattice} from '../../src/domain/smooth/lattice';
const base=parseLandmarks(readFileSync('artifacts/basic-patch/adjusted-source.json','utf8'));
let p=base;
for(const names of [
 ['左面壳前边界·颧颊至下颊','左颊部体积线·颧颊至颊峰','左颊部体积线·颊峰至下颊'],
 ['左面壳前边界·颧颊至下颊','左斜面带横向桥·颧颊层','左面壳后边界·颧弓至下颌角','左斜面带横向桥·下颊层'],
 ['左面壳前边界·额颞至颧颊','左斜面带横向桥·额颞层','左面壳后边界·颞侧至颧弓','左斜面带横向桥·颧颊层']
])p=addPatch(p,names.map(n=>base.curves.find(c=>c.name===n)!.id));
p={...p,version:'landmarks-0.4.2',surfaceSmooth:{enabled:true,strength:1,edgeInfluenceOverrides:{}}};
const cases={shearedPlane:smoothFixture(0,.9),crease:smoothFixture(.65),realCheek:p};
const data=Object.fromEntries(Object.entries(cases).map(([name,p])=>{const start=performance.now(),result=solveSmooth(p);return[name,{milliseconds:performance.now()-start,error:result.error??null,...result.diagnostics}];}));
writeFileSync('artifacts/surface-smooth/diagnostics.json',JSON.stringify(data,null,2));
writeFileSync('artifacts/surface-smooth/cheek-validation.json',JSON.stringify({...p,views:p.views.map(({reference,...view})=>view)},null,2));
// Cross-sections through a real crease fixture. Exact base plus the evaluated field;
// no artistic smoothing is applied to these polylines.
const fixture=cases.crease,result=solveSmooth(fixture);installSmoothResult(fixture,result);const graph=buildLattice(fixture);
let paths='';
for(const patch of fixture.patches!){const chart=graph.charts.get(patch.id)!,e=chart.ring.findIndex(x=>x.id==='seam');
 for(const smooth of [false,true]){const f=smooth?evaluator(fixture,patch):fullnessEvaluator(fixture,patch),points=[];
 for(let i=0;i<=240;i++){const s=i/240,[u,v]=[[.5,s],[1-s,.5],[.5,1-s],[s,.5]][e],q=f(u,v);points.push([350+q[0]*280,270-(q[2]-1)*280]);}
 paths+=`<polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${smooth?'#087d6c':'#b7bdc7'}" stroke-width="${smooth?3:5}"/>`;
 }
}
writeFileSync('artifacts/surface-smooth/crease-section.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="700" height="330" viewBox="0 0 700 330"><rect width="700" height="330" fill="white"/><text x="30" y="32" font-family="sans-serif" font-size="18">Cross-seam section: gray = source, green = Smooth</text>${paths}<text x="30" y="315" font-family="sans-serif" font-size="14">Source nodes fixed. Approximate continuity on a fixed 12-subdivision lattice.</text></svg>`);
