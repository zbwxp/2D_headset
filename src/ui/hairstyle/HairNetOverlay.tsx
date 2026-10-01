import {memo,useMemo} from 'react';
import type {HairGeometry,HairMesh} from '../../domain/hairstyle/geometry';
import type {Vec3} from '../../domain/hairstyle/model';
import {hairBasis,type HairView} from '../../domain/hairstyle/projection';

type Props=Pick<HairGeometry,'shell'|'base'|'rim'|'netLines'>&{
 view:HairView;width:number;height:number;unit:number;panX:number;panY:number;opacity:number;
};

/** A lightweight projection of the existing construction mesh. It shares the
 * contour's camera/transform, without a second WebGL context or strand solve. */
function HairNetOverlay({shell,base,rim,netLines,view,width,height,unit,panX,panY,opacity}:Props){
 const paths=useMemo(()=>{
  const {right,up}=hairBasis(view);
  const project=(p:Vec3)=>[p[0]*right[0]+p[1]*right[1]+p[2]*right[2],p[0]*up[0]+p[1]*up[1]+p[2]*up[2]];
  const coordinate=(p:number[])=>p.map(v=>v.toFixed(5)).join(',');
  const mesh=(m:HairMesh)=>{
   const points=m.vertices.map(project),xy=points.map(coordinate);
   // All projected triangles use the same winding: one nonzero-fill path
   // gives the shell's silhouette, without dark overlapping translucent faces.
   return m.triangles.map(([a,b,c])=>{
    const A=points[a],B=points[b],C=points[c];
    const cross=(B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0]);
    if(Math.abs(cross)<1e-12)return '';
    return cross>0?`M${xy[a]}L${xy[b]}L${xy[c]}Z`:`M${xy[a]}L${xy[c]}L${xy[b]}Z`;
   }).join('');
  };
  const line=(points:Vec3[])=>points.map((p,i)=>(i?'L':'M')+coordinate(project(p))).join('');
  return {shell:mesh(shell),base:base?mesh(base):'',rim:rim?line(rim):'',wire:netLines.map(line).join('')};
 },[shell,base,rim,netLines,view.yaw,view.pitch]);
 return <g data-testid="hair-net-overlay" aria-hidden="true" pointerEvents="none" opacity={opacity}
  transform={`translate(${width/2+panX*unit},${height/2+panY*unit}) scale(${unit},${-unit})`}>
  <path d={paths.shell} fill="#527d86" fillOpacity=".24" fillRule="nonzero"/>
  <path d={paths.base} fill="#b18c52" fillOpacity=".16" fillRule="nonzero"/>
  <path d={paths.wire} fill="none" stroke="#417882" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
  <path d={paths.rim} fill="none" stroke="#b47b35" strokeWidth="1.4" vectorEffect="non-scaling-stroke"/>
 </g>;
}
export default memo(HairNetOverlay);
