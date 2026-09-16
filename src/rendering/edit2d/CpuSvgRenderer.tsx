import {useMemo} from 'react';
import type {EditRenderSnapshot,EditRenderStyle} from './types';
import {worldToSvg,EDIT_VIEWBOX,type OrthographicViewState} from '../orthographic';
import {screenIndex,type ProjectedTriangle} from '../../domain/geometry/screenIndex';
import {count,timed} from '../../domain/geometry/diagnostics';
const UNIT=EDIT_VIEWBOX.unitsPerWorld;
const point=(buffer:Float32Array,i:number)=>[buffer[i*3],buffer[i*3+1],buffer[i*3+2]];
/** Renderer-local depth classification. No layer counts or physical-transparency contract. */
export function behindSurface(triangles:ProjectedTriangle[],x:number,y:number,z:number):boolean{
 for(const tr of triangles){
  if(x<tr.minX||x>tr.maxX||y<tr.minY||y>tr.maxY)continue;
  const [a,b,c]=tr.pts,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-12)continue;
  const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;
  if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8&&u*a[2]+v*b[2]+(1-u-v)*c[2]>z+1e-4)return true;
 }
 return false;
}
/** CPU logical reference. A GPU replacement consumes the same snapshot/view/style, not this output. */
export function prepareCpuSvg(snapshot:EditRenderSnapshot,view:OrthographicViewState){
 const done=timed('projectionOcclusion');
 const triangles=snapshot.surface.flatMap(patch=>{
  const pts=Array.from({length:patch.positions.length/3},(_,i)=>worldToSvg(point(patch.positions,i),view));
  const result=[];
  for(let i=0;i<patch.indices.length;i+=3){
   const p=[pts[patch.indices[i]],pts[patch.indices[i+1]],pts[patch.indices[i+2]]];
   // Cross product in orthonormal camera coordinates; SVG has inverted/scaled XY.
   const a=p[1].map((x,k)=>x-p[0][k]),b=p[2].map((x,k)=>x-p[0][k]);a[0]/=UNIT;a[1]/=-UNIT;b[0]/=UNIT;b[1]/=-UNIT;
   const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
   const shade=.72+.28*Math.abs(n[2])/(Math.hypot(...n)||1);
   result.push({patch:patch.id,pts:p,shade,depth:(p[0][2]+p[1][2]+p[2][2])/3,minX:Math.min(...p.map(x=>x[0])),maxX:Math.max(...p.map(x=>x[0])),minY:Math.min(...p.map(x=>x[1])),maxY:Math.max(...p.map(x=>x[1]))});
  }return result;
 });
 const index=screenIndex(triangles);
 const curves=snapshot.curves.map(c=>{
  const pts=Array.from({length:c.samples.length/3},(_,i)=>worldToSvg(point(c.samples,i),view));
  const groups=['',''];
  for(let i=1;i<pts.length;i++){if(c.dashed&&i%6>=3)continue;const a=pts[i-1],b=pts[i],x=(a[0]+b[0])/2,y=(a[1]+b[1])/2,z=(a[2]+b[2])/2,candidates=index.query(x,y);count('occlusionCandidateTests',candidates.length);
   groups[behindSurface(candidates,x,y,z)?1:0]+=`M${a[0]},${a[1]}L${b[0]},${b[1]}`;
  }
  return {id:c.id,segments:groups.map((d,i)=>({d,behind:!!i})).filter(s=>s.d)};
 });
 triangles.sort((a,b)=>a.depth-b.depth);count('projectedTriangles',triangles.length);done();return {triangles,curves};
}
export interface Edit2DRendererProps{snapshot:EditRenderSnapshot;view:OrthographicViewState;style:EditRenderStyle}
export default function CpuSvgRenderer({snapshot,view,style}:Edit2DRendererProps){
 count('renderPatchLayer');
 const data=useMemo(()=>prepareCpuSvg(snapshot,view),[snapshot.geometryToken,view.orientationToken]);
 return <g data-testid="cpu-svg-renderer" pointerEvents="none">
  {snapshot.surface.length>0&&<g data-testid="patch-layer" data-layer="surface-render">
   {data.triangles.map((t,i)=><path key={i} d={`M${t.pts.map(x=>`${x[0]},${x[1]}`).join('L')}Z`} fill={`rgb(${Math.round(190*t.shade)},${Math.round(205*t.shade)},${Math.round(207*t.shade)})`} fillOpacity={style.surfaceOpacity} stroke="none"/>)}
  </g>}
  <g data-layer="curve-render">
   {data.curves.filter(c=>!style.selectedCurveIds.has(c.id)).map(c=><g key={c.id} data-testid={`patch-visible-curve-${c.id}`}>{c.segments.map((s,i)=><path key={i} d={s.d} data-depth={s.behind?'behind':'front'} fill="none" stroke="#ab9fdd" strokeWidth="1.5" strokeOpacity={s.behind?style.hiddenCurveOpacity:1} vectorEffect="non-scaling-stroke"/>)}</g>)}
  </g>
 </g>;
}
