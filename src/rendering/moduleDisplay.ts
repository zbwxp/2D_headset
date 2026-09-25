import {Vector3} from 'three';
import type {LandmarkProject} from '../domain/landmarks/model';
import type {Vec2,Vec3} from '../domain/project/types';
import {ownerOf} from '../domain/modules/ownership';
import {headPerspective} from '../domain/head/perspective';
import {curvePolyline,type CurveProvider} from '../domain/geometry/curveProvider';
import {eyeObjectMatrix} from './eyeDisplay';
import {pointPosition} from '../domain/geometry/evaluation';
import {worldToPlane,type OrthographicViewState} from './orthographic';

export function displayTransform(p:LandmarkProject,id:string,facing:Vec3){
 if(ownerOf(p,id)==='HEADSET')return headPerspective(p,facing);
 const m=eyeObjectMatrix(p,id,facing),inverse=m.clone().invert();
 return {active:!m.equals(m.clone().identity()),key:JSON.stringify(m.elements),display:(v:Vec3)=>new Vector3(...v).applyMatrix4(m).toArray(),raw:(v:Vec3)=>new Vector3(...v).applyMatrix4(inverse).toArray()};
}
export const displayPoint=(p:LandmarkProject,id:string,v:Vec3,facing:Vec3):Vec3=>displayTransform(p,id,facing).display(v);
export function rawDisplayPlane(p:LandmarkProject,id:string,xy:Vec2,v:OrthographicViewState,at?:Vec3):Vec2{
 const anchor=at??(p.landmarks.some(l=>l.id===id)?pointPosition(p,id):v.target);
 const depth=anchor.reduce((n,x,i)=>n+(x-v.target[i])*v.forward[i],0);
 const world=v.target.map((n,i)=>n+xy[0]*v.right[i]+xy[1]*v.up[i]+depth*v.forward[i]) as Vec3;
 return worldToPlane(displayTransform(p,id,v.forward).raw(world),v).slice(0,2) as Vec2;
}

const warpSamples=new WeakMap<CurveProvider,Vec3[]>();
/** A spatially straight source may bend under anisotropic perspective. Sample
 * before warping; transforming only its two endpoints loses that curvature. */
export function displayCurveSamples(p:LandmarkProject,id:string,g:CurveProvider,facing:Vec3){
 const pose=displayTransform(p,id,facing);let points:Vec3[];
 if(pose.active&&ownerOf(p,id)==='HEADSET'){points=warpSamples.get(g)??g.sample(256);warpSamples.set(g,points);}else points=curvePolyline(g);
 return pose.active?points.map(pose.display):points;
}
