import {useId} from 'react';
import type {ContourMist,Point2} from '../../domain/drawing/model';
import {pathOf,outlinePath,type InkRun} from '../../domain/drawing/appearance';
import {inkEdgeStyle,inkEdgeParameters} from '../../domain/drawing/mist';

/** The effect replaces the visible ink; it is not an image behind sharp ink.
 * Browser-native filtering avoids canvas readbacks, PNG encoding and bitmap
 * caches per interpolated frame. Fill effects and hit geometry are independent. */
export default function MistInk({runs,mist,screen,unit,width,strokeId,owner}:{runs:InkRun[];mist?:ContourMist;screen:(p:Point2)=>Point2;unit:number;width:number;strokeId?:string;owner?:string}){
 const id=useId(),style=inkEdgeStyle(mist),enabled=style.enabled&&style.density>0;
 if(!runs.length)return null;
 const origin=enabled?screen(runs[0].shapes[0][0]):[0,0];
 const local=(p:Point2):Point2=>{const q=screen(p);return [+(q[0]-origin[0]).toFixed(3),+(q[1]-origin[1]).toFixed(3)];};
 const params=inkEdgeParameters(style,width,unit),pad=width*unit/2+params.sigma*4+params.displacement+1;
 const bounds=enabled?runs.flatMap(r=>[...r.shapes.flat(),...r.outline,...r.tips.flat()]).reduce((b,p)=>{const q=local(p);return [Math.min(b[0],q[0]),Math.min(b[1],q[1]),Math.max(b[2],q[0]),Math.max(b[3],q[1])];},[Infinity,Infinity,-Infinity,-Infinity]):[];
 return <g data-testid={enabled?'assembly-drawing-ink-edge':undefined} data-id={owner} transform={enabled?`translate(${origin[0]} ${origin[1]})`:undefined} pointerEvents="none" aria-hidden="true">
  {enabled&&<defs><filter id={id} filterUnits="userSpaceOnUse" x={bounds[0]-pad} y={bounds[1]-pad} width={bounds[2]-bounds[0]+pad*2} height={bounds[3]-bounds[1]+pad*2} colorInterpolationFilters="sRGB">
   <feTurbulence type="fractalNoise" baseFrequency={params.frequency} numOctaves="1" seed="17" result="edge-drift"/>
   <feDisplacementMap in="SourceGraphic" in2="edge-drift" scale={params.displacement} xChannelSelector="R" yChannelSelector="G" result="ink"/>
   <feGaussianBlur in="ink" stdDeviation={params.sigma}/>
   {/* Five tonal anchors, interpolated continuously: no dots or posterized bands. */}
   <feComponentTransfer><feFuncA type="table" tableValues="0 .18 .65 .94 1"/></feComponentTransfer>
   <feComposite in2="SourceGraphic" operator="arithmetic" k1="0" k2={params.mix} k3={1-params.mix} k4="0"/>
  </filter></defs>}
  <g filter={enabled?`url(#${id})`:undefined}>{runs.map((run,i)=><g key={i}>
   <path data-testid="assembly-drawing-ink" data-stroke={strokeId} data-id={owner} d={run.uniform?pathOf(run.shapes,local,run.closed):outlinePath(run.outline,local)} fill={run.uniform?'none':'#191e22'} stroke={run.uniform?'#191e22':'none'} strokeWidth={width*unit} strokeLinecap={run.clipped?'butt':'round'} strokeLinejoin="round"/>
   {run.uniform&&run.tips.map((tip,j)=><path key={j} data-testid="assembly-drawing-cusp-tip" d={outlinePath(tip,local)} fill="#191e22"/>)}
  </g>)}</g>
 </g>;
}
