import type {HairNet,Vec3} from './model';
import type {Point2} from '../drawing/model';

export interface DomedHairProfile {version:1;width:number;shoulder:number;crown:number;lower:number}
export interface PumpkinHairProfile {version:2;width:number;shoulder:number;crown:number;lower:number;inset:number;insetStart?:number;baseHeight:number;baseTilt:number}
export type HairShellProfile=DomedHairProfile|PumpkinHairProfile;
export const PROFILE_LIMITS={width:[.65,1.45],shoulder:[-.3,.6],crown:[.25,.8],lower:[.2,.8]} as const;
export const PUMPKIN_LIMITS={width:[.65,1.45],shoulder:[0,.6],crown:[.25,.8],lower:[.2,.5],inset:[.2,.8],baseHeight:[-.6,-.05],baseTilt:[0,35],insetStart:[-.5,.85]} as const;
export const defaultHairProfile=():DomedHairProfile=>({version:1,width:1.08,shoulder:.24,crown:.6,lower:.46});
export const defaultPumpkinProfile=():PumpkinHairProfile=>({version:2,width:1.22,shoulder:.35,crown:.64,lower:.35,inset:.60,insetStart:.35,baseHeight:-.30,baseTilt:24});
// Older recipes start tucking at the shoulder; omission must preserve that shape.
export const hairInsetStart=(p:PumpkinHairProfile)=>p.insetStart??p.shoulder;
export function parseHairProfile(value:unknown):HairShellProfile|null {
 if(value===null)return null;
 const p=value as HairShellProfile;
 if(!p||!([1,2] as number[]).includes(p.version))throw Error('发网壳形参数无效 / Invalid hair shell profile');
 const limits=p.version===2?PUMPKIN_LIMITS:PROFILE_LIMITS;
 if(Object.entries(limits).some(([key,[lo,hi]])=>{const v=(p as unknown as Record<string,number>)[key];if(key==='insetStart'&&v===undefined)return false;return !Number.isFinite(v)||v<lo||v>hi;}))throw Error('发网壳形参数无效 / Invalid hair shell profile');
 const common={width:p.width,shoulder:p.shoulder,crown:p.crown,lower:p.lower};
 return p.version===2?{version:2,...common,inset:p.inset,...(p.insetStart!==undefined?{insetStart:p.insetStart}:{}),baseHeight:p.baseHeight,baseTilt:p.baseTilt}:{version:1,...common};
}
export type ProfileCubic=[Point2,Point2,Point2,Point2];
/** Meridian basis. An independent tuck onset is applied to its radial field in
 * profileTable; these cubics retain the original recipe for exact migration. */
export function hairProfileCubics(p:HairShellProfile):ProfileCubic[] {
 const w=p.width,h=p.shoulder;
 if(p.version===1)return [[[0,1],[w*p.crown,1],[w,h+(1-h)*.55228475],[w,h]],[[w,h],[w,h-(1+h)*p.lower],[w*.55228475,-1],[0,-1]]];
 // Smooth bulging crown, tucked lower flank, then an internal closure below the
 // cut. The last piece only closes the solid for plane/section intersection.
 const r=w*(1-p.inset),q=w*(1-.95*p.inset);
 return [
  [[0,1],[w*p.crown,1],[w,h+(1-h)*.80],[w,h]],
  [[w,h],[w,h-(1+h)*p.lower],[q,h-.24*(1+h)],[r,-.98]],
  [[r,-.98],[r-(q-r)*.12,-.98-(.98+h-.24*(1+h))*.12],[r*.45,-1.20],[0,-1.20]]
 ];
}
function at(c:ProfileCubic,t:number,k:0|1){const u=1-t;return u*u*u*c[0][k]+3*u*u*t*c[1][k]+3*u*t*t*c[2][k]+t*t*t*c[3][k];}
function parameterAtHeight(c:ProfileCubic,y:number){
 let lo=0,hi=1;for(let j=0;j<25;j++){const mid=(lo+hi)/2;if(at(c,mid,1)>y)lo=mid;else hi=mid;}return (lo+hi)/2;
}
const TABLE_SIZE=2048,cache=new WeakMap<HairShellProfile,Float64Array>();
export const hairProfileFloor=(n:HairNet)=>n.profile?.version===2?-1.2:-1;
function profileTable(p:HairShellProfile):Float64Array {
 const found=cache.get(p);if(found)return found;
 const curves=hairProfileCubics(p),table=new Float64Array(TABLE_SIZE+1),floor=p.version===2?-1.2:-1;
 const onset=p.version===2?hairInsetStart(p):0,shift=p.version===2&&onset!==p.shoulder;
 for(let i=1;i<TABLE_SIZE;i++){
  const y=floor+(1-floor)*i/TABLE_SIZE,c=curves.find(c=>y>=c[3][1])??curves.at(-1)!;
  let radius=at(c,parameterAtHeight(c,y),0);
  if(shift&&p.version===2&&y>-.98){
   // Start from the untucked crown/body, then relocate only the inward radial
   // displacement. Above onset it is exactly zero. The height remap meets the
   // original lower closure with value AND derivative unchanged (no seam).
   radius=y>=p.shoulder?at(curves[0],parameterAtHeight(curves[0],y),0):p.width;
   if(y<onset){
    const progress=(onset-y)/(onset+.98);
    const sourceY=y+(p.shoulder-onset)*(1-progress)**2;
    const t=parameterAtHeight(curves[1],sourceY);
    radius-=p.width*p.inset*(.95*3*(1-t)*t*t+t*t*t);
   }
  }
  table[i]=radius*radius;
 }
 cache.set(p,table);return table;
}
/** Radius of the uncut body, in normalized X/Z units. */
export function hairRadiusSquared(n:HairNet,y:number):number {
 const floor=hairProfileFloor(n);if(y<=floor||y>=1)return 0;
 if(!n.profile)return 1-y*y;
 const table=profileTable(n.profile),u=(y-floor)/(1-floor)*TABLE_SIZE,i=Math.min(TABLE_SIZE-1,Math.floor(u)),f=u-i;
 return table[i]*(1-f)+table[i+1]*f;
}
export function hairRadialScale(n:HairNet,y:number):number {
 if(!n.profile)return 1;
 const yy=Math.max(-.999999,Math.min(.999999,y));return Math.sqrt(hairRadiusSquared(n,yy)/(1-yy*yy));
}
/** Convert a world-space bottom-plane angle to normalized shell units. */
export const pumpkinSlope=(n:HairNet)=>n.profile?.version===2?Math.tan(n.profile.baseTilt*Math.PI/180)*n.radiusZ/n.radiusY:0;
const rims=new WeakMap<HairNet,Map<number,number>>();
export function pumpkinRimY(n:HairNet,az:number):number {
 if(n.profile?.version!==2)return -1;
 let cache=rims.get(n);if(!cache){cache=new Map();rims.set(n,cache);}
 const key=Math.cos(az),found=cache.get(key);if(found!==undefined)return found;
 const p=n.profile,k=pumpkinSlope(n)*key;let lo=-1.2,hi=1;
 for(let i=0;i<29;i++){const y=(lo+hi)/2;if(y-p.baseHeight-k*Math.sqrt(hairRadiusSquared(n,y))>0)hi=y;else lo=y;}
 const result=(lo+hi)/2;if(cache.size>=512)cache.delete(cache.keys().next().value!);cache.set(key,result);return result;
}
/** Stable curved-shell attachment chart: top=1, rim=-1. No endpoint is silently
 * attached to the interior of the bottom disk when the cutting plane moves. */
export function pumpkinSurface(n:HairNet,az:number,down:number):Vec3 {
 const y=1+(pumpkinRimY(n,az)-1)*down,r=Math.sqrt(hairRadiusSquared(n,y));
 return [n.center[0]+r*Math.sin(az)*n.radiusX,n.center[1]+y*n.radiusY,n.center[2]+r*Math.cos(az)*n.radiusZ];
}
export function hairWorld(n:HairNet,p:Vec3):Vec3 {
 if(n.profile?.version===2)return pumpkinSurface(n,Math.atan2(p[0],p[2]),(1-p[1])/2);
 const scale=hairRadialScale(n,p[1]);return [n.center[0]+p[0]*n.radiusX*scale,n.center[1]+p[1]*n.radiusY,n.center[2]+p[2]*n.radiusZ*scale];
}
export function hairLocal(n:HairNet,p:Vec3):Vec3 {
 const y=(p[1]-n.center[1])/n.radiusY;
 if(n.profile?.version===2){
  const az=Math.atan2((p[0]-n.center[0])/n.radiusX,(p[2]-n.center[2])/n.radiusZ),v=1-2*(1-y)/(1-pumpkinRimY(n,az)),r=Math.sqrt(Math.max(0,1-v*v));
  return [r*Math.sin(az),v,r*Math.cos(az)];
 }
 const scale=hairRadialScale(n,y);return [(p[0]-n.center[0])/n.radiusX/scale,y,(p[2]-n.center[2])/n.radiusZ/scale];
}
export function hairFrontCoordinates(n:HairNet,p:Point2):Point2 {
 const y=(p[1]-n.center[1])/n.radiusY;
 if(n.profile?.version===2){
  const r=Math.sqrt(hairRadiusSquared(n,y)),x=Math.max(-r,Math.min(r,(p[0]-n.center[0])/n.radiusX)),z=Math.sqrt(Math.max(0,r*r-x*x));
  const q=hairLocal(n,[n.center[0]+x*n.radiusX,p[1],n.center[2]+z*n.radiusZ]);return [q[0],q[1]];
 }
 return [(p[0]-n.center[0])/n.radiusX/hairRadialScale(n,y),y];
}
/** Negative inside the actual solid, including the sloping planar closure. */
export function hairNormalizedField(n:HairNet,x:number,y:number,z:number):number {
 const radial=x*x+z*z-hairRadiusSquared(n,y);
 return n.profile?.version===2?Math.max(radial,hairProfileFloor(n)-y,y-1,n.profile.baseHeight+pumpkinSlope(n)*z-y):radial+Math.max(0,Math.abs(y)-1);
}
export function hairShellField(n:HairNet,p:Vec3):number {
 return hairNormalizedField(n,(p[0]-n.center[0])/n.radiusX,(p[1]-n.center[1])/n.radiusY,(p[2]-n.center[2])/n.radiusZ);
}
