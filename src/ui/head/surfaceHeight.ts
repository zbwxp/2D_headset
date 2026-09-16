import type {Vec3} from '../../domain/project/types';
/** Height editing on the sphere slice parallel to the HeadFrame sagittal plane. */
export function surfaceHeightDirection(direction:Vec3,height:number,depthSide:number):Vec3 {
 const x=direction[0],limit=Math.sqrt(Math.max(0,1-x*x));
 const y=Math.max(-limit,Math.min(limit,height));
 return [x,y,(depthSide<0?-1:1)*Math.sqrt(Math.max(0,1-x*x-y*y))];
}
