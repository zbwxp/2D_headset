import {it,expect} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import {pickCurve} from '../ui/inspect3d/picking';
it('uses pixel tolerance at different scales and resolves overlapping curves by depth',()=>{
 for(const size of [400,1200])for(const distance of [3,8]){
 const camera=new PerspectiveCamera(34,1,.1,100);camera.position.set(0,0,distance);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const segments=[{id:'back',a:new Vector3(-1,0,-1),b:new Vector3(1,0,-1)},{id:'front',a:new Vector3(-1,0,0),b:new Vector3(1,0,0)}];
 expect(pickCurve(segments,camera,size,size,size/2,size/2+5)).toBe('front');expect(pickCurve(segments,camera,size,size,size/2,size/2+8)).toBeNull();
 }
});
it('does not pick geometry behind the perspective camera',()=>{const c=new PerspectiveCamera(34,1,.1,100);c.position.set(0,0,3);c.lookAt(0,0,0);c.updateMatrixWorld();expect(pickCurve([{id:'hidden',a:new Vector3(-1,0,4),b:new Vector3(1,0,4)}],c,400,400,200,200)).toBeNull();});
