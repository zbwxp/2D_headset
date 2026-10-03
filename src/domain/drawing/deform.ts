import {applyMirrorEditing,mirrorWritesForCurves} from './mirrorEditing';
import {add,sub,mul,length,shapeOf,curveById,type Point2,type Cubic,type DrawingDocument as Doc} from './model';
import {transform} from './commands';
// Hot fitting loop: evaluate the 2D cubic directly (no temporary 3D de Casteljau arrays).
const point=(s:Cubic,t:number):Point2=>{const u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,d=t*t*t;return [a*s[0][0]+b*s[1][0]+c*s[2][0]+d*s[3][0],a*s[0][1]+b*s[1][1]+c*s[2][1]+d*s[3][1]];};
import {displayField,displayPath} from './displayIntervals';
import {roundedJoins} from './roundedJoin';
import {assertBend,bendPoint,bendVector,isNeutralBend,type BendValue} from '../deformation/coons';

/** Counterclockwise in drawing coordinates: bottom left, bottom right, top right, top left. */
export type Quad=[Point2,Point2,Point2,Point2];
export interface DeformRect {min:Point2;max:Point2}
export const rectQuad=(r:DeformRect):Quad=>[[...r.min],[r.max[0],r.min[1]],[...r.max],[r.min[0],r.max[1]]];
const dot=(a:Point2,b:Point2)=>a[0]*b[0]+a[1]*b[1];
const cross=(a:Point2,b:Point2)=>a[0]*b[1]-a[1]*b[0];
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
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

export type DrawingDeformProjection=Pick<ReturnType<typeof quadProjection>,'map'|'vector'|'denominator'|'affine'>;
/** Shared editing field: normalized Coons boundary displacement, then the exact
 * four-corner homography. A neutral cage returns the original projection. */
export function drawingDeformProjection(rect:DeformRect,quad:Quad,bend?:BendValue):DrawingDeformProjection {
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

/** Projective reparameterization equalizes the rational cubic's endpoint weights.
 * This preserves source-point correspondence while avoiding tangential fit error on long curves. */
export const deformParameter=(t:number,scale:number)=>scale*t/(1+(scale-1)*t);
export interface CurveParameterMap {values:number[]}
export function mappedParameter(t:number,map?:CurveParameterMap){
 if(!map)return t;const x=clamp(t)*(map.values.length-1),i=Math.min(map.values.length-2,Math.floor(x));return map.values[i]+(map.values[i+1]-map.values[i])*(x-i);
}
/** Fit two positive handle lengths and monotonically refine point correspondence.
 * Endpoint positions and tangent rays remain exact throughout the geometric fit. */
function fit(shape:Cubic,f:DrawingDeformProjection){
 const count=128,scale=Math.cbrt(f.denominator(shape[3])/f.denominator(shape[0]));
 const values=Array.from({length:count+1},(_,i)=>f.affine?i/count:deformParameter(i/count,scale));
 if(f.affine)return {shape:shape.map(f.map) as Cubic,parameters:{values}};
 const targets=values.map((_,i)=>f.map(point(shape,i/count))),a=targets[0],b=targets[count],va=mul(f.vector(shape[0],sub(shape[1],shape[0])),1/scale),vb=mul(f.vector(shape[3],sub(shape[2],shape[3])),scale);
 const la=length(va),lb=length(vb),ta=mul(va,1/(la||1)),tb=mul(vb,1/(lb||1)),loA=la?la*.01:0,loB=lb?lb*.01:0,hiA=la*8,hiB=lb*8,bound=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
 let fitted:Cubic=[a,add(a,va),add(b,vb),b];
 for(let iteration=0;iteration<10;iteration++){
  let aa=0,ab=0,bb=0,ra=0,rb=0;
  for(let i=1;i<count;i++){
   const t=values[i],u=1-t,B1=3*u*u*t,B2=3*u*t*t,base=add(mul(a,u*u*u+B1),mul(b,B2+t*t*t)),r=sub(targets[i],base),x=mul(ta,B1),y=mul(tb,B2);
   aa+=dot(x,x);ab+=dot(x,y);bb+=dot(y,y);ra+=dot(x,r);rb+=dot(y,r);
  }
  const det=aa*bb-ab*ab,candidates:Point2[]=[];
  if(det>1e-15){const x=(ra*bb-rb*ab)/det,y=(rb*aa-ra*ab)/det;if(x>=loA&&x<=hiA&&y>=loB&&y<=hiB)candidates.push([x,y]);}
  for(const x of [loA,hiA])candidates.push([x,bound(bb?(rb-ab*x)/bb:0,loB,hiB)]);
  for(const y of [loB,hiB])candidates.push([bound(aa?(ra-ab*y)/aa:0,loA,hiA),y]);
  const score=([x,y]:Point2)=>aa*x*x+2*ab*x*y+bb*y*y-2*ra*x-2*rb*y;
  const [x,y]=candidates.sort((p,q)=>score(p)-score(q))[0];fitted=[a,add(a,mul(ta,x)),add(b,mul(tb,y)),b];
  // Closest-point Newton steps, constrained between neighbours to keep material order.
  for(let i=1;i<count;i++)for(let step=0;step<3;step++){
   const t=values[i],u=1-t,v=add(add(mul(sub(fitted[1],a),3*u*u),mul(sub(fitted[2],fitted[1]),6*u*t)),mul(sub(b,fitted[2]),3*t*t)),acc=add(mul(add(sub(fitted[2],mul(fitted[1],2)),a),6*u),mul(add(sub(b,mul(fitted[2],2)),fitted[1]),6*t)),r=sub(point(fitted,t),targets[i]),den=dot(v,v)+dot(r,acc);
   if(den<=1e-15)break;const next=bound(t-dot(r,v)/den,values[i-1]+1e-9,values[i+1]-1e-9);
   if(length(sub(point(fitted,next),targets[i]))>length(r))break;values[i]=next;
  }
  if(values.every((t,i)=>length(sub(point(fitted,t),targets[i]))<.00004))break;
 }
 return {shape:fitted,parameters:{values}};
}

type Field=ReturnType<typeof displayField>;
function distanceAt(part:Field['parts'][number],t:number){
 const i=Math.max(1,part.pts.findIndex(p=>p.t>=t)),lo=part.pts[i-1].t,hi=part.pts[i].t;
 return part.start+part.dist[i-1]+(part.dist[i]-part.dist[i-1])*clamp((t-lo)/(hi-lo||1));
}
/** Invert only this selected piece's arc table. A second whole-field lookup can
 * choose the adjacent piece at a floating-point seam and pair its t with the
 * previous source ID, moving a cut by an entire cubic. */
function parameterAt(part:Field['parts'][number],distance:number){
 const local=Math.max(0,Math.min(part.length,distance-part.start));let lo=0,hi=part.dist.length-1;
 while(hi-lo>1){const mid=(lo+hi)>>1;if(part.dist[mid]<=local)lo=mid;else hi=mid;}
 return part.pts[lo].t+(part.pts[hi].t-part.pts[lo].t)*(local-part.dist[lo])/(part.dist[hi]-part.dist[lo]||1);
}
/** Transport material positions, rather than retaining arc percentages after nonuniform deformation. */
export function transportDeformedIntervals(before:Doc,after:Doc,parameters=new Map<string,CurveParameterMap>()):Doc{
 if(!before.displayIntervals?.length)return after;
 const fields=new Map<string,[Field,Field]>();
 return {...after,displayIntervals:before.displayIntervals.map(track=>{
  const path=displayPath(before,track.anchor.id),key=path.segments.map(s=>s.id).join('|');
  const ids=new Set(path.segments.map(s=>s.id)),joins=(d:Doc)=>d.joins.filter(j=>ids.has(j.a.curveId)||ids.has(j.b.curveId));
  if(path.segments.every(s=>JSON.stringify(shapeOf(before,s.id))===JSON.stringify(shapeOf(after,s.id)))&&JSON.stringify(joins(before))===JSON.stringify(joins(after))&&JSON.stringify(before.endpointLinks)===JSON.stringify(after.endpointLinks))return track;
  let pair=fields.get(key);if(!pair){pair=[displayField(before,path),displayField(after,displayPath(after,track.anchor.id))];fields.set(key,pair);}
  const [old,next]=pair;if(old.total<1e-10||next.total<1e-10)throw Error('显示区间所在曲线退化，无法变形。');
  const move=(s:number)=>{
   const absolute=old.native(track,s)*old.total,index=Math.max(0,old.parts.findIndex(p=>absolute<=p.start+p.length+1e-12)),part=old.parts[index],piece=old.geometry.pieces[index];
   let dest:number;
   if(piece.joinId){
    const indices=old.geometry.pieces.flatMap((p,i)=>p.joinId===piece.joinId?[i]:[]),targets=next.geometry.pieces.flatMap((p,i)=>p.joinId===piece.joinId?[i]:[]);
    if(!targets.length)throw Error('圆弧过渡退化，无法保持显示区间。');
    const start=old.parts[indices[0]].start,total=indices.reduce((n,i)=>n+old.parts[i].length,0),endTotal=targets.reduce((n,i)=>n+next.parts[i].length,0);
    dest=next.parts[targets[0]].start+clamp((absolute-start)/(total||1))*endTotal;
   }else{
    const range=piece.sourceRange??[0,1],sourceT=range[0]+(range[1]-range[0])*parameterAt(part,absolute);
    const reversed=path.segments.find(u=>u.id===piece.owners[0])!.reverse,parameterMap=parameters.get(piece.owners[0]),native=reversed?1-mappedParameter(1-sourceT,parameterMap):mappedParameter(sourceT,parameterMap);
    const j=next.geometry.pieces.findIndex(p=>!p.joinId&&p.owners[0]===piece.owners[0]),r=next.geometry.pieces[j].sourceRange??[0,1];
    dest=distanceAt(next.parts[j],clamp((native-r[0])/(r[1]-r[0]||1)));
   }
   return next.relative(track,dest/next.total);
  };
  return {...track,ranges:track.ranges.map(r=>r.fullLoop?{...r,start:move(r.start),end:move(r.start)}:path.closed&&Math.abs(r.end-r.start)>1-1e-10?r:{...r,start:move(r.start),end:move(r.end)})};
 })};
}

export function deformDrawing(d:Doc,ids:string[],rect:DeformRect,quad:Quad,allowRelated=false,bend?:BendValue){
 if(ids.some(id=>curveById(d,id)?.locked))throw Error('所选曲线包含锁定成员，请先解锁。');
 const f=drawingDeformProjection(rect,quad,bend),curved=!!bend&&!isNeutralBend(bend),transformed=transform(d,ids,f.map,allowRelated);
 if(transformed===d&&(!curved||!ids.length))return {document:d,maxError:0,parameters:new Map<string,CurveParameterMap>()};
 // A curved field can fix every source control and still move its interior.
 const n=transformed===d?structuredClone(d):transformed;
 let maxError=0;const parameters=new Map<string,CurveParameterMap>();
 for(const id of ids){
  const shape=shapeOf(d,id);shape.forEach(f.map); // also guard authored controls outside the normalized cage
  const result=fit(shape,f),fitted=result.shape,c=curveById(n,id);parameters.set(id,result.parameters);c.handles=[fitted[1],fitted[2]];
  for(let i=0;i<=256;i++)maxError=Math.max(maxError,length(sub(point(fitted,mappedParameter(i/256,result.parameters)),f.map(point(shape,i/256)))));
 }
 // Under a nonlinear field a mapped control chord need not point along the
 // endpoint derivative. Keep partial Smooth neighbours on that exact ray.
 if(curved){const selected=new Set(ids);for(const j of n.joins)if(j.mode==='SMOOTH'&&selected.has(j.a.curveId)!==selected.has(j.b.curveId)){
  const e=selected.has(j.a.curveId)?j.b:j.a,s=shapeOf(d,e.curveId),p=s[e.end?3:0];
  curveById(n,e.curveId).handles[e.end]=add(f.map(p),f.vector(p,sub(s[e.end?2:1],p)));
 }}
 for(const j of n.joins)if(j.mode!=='CUSP')for(const e of [j.a,j.b]){const s=shapeOf(n,e.curveId);if(length(sub(s[e.end?2:1],s[e.end?3:0]))<1e-7)throw Error('变换会使连接柄退化。');}
 const oldArcs=roundedJoins(d),newArcs=roundedJoins(n);
 for(const [id,g] of newArcs)if(g.error&&!oldArcs.get(id)?.error)throw Error('变形会使圆弧接笔退化；已保留最后有效位置。');
 const mirrored=applyMirrorEditing(d,n,mirrorWritesForCurves(n,ids));
 if(d.mirrorEditing?.enabled)for(const pair of d.mirrorEditing.curvePairs){const a=parameters.get(pair.a),b=parameters.get(pair.b);if(!!a===!!b)continue;const from=a??b!,to=a?pair.b:pair.a;parameters.set(to,{values:pair.reverse?[...from.values].reverse().map(t=>1-t):[...from.values]});}
 return {document:transportDeformedIntervals(d,mirrored,parameters),maxError,parameters};
}
