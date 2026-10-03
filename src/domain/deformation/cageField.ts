import {add,sub,mul,length,type Point2} from '../drawing/model';
import {assertBend,bendPoint,bendVector,isNeutralBend,type BendValue} from './coons';

/** Counterclockwise in drawing coordinates: bottom left, bottom right, top right, top left. */
export type Quad=[Point2,Point2,Point2,Point2];
export interface DeformRect {min:Point2;max:Point2}
export const rectQuad=(r:DeformRect):Quad=>[[...r.min],[r.max[0],r.min[1]],[...r.max],[r.min[0],r.max[1]]];
const cross=(a:Point2,b:Point2)=>a[0]*b[1]-a[1]*b[0];
const invalid=()=>Error('四角不能交叉或压扁；已保留最后有效位置。');

/** Unit square homography, normalized before solving to avoid document-coordinate conditioning. */
export function quadProjection(rect:DeformRect,quad:Quad){
 const w=rect.max[0]-rect.min[0],h=rect.max[1]-rect.min[1],scale=Math.max(...quad.map((p,i)=>length(sub(p,quad[(i+1)%4]))));
 if(w<1e-7||h<1e-7||!quad.flat().every(Number.isFinite)||scale<1e-7)throw invalid();
 for(let i=0;i<4;i++)if(cross(sub(quad[(i+1)%4],quad[i]),sub(quad[(i+2)%4],quad[(i+1)%4]))<scale*scale*1e-5)throw invalid();
 const q=quad.map(p=>mul(sub(p,quad[0]),1/scale)),uv:Point2[]=[[0,0],[1,0],[1,1],[0,1]],rows:number[][]=[];
 uv.forEach(([u,v],i)=>{const [x,y]=q[i];rows.push([u,v,1,0,0,0,-x*u,-x*v,x],[0,0,0,u,v,1,-y*u,-y*v,y]);});
 for(let k=0;k<8;k++){
  let pivot=k;for(let i=k+1;i<8;i++)if(Math.abs(rows[i][k])>Math.abs(rows[pivot][k]))pivot=i;
  [rows[k],rows[pivot]]=[rows[pivot],rows[k]];const den=rows[k][k];if(Math.abs(den)<1e-12)throw invalid();
  for(let j=k;j<=8;j++)rows[k][j]/=den;
  for(let i=0;i<8;i++)if(i!==k){const f=rows[i][k];for(let j=k;j<=8;j++)rows[i][j]-=f*rows[k][j];}
 }
 const a=rows.map(r=>r[8]);
 const coords=(p:Point2)=>[(p[0]-rect.min[0])/w,(p[1]-rect.min[1])/h];
 const denominator=(p:Point2)=>{const [u,v]=coords(p);return a[6]*u+a[7]*v+1;};
 function map(p:Point2):Point2{const [u,v]=coords(p),den=denominator(p);if(den<1e-4)throw invalid();return add(quad[0],mul([(a[0]*u+a[1]*v+a[2])/den,(a[3]*u+a[4]*v+a[5])/den],scale));}
 function vector(p:Point2,v:Point2):Point2{
  const [u,s]=coords(p),den=denominator(p),x=(a[0]*u+a[1]*s+a[2])/den,y=(a[3]*u+a[4]*s+a[5])/den;
  return mul([(a[0]-x*a[6])*v[0]/w+(a[1]-x*a[7])*v[1]/h,(a[3]-y*a[6])*v[0]/w+(a[4]-y*a[7])*v[1]/h],scale/den);
 }
 rectQuad(rect).forEach(map);
 // Exact row-major homography, also used by the nondestructive Assembly renderer.
 const x0=(scale*a[0]+quad[0][0]*a[6])/w,x1=(scale*a[1]+quad[0][0]*a[7])/h;
 const y0=(scale*a[3]+quad[0][1]*a[6])/w,y1=(scale*a[4]+quad[0][1]*a[7])/h;
 const z0=a[6]/w,z1=a[7]/h;
 const matrix:[number,number,number,number,number,number,number,number,number]=[
  x0,x1,scale*a[2]+quad[0][0]-x0*rect.min[0]-x1*rect.min[1],
  y0,y1,scale*a[5]+quad[0][1]-y0*rect.min[0]-y1*rect.min[1],
  z0,z1,1-z0*rect.min[0]-z1*rect.min[1]];
 return {map,vector,denominator,matrix,affine:Math.abs(a[6])+Math.abs(a[7])<1e-10};
}

export type DeformProjection=Pick<ReturnType<typeof quadProjection>,'map'|'vector'|'denominator'|'affine'>;
/** Shared editing field: normalized Coons boundary displacement, then the exact
 * four-corner homography. A neutral cage returns the original projection. */
export function drawingDeformProjection(rect:DeformRect,quad:Quad,bend?:BendValue):DeformProjection {
 const projection=quadProjection(rect,quad);
 if(!bend)return projection;
 assertBend(bend);if(isNeutralBend(bend))return projection;
 const w=rect.max[0]-rect.min[0],h=rect.max[1]-rect.min[1];
 const normalized=(p:Point2):Point2=>[(p[0]-rect.min[0])/w,(p[1]-rect.min[1])/h];
 const source=(p:Point2):Point2=>[rect.min[0]+p[0]*w,rect.min[1]+p[1]*h];
 const bent=(p:Point2)=>source(bendPoint(bend,normalized(p)));
 const map=(p:Point2)=>projection.map(bent(p));
 const vector=(p:Point2,v:Point2):Point2=>{const q=normalized(p),t=bendVector(bend,q,[v[0]/w,v[1]/h]);return projection.vector(source(bendPoint(bend,q)),[t[0]*w,t[1]*h]);};
 // Validate the interior as well as the curve's eventual samples. The bend
 // guard checks orientation; this guard checks the composed projective horizon.
 for(let j=0;j<=16;j++)for(let i=0;i<=16;i++)map(source([i/16,j/16]));
 return {map,vector,denominator:(p:Point2)=>projection.denominator(bent(p)),affine:false};
}
