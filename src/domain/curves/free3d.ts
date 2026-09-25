import type { LandmarkProject } from '../landmarks/model';
import type { Vec3 } from '../project/types';
import { rotateFrame } from '../head/frame';
import { sub } from '../geometry/core';
import { evaluationContext } from '../geometry/evaluation';
import { eyeSide } from '../eyes/scaffold';
import { ownerOf } from '../modules/ownership';
import { isDerived, isFree3DShape, isHelmetLoop, type Free3DShape } from './model';
import type { ControlPoints } from './geometry';

export function handleToWorld(p: LandmarkProject, v: Vec3): Vec3 {
  const f=p.headFrame;
  return f ? rotateFrame([v[0]*f.radiusX,v[1]*f.radiusY,v[2]*f.radiusZ],f) : v;
}
export function handleToLocal(p: LandmarkProject, v: Vec3): Vec3 {
  const f=p.headFrame;if(!f)return v;
  const q=rotateFrame(v,f,true);
  return [q[0]/f.radiusX,q[1]/f.radiusY,q[2]/f.radiusZ];
}
export function free3DFromControls(p: LandmarkProject, cp: ControlPoints): Free3DShape {
  return {kind:'FREE_3D',startHandleOffset:handleToLocal(p,sub(cp[1],cp[0])),endHandleOffset:handleToLocal(p,sub(cp[2],cp[3]))};
}
/** Evaluate all legacy sources against the same complete pre-migration graph.
 * Never bake final joined geometry into its own source. */
export function migrateFree3D(p: LandmarkProject): LandmarkProject {
  const ctx=evaluationContext(p);
  const curves=p.curves.map(c=>{
    if(c.role!=='canonical'||isDerived(c)||isFree3DShape(c.shape)||ownerOf(p,c.id)!=='HEADSET'||eyeSide(p,c.id))return c;
    const shape=free3DFromControls(p,ctx.sourceCurveControls(c.id));
    if([c.startLandmarkId,c.endLandmarkId].every(id=>p.landmarks.find(l=>l.id===id)?.type==='CENTERLINE')){
      shape.startHandleOffset[0]=0;shape.endHandleOffset[0]=0;
    }
    return {...c,shape};
  });
  const hasFree=curves.some(c=>c.role==='canonical'&&!isDerived(c)&&isFree3DShape(c.shape));
  return {...p,curves,version:p.chinScaffold?'landmarks-0.9.5':curves.some(isHelmetLoop)?'landmarks-0.9.3':hasFree?'landmarks-0.9.2':p.version};
}
