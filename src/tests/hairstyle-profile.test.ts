import {describe,it,expect} from 'vitest';
import {defaultHairNet,defaultHairstyle,parseHairstyle,type Vec3} from '../domain/hairstyle/model';
import {defaultHairProfile,hairRadiusSquared,hairShellField,hairWorld,hairLocal,parseHairProfile,PROFILE_LIMITS} from '../domain/hairstyle/profile';
import {generateHair,hairSection,hairSurfacePoint} from '../domain/hairstyle/geometry';
import {profileHair,syncStrands,editHairDrawing,independentHair} from '../domain/hairstyle/strands';
import {connect,duplicateLayer} from '../domain/drawing/commands';
import {locateHairEndpoint,projectedHairControl,inferHairAngle,dragHairControl} from '../domain/hairstyle/inverse';
import {useEditor} from '../app/store';
import {createEmptyProject} from '../app/emptyProject';
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
const net=()=>({...defaultHairNet(),profile:defaultHairProfile()});
const extremeProfiles=()=>[defaultHairProfile(),...Array.from({length:16},(_,i)=>Object.fromEntries([['version',1],...Object.entries(PROFILE_LIMITS).map(([k,r],j)=>[k,r[(i>>j)&1]])]) as ReturnType<typeof defaultHairProfile>)];
describe('editable domed hair shell',()=>{
 it('has fuller upper shoulders, remains convex across editor limits and maps attachments invertibly',()=>{
  const n=net();expect(hairRadiusSquared(n,.65)).toBeGreaterThan(hairRadiusSquared(n,-.65));
  for(const profile of extremeProfiles()){
   const n={...net(),profile};let previous=Infinity,last=0;
   for(let i=1;i<=256;i++){const r=Math.sqrt(hairRadiusSquared(n,-1+2*i/256)),slope=r-last;expect(slope).toBeLessThanOrEqual(previous+1e-5);previous=slope;last=r;}
   for(const xy of [[0,.8],[.6,.3],[-.5,-.4],[.01,.99]]){const p=hairSurfacePoint(...xy as [number,number]),w=hairWorld(n,p);expect(Math.abs(hairShellField(n,w))).toBeLessThan(1e-9);expect(distance(hairLocal(n,w),p)).toBeLessThan(1e-9);}
  }
 });
 it('keeps actual section samples on both the new shell and the rotated plane, including 90 degrees',()=>{
  for(const profile of [defaultHairProfile(),extremeProfiles()[16]])for(const angle of [-90,-45,0,45,90]){
   const n={...net(),profile,center:[.1,.2,-.3] as Vec3,radiusX:1.4,radiusY:.8,radiusZ:1.1},a=hairSurfacePoint(.03,.8),b=hairSurfacePoint(.12,-.35),s=hairSection(n,a,b,angle);
   expect(s.cubics).toHaveLength(1);expect(s.cubic[0]).toEqual(hairWorld(n,a));expect(s.cubic[3]).toEqual(hairWorld(n,b));expect(s.cubic.flat().every(Number.isFinite)).toBe(true);
   for(const p of s.points){expect(Math.abs(hairShellField(n,p))).toBeLessThan(1e-6);expect(p.reduce((sum,v,i)=>sum+s.normal[i]*(v-n.center[i]),0)).toBeCloseTo(s.planeOffset,8);}
   if(Math.abs(angle)===90){const near=hairSection(n,a,b,angle-Math.sign(angle)*.0001);expect(Math.max(...s.cubic.flat().map((v,i)=>Math.abs(v-near.cubic.flat()[i])))).toBeLessThan(.001);}
  }
 });
 it('retains endpoint inverse editing on the shaped shell, including ambiguous depth and unreachable positions',()=>{
  const n={...net(),center:[.1,.2,-.3] as Vec3,radiusX:1.3,radiusY:.8,radiusZ:1.1};
  for(const view of [{yaw:0,pitch:0},{yaw:45,pitch:30},{yaw:90,pitch:-20},{yaw:-80,pitch:45},{yaw:180,pitch:0}])for(const xy of [[.1,.75],[-.5,-.2],[.7,.2]]){
   const p=hairSurfacePoint(...xy as [number,number]),target=projectedHairControl(hairWorld(n,p),view),q=locateHairEndpoint(n,view,target,p);
   expect(distance(p,q)).toBeLessThan(1e-5);
   const outside:[number,number]=[3,2],edge=locateHairEndpoint(n,view,outside,p);expect(edge.every(Number.isFinite)).toBe(true);expect(edge[2]).toBeGreaterThan(.099);expect(distance(projectedHairControl(hairWorld(n,edge),view),outside)).toBeLessThanOrEqual(distance(target,outside)+1e-8);
  }
 });
 it('still fits both handles using the section angle and a single projected cubic',()=>{
  const n=net(),a=hairSurfacePoint(0,.8),b=hairSurfacePoint(.05,-.3);
  for(const mode of ['SECTION','FRONT'] as const)for(const view of [{yaw:0,pitch:0},{yaw:45,pitch:25}])for(const control of [1,2] as const){
   const wanted=-35,target=projectedHairControl(hairSection(n,a,b,wanted,mode).cubic[control],view),angle=inferHairAngle(n,a,b,25,mode,view,control,target);
   expect(distance(projectedHairControl(hairSection(n,a,b,angle,mode).cubic[control],view),target)).toBeLessThan(.003);
  }
 });
 it('changes the common shell without changing strand identity, randomness, bindings, layers or intervals',()=>{
  let old=independentHair(defaultHairstyle());const [a,b]=old.strandSet!.curves;
  old=editHairDrawing(old,connect(old.drawing,{curveId:a.id,end:0},{curveId:b.id,end:0},'POSITION'));
  const before=JSON.stringify(old),h=profileHair(old),g=generateHair(h);
  expect(h.strandSet).toEqual(old.strandSet);expect(h.drawing.layers).toEqual(old.drawing.layers);expect(h.drawing.joins).toEqual(old.drawing.joins);expect(h.drawing.displayIntervals).toEqual(old.drawing.displayIntervals);expect(JSON.stringify(old)).toBe(before);
  expect(g.strands![0].cubic[0]).toEqual(g.strands![1].cubic[0]);expect(profileHair(h)).toBe(h);
  expect(parseHairstyle(JSON.parse(JSON.stringify(h)))).toEqual(h);
  const ellipse=syncStrands({...h,net:{...h.net,profile:null}});expect(profileHair(ellipse)).toBe(ellipse);expect(generateHair(ellipse).strands!.map(s=>s.cubic)).toEqual(generateHair(old).strands!.map(s=>s.cubic));
  const copy=editHairDrawing(h,duplicateLayer(h.drawing,h.drawing.layers[0].id));expect(copy.strandSet!.curves).toHaveLength(h.strandSet!.curves.length*2);
  const p=hairSurfacePoint(.18,.65),moved=dragHairControl(h,a.id,{yaw:0,pitch:0},0,projectedHairControl(hairWorld(h.net,p),{yaw:0,pitch:0}));expect(moved.strandSet!.endpoints.find(e=>e.id===a.nodes[0])!.x.value).toBeCloseTo(.18,6);
 });
 it('validates profile files and groups shape edits into one undo without touching the main drawing',()=>{
  for(const [key,range] of Object.entries(PROFILE_LIMITS))for(const value of [range[0]-.01,range[1]+.01,NaN])expect(()=>parseHairProfile({...defaultHairProfile(),[key]:value})).toThrow();expect(parseHairProfile(null)).toBe(null);
  const h=profileHair(defaultHairstyle()),project={...createEmptyProject(),hairstyle:h,drawing:structuredClone(h.drawing)};useEditor.setState({project,past:[],future:[]});useEditor.getState().beginEdit();
  for(const shoulder of [.3,.4,.5])useEditor.getState().setHairstyle(syncStrands({...h,net:{...h.net,profile:{...h.net.profile!,shoulder}}}));useEditor.getState().endEdit();expect(useEditor.getState().past).toHaveLength(1);expect(useEditor.getState().project.drawing).toBe(project.drawing);useEditor.getState().undo();expect(useEditor.getState().project.hairstyle).toEqual(h);
 });
});
