import {test,expect} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import {projection,depthSteps,visible} from '../domain/contour/visible';
import {clipPerspective} from '../domain/contour/perspective';
import type {ContourMesh,Orientation} from '../domain/contour/silhouette';
const mesh:ContourMesh={vertices:[[-1,-1,0],[1,-1,1],[0,1,-1]],triangles:[{indices:[0,1,2],patchId:'x',triangleId:0}]};
function finish<T>(g:Generator<void,T>){let n=g.next();while(!n.done)n=g.next();return n.value;}
test('perspective matches Three camera projection, including pan and distance',()=>{
 const camera=new PerspectiveCamera(34,1,.1,100);camera.position.set(3,1,5);camera.lookAt(.2,.3,0);camera.updateMatrixWorld();
 const opts={position:camera.position.toArray(),fov:34},q=camera.quaternion.toArray();const p=projection(mesh,q,768,mesh.vertices,opts);
 mesh.vertices.forEach((v,i)=>{const ndc=new Vector3(...v).project(camera);expect(p.points[i][0]).toBeCloseTo((ndc.x+1)*384,8);expect(p.points[i][1]).toBeCloseTo((1-ndc.y)*384,8);});
});
test('reciprocal depth keeps a perspective projected triangle visible without hiding behind it',()=>{
 const p=projection(mesh,[0,0,0,1],768,mesh.vertices,{position:[0,0,5],fov:34}),d=finish(depthSteps(p.points,mesh));
 const c=p.points[0].map((_,k)=>p.points.reduce((sum,v)=>sum+v[k]/3,0)) as [number,number,number];expect(visible(c,d,p.epsilon)).toBe(true);expect(visible([c[0],c[1],c[2]-.01],d,p.epsilon)).toBe(false);
});
test('near clipping produces finite projection and removes geometry behind the camera',()=>{
 const m:ContourMesh={...mesh,vertices:[[-1,0,-1],[1,0,-1],[0,1,1]]},q:Orientation=[0,0,0,1],c={position:[0,0,0] as [number,number,number],fov:34};
 const clipped=clipPerspective(m,q,c);expect(clipped.triangles.length).toBeGreaterThan(0);expect(clipped.vertices.every(v=>v[2]<=-.1+1e-12)).toBe(true);expect(projection(clipped,q,768,clipped.vertices,c).points.flat().every(Number.isFinite)).toBe(true);
});
