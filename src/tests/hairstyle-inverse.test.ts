import {describe,it,expect} from 'vitest';
import {defaultHairstyle,defaultHairNet,parseHairstyle,type Vec3} from '../domain/hairstyle/model';
import {hairSection,hairSurfacePoint,world,generateHair} from '../domain/hairstyle/geometry';
import {locateHairEndpoint,projectedHairControl,inferHairAngle,dragHairControl,hairControlEditable} from '../domain/hairstyle/inverse';
import {independentHair,syncStrands,editHairDrawing} from '../domain/hairstyle/strands';
import {connect} from '../domain/drawing/commands';
import {shapeOf} from '../domain/drawing/model';
import {useEditor} from '../app/store';
import {createEmptyProject} from '../app/emptyProject';
const distance=(a:number[],b:number[])=>Math.hypot(...a.map((v,i)=>v-b[i]));
const front={yaw:0,pitch:0};
describe('Bezier controls as inverse hair references',()=>{
 it('recovers surface positions in rotated views and retains ambiguous depth branches',()=>{
  const net={...defaultHairNet(),center:[.1,.2,-.3] as Vec3,radiusX:1.4,radiusY:.8,radiusZ:1.2};
  for(const view of [front,{yaw:45,pitch:30},{yaw:-75,pitch:-35},{yaw:180,pitch:20},{yaw:90,pitch:0}])for(const xy of [[.1,.75],[-.5,-.2],[.7,.2]]){
   const p=hairSurfacePoint(xy[0],xy[1]),target=projectedHairControl(world(net,p),view),q=locateHairEndpoint(net,view,target,p);
   expect(distance(p,q)).toBeLessThan(1e-7);
  }
  // At a side view, both ±X hit the same screen point: stay on the starting side.
  const view={yaw:90,pitch:0},p=hairSurfacePoint(.45,.2),other=hairSurfacePoint(-.45,.2),target=projectedHairControl(world(net,p),view);
  expect(locateHairEndpoint(net,view,target,p)[0]).toBeGreaterThan(0);
  expect(locateHairEndpoint(net,view,target,other)[0]).toBeLessThan(0);
 });
 it('clamps unreachable pointer positions to the nearest legal cap/silhouette without NaN',()=>{
  const n=defaultHairNet(),p=hairSurfacePoint(0,.8),edge=locateHairEndpoint(n,front,[5,3],p);
  expect(Math.hypot(edge[0],edge[1])).toBeCloseTo(.995,6);expect(edge[0]/edge[1]).toBeCloseTo(5/3,4);
  for(const view of [{yaw:90,pitch:40},{yaw:180,pitch:0},{yaw:25,pitch:-60}])for(const target of [[3,2],[-3,-2],[0,0]] as [number,number][]){
   const q=locateHairEndpoint(n,view,target,p);expect(q.every(Number.isFinite)).toBe(true);expect(Math.hypot(...q)).toBeCloseTo(1,9);expect(q[2]).toBeGreaterThan(.099);
   expect(distance(projectedHairControl(world(n,q),view),target)).toBeLessThanOrEqual(distance(projectedHairControl(world(n,p),view),target)+1e-9);
  }
 });
 it('fits either handle in both angle modes while holding endpoints fixed',()=>{
  const n={...defaultHairNet(),radiusX:1.2,radiusY:.9,radiusZ:1.1},a=hairSurfacePoint(0,.8),b=hairSurfacePoint(.05,-.3);
  for(const mode of ['SECTION','FRONT'] as const)for(const view of [front,{yaw:45,pitch:25},{yaw:-50,pitch:-30}])for(const control of [1,2] as const)for(const wanted of [-65,-15,45,80]){
   const target=projectedHairControl(hairSection(n,a,b,wanted,mode).cubic[control],view),angle=inferHairAngle(n,a,b,25,mode,view,control,target),result=hairSection(n,a,b,angle,mode);
   expect(distance(projectedHairControl(result.cubic[control],view),target)).toBeLessThan(.002);
   expect(result.cubic[0]).toEqual(world(n,a));expect(result.cubic[3]).toEqual(world(n,b));
  }
 });
 it('edits shared roots without losing randomness, intervals, identity or bindings',()=>{
  let h=independentHair(defaultHairstyle());const [a,b]=h.strandSet!.curves;
  h=editHairDrawing(h,connect(h.drawing,{curveId:a.id,end:0},{curveId:b.id,end:0},'POSITION'));
  const root=h.strandSet!.curves[0].nodes[0];h=syncStrands({...h,strandSet:{...h.strandSet!,endpoints:h.strandSet!.endpoints.map(n=>n.id===root?{...n,x:{value:0,random:[-.1,.2]},sample:[.7,.4]}:n)}});
  const before=JSON.stringify(h),next=dragHairControl(h,a.id,front,0,[.15,.65]);
  expect(shapeOf(next.drawing,a.id)[0][0]).toBeCloseTo(.15,7);expect(shapeOf(next.drawing,b.id)[0]).toEqual(shapeOf(next.drawing,a.id)[0]);
  expect(next.strandSet!.endpoints.find(n=>n.id===root)?.sample).toEqual([.7,.4]);expect(next.strandSet!.endpoints.find(n=>n.id===root)?.x.random).toEqual([-.1,.2]);
  expect(next.drawing.displayIntervals).toEqual(h.drawing.displayIntervals);expect(next.drawing.joins).toEqual(h.drawing.joins);expect(next.drawing.layers).toEqual(h.drawing.layers);
  expect(JSON.stringify(h)).toBe(before);expect(parseHairstyle(JSON.parse(JSON.stringify(next)))).toEqual(next);
  const locked={...h,drawing:{...h.drawing,curves:h.drawing.curves.map(c=>c.id===b.id?{...c,locked:true}:c)}};
  expect(hairControlEditable(locked,a.id,0)).toBe(false);expect(hairControlEditable(locked,a.id,1)).toBe(true);expect(dragHairControl(locked,a.id,front,0,[.3,.5])).toBe(locked);
 });
 it('leaves a no-op unchanged and groups a drag into one undo, isolated from Drawing',()=>{
  const h=independentHair(defaultHairstyle()),id=h.strandSet!.curves[0].id,p=shapeOf(h.drawing,id)[3];
  expect(dragHairControl(h,id,front,3,p)).toBe(h);expect(dragHairControl(h,id,front,1,shapeOf(h.drawing,id)[1])).toBe(h);
  const project={...createEmptyProject(),hairstyle:h,drawing:structuredClone(h.drawing)};
  useEditor.setState({project,past:[],future:[]});useEditor.getState().beginEdit();
  for(const x of [.1,.2,.3])useEditor.getState().setHairstyle(dragHairControl(h,id,front,3,[x,-.25]));
  useEditor.getState().endEdit();const final=useEditor.getState().project.hairstyle;
  expect(useEditor.getState().past).toHaveLength(1);expect(useEditor.getState().project.drawing).toBe(project.drawing);
  useEditor.getState().undo();expect(useEditor.getState().project.hairstyle).toEqual(h);
  useEditor.getState().redo();expect(useEditor.getState().project.hairstyle).toEqual(final);
  expect(generateHair(final!).strands![0].cubic.flat().every(Number.isFinite)).toBe(true);
 });
});
