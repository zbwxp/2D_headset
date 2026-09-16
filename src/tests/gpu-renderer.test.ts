import {describe,it,expect} from 'vitest';
import {Camera,Vector3} from 'three';
import {GpuScene,applyCamera} from '../rendering/edit2d/GpuScene';
import {orthographicView,worldToScreen} from '../rendering/orthographic';
import type {EditRenderSnapshot,EditRenderStyle} from '../rendering/edit2d/types';
import {surfaceNormals} from '../app/renderSnapshot';
const positions=new Float32Array([0,0,0,1,0,0,0,1,0]),indices=new Uint32Array([0,1,2]);
const snapshot:EditRenderSnapshot={surface:[{id:'p',geometryToken:'p1',positions,indices,normals:surfaceNormals([...positions],[...indices])}],curves:[{id:'c',geometryToken:'c1',samples:positions}],geometryToken:'1'};
const style:EditRenderStyle={surfaceOpacity:.75,hiddenCurveOpacity:.25,selectedCurveIds:new Set()};
describe('GPU resources and shared camera',()=>{
 it('reuses unchanged buffers for style/selection; replaces only changed patch; disposes removals',()=>{
  const scene=new GpuScene();scene.update(snapshot,style);const p=scene.surfaces.get('p')!.geometry,c=scene.curves.get('c')!.geometry;
  scene.update({...snapshot}, {...style,surfaceOpacity:1,selectedCurveIds:new Set(['c'])});
  expect(scene.surfaces.get('p')!.geometry).toBe(p);expect(scene.curves.get('c')!.geometry).toBe(c);expect(scene.curves.get('c')!.front.visible).toBe(false);
  let disposed=0;p.addEventListener('dispose',()=>disposed++);
  scene.update({...snapshot,surface:[{...snapshot.surface[0],geometryToken:'p2'}]},style);
  expect(disposed).toBe(1);expect(scene.surfaces.get('p')!.geometry).not.toBe(p);expect(scene.curves.get('c')!.geometry).toBe(c);
  scene.update({surface:[],curves:[],geometryToken:'empty'},style);expect(scene.surfaces.size+scene.curves.size).toBe(0);scene.dispose();
 });
 for(const yaw of [0,45,90])it(`GPU matrix CSS alignment yaw ${yaw}, all DPR/aspects`,()=>{
  for(const dpr of [1,2,3])for(const [w,h] of [[800,600],[450,900]]){
   const view=orthographicView({projection:'orthographic',zoom:1,position:[.1+Math.sin(yaw*Math.PI/180),.2,.3+Math.cos(yaw*Math.PI/180)],target:[.1,.2,.3],up:[0,1,0]},{zoom:1.73,pan:[31,-21]},w,h,dpr);
   const camera=new Camera();applyCamera(camera,view);const p=[.35,.21,.8],clip=new Vector3(...p).project(camera),screen=[(clip.x+1)*w/2,(1-clip.y)*h/2],expected=worldToScreen(p,view);
   expect(Math.hypot(screen[0]-expected[0],screen[1]-expected[1])).toBeLessThan(1e-10);
   const near=new Vector3(...view.target).add(new Vector3(...view.forward)).project(camera),far=new Vector3(...view.target).sub(new Vector3(...view.forward)).project(camera);
   expect(near.z).toBeLessThan(far.z);expect(camera.matrixWorldInverse.determinant()).toBeCloseTo(1);
  }
 });
 it('cached normals are finite and match triangle orientation',()=>{expect([...snapshot.surface[0].normals!]).toEqual([0,0,1,0,0,1,0,0,1]);});
});
