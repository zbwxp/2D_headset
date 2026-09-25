import {Matrix4,Vector3} from 'three';
import type {LandmarkProject} from '../domain/landmarks/model';
import type {Vec2,Vec3} from '../domain/project/types';
import {evaluationContext} from '../domain/geometry/evaluation';
import {eyeSide} from '../domain/eyes/scaffold';
import {eyePerspectiveMatrix} from '../domain/eyes/perspective';
import {rotateFrame} from '../domain/head/frame';
import {worldToPlane,type OrthographicViewState} from './orthographic';
export function eyeObjectMatrix(p:LandmarkProject,id:string,facing:Vec3){
 if(!p.eyeScaffold||!p.headFrame||p.geometryModules?.[id]!=='EYES')return new Matrix4();
 const patch=p.patches?.find(x=>x.id===id);
 const l=p.landmarks.find(l=>l.id===id),curve=p.curves.find(c=>c.id===(patch?.boundaryUses[0]?.curveId??id)),anchor=curve&&p.landmarks.find(l=>l.id===curve.startLandmarkId);
 let side=(l?.placement.kind==='EYE_LOCAL'?l.placement.side:anchor?.placement.kind==='EYE_LOCAL'?anchor.placement.side:undefined)??eyeSide(p,id)??(patch?eyeSide(p,patch.boundaryUses[0].curveId):undefined);if(!side){const ctx=evaluationContext(p),c=curve;const v=c?ctx.curve(c.id).evaluate(.5):p.landmarks.some(l=>l.id===id)?ctx.pointPosition(id):p.headFrame.center;side=rotateFrame(v.map((n,i)=>n-p.headFrame!.center[i]) as Vec3,p.headFrame,true)[0]<0?'left':'right';}
 return eyePerspectiveMatrix(p,side,facing);
}
export const displayEyePoint=(p:LandmarkProject,id:string,v:Vec3,facing:Vec3):Vec3=>new Vector3(...v).applyMatrix4(eyeObjectMatrix(p,id,facing)).toArray();
/** Warp preserves view depth, so its plane inverse is independent of pick depth. */
export function rawEyePlane(p:LandmarkProject,id:string,xy:Vec2,v:OrthographicViewState):Vec2{
 const world=v.target.map((n,i)=>n+xy[0]*v.right[i]+xy[1]*v.up[i]) as Vec3;
 return worldToPlane(new Vector3(...world).applyMatrix4(eyeObjectMatrix(p,id,v.forward).invert()).toArray(),v).slice(0,2) as Vec2;
}
