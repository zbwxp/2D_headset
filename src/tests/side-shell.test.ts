import {test,expect} from 'vitest';
import {sideShellProfile,ensureScaffold,scaffoldPointRelative} from '../domain/head/scaffold';
import {helmetMesh} from '../domain/head/helmet';
import {createLandmarkProject} from '../domain/landmarks/presets';
import {migrateHeadFrame} from '../domain/head/frame';
import {parseLandmarks} from '../domain/landmarks/persistence';
const alphas=[0,.25,.5,.75,1];
test('convex profiles, monotonic roundness, exact boundary and tangent for full offset range',()=>{
 for(const c of [.1,.2,.3,.4,.75,.95])for(const a of alphas){
  const f=(r:number)=>sideShellProfile(c,a,r),h=1e-5,q=(1-c*c)/c;
  expect(f(1)).toBeCloseTo(c,12);expect(Math.abs((f(h)-f(0))/h)).toBeLessThan(1e-4);
  expect(Math.abs((3*f(1)-4*f(1-h)+f(1-2*h))/(2*h)+q)).toBeLessThan(1e-4);
  for(let i=1;i<100;i++){const r=i/100;expect((f(r+h)-2*f(r)+f(r-h))/(h*h)).toBeLessThan(1e-4);expect(f(r+h)-f(r-h)).toBeLessThanOrEqual(1e-12);}
  for(let i=0;i<=100;i++){const r=i/100,values=alphas.map(a=>sideShellProfile(c,a,r));expect(values.every(Number.isFinite)).toBe(true);for(let j=1;j<values.length;j++)expect(values[j]+1e-12).toBeGreaterThanOrEqual(values[j-1]);expect(values[4]).toBeCloseTo(Math.sqrt(1-(1-c*c)*r*r),12);}
 }
});
test('old convexity resets to new default; Height moves anchor but not surface mesh',()=>{
 const p=ensureScaffold(migrateHeadFrame(createLandmarkProject()));const legacy=ensureScaffold({...p,loomisScaffold:{...p.loomisScaffold!,version:1,convexity:.9,roundness:undefined} as any});expect(legacy.loomisScaffold!.roundness).toBe(.5);expect('convexity' in legacy.loomisScaffold!).toBe(false);
 expect(parseLandmarks(JSON.stringify(legacy)).loomisScaffold).toEqual(legacy.loomisScaffold);
 const next=ensureScaffold({...p,loomisScaffold:{...p.loomisScaffold!,apexHeight:.6}});expect(helmetMesh(next)).toBe(helmetMesh(p));expect(scaffoldPointRelative(next,'APEX_R')).not.toEqual(scaffoldPointRelative(p,'APEX_R'));
});
test('five-view contour matrix at extreme roundness values',async()=>{
 const {silhouette}=await import('../domain/contour/silhouette');const {writeFileSync}=await import('node:fs');let p=ensureScaffold(migrateHeadFrame(createLandmarkProject()));const parts:string[]=[];
 for(const [row,a] of [0,.25,.5,1].entries()){p={...p,loomisScaffold:{...p.loomisScaffold!,roundness:a}};for(const [col,angle] of [0,30,45,90,-90].entries()){const theta=angle*Math.PI/360,q:[number,number,number,number]=col===4?[Math.sin(theta),0,0,Math.cos(theta)]:[0,Math.sin(theta),0,Math.cos(theta)];const result=silhouette({vertices:helmetMesh(p).vertices,triangles:helmetMesh(p).triangles.map((indices,triangleId)=>({indices:indices as [number,number,number],patchId:'helmet',triangleId}))},q,768);expect(result.coveredPixels).toBeGreaterThan(0);expect(result.paths.flat(2).every(Number.isFinite)).toBe(true);parts.push(`<g transform="translate(${col*320},${row*335})"><text x="8" y="18">a=${a} ${col===4?'Top':angle+'°'}</text><g transform="translate(0,24) scale(.4)">${result.paths.map(path=>`<polyline points="${path.map(v=>v.join(',')).join(' ')}" fill="none" stroke="black" stroke-width="2"/>`).join('')}</g></g>`);}}
 writeFileSync('artifacts/scaffold/roundness.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1340"><rect width="1600" height="1340" fill="white"/>${parts.join('')}</svg>`);
});
