import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Matrix4,Vector3} from 'three';
import {parseLandmarks} from '../domain/landmarks/persistence';
import {project} from '../domain/geometry/core';
import {editRenderSnapshot} from '../app/renderSnapshot';
import {orthographicView,worldToScreen,screenToWorld,viewMatrix,projectionMatrix,framebufferSize} from '../rendering/orthographic';
import {prepareCpuSvg,behindSurface} from '../rendering/edit2d/CpuSvgRenderer';
import {editSurfaceOpacity} from '../rendering/edit2d/types';
import {tessellate} from '../domain/patches/geometry';
import {installSmoothResult} from '../domain/continuity/evaluation';
import {solveContinuity as solveSmooth} from '../domain/continuity/solver';
import {diagnostics} from '../domain/geometry/diagnostics';
const source=()=>parseLandmarks(readFileSync('artifacts/surface-smooth/full-head-regression.json','utf8'));
for(const id of ['front','right45','side'])it(id+' shared CSS projection/inverse and GPU-ready matrices agree through aspect/pan/zoom/DPR',()=>{
 const camera=source().views.find(v=>v.id===id)!.camera;
 for(const [w,h,z,px,py] of [[800,600,1,0,0],[330,940,2.3,34,-50],[1300,400,.55,-70,35]]){
  const v=orthographicView(camera,{zoom:z,pan:[px,py]},w,h,2),p:[number,number,number]=[.41,-.33,.89],screen=worldToScreen(p,v),old=project(p,{camera}),fit=Math.min(w/600,h/560);
  expect(screen[0]).toBeCloseTo(w/2+fit*(px+z*old[0]*160),10);expect(screen[1]).toBeCloseTo(h/2+fit*(py-z*old[1]*160),10);
  const vm=new Matrix4().fromArray([...viewMatrix(v)]),pm=new Matrix4().fromArray([...projectionMatrix(v)]),clip=new Vector3(...p).applyMatrix4(vm).applyMatrix4(pm);
  expect((clip.x+1)*w/2).toBeCloseTo(screen[0],9);expect((1-clip.y)*h/2).toBeCloseTo(screen[1],9);
  const depth=p.reduce((sum,x,i)=>sum+(x-v.target[i])*v.forward[i],0);
  screenToWorld(screen,v,depth).forEach((x,i)=>expect(x).toBeCloseTo(p[i],10));
  expect(worldToScreen(p,{...v,devicePixelRatio:1})).toEqual(screen);expect(framebufferSize(v)).toEqual([w*2,h*2]);
 }
});
it('snapshot packs final Fullness/Smooth tessellation and shares buffers across display/selection changes',()=>{
 const p=source();const smooth=solveSmooth(p);expect(Object.values(smooth.patches).some(x=>x.field)).toBe(true);installSmoothResult(p,smooth);
 const opts={subdivisions:6,curveSegments:24,includeSurface:true},before=JSON.stringify(p),snapshot=editRenderSnapshot(p,opts);
 for(let i=0;i<p.patches!.length;i++){
  const mesh=tessellate(p,p.patches![i],6);expect(snapshot.surface[i].positions).toEqual(new Float32Array(mesh.vertices.flat()));expect(snapshot.surface[i].indices).toEqual(new Uint32Array(mesh.triangles.flat()));
 }
 diagnostics.reset();const again=editRenderSnapshot({...p,patchDisplay:{...p.patchDisplay!,opacity2d:.5},views:p.views.map(v=>({...v,canvas:{zoom:2,pan:[12,24]}}))},opts);
 expect(again.geometryToken).toBe(snapshot.geometryToken);again.surface.forEach((s,i)=>expect(s).toBe(snapshot.surface[i]));again.curves.forEach((s,i)=>expect(s).toBe(snapshot.curves[i]));
 expect(diagnostics.snapshot().counters.surfaceRenderBufferBuilds??0).toBe(0);expect(diagnostics.snapshot().counters.curveRenderBufferBuilds??0).toBe(0);
 const view=orthographicView(p.views[0].camera,p.views[0].canvas,800,600);diagnostics.reset();prepareCpuSvg(snapshot,view);
 for(const key of ['pointEvaluations','curveEvaluations','patchEvaluations','patchTessellations'])expect(diagnostics.snapshot().counters[key]??0).toBe(0);
 expect(JSON.stringify(p)).toBe(before);
});
it('hidden classification is nearest-surface binary, independent of number of covering patches',()=>{
 const triangle={patch:'one',pts:[[0,0,1],[10,0,1],[0,10,1]],minX:0,minY:0,maxX:10,maxY:10};
 expect(behindSurface([triangle],2,2,0)).toBe(true);expect(behindSurface([triangle,{...triangle,patch:'two'}],2,2,0)).toBe(true);
 expect(behindSurface([triangle],2,2,2)).toBe(false);expect(behindSurface([],2,2,0)).toBe(false);
 expect(editSurfaceOpacity(undefined)).toBe(.75);expect(editSurfaceOpacity(.7)).toBe(.75);expect(editSurfaceOpacity(.98)).toBe(1);
});
