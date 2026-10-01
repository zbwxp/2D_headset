import {describe,it,expect} from 'vitest';
import {defaultHairNet,defaultHairstyle,parseHairstyle,type Vec3} from '../domain/hairstyle/model';
import {defaultPumpkinProfile,defaultHairProfile,hairProfileCubics,hairRadiusSquared,hairShellField,hairWorld,hairLocal,parseHairProfile,pumpkinSurface,PUMPKIN_LIMITS} from '../domain/hairstyle/profile';
import {generateHair,hairSection,hairSurfacePoint} from '../domain/hairstyle/geometry';
import {profileHair,syncStrands} from '../domain/hairstyle/strands';
import {locateHairEndpoint,projectedHairControl,inferHairAngle} from '../domain/hairstyle/inverse';
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
const net=()=>({...defaultHairNet(),profile:defaultPumpkinProfile()});
const extremes=()=>[defaultPumpkinProfile(),...Array.from({length:2**Object.keys(PUMPKIN_LIMITS).length},(_,i)=>Object.fromEntries([['version',2],...Object.entries(PUMPKIN_LIMITS).map(([k,r],j)=>[k,r[(i>>j)&1]])]) as ReturnType<typeof defaultPumpkinProfile>)];
describe('pumpkin hair shell',()=>{
 it('has tucked lower sides and a planar base with higher forehead and lower nape, across parameter limits',()=>{
  const n=net();expect(hairRadiusSquared(n,.35)).toBeGreaterThan(hairRadiusSquared(n,-.35));
  for(const profile of extremes()){
   const n={...net(),profile};
   for(let y=-1.19;y<1;y+=.025){const radius=hairRadiusSquared(n,y);expect(Number.isFinite(radius)).toBe(true);expect(radius).toBeGreaterThan(0);expect(radius).toBeLessThanOrEqual(profile.width**2+1e-6);}
   for(const c of hairProfileCubics(profile))for(let i=0;i<=100;i++){
    const t=i/100,u=1-t,dy=3*u*u*(c[1][1]-c[0][1])+6*u*t*(c[2][1]-c[1][1])+3*t*t*(c[3][1]-c[2][1]);expect(dy).toBeLessThanOrEqual(1e-9);
   }
   for(let i=0;i<16;i++){
    const az=i*Math.PI/8,p=pumpkinSurface(n,az,1);
    expect(p.every(Number.isFinite)).toBe(true);
    expect(p[1]-n.center[1]).toBeCloseTo(profile.baseHeight*n.radiusY+Math.tan(profile.baseTilt*Math.PI/180)*(p[2]-n.center[2]),7);
    expect(Math.abs(hairShellField(n,p))).toBeLessThan(1e-7);
   }
   expect(pumpkinSurface(n,0,1)[1]).toBeGreaterThanOrEqual(pumpkinSurface(n,Math.PI,1)[1]-1e-8);
  }
 });
 it('keeps the angle in world space and the attachment chart invertible under XYZ scaling',()=>{
  const n={...net(),radiusX:.7,radiusY:.5,radiusZ:2,center:[.2,-.1,.3] as Vec3};
  for(let az=-Math.PI;az<=Math.PI;az+=.2){const p=pumpkinSurface(n,az,1);expect(p[1]-n.center[1]).toBeCloseTo(n.profile.baseHeight*n.radiusY+Math.tan(n.profile.baseTilt*Math.PI/180)*(p[2]-n.center[2]),7);}
  for(const xy of [[0,.8],[.6,.3],[-.5,-.4],[.01,.99],[0,-.98]]){
   const p=hairSurfacePoint(...xy as [number,number]),w=hairWorld(n,p);expect(Math.abs(hairShellField(n,w))).toBeLessThan(1e-8);expect(distance(hairLocal(n,w),p)).toBeLessThan(1e-8);
  }
 });
 it('builds a closed full shell, with a matching planar base and stable geometry cache',()=>{
  const h=profileHair(defaultHairstyle()),g=generateHair(h);expect(h.net.profile?.version).toBe(2);expect(g.base).toBeDefined();expect(g.rim).toHaveLength(65);
  expect(g.shell.vertices.some(p=>p[2]<h.net.center[2])).toBe(true);
  for(const mesh of [g.shell,g.base!])expect(mesh.vertices.flat().every(Number.isFinite)).toBe(true);
  for(const p of g.rim!)expect(g.base!.vertices).toContain(p);
  expect(generateHair({...h})).toBe(g);
  const next=syncStrands({...h,net:{...h.net,profile:{...defaultPumpkinProfile(),baseTilt:5}}}),other=generateHair(next);
  expect(other.shell).not.toBe(g.shell);expect(other.strands![0].cubic).not.toEqual(g.strands![0].cubic);
  expect(next.strandSet).toBe(h.strandSet);expect(next.drawing.displayIntervals).toEqual(h.drawing.displayIntervals);
 });
 it('samples section curves on the actual shell and section plane, including tucked and bottom crossings',()=>{
  for(const profile of [defaultPumpkinProfile(),...extremes().filter((_,i)=>i%17===0)])for(const xy of [[.12,-.35],[-.5,-.8],[.1,.7]])for(const angle of [-90,-60,-20,0,20,60,90]){
   const n={...net(),profile,center:[.1,.2,-.3] as Vec3,radiusX:1.4,radiusY:.8,radiusZ:1.1},a=hairSurfacePoint(.03,.8),b=hairSurfacePoint(...xy as [number,number]),s=hairSection(n,a,b,angle);
   expect(s.cubics).toHaveLength(1);expect(s.cubic[0]).toEqual(hairWorld(n,a));expect(s.cubic[3]).toEqual(hairWorld(n,b));expect(s.cubic.flat().every(Number.isFinite)).toBe(true);
   for(const p of s.points){expect(Math.abs(hairShellField(n,p)),JSON.stringify({profile,xy,angle,p})).toBeLessThan(2e-6);expect(p.reduce((sum,v,i)=>sum+s.normal[i]*(v-n.center[i]),0)).toBeCloseTo(s.planeOffset,7);}
  }
 });
 it('inverse-drags endpoints on the curved side, retaining the nearest branch at different views',()=>{
  const n={...net(),center:[.1,.2,-.3] as Vec3,radiusX:1.3,radiusY:.8,radiusZ:1.1};
  for(const view of [{yaw:0,pitch:0},{yaw:45,pitch:30},{yaw:90,pitch:-20},{yaw:-80,pitch:45},{yaw:180,pitch:0}])for(const xy of [[.1,.75],[-.5,-.2],[.7,.2]]){
   const p=hairSurfacePoint(...xy as [number,number]),previous=hairSurfacePoint(p[0]+.006,p[1]+.002),target=projectedHairControl(hairWorld(n,p),view),q=locateHairEndpoint(n,view,target,previous);
   expect(distance(projectedHairControl(hairWorld(n,q),view),target)).toBeLessThan(1e-5);expect(distance(p,q)).toBeLessThan(1e-4);
   const outside:[number,number]=[3,2],edge=locateHairEndpoint(n,view,outside,p);expect(edge.every(Number.isFinite)).toBe(true);expect(edge[2]).toBeGreaterThan(.099);expect(distance(projectedHairControl(hairWorld(n,edge),view),outside)).toBeLessThanOrEqual(distance(target,outside)+1e-8);
  }
 });
 it('still uses both Bézier handles as angle references',()=>{
  const n=net(),a=hairSurfacePoint(0,.8),b=hairSurfacePoint(.05,-.3);
  for(const mode of ['SECTION','FRONT'] as const)for(const view of [{yaw:0,pitch:0},{yaw:45,pitch:25}])for(const control of [1,2] as const){
   const target=projectedHairControl(hairSection(n,a,b,-35,mode).cubic[control],view),angle=inferHairAngle(n,a,b,25,mode,view,control,target);
   expect(distance(projectedHairControl(hairSection(n,a,b,angle,mode).cubic[control],view),target)).toBeLessThan(.01);
  }
 });
 it('migrates old shell settings once, validates parameters and preserves identity/randomness on save',()=>{
  const old=profileHair(defaultHairstyle()),v1={...old,net:{...old.net,profile:{...defaultHairProfile(),width:1.3}}},h=profileHair(v1);
  expect(h.net.profile).toMatchObject({version:2,width:1.3});expect(h.strandSet).toBe(old.strandSet);expect(profileHair(h)).toBe(h);
  expect(parseHairstyle(JSON.parse(JSON.stringify(h)))).toEqual(h);
  for(const [key,range] of Object.entries(PUMPKIN_LIMITS))for(const value of [range[0]-.01,range[1]+.01,NaN])expect(()=>parseHairProfile({...defaultPumpkinProfile(),[key]:value})).toThrow();
  expect(parseHairProfile(defaultHairProfile())?.version).toBe(1);
 });
 it('preserves the old shape exactly when the saved onset is absent or equals its shoulder',()=>{
  const {insetStart:_,...old}=defaultPumpkinProfile();
  for(const shoulder of [0,.22,.6]){
   const legacy={...net(),profile:{...old,shoulder}},explicit={...net(),profile:{...old,shoulder,insetStart:shoulder}};
   for(let y=-1.19;y<1;y+=.013)expect(hairRadiusSquared(explicit,y)).toBe(hairRadiusSquared(legacy,y));
   expect(parseHairProfile(legacy.profile)).toEqual(legacy.profile);
  }
 });
 it('moves the inward influence higher without altering the crown above it or the lower closure',()=>{
  const normal=net(),earlier={...normal,profile:{...normal.profile,insetStart:.75}},later={...normal,profile:{...normal.profile,insetStart:-.3}};
  for(const y of [.8,.9,.95])expect(hairRadiusSquared(earlier,y)).toBeCloseTo(hairRadiusSquared(normal,y),10);
  for(const y of [.6,.45,.2,0,-.4])expect(hairRadiusSquared(earlier,y)).toBeLessThan(hairRadiusSquared(later,y));
  expect(hairRadiusSquared(later,0)).toBeCloseTo(normal.profile.width**2,8);
  for(const y of [-1.15,-1.1,-1.0])expect(hairRadiusSquared(earlier,y)).toBe(hairRadiusSquared(normal,y));
  const h=profileHair(defaultHairstyle()),updated=syncStrands({...h,net:{...h.net,profile:earlier.profile}});
  expect(updated.strandSet).toBe(h.strandSet);expect(updated.drawing.displayIntervals).toEqual(h.drawing.displayIntervals);
  expect(parseHairstyle(JSON.parse(JSON.stringify(updated))).net.profile).toEqual(earlier.profile);
 });
 it('joins the new onset and the old lower closure without a tangent crease',()=>{
  for(const insetStart of [-.5,.1,.6,.85]){
   const n={...net(),profile:{...defaultPumpkinProfile(),insetStart}},r=(y:number)=>Math.sqrt(hairRadiusSquared(n,y));
   for(const y of [insetStart,-.98]){
    // Extrapolate away ordinary curvature; a genuine tangent jump survives
    // this limit. Steps exceed the radius table's spacing to avoid a false pass.
    const jump=(h:number)=>(r(y+h)-2*r(y)+r(y-h))/h;
    expect(Math.abs(2*jump(.003)-jump(.006)),JSON.stringify({insetStart,y})).toBeLessThan(.01);
   }
  }
 });
});
