import {describe,it,expect} from 'vitest';
import {defaultHairstyle,parseHairstyle,type Hairstyle} from '../domain/hairstyle/model';
import {profileHair,addStrand,editHairDrawing,syncStrands} from '../domain/hairstyle/strands';
import {generateHair,hairCubicPoint} from '../domain/hairstyle/geometry';
import {dragHairControl,projectedHairControl} from '../domain/hairstyle/inverse';
import {hairShellField,hairWorld} from '../domain/hairstyle/profile';
import {projectHairDrawing} from '../domain/hairstyle/drawing';
import {hairSketchProjector} from '../domain/hairstyle/surfaceCurve';
import {hairEndpointPosition} from '../domain/hairstyle/strandTypes';
import {duplicateLayer} from '../domain/drawing/commands';
import type {Point2} from '../domain/drawing/model';
const front={yaw:0,pitch:0},distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
const setup=()=>{const h=profileHair(defaultHairstyle());return syncStrands({...h,bang:{...h.bang!,mode:'SECTION'}});};
describe('current-view 2D hair editing projected onto the shell',()=>{
 it('places either handle exactly in the editing view, without moving the other three controls',()=>{
  const h=setup(),g=generateHair(h),a=g.strands![0];
  for(const view of [front,{yaw:35,pitch:15},{yaw:-35,pitch:-10},{yaw:180,pitch:0}])for(const control of [1,2] as const){
   const expected=a.cubic.map(p=>projectedHairControl(p,view));expected[control]=[expected[control][0]+.015,expected[control][1]-.015];
   const next=dragHairControl(h,a.id,view,control,expected[control]),result=generateHair(next).strands![0];
   result.cubic.forEach((p,i)=>expect(distance(projectedHairControl(p,view),expected[i])).toBeLessThan(1e-8));
   expect(next.strandSet!.curves[0].surface!.view).toEqual(view);
   expect(result.projectionMisses).toEqual([]);
   for(const p of result.points)expect(Math.abs(hairShellField(next.net,p))).toBeLessThan(1e-7);
   expect(result.cubics).toHaveLength(1);
   expect(next.drawing.displayIntervals).toEqual(h.drawing.displayIntervals);
   expect(next.drawing.layers).toEqual(h.drawing.layers);
   expect(generateHair(next).strands![1]).toBe(g.strands![1]);
  }
 });
 it('releases the section plane, then freezes the 3D result while orbiting',()=>{
  const h=setup(),a=generateHair(h).strands![0],p=projectedHairControl(a.cubic[1],front),n=dragHairControl(h,a.id,front,1,[p[0]+.05,p[1]-.08]),g=generateHair(n),s=g.strands![0];
  const maxFromOldPlane=Math.max(...s.points.map(p=>Math.abs(p.reduce((v,x,i)=>v+a.normal[i]*(x-n.net.center[i]),0)-a.planeOffset)));
  expect(maxFromOldPlane).toBeGreaterThan(.01);
  const before=JSON.stringify(n);
  for(const view of [{yaw:90,pitch:0},{yaw:-25,pitch:45},{yaw:180,pitch:0},front]){
   projectHairDrawing(n,g,view);expect(generateHair(n)).toBe(g);expect(JSON.stringify(n)).toBe(before);
  }
  expect(parseHairstyle(JSON.parse(before))).toEqual(n);
 });
 it('rebases another-view edit from the current curve without accumulating camera-dependent deformation',()=>{
  let h=setup();const id=h.strandSet!.curves[0].id;
  for(const [view,control] of [[front,1],[{yaw:40,pitch:10},2],[front,1]] as const){
   const before=generateHair(h).strands![0],q=projectedHairControl(before.cubic[control],view),target:Point2=[q[0]+.01,q[1]-.01];
   const next=dragHairControl(h,id,view,control,target),after=generateHair(next).strands![0];
   for(const i of [0,1,2,3])expect(distance(projectedHairControl(after.cubic[i],view),i===control?target:projectedHairControl(before.cubic[i],view))).toBeLessThan(1e-8);
   h=next;
  }
 });
 it('moves a surface endpoint and its neighboring handle in 2D, keeping the remote controls fixed',()=>{
  const h=setup(),a=generateHair(h).strands![0],view={yaw:25,pitch:10},before=a.cubic.map(p=>projectedHairControl(p,view)),target:Point2=[before[3][0]+.01,before[3][1]+.01];
  const n=dragHairControl(h,a.id,view,3,target),after=generateHair(n).strands![0].cubic.map(p=>projectedHairControl(p,view));
  for(const i of [0,1])expect(distance(after[i],before[i])).toBeLessThan(1e-7);
  for(const i of [2,3])expect(distance(after[i],[before[i][0]+.01,before[i][1]+.01])).toBeLessThan(1e-7);
 });
 it('preserves free handles through duplication, reload and new-strand creation',()=>{
  const h=setup(),a=generateHair(h).strands![0],p=projectedHairControl(a.cubic[1],front),n=dragHairControl(h,a.id,front,1,[p[0]+.01,p[1]-.01]);
  const clone=addStrand(n,n.drawing.layers[0].id,a.id);
  expect(clone.strandSet!.curves.at(-1)!.surface).toEqual(n.strandSet!.curves[0].surface);
  const duplicated=editHairDrawing(n,duplicateLayer(n.drawing,n.drawing.layers[0].id));
  expect(duplicated.strandSet!.curves.filter(c=>c.surface)).toHaveLength(2);
  expect(parseHairstyle(JSON.parse(JSON.stringify(duplicated)))).toEqual(duplicated);
  expect(addStrand(h,h.drawing.layers[0].id).strandSet!.curves.at(-1)!.surface).toBeDefined();
 });
 it('reports an unreachable sketch instead of silently fitting a different shape',()=>{
  const h=setup(),before=JSON.stringify(h),id=h.strandSet!.curves[0].id;
  expect(()=>dragHairControl(h,id,front,1,[10,10])).toThrow('发网投影范围');
  expect(()=>dragHairControl(h,id,front,3,[10,10])).toThrow('没有可投影');
  expect(JSON.stringify(h)).toBe(before);
  const invalid=structuredClone(h) as Hairstyle;invalid.strandSet!.curves[0].surface={version:1,view:front,handles:[[NaN,0],[0,0]],depths:[0,0,0,0]};
  expect(()=>parseHairstyle(invalid)).toThrow();
 });
 it('retains a back-side attachment and ray branch across serialization',()=>{
  const h=setup(),e=h.strandSet!.endpoints[0],back={...e,side:-1 as const},p=hairWorld(h.net,hairEndpointPosition(back)),view={yaw:180,pitch:0},xy=projectedHairControl(p,view);
  const projected=hairSketchProjector(h.net,view)(xy,-p[2]);
  expect(projected).not.toBeNull();expect(distance(projected!,p)).toBeLessThan(1e-7);
  const n=syncStrands({...h,strandSet:{...h.strandSet!,endpoints:h.strandSet!.endpoints.map(x=>x.id===e.id?back:x)}});
  expect(parseHairstyle(JSON.parse(JSON.stringify(n))).strandSet!.endpoints[0].side).toBe(-1);
 });
});
