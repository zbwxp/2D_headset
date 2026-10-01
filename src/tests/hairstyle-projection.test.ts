import {describe,it,expect} from 'vitest';
import {Matrix4,OrthographicCamera,Vector3} from 'three';
import {hairBasis} from '../domain/hairstyle/projection';
import {defaultHairNet,type Vec3} from '../domain/hairstyle/model';
import {surfaceHairArc,surfaceFromView} from '../domain/hairstyle/surfaceCurve';
import {parseHairStrandSet,type HairSurfaceCurve} from '../domain/hairstyle/strandTypes';

describe('hair view rotation',()=>{
 it('nods around the anatomical left/right axis even at either side view',()=>{
  for(const yaw of [-180,-90,-35,0,35,90,180])for(const pitch of [-60,0,60]){
   const b=hairBasis({yaw,pitch}),radians=pitch*Math.PI/180;
   // The ear-to-ear direction does not tilt with pitch; the nose moves down
   // with positive pitch at every yaw, including the two profile views.
   expect(b.up[0]).toBeCloseTo(0,12);
   expect(b.right[0]).toBeCloseTo(Math.cos(yaw*Math.PI/180),12);
   expect(b.forward[0]).toBeCloseTo(Math.sin(yaw*Math.PI/180),12);
   expect(b.up[2]).toBeCloseTo(-Math.sin(radians),12);
  }
 });
 it('matches a pitched head followed by yaw, and the Three cameras used by both previews',()=>{
  for(const yaw of [-180,-90,0,35,90,180])for(const pitch of [-90,-25,0,40,90]){
   const b=hairBasis({yaw,pitch}),right=new Vector3(...b.right),up=new Vector3(...b.up),forward=new Vector3(...b.forward);
   expect(right.length()).toBeCloseTo(1,12);expect(up.length()).toBeCloseTo(1,12);expect(forward.length()).toBeCloseTo(1,12);
   expect(right.dot(up)).toBeCloseTo(0,12);expect(right.clone().cross(up).distanceTo(forward)).toBeLessThan(1e-12);
   const rotation=new Matrix4().makeRotationY(-yaw*Math.PI/180).multiply(new Matrix4().makeRotationX(pitch*Math.PI/180));
   const camera=new OrthographicCamera(-2,2,2,-2,.01,100);
   camera.position.copy(forward).multiplyScalar(12);camera.up.copy(up);camera.lookAt(0,0,0);camera.updateMatrixWorld();
   for(const point of [[.3,.8,.6],[-.8,-.2,.4],[0,0,1]]){
    const p=new Vector3(...point),expected=p.clone().applyMatrix4(rotation),screen=p.clone().project(camera);
    expect(p.dot(right)).toBeCloseTo(expected.x,12);expect(p.dot(up)).toBeCloseTo(expected.y,12);
    expect(screen.x*2).toBeCloseTo(expected.x,12);expect(screen.y*2).toBeCloseTo(expected.y,12);
   }
  }
 });
 it('retains the authored shape of a legacy oblique-view sketch',()=>{
  const surface:HairSurfaceCurve={version:1,view:{yaw:35,pitch:20},handles:[[-.12,-.2],[.12,.3]],depths:[.7,1.1,1.1,1]};
  const root:Vec3=[0,.8,.6],tip:Vec3=[.1,-.2,Math.sqrt(.95)];
  const arc=surfaceHairArc(defaultHairNet(),root,tip,surface);
  expect(arc.projectionMisses).toEqual([]);
  expect(arc.cubic.map(p=>p.map(v=>Number(v.toFixed(9))))).toMatchInlineSnapshot(`
    [
      [
        0,
        0.8,
        0.6,
      ],
      [
        0.01925485,
        0.661759259,
        0.836712391,
      ],
      [
        0.301598813,
        0.184804023,
        1.053378762,
      ],
      [
        0.1,
        -0.2,
        0.974679434,
      ],
    ]
  `);
  const set={version:1,endpoints:[{id:'a',x:{value:0,random:[0,0]},y:{value:.8,random:[0,0]},sample:[0,0]},{id:'b',x:{value:.1,random:[0,0]},y:{value:-.2,random:[0,0]},sample:[0,0]}],curves:[{id:'curve',nodes:['a','b'],angle:0,start:{value:0,random:[0,0]},end:{value:1,random:[0,0]},sample:[0,0],surface}]};
  expect(parseHairStrandSet(JSON.parse(JSON.stringify(set))).curves[0].surface).toEqual(surface);
  // A later edit rebases coordinates into V2 without changing the displayed
  // cubic first. Both versions remain loadable, with no eager shape migration.
  const updated=surfaceFromView(defaultHairNet(),arc,{yaw:45,pitch:25});
  expect(updated.version).toBe(2);
  expect(parseHairStrandSet({...set,curves:[{...set.curves[0],surface:updated}]}).curves[0].surface).toEqual(updated);
  const next=surfaceHairArc(defaultHairNet(),root,tip,updated),b=hairBasis(updated.view);
  for(let i=0;i<4;i++)for(const axis of [b.right,b.up]){
   const dot=(p:Vec3)=>p.reduce((s,v,j)=>s+v*axis[j],0);
   expect(dot(next.cubic[i])).toBeCloseTo(dot(arc.cubic[i]),8);
  }
 });
});
