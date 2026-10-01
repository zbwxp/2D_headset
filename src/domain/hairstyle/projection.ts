import type {Vec3} from './model';
import type {Cubic,Point2} from '../drawing/model';
import type {HairGeometry} from './geometry';
export interface HairView {yaw:number;pitch:number}
/** Pitch about the head's own left/right axis, then yaw about world up.
 * Projection is Ry(-yaw) Rx(pitch); an orbit camera's opposite composition
 * turns pitch into anatomical roll when viewing the head from the side. */
export function hairBasis(view:HairView){
 const y=view.yaw*Math.PI/180,p=view.pitch*Math.PI/180;
 return {right:[Math.cos(y),-Math.sin(y)*Math.sin(p),-Math.sin(y)*Math.cos(p)] as Vec3,up:[0,Math.cos(p),-Math.sin(p)] as Vec3,forward:[Math.sin(y),Math.cos(y)*Math.sin(p),Math.cos(y)*Math.cos(p)] as Vec3};
}
/** Orthographic projection commutes with cubic evaluation: project the 8 controls,
 * not a freshly sampled/re-fitted silhouette. Matches HairScene's camera basis. */
export function projectHairCubics(geometry:HairGeometry,view:HairView):[Cubic,Cubic]{
 const {right,up}=hairBasis(view),dot=(a:Vec3,b:Vec3)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
 return geometry.arcs.map(arc=>arc.cubic.map(p=>[dot(p,right),dot(p,up)] as Point2) as Cubic) as [Cubic,Cubic];
}
/** Each source hair has exactly one fitted cubic, at every camera angle. */
export function projectHairContours(geometry:HairGeometry,view:HairView):Cubic[][]{
 const {right,up}=hairBasis(view),dot=(a:Vec3,b:Vec3)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
 return [...geometry.arcs,...geometry.centerArcs,...geometry.interiorArcs].map(arc=>arc.cubics.map(c=>c.map(p=>[dot(p,right),dot(p,up)] as Point2) as Cubic));
}
