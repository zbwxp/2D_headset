import {Matrix4,Vector3} from 'three';
import type {Vec3} from '../project/types';
import type {LandmarkProject} from '../landmarks/model';
import {rotateFrame} from '../head/frame';
type Source=Pick<LandmarkProject,'eyeScaffold'|'headFrame'>;
/** Camera-local affine correction per eye, after gaze. Bounded, invertible,
 * identity at frontal yaw, and covariant under whole-head/view reflection. */
export function eyePerspectiveMatrix(p:Source,side:'left'|'right',facing:Vec3){
 const m=new Matrix4(),f=p.headFrame,e=p.eyeScaffold;if(!f||!e)return m;
 const sx=e.perspective?.x??0,sy=e.perspective?.y??0;if(!sx&&!sy)return m;
 const local=rotateFrame(facing,f,true),yaw=Math.atan2(local[0],local[2]),s=Math.sin(yaw),a=s*s;
 const forward=new Vector3(...facing).normalize(),up0=new Vector3(...rotateFrame([0,1,0],f));
 let right=new Vector3().crossVectors(up0,forward);if(right.lengthSq()<1e-10)right=new Vector3(...rotateFrame([1,0,0],f));right.normalize();
 const up=new Vector3().crossVectors(forward,right).normalize(),sign=side==='left'?-1:1,q=e.perspectiveOrigin?{x:e.perspectiveOrigin[0],y:e.perspectiveOrigin[1],z:e.perspectiveOrigin[2]}:e.parameters;
 const center=new Vector3(...rotateFrame([sign*q.x*f.radiusX,q.y*f.radiusX,q.z*f.radiusX],f)).add(new Vector3(...f.center));
 const middle=new Vector3(...rotateFrame([0,q.y*f.radiusX,q.z*f.radiusX],f)).add(new Vector3(...f.center));
 const xScale=1+.55*sx*sign*s,yScale=1+.4*sy*sign*s;
 const axes=new Matrix4().makeBasis(right,up,forward);
 m.copy(axes).multiply(new Matrix4().makeScale(xScale,yScale,1)).multiply(axes.clone().transpose());
 const delta=center.clone().sub(center.clone().applyMatrix4(m));
 delta.addScaledVector(right,-center.clone().sub(middle).dot(right)*.3*sx*a);
 m.setPosition(delta);return m;
}