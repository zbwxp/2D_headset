import {it,expect} from 'vitest';
import {writeFileSync,readFileSync} from 'node:fs';
import {defaultHairstyle,type Hairstyle,type HairNet,type Vec3} from '../domain/hairstyle/model';
import {profileHair,syncStrands} from '../domain/hairstyle/strands';
import {generateHair,hairSection,hairCubicPoint} from '../domain/hairstyle/geometry';
import {projectHairDrawing} from '../domain/hairstyle/drawing';
import {dragHairControl,projectedHairControl} from '../domain/hairstyle/inverse';

function fixture(count:number,mode:'SECTION'|'FRONT'):Hairstyle {
 const h=profileHair(defaultHairstyle()),rule=h.strandSet!.curves[0],curve=h.drawing.curves[0],root=h.strandSet!.endpoints[0];
 const ids=Array.from({length:count},(_,i)=>'strand-'+i);
 const endpoints=ids.flatMap((id,i)=>[0,1].map(end=>({...root,id:id+':'+end,x:{value:(i-count/2)*.005,random:[0,0] as [number,number]},y:{value:end?-.3:.8,random:[0,0] as [number,number]},sample:[.5,.5] as [number,number]})));
 return syncStrands({...h,bang:{...h.bang!,mode},strandSet:{version:1,endpoints,curves:ids.map((id,i)=>({...rule,id,nodes:[id+':0',id+':1'],angle:-60+i*120/count}))},drawing:{...h.drawing,joins:[],displayIntervals:[],curves:ids.map(id=>({...curve,id,nodes:[id+':0',id+':1']})),nodes:endpoints.map(e=>({id:e.id,position:[0,0]})),layers:[{...h.drawing.layers[0],items:ids}]}});
}

// Opt-in CPU benchmark, same immutable pointer-down recipe as the real editor.
// Includes inverse edit, saved front refresh, UI geometry and current-view projection.
it.skipIf(!process.env.HAIR_BENCH)('measures hair drag CPU work (not browser FPS)',()=>{
 const report:unknown[]=[];
 for(const count of [4,32])for(const mode of ['SECTION','FRONT'] as const)for(const control of [1,3] as const){
  const h=fixture(count,mode),view={yaw:35,pitch:15},g=generateHair(h),p=projectedHairControl(g.strands![0].cubic[control],view),times:number[]=[];
  for(let i=0;i<25;i++){
   const start=performance.now(),next=dragHairControl(h,'strand-0',view,control,[p[0]+.003*(i+1),p[1]+.002*(i+1)]);
   const d=projectHairDrawing(next,generateHair(next),view);expect(d.curves).toHaveLength(count);
   times.push(performance.now()-start);
  }
  const sorted=times.slice(1).sort((a,b)=>a-b),row={count,mode,control:control===1?'handle':'endpoint',firstMs:times[0],medianMs:sorted[12],p95Ms:sorted[22]};report.push(row);
 }
 writeFileSync(`artifacts/hair-performance/${process.env.HAIR_BENCH}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
},120000);

it('reuses static geometry and unchanged strands, and invalidates edited inputs',()=>{
 const h=fixture(8,'FRONT'),g=generateHair(h),set=h.strandSet!,r=set.curves[0];
 expect(generateHair({...h,drawing:{...h.drawing}} as Hairstyle)).toBe(g);
 const angle=syncStrands({...h,strandSet:{...set,curves:set.curves.map(c=>c.id===r.id?{...c,angle:15}:c)}}),a=generateHair(angle);
 expect(a.shell).toBe(g.shell);expect(a.netLines).toBe(g.netLines);expect(a.strands![0]).not.toBe(g.strands![0]);
 expect(a.strands!.slice(1)).toEqual(g.strands!.slice(1));
 for(let i=1;i<8;i++){expect(a.strands![i]).toBe(g.strands![i]);expect(angle.drawing.curves[i]).toBe(h.drawing.curves[i]);}
 expect(angle.drawing.displayIntervals).toEqual(h.drawing.displayIntervals);
 expect(generateHair(structuredClone(angle))).toEqual(a);
 for(const next of [
  {...h,strandSet:{...set,endpoints:set.endpoints.map(e=>e.id===r.nodes[0]?{...e,y:{...e.y,value:.7}}:e)}},
  {...h,net:{...h.net,profile:{...h.net.profile!,shoulder:.4}}},
  {...h,bang:{...h.bang!,mode:'SECTION' as const}}
 ]){const changed=generateHair(next);expect(changed.strands![0].cubic).not.toEqual(g.strands![0].cubic);expect(changed).toEqual(generateHair(structuredClone(next)));}
 expect(generateHair(h)).toEqual(g); // Undo restores the same geometry after a mode switch.
});

it('keeps the reduced-sampling cubic close to the original high-precision fit',()=>{
 const cases=JSON.parse(readFileSync('src/tests/fixtures/hair-shell-fit-reference.json','utf8')) as {net:HairNet;root:Vec3;tip:Vec3;angle:number;cubic:[Vec3,Vec3,Vec3,Vec3]}[];
 let max=0;
 for(const c of cases){const fit=hairSection(c.net,c.root,c.tip,c.angle);for(let i=0;i<=100;i++){
  const a=hairCubicPoint(fit.cubic,i/100),b=hairCubicPoint(c.cubic,i/100);max=Math.max(max,Math.hypot(...a.map((v,k)=>v-b[k])));
 }}
 // Less than 1 px at a 1000 px radius, even across the extreme shell profiles.
 expect(max).toBeLessThan(.001);
 if(process.env.HAIR_BENCH)writeFileSync('artifacts/hair-performance/fit-error.json',JSON.stringify({maxWorldDeviation:max,cases:cases.length}));
});

it('does not let legacy ink ranges contaminate cached sections',()=>{
 const h=fixture(4,'SECTION'),g=generateHair(h),root=h.strandSet!.endpoints[0];
 const a:Vec3=[0,.8,.6],b:Vec3=[0,0,1],first=hairSection(h.net,a,b,30);first.inkRange=[.3,.7];
 expect(hairSection(h.net,a,b,30).inkRange).toEqual([0,1]);expect(root.sample).toEqual([.5,.5]);expect(generateHair(h)).toBe(g);
});
